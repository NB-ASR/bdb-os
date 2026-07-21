import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isFounderBootstrapEnabled,
  matchesFounderBootstrapControl,
} from "@/lib/security/bootstrap";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init?.headers },
  });
}

function suppliedControl(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type BootstrapResult = {
  email: string;
  status: string;
  outcome?: "created" | "granted" | "already-configured";
};

type PreparedFounder = {
  email: string;
  fullName: string;
  existingUser?: User;
  existingAdmin: { role: string; active: boolean } | null;
  existingProfile: { id: string; is_active: boolean } | null;
};

export async function POST(request: Request) {
  if (!isFounderBootstrapEnabled()) {
    return json({ error: "Founder bootstrap is disabled." }, { status: 410 });
  }

  const expectedControl = process.env.FOUNDER_BOOTSTRAP_SECRET;
  if (!matchesFounderBootstrapControl(expectedControl, suppliedControl(request))) {
    return json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const admin = createAdminClient();
  const temporaryPassword = process.env.FOUNDER_INITIAL_PASSWORD;
  const founderEmails = (process.env.BDB_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const founderNames = (process.env.BDB_FOUNDER_NAMES ?? "")
    .split(",")
    .map((name) => name.trim());

  if (!admin || !temporaryPassword || founderEmails.length === 0) {
    return json({ error: "Founder bootstrap is not configured." }, { status: 503 });
  }
  if (temporaryPassword.length < 16) {
    return json({ error: "The temporary password must be at least 16 characters." }, { status: 400 });
  }
  if (temporaryPassword === expectedControl) {
    return json({ error: "Bootstrap control and temporary password must be different." }, { status: 400 });
  }
  if (new Set(founderEmails).size !== founderEmails.length || founderEmails.some((email) => !validEmail(email))) {
    return json({ error: "Founder email configuration is invalid or duplicated." }, { status: 400 });
  }

  const { count: configuredAdmins, error: adminCountError } = await admin
    .from("platform_admins")
    .select("user_id", { count: "exact", head: true });
  if (adminCountError) return json({ error: "Founder bootstrap preflight failed." }, { status: 500 });
  if ((configuredAdmins ?? 0) > 0 && process.env.BDB_FOUNDER_BOOTSTRAP_ALLOW_EXISTING !== "true") {
    return json(
      {
        error: "Founder access already exists. Keep bootstrap disabled and use a reviewed manual recovery procedure.",
      },
      { status: 409 },
    );
  }

  const { data: proPlan, error: planError } = await admin
    .from("plans")
    .select("id")
    .eq("code", "pro")
    .eq("is_active", true)
    .maybeSingle();
  if (planError || !proPlan) {
    return json({ error: planError?.message ?? "The Pro plan is unavailable." }, { status: 500 });
  }

  const { data: userPage, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return json({ error: "Founder bootstrap user preflight failed." }, { status: 500 });
  const existingByEmail = new Map(userPage.users.map((user) => [user.email?.toLowerCase(), user]));

  const prepared: PreparedFounder[] = [];
  for (const [index, email] of founderEmails.entries()) {
    const existingUser = existingByEmail.get(email);
    let existingAdmin: PreparedFounder["existingAdmin"] = null;
    let existingProfile: PreparedFounder["existingProfile"] = null;

    if (existingUser) {
      const [adminResult, profileResult] = await Promise.all([
        admin
          .from("platform_admins")
          .select("role,active")
          .eq("user_id", existingUser.id)
          .maybeSingle(),
        admin
          .from("profiles")
          .select("id,is_active")
          .eq("id", existingUser.id)
          .maybeSingle(),
      ]);
      if (adminResult.error || profileResult.error) {
        return json({ error: "Founder bootstrap identity preflight failed." }, { status: 500 });
      }
      existingAdmin = adminResult.data;
      existingProfile = profileResult.data;
      if (existingAdmin && (existingAdmin.role !== "founder" || !existingAdmin.active)) {
        return json({ error: "Existing platform access requires manual review." }, { status: 409 });
      }
      if (existingProfile && !existingProfile.is_active) {
        return json({ error: "An inactive Founder profile requires manual recovery review." }, { status: 409 });
      }
    }

    prepared.push({
      email,
      fullName: founderNames[index] || email.split("@")[0],
      existingUser,
      existingAdmin,
      existingProfile,
    });
  }

  const workspaceSlug = process.env.BDB_INTERNAL_WORKSPACE_SLUG?.trim() || "bdb-os";
  const workspaceName = process.env.BDB_INTERNAL_WORKSPACE_NAME?.trim() || "BDB OS";
  const { data: existingWorkspace, error: workspaceLookupError } = await admin
    .from("workspaces")
    .select("id,status,plan_id")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspaceLookupError) {
    return json({ error: "Founder workspace preflight failed." }, { status: 500 });
  }
  if (
    existingWorkspace &&
    (!( ["trial", "active"] as string[]).includes(existingWorkspace.status) || existingWorkspace.plan_id !== proPlan.id)
  ) {
    return json({ error: "The existing Founder workspace requires manual review." }, { status: 409 });
  }

  let workspaceId = existingWorkspace?.id as string | undefined;
  let createdWorkspace = false;
  const createdAuthUserIds: string[] = [];
  const createdProfileIds: string[] = [];
  const createdAdminIds: string[] = [];
  const createdMembershipUserIds: string[] = [];
  const results: BootstrapResult[] = [];
  const cleanupAdmin = admin;

  async function cleanupCreatedResources() {
    if (workspaceId && createdMembershipUserIds.length) {
      await cleanupAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("user_id", createdMembershipUserIds);
    }
    if (createdAdminIds.length) {
      await cleanupAdmin.from("platform_admins").delete().in("user_id", createdAdminIds);
    }
    if (createdProfileIds.length) {
      await cleanupAdmin.from("profiles").delete().in("id", createdProfileIds);
    }
    for (const userId of createdAuthUserIds) {
      await cleanupAdmin.auth.admin.deleteUser(userId);
    }
    if (createdWorkspace && workspaceId) {
      await cleanupAdmin.from("workspaces").delete().eq("id", workspaceId);
    }
  }

  try {
    if (!workspaceId) {
      const { data, error } = await admin
        .from("workspaces")
        .insert({ slug: workspaceSlug, name: workspaceName, status: "active", plan_id: proPlan.id })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Workspace creation failed");
      workspaceId = data.id;
      createdWorkspace = true;

      const [{ error: settingsError }, { error: themeError }] = await Promise.all([
        admin.from("workspace_settings").insert({
          workspace_id: workspaceId,
          owner_name: "Founders",
          email: founderEmails[0],
          currency: "EUR",
          invoice_prefix: "BDB",
          vat_rate: 18,
          timezone: "Europe/Malta",
        }),
        admin.from("workspace_themes").insert({
          workspace_id: workspaceId,
          preset: "obsidian-gold",
          mode: "dark",
          accent_color: "#d3a84b",
          font_family: "manrope",
          text_scale: 1,
          density: "comfortable",
          high_contrast: false,
          reduced_motion: false,
        }),
      ]);
      if (settingsError || themeError) throw settingsError ?? themeError;
    }

    for (const founder of prepared) {
      let user = founder.existingUser;
      let createdAuthUser = false;

      if (!user) {
        const created = await admin.auth.admin.createUser({
          email: founder.email,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { founder_bootstrap: true, full_name: founder.fullName },
        });
        if (created.error || !created.data.user) {
          throw created.error ?? new Error("Founder Auth user creation failed");
        }
        user = created.data.user;
        createdAuthUser = true;
        createdAuthUserIds.push(user.id);
      }

      const { data: currentProfile, error: profileLookupError } = await admin
        .from("profiles")
        .select("id,is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      if (currentProfile && !currentProfile.is_active) {
        throw new Error("Inactive Founder profile requires manual review");
      }
      if (!currentProfile) {
        const { error } = await admin.from("profiles").insert({
          id: user.id,
          full_name: founder.fullName,
          is_active: true,
          must_change_password: createdAuthUser,
          active_workspace_id: workspaceId,
        });
        if (error) throw error;
        if (!createdAuthUser) createdProfileIds.push(user.id);
      } else if (createdAuthUser) {
        const { error } = await admin
          .from("profiles")
          .update({
            full_name: founder.fullName,
            is_active: true,
            must_change_password: true,
            active_workspace_id: workspaceId,
          })
          .eq("id", user.id);
        if (error) throw error;
      }

      if (!founder.existingAdmin) {
        const { error } = await admin.from("platform_admins").insert({
          user_id: user.id,
          role: "founder",
          active: true,
        });
        if (error) throw error;
        createdAdminIds.push(user.id);
      }

      const { data: currentMembership, error: membershipLookupError } = await admin
        .from("workspace_memberships")
        .select("role,status,access_profile")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipLookupError) throw membershipLookupError;
      if (currentMembership) {
        if (
          currentMembership.status !== "active" ||
          currentMembership.role !== "owner" ||
          currentMembership.access_profile !== "owner"
        ) {
          throw new Error("Existing Founder workspace membership requires manual review");
        }
      } else {
        const { error } = await admin.from("workspace_memberships").insert({
          workspace_id: workspaceId,
          user_id: user.id,
          role: "owner",
          status: "active",
          access_profile: "owner",
          joined_at: new Date().toISOString(),
          invitation_expires_at: null,
        });
        if (error) throw error;
        createdMembershipUserIds.push(user.id);
      }

      results.push({
        email: founder.email,
        status: "ready",
        outcome: createdAuthUser
          ? "created"
          : founder.existingAdmin
            ? "already-configured"
            : "granted",
      });
    }
  } catch (error) {
    console.error("Founder bootstrap failed; cleaning up created resources", error);
    await cleanupCreatedResources();
    await admin.from("audit_logs").insert({
      action: "platform.founder_bootstrap_failed",
      entity_type: "platform",
      metadata: {
        configured_founders_before_failure: results.length,
        total_requested: founderEmails.length,
      },
    });
    return json({ error: "Founder bootstrap failed and created resources were rolled back." }, { status: 500 });
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    action: "platform.founder_bootstrap_executed",
    entity_type: "platform",
    metadata: {
      configured_founders: results.length,
      total_requested: founderEmails.length,
    },
  });
  if (auditError) {
    console.error("Founder bootstrap completed but audit recording failed", auditError);
  }

  return json({
    ok: true,
    workspace: { id: workspaceId, slug: workspaceSlug, name: workspaceName, plan: "pro" },
    results,
    next: "Disable BDB_FOUNDER_BOOTSTRAP_ENABLED and remove FOUNDER_INITIAL_PASSWORD after verification.",
  });
}

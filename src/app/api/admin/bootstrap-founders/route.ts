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

type BootstrapResult = {
  email: string;
  status: string;
  outcome?: "created" | "granted" | "already-configured";
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

  const workspaceSlug = process.env.BDB_INTERNAL_WORKSPACE_SLUG?.trim() || "bdb-os";
  const workspaceName = process.env.BDB_INTERNAL_WORKSPACE_NAME?.trim() || "BDB OS";
  const { data: existingWorkspace, error: workspaceLookupError } = await admin
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspaceLookupError) {
    return json({ error: workspaceLookupError.message }, { status: 500 });
  }

  let workspaceId = existingWorkspace?.id as string | undefined;
  if (workspaceId) {
    const { error } = await admin
      .from("workspaces")
      .update({ name: workspaceName, status: "active", plan_id: proPlan.id })
      .eq("id", workspaceId);
    if (error) return json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await admin
      .from("workspaces")
      .insert({ slug: workspaceSlug, name: workspaceName, status: "active", plan_id: proPlan.id })
      .select("id")
      .single();
    if (error || !data) {
      return json({ error: error?.message ?? "Workspace creation failed." }, { status: 500 });
    }
    workspaceId = data.id;
  }

  const [{ error: settingsError }, { error: themeError }] = await Promise.all([
    admin.from("workspace_settings").upsert({
      workspace_id: workspaceId,
      owner_name: "Founders",
      email: founderEmails[0],
      currency: "EUR",
      invoice_prefix: "BDB",
      vat_rate: 18,
      timezone: "Europe/Malta",
    }, { onConflict: "workspace_id" }),
    admin.from("workspace_themes").upsert({
      workspace_id: workspaceId,
      preset: "obsidian-gold",
      mode: "dark",
      accent_color: "#d3a84b",
      font_family: "manrope",
      text_scale: 1,
      density: "comfortable",
      high_contrast: false,
      reduced_motion: false,
    }, { onConflict: "workspace_id" }),
  ]);
  if (settingsError || themeError) {
    return json({ error: settingsError?.message ?? themeError?.message }, { status: 500 });
  }

  const { data: userPage, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return json({ error: listError.message }, { status: 500 });

  const existingByEmail = new Map(userPage.users.map((user) => [user.email?.toLowerCase(), user]));
  const results: BootstrapResult[] = [];

  for (const [index, email] of founderEmails.entries()) {
    const fullName = founderNames[index] || email.split("@")[0];
    let user = existingByEmail.get(email);
    let createdAuthUser = false;

    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { founder_bootstrap: true, full_name: fullName },
      });
      if (created.error || !created.data.user) {
        results.push({ email, status: created.error?.message ?? "creation failed" });
        continue;
      }
      user = created.data.user;
      createdAuthUser = true;
    }

    const { data: existingAdmin, error: adminLookupError } = await admin
      .from("platform_admins")
      .select("role,active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (adminLookupError) {
      if (createdAuthUser) await admin.auth.admin.deleteUser(user.id);
      results.push({ email, status: adminLookupError.message });
      continue;
    }
    if (existingAdmin && (existingAdmin.role !== "founder" || !existingAdmin.active)) {
      results.push({ email, status: "Existing platform access requires manual review." });
      continue;
    }

    try {
      const { data: existingProfile, error: profileLookupError } = await admin
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;

      if (existingProfile) {
        const updates: Record<string, unknown> = {
          full_name: fullName,
          active_workspace_id: workspaceId,
        };
        if (createdAuthUser) {
          updates.is_active = true;
          updates.must_change_password = true;
        }
        const { error } = await admin.from("profiles").update(updates).eq("id", user.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("profiles").insert({
          id: user.id,
          full_name: fullName,
          is_active: true,
          must_change_password: createdAuthUser,
          active_workspace_id: workspaceId,
        });
        if (error) throw error;
      }

      if (!existingAdmin) {
        const { error } = await admin.from("platform_admins").insert({
          user_id: user.id,
          role: "founder",
          active: true,
        });
        if (error) throw error;
      }

      const { error: membershipError } = await admin.from("workspace_memberships").upsert({
        workspace_id: workspaceId,
        user_id: user.id,
        role: "owner",
        status: "active",
        access_profile: "owner",
        joined_at: new Date().toISOString(),
        invitation_expires_at: null,
      }, { onConflict: "workspace_id,user_id" });
      if (membershipError) throw membershipError;

      await admin.from("audit_logs").insert({
        actor_user_id: user.id,
        workspace_id: workspaceId,
        action: "platform.founder_workspace_ready",
        entity_type: "workspace_membership",
        entity_id: workspaceId,
        metadata: {
          email,
          full_name: fullName,
          auth_user_created: createdAuthUser,
          workspace_role: "owner",
        },
      });

      results.push({
        email,
        status: "ready",
        outcome: createdAuthUser ? "created" : existingAdmin ? "already-configured" : "granted",
      });
    } catch (error) {
      if (createdAuthUser) await admin.auth.admin.deleteUser(user.id);
      results.push({
        email,
        status: error instanceof Error ? error.message : "bootstrap failed",
      });
    }
  }

  await admin.from("audit_logs").insert({
    action: "platform.founder_bootstrap_executed",
    entity_type: "platform",
    metadata: {
      configured_founders: results.filter((result) => result.status === "ready").length,
      total_requested: founderEmails.length,
    },
  });

  return json({
    ok: results.every((result) => result.status === "ready"),
    workspace: { id: workspaceId, slug: workspaceSlug, name: workspaceName, plan: "pro" },
    results,
    next: "Disable BDB_FOUNDER_BOOTSTRAP_ENABLED and remove FOUNDER_INITIAL_PASSWORD after verification.",
  });
}

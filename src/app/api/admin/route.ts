import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

async function listUsers(admin: AdminClient) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

async function findUserByEmail(admin: AdminClient, email: string): Promise<User | undefined> {
  const users = await listUsers(admin);
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

async function sendExistingUserInvite(email: string, redirectTo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NOT_CONFIGURED");
  const client = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) throw error;
}

async function dashboard(admin: AdminClient) {
  const [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    audit,
    users,
  ] = await Promise.all([
    admin.from("workspaces").select("*").order("created_at", { ascending: false }),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("features").select("*").order("sort_order"),
    admin.from("plan_features").select("*"),
    admin.from("workspace_feature_overrides").select("*"),
    admin.from("subscriptions").select("*"),
    admin.from("contracts").select("*"),
    admin
      .from("workspace_memberships")
      .select("workspace_id,user_id,role,access_profile,status,created_at,joined_at,invitation_expires_at,invitation_last_sent_at,profiles(full_name)"),
    admin.from("business_groups").select("*").order("name"),
    admin.from("business_group_workspaces").select("group_id,workspace_id,created_at"),
    admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100),
    listUsers(admin),
  ]);
  const results = [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    audit,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const usersById = new Map(users.map((user) => [user.id, user]));

  return {
    workspaces: workspaces.data ?? [],
    plans: plans.data ?? [],
    features: features.data ?? [],
    planFeatures: planFeatures.data ?? [],
    overrides: overrides.data ?? [],
    subscriptions: subscriptions.data ?? [],
    contracts: contracts.data ?? [],
    memberships: (memberships.data ?? []).map((membership) => ({
      ...membership,
      email: usersById.get(membership.user_id)?.email ?? "",
    })),
    groups: groups.data ?? [],
    groupLinks: groupLinks.data ?? [],
    audit: audit.data ?? [],
  };
}

function cleanSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    return Response.json(await dashboard(admin));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as { action?: string; [key: string]: unknown };

    if (body.action === "create-group") {
      const name = String(body.name ?? "").trim();
      const slug = cleanSlug(body.slug || name);
      if (name.length < 2 || slug.length < 3) {
        return Response.json({ error: "Enter a valid group name and slug." }, { status: 400 });
      }
      const { data, error } = await admin
        .from("business_groups")
        .insert({ name, slug, created_by: identity.userId })
        .select("id")
        .single();
      if (error) throw error;
      await admin.from("audit_logs").insert({
        actor_user_id: identity.userId,
        action: "business_group.created",
        entity_type: "business_group",
        entity_id: data.id,
        metadata: { name, slug },
      });
      return Response.json({ ok: true, groupId: data.id });
    }

    if (body.action !== "create-workspace") {
      return Response.json({ error: "Unsupported action." }, { status: 400 });
    }

    const name = String(body.name ?? "").trim();
    const legalName = String(body.legalName ?? "").trim() || null;
    const slug = cleanSlug(body.slug);
    const ownerName = String(body.ownerName ?? "").trim();
    const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
    const planId = String(body.planId ?? "");
    const selectedFeatures = Array.isArray(body.features)
      ? body.features.map(String)
      : null;
    if (!name || slug.length < 3 || ownerName.length < 2 || !validEmail(ownerEmail) || !planId) {
      return Response.json(
        { error: "Business name, slug, owner name, owner email and plan are required." },
        { status: 400 },
      );
    }

    const { data: plan } = await admin.from("plans").select("id").eq("id", planId).eq("is_active", true).maybeSingle();
    if (!plan) return Response.json({ error: "Choose an active plan." }, { status: 400 });

    const workspaceId = crypto.randomUUID();
    let invitedUser: User | undefined;
    let createdAuthUser = false;
    try {
      const { error: workspaceError } = await admin.from("workspaces").insert({
        id: workspaceId,
        name,
        legal_name: legalName,
        slug,
        status: "trial",
        plan_id: planId,
      });
      if (workspaceError) throw workspaceError;

      const existing = await findUserByEmail(admin, ownerEmail);
      invitedUser = existing;
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const redirectTo = `${origin}/auth/callback?next=/activate`;
      if (!invitedUser) {
        const invite = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
          data: { full_name: ownerName, workspace_id: workspaceId, access_profile: "owner" },
          redirectTo,
        });
        if (invite.error || !invite.data.user) throw invite.error ?? new Error("Could not invite owner");
        invitedUser = invite.data.user;
        createdAuthUser = true;
      } else {
        await sendExistingUserInvite(ownerEmail, redirectTo);
      }

      const now = new Date();
      const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const setupResults = await Promise.all([
        admin.from("profiles").upsert({ id: invitedUser.id, full_name: ownerName, is_active: true }, { onConflict: "id" }),
        admin.from("workspace_memberships").upsert({
          workspace_id: workspaceId,
          user_id: invitedUser.id,
          role: "owner",
          access_profile: "owner",
          status: "invited",
          invited_by: identity.userId,
          invitation_last_sent_at: now.toISOString(),
          invitation_expires_at: expiry,
        }, { onConflict: "workspace_id,user_id" }),
        admin.from("workspace_settings").insert({
          workspace_id: workspaceId,
          owner_name: ownerName,
          email: ownerEmail,
        }),
        admin.from("workspace_themes").insert({
          workspace_id: workspaceId,
          preset: "obsidian-gold",
          mode: "dark",
          accent_color: "#d3a84b",
          font_family: "manrope",
          text_scale: 1,
          density: "comfortable",
        }),
      ]);
      const setupFailure = setupResults.find((result) => result.error);
      if (setupFailure?.error) throw setupFailure.error;

      if (selectedFeatures) {
        const { data: allFeatures, error: featureError } = await admin.from("features").select("key").eq("is_active", true);
        if (featureError) throw featureError;
        const selected = new Set(selectedFeatures);
        const { error: overrideError } = await admin.from("workspace_feature_overrides").upsert(
          (allFeatures ?? []).map((feature) => ({
            workspace_id: workspaceId,
            feature_key: feature.key,
            enabled: selected.has(feature.key),
            reason: "Selected during client provisioning",
            starts_at: now.toISOString(),
            created_by: identity.userId,
          })),
          { onConflict: "workspace_id,feature_key" },
        );
        if (overrideError) throw overrideError;
      }

      await admin.from("audit_logs").insert({
        actor_user_id: identity.userId,
        workspace_id: workspaceId,
        action: "workspace.created",
        entity_type: "workspace",
        entity_id: workspaceId,
        metadata: {
          name,
          legal_name: legalName,
          slug,
          owner_name: ownerName,
          owner_email: ownerEmail,
          plan_id: planId,
          selected_features: selectedFeatures,
        },
      });
      return Response.json({ ok: true, workspaceId, invitationExpiresAt: expiry });
    } catch (error) {
      await admin.from("workspaces").delete().eq("id", workspaceId);
      if (createdAuthUser && invitedUser) await admin.auth.admin.deleteUser(invitedUser.id);
      throw error;
    }
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      action?: string;
      workspaceId?: string;
      planId?: string;
      featureKey?: string;
      enabled?: boolean;
      status?: string;
      reason?: string;
      groupId?: string;
      userId?: string;
    };

    if (body.action === "feature-override" && body.workspaceId && body.featureKey) {
      const { error } = await admin.from("workspace_feature_overrides").upsert({
        workspace_id: body.workspaceId,
        feature_key: body.featureKey,
        enabled: Boolean(body.enabled),
        reason: body.reason || "Founder override",
        created_by: identity.userId,
        starts_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,feature_key" });
      if (error) throw error;
    } else if (body.action === "plan-feature" && body.planId && body.featureKey) {
      const { error } = await admin.from("plan_features").upsert({
        plan_id: body.planId,
        feature_key: body.featureKey,
        enabled: Boolean(body.enabled),
      }, { onConflict: "plan_id,feature_key" });
      if (error) throw error;
    } else if (body.action === "workspace-plan" && body.workspaceId && body.planId) {
      const { error } = await admin.from("workspaces").update({ plan_id: body.planId }).eq("id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "workspace-status" && body.workspaceId && body.status) {
      const allowed = ["trial", "active", "suspended", "cancelled"];
      if (!allowed.includes(body.status)) return Response.json({ error: "Invalid status." }, { status: 400 });
      const { error } = await admin.from("workspaces").update({ status: body.status }).eq("id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "link-workspace" && body.workspaceId && body.groupId) {
      await admin.from("business_group_workspaces").delete().eq("workspace_id", body.workspaceId);
      const { error } = await admin.from("business_group_workspaces").insert({
        group_id: body.groupId,
        workspace_id: body.workspaceId,
        created_by: identity.userId,
      });
      if (error) throw error;
    } else if (body.action === "unlink-workspace" && body.workspaceId) {
      const { error } = await admin.from("business_group_workspaces").delete().eq("workspace_id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "resend-owner-invite" && body.workspaceId) {
      const { data: membership } = await admin
        .from("workspace_memberships")
        .select("user_id,status")
        .eq("workspace_id", body.workspaceId)
        .eq("role", "owner")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!membership) return Response.json({ error: "No Business Owner invitation was found." }, { status: 404 });
      if (membership.status !== "invited") return Response.json({ error: "The Business Owner has already activated access." }, { status: 409 });
      const users = await listUsers(admin);
      const email = users.find((user) => user.id === membership.user_id)?.email;
      if (!email) return Response.json({ error: "The invited owner's email could not be found." }, { status: 404 });
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      await sendExistingUserInvite(email, `${origin}/auth/callback?next=/activate`);
      const now = new Date();
      const { error } = await admin.from("workspace_memberships").update({
        invitation_last_sent_at: now.toISOString(),
        invitation_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }).eq("workspace_id", body.workspaceId).eq("user_id", membership.user_id);
      if (error) throw error;
    } else if (body.action === "support-access" && body.workspaceId && body.reason?.trim()) {
      // Audit record below is mandatory before any founder support workflow.
    } else {
      return Response.json({ error: "Invalid action." }, { status: 400 });
    }

    await admin.from("audit_logs").insert({
      actor_user_id: identity.userId,
      workspace_id: body.workspaceId ?? null,
      action: `admin.${body.action}`,
      entity_type: body.groupId ? "business_group" : body.featureKey ? "feature" : "workspace",
      entity_id: body.groupId ?? body.featureKey ?? body.workspaceId ?? body.planId ?? null,
      metadata: body,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

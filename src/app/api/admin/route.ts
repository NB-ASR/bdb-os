import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { activationRedirectUrl, invitationExpiresAt } from "@/lib/auth/invitations";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
type AuditRow = {
  id: number;
  actor_user_id: string | null;
  workspace_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type WorkspaceRow = {
  id: string;
  created_at: string;
  [key: string]: unknown;
};

const WORKSPACE_CREATION_ACTIONS = new Set(["workspace.created", "workspace.manually_provisioned"]);
const NON_MODIFYING_FOUNDER_ACTIONS = new Set(["platform.founder_workspace_ready", "admin.support-access"]);

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

async function writeAudit(admin: AdminClient, record: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert(record);
  if (error) throw error;
}

function actorDetails(
  userId: string | null,
  profilesById: Map<string, string>,
  usersById: Map<string, User>,
) {
  if (!userId) return { name: null, email: null };
  const user = usersById.get(userId);
  const metadataName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  return {
    name: profilesById.get(userId) || metadataName || user?.email || null,
    email: user?.email ?? null,
  };
}

function enrichAudit(
  row: AuditRow,
  profilesById: Map<string, string>,
  usersById: Map<string, User>,
  platformAdminIds: Set<string>,
) {
  const actor = actorDetails(row.actor_user_id, profilesById, usersById);
  return {
    ...row,
    metadata: row.metadata ?? {},
    actor_name: actor.name,
    actor_email: actor.email,
    actor_is_platform_admin: Boolean(row.actor_user_id && platformAdminIds.has(row.actor_user_id)),
  };
}

async function dashboard(admin: AdminClient) {
  const [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    templates,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    recentAudit,
    workspaceAudit,
    profiles,
    platformAdmins,
    users,
  ] = await Promise.all([
    admin.from("workspaces").select("*").order("created_at", { ascending: false }),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("features").select("*").order("sort_order"),
    admin.from("plan_features").select("*"),
    admin.from("workspace_feature_overrides").select("*"),
    admin.from("workspace_templates").select("id,code,name,description,plan_id,version,is_active,is_default").order("is_default", { ascending: false }).order("name"),
    admin.from("subscriptions").select("*"),
    admin.from("contracts").select("*"),
    admin
      .from("workspace_memberships")
      .select("workspace_id,user_id,role,access_profile,status,created_at,joined_at,invitation_expires_at,invitation_last_sent_at,profiles(full_name)"),
    admin.from("business_groups").select("*").order("name"),
    admin.from("business_group_workspaces").select("group_id,workspace_id,created_at"),
    admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(250),
    admin.from("audit_logs").select("*").not("workspace_id", "is", null).order("created_at", { ascending: false }).limit(2000),
    admin.from("profiles").select("id,full_name"),
    admin.from("platform_admins").select("user_id,role,active"),
    listUsers(admin),
  ]);
  const results = [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    templates,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    recentAudit,
    workspaceAudit,
    profiles,
    platformAdmins,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const usersById = new Map(users.map((user) => [user.id, user]));
  const profilesById = new Map(
    (profiles.data ?? [])
      .filter((profile) => profile.id && profile.full_name)
      .map((profile) => [String(profile.id), String(profile.full_name).trim()]),
  );
  const platformAdminIds = new Set(
    (platformAdmins.data ?? [])
      .filter((record) => record.active)
      .map((record) => String(record.user_id)),
  );
  const enrichedRecentAudit = ((recentAudit.data ?? []) as AuditRow[]).map((row) =>
    enrichAudit(row, profilesById, usersById, platformAdminIds),
  );
  const founderWorkspaceAudit = ((workspaceAudit.data ?? []) as AuditRow[])
    .filter((row) => Boolean(row.actor_user_id && platformAdminIds.has(row.actor_user_id)))
    .map((row) => enrichAudit(row, profilesById, usersById, platformAdminIds));

  const workspaceActivity = Object.fromEntries(
    ((workspaces.data ?? []) as WorkspaceRow[]).map((workspace) => {
      const rows = founderWorkspaceAudit.filter((row) => row.workspace_id === workspace.id);
      const creator = [...rows]
        .reverse()
        .find((row) => WORKSPACE_CREATION_ACTIONS.has(row.action));
      const lastModified = rows.find((row) => !NON_MODIFYING_FOUNDER_ACTIONS.has(row.action)) ?? creator ?? null;
      return [
        workspace.id,
        {
          workspace_id: workspace.id,
          created_at: creator?.created_at ?? workspace.created_at,
          created_by_user_id: creator?.actor_user_id ?? null,
          created_by_name: creator?.actor_name ?? null,
          created_by_email: creator?.actor_email ?? null,
          last_modified_at: lastModified?.created_at ?? null,
          last_modified_by_user_id: lastModified?.actor_user_id ?? null,
          last_modified_by_name: lastModified?.actor_name ?? null,
          last_modified_by_email: lastModified?.actor_email ?? null,
          last_action: lastModified?.action ?? null,
        },
      ];
    }),
  );

  const auditCursor = enrichedRecentAudit.find((row) => row.actor_is_platform_admin)?.id ?? 0;

  return {
    workspaces: workspaces.data ?? [],
    plans: plans.data ?? [],
    features: features.data ?? [],
    planFeatures: planFeatures.data ?? [],
    overrides: overrides.data ?? [],
    templates: templates.data ?? [],
    subscriptions: subscriptions.data ?? [],
    contracts: contracts.data ?? [],
    memberships: (memberships.data ?? []).map((membership) => ({
      ...membership,
      email: usersById.get(membership.user_id)?.email ?? "",
    })),
    accounts: users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      full_name: profilesById.get(user.id) ?? "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      email_confirmed_at: user.email_confirmed_at ?? null,
      banned_until: user.banned_until ?? null,
      is_platform_admin: platformAdminIds.has(user.id),
    })),
    groups: groups.data ?? [],
    groupLinks: groupLinks.data ?? [],
    audit: enrichedRecentAudit,
    workspaceActivity,
    auditCursor,
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
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    return Response.json(
      { ...(await dashboard(admin)), actorUserId: identity.userId },
      { headers: { "Cache-Control": "no-store" } },
    );
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
      await writeAudit(admin, {
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
    const templateId = String(body.templateId ?? "");
    if (!name || slug.length < 3 || ownerName.length < 2 || !validEmail(ownerEmail) || !templateId) {
      return Response.json(
        { error: "Business name, slug, owner name, owner email and workspace template are required." },
        { status: 400 },
      );
    }

    const { data: template } = await admin
      .from("workspace_templates")
      .select("id,code,name,version,plan_id")
      .eq("id", templateId)
      .eq("is_active", true)
      .maybeSingle();
    if (!template) return Response.json({ error: "Choose an active workspace template." }, { status: 400 });

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
      });
      if (workspaceError) throw workspaceError;

      const existing = await findUserByEmail(admin, ownerEmail);
      invitedUser = existing;
      const redirectTo = activationRedirectUrl(request.url);
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

      const { error: templateError } = await admin.rpc("apply_workspace_template", {
        target_workspace_id: workspaceId,
        target_template_id: templateId,
        target_actor_user_id: identity.userId,
        target_owner_name: ownerName,
        target_owner_email: ownerEmail,
      });
      if (templateError) throw templateError;

      const now = new Date();
      const expiry = invitationExpiresAt(now);
      const setupResults = await Promise.all([
        admin.from("profiles").upsert({ id: invitedUser.id, full_name: ownerName }, { onConflict: "id" }),
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
      ]);
      const setupFailure = setupResults.find((result) => result.error);
      if (setupFailure?.error) throw setupFailure.error;

      await writeAudit(admin, {
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
          template_id: template.id,
          template_code: template.code,
          template_version: template.version,
          plan_id: template.plan_id,
          invitation_expires_at: expiry,
        },
      });
      return Response.json({
        ok: true,
        workspaceId,
        templateId: template.id,
        templateVersion: template.version,
        invitationExpiresAt: expiry,
      });
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
      if (body.status === "active") {
        const { count, error: ownerError } = await admin
          .from("workspace_memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("workspace_id", body.workspaceId)
          .eq("access_profile", "owner")
          .eq("status", "active");
        if (ownerError) throw ownerError;
        if ((count ?? 0) < 1) {
          return Response.json(
            { error: "Activate this workspace after at least one Owner has accepted their invitation." },
            { status: 409 },
          );
        }
      }
      const { error } = await admin.from("workspaces").update({ status: body.status }).eq("id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "link-workspace" && body.workspaceId && body.groupId) {
      const removeExisting = await admin.from("business_group_workspaces").delete().eq("workspace_id", body.workspaceId);
      if (removeExisting.error) throw removeExisting.error;
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
      await sendExistingUserInvite(email, activationRedirectUrl(request.url));
      const now = new Date();
      const expiry = invitationExpiresAt(now);
      const { error } = await admin.from("workspace_memberships").update({
        invitation_last_sent_at: now.toISOString(),
        invitation_expires_at: expiry,
      }).eq("workspace_id", body.workspaceId).eq("user_id", membership.user_id);
      if (error) throw error;
    } else if (body.action === "support-access" && body.workspaceId && body.reason?.trim()) {
      // The audit record below is the intended operation for an administrative reason.
    } else {
      return Response.json({ error: "Invalid action." }, { status: 400 });
    }

    await writeAudit(admin, {
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

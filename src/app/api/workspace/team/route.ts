import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const profiles = new Set(["owner", "manager", "employee", "custom"]);
const memberStatuses = new Set(["active", "suspended"]);
const actions = ["view", "create", "edit", "delete", "approve", "export"] as const;
type PermissionAction = (typeof actions)[number];
type PermissionInput = { featureKey: string } & Record<`can_${PermissionAction}`, boolean>;

function mappedRole(accessProfile: string) {
  if (accessProfile === "owner") return "owner";
  if (accessProfile === "manager") return "manager";
  return "staff";
}

async function context() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  if (!workspaceId) throw new Error("NO_WORKSPACE");

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  if (claimsError || !userId) throw new Error("UNAUTHENTICATED");

  const { data: membership, error: membershipError } = await admin
    .from("workspace_memberships")
    .select("role,access_profile,status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("FORBIDDEN");

  let canView = membership.access_profile === "owner" || membership.access_profile === "manager";
  let canEdit = canView;
  if (!canView && membership.access_profile === "custom") {
    const { data: permission } = await admin
      .from("workspace_member_permissions")
      .select("can_view,can_edit")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("feature_key", "team_members")
      .maybeSingle();
    canView = Boolean(permission?.can_view);
    canEdit = Boolean(permission?.can_edit);
  }
  if (!canView) throw new Error("FORBIDDEN");

  return {
    admin,
    workspaceId,
    userId,
    actorRole: String(membership.role),
    actorProfile: String(membership.access_profile),
    canEdit,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "REQUEST_FAILED";
  const status =
    message === "NOT_CONFIGURED" ? 503
      : message === "UNAUTHENTICATED" ? 401
        : message === "NO_WORKSPACE" ? 409
          : ["FORBIDDEN", "LAST_OWNER", "CANNOT_MANAGE_OWNER"].includes(message) ? 403
            : message === "NOT_FOUND" ? 404
              : 500;
  const publicMessage =
    message === "NOT_CONFIGURED" ? "Cloud administration is not configured."
      : message === "LAST_OWNER" ? "A business must keep at least one active Owner."
        : message === "CANNOT_MANAGE_OWNER" ? "Only an Owner can change another Owner's access."
          : message === "FORBIDDEN" ? "You do not have permission to manage this team."
            : message === "NOT_FOUND" ? "Team member not found."
              : "The team change could not be completed.";
  return Response.json({ error: publicMessage, code: message }, { status });
}

async function listUsersById(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return new Map(data.users.map((user) => [user.id, user]));
}

async function findUserByEmail(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  email: string,
): Promise<User | undefined> {
  const users = await listUsersById(admin);
  return [...users.values()].find((user) => user.email?.toLowerCase() === email);
}

async function sendExistingUserInvite(email: string, redirectTo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NOT_CONFIGURED");
  const authClient = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) throw error;
}

async function ensureCanChangeOwner(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  workspaceId: string,
  actorProfile: string,
  target: { role: string; status: string },
  nextProfile?: string,
  nextStatus?: string,
) {
  if (target.role === "owner" && actorProfile !== "owner") {
    throw new Error("CANNOT_MANAGE_OWNER");
  }
  const removesActiveOwner =
    target.role === "owner" &&
    target.status === "active" &&
    ((nextProfile && nextProfile !== "owner") || nextStatus === "suspended");
  if (!removesActiveOwner) return;

  const { count } = await admin
    .from("workspace_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .eq("status", "active");
  if ((count ?? 0) <= 1) throw new Error("LAST_OWNER");
}

export async function GET() {
  try {
    const { admin, workspaceId, canEdit } = await context();
    const [membersResult, permissionsResult, featuresResult, users] = await Promise.all([
      admin
        .from("workspace_memberships")
        .select("user_id,role,access_profile,status,joined_at,created_at,invitation_expires_at,invitation_last_sent_at,profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
      admin
        .from("workspace_member_permissions")
        .select("workspace_id,user_id,feature_key,can_view,can_create,can_edit,can_delete,can_approve,can_export")
        .eq("workspace_id", workspaceId),
      admin
        .from("features")
        .select("key,name,description,category,route,is_active")
        .eq("is_active", true)
        .order("sort_order"),
      listUsersById(admin),
    ]);
    const failed = [membersResult, permissionsResult, featuresResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    return Response.json({
      canEdit,
      features: featuresResult.data ?? [],
      permissions: permissionsResult.data ?? [],
      members: (membersResult.data ?? []).map((member) => ({
        ...member,
        email: users.get(member.user_id)?.email ?? "",
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, workspaceId, userId, actorProfile, canEdit } = await context();
    if (!canEdit) throw new Error("FORBIDDEN");
    const body = (await request.json()) as {
      action?: string;
      email?: string;
      accessProfile?: string;
      userId?: string;
    };

    if (body.action === "resend") {
      const targetUserId = String(body.userId ?? "");
      const { data: membership } = await admin
        .from("workspace_memberships")
        .select("user_id,role,status")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (!membership) throw new Error("NOT_FOUND");
      if (membership.role === "owner" && actorProfile !== "owner") throw new Error("CANNOT_MANAGE_OWNER");
      if (membership.status !== "invited") {
        return Response.json({ error: "Only pending invitations can be resent." }, { status: 409 });
      }
      const users = await listUsersById(admin);
      const email = users.get(targetUserId)?.email;
      if (!email) throw new Error("NOT_FOUND");
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const redirectTo = `${origin}/auth/callback?next=/activate`;
      await sendExistingUserInvite(email, redirectTo);
      const now = new Date();
      await admin
        .from("workspace_memberships")
        .update({
          invitation_last_sent_at: now.toISOString(),
          invitation_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      await admin.from("audit_logs").insert({
        workspace_id: workspaceId,
        actor_user_id: userId,
        action: "team.invitation_resent",
        entity_type: "membership",
        entity_id: targetUserId,
        metadata: { email },
      });
      return Response.json({ ok: true, message: `Invitation resent to ${email}.` });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const accessProfile = profiles.has(String(body.accessProfile))
      ? String(body.accessProfile)
      : "employee";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid work email." }, { status: 400 });
    }
    if (actorProfile !== "owner" && accessProfile === "owner") {
      throw new Error("CANNOT_MANAGE_OWNER");
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const redirectTo = `${origin}/auth/callback?next=/activate`;
    const existing = await findUserByEmail(admin, email);
    let invitedUser = existing;

    if (!invitedUser) {
      const invite = await admin.auth.admin.inviteUserByEmail(email, {
        data: { workspace_id: workspaceId, access_profile: accessProfile },
        redirectTo,
      });
      if (invite.error || !invite.data.user) {
        throw invite.error ?? new Error("Invite failed");
      }
      invitedUser = invite.data.user;
    } else {
      await sendExistingUserInvite(email, redirectTo);
    }

    const now = new Date();
    const role = mappedRole(accessProfile);
    const { error: membershipError } = await admin
      .from("workspace_memberships")
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: invitedUser.id,
          role,
          access_profile: accessProfile,
          status: "invited",
          invited_by: userId,
          joined_at: null,
          invitation_last_sent_at: now.toISOString(),
          invitation_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "workspace_id,user_id" },
      );
    if (membershipError) {
      if (!existing) await admin.auth.admin.deleteUser(invitedUser.id);
      throw membershipError;
    }

    if (accessProfile === "custom") {
      const { data: features } = await admin.from("features").select("key").eq("is_active", true);
      if (features?.length) {
        await admin.from("workspace_member_permissions").upsert(
          features.map((feature) => ({
            workspace_id: workspaceId,
            user_id: invitedUser!.id,
            feature_key: feature.key,
            created_by: userId,
          })),
          { onConflict: "workspace_id,user_id,feature_key" },
        );
      }
    }

    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: "team.member_invited",
      entity_type: "membership",
      entity_id: invitedUser.id,
      metadata: { email, access_profile: accessProfile, existing_user: Boolean(existing) },
    });
    return Response.json({ ok: true, message: `Invitation sent to ${email}.` });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { admin, workspaceId, userId, actorProfile, canEdit } = await context();
    if (!canEdit) throw new Error("FORBIDDEN");
    const body = (await request.json()) as {
      userId?: string;
      accessProfile?: string;
      status?: string;
      permissions?: PermissionInput[];
    };
    const targetUserId = String(body.userId ?? "");
    const accessProfile = profiles.has(String(body.accessProfile)) ? String(body.accessProfile) : undefined;
    const status = memberStatuses.has(String(body.status)) ? String(body.status) : undefined;
    const permissions = Array.isArray(body.permissions) ? body.permissions : undefined;
    if (!targetUserId || (!accessProfile && !status && !permissions)) {
      return Response.json({ error: "Choose a valid team change." }, { status: 400 });
    }

    const { data: targetMembership } = await admin
      .from("workspace_memberships")
      .select("role,access_profile,status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!targetMembership) throw new Error("NOT_FOUND");
    if (accessProfile === "owner" && actorProfile !== "owner") throw new Error("CANNOT_MANAGE_OWNER");
    await ensureCanChangeOwner(admin, workspaceId, actorProfile, targetMembership, accessProfile, status);

    const changes = {
      ...(accessProfile ? { access_profile: accessProfile, role: mappedRole(accessProfile) } : {}),
      ...(status ? { status } : {}),
    };
    if (Object.keys(changes).length) {
      const { error } = await admin
        .from("workspace_memberships")
        .update(changes)
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (error) throw error;
    }

    if (permissions) {
      if ((accessProfile ?? targetMembership.access_profile) === "owner") {
        await admin
          .from("workspace_member_permissions")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("user_id", targetUserId);
      } else {
        const rows = permissions
          .filter((permission) => permission.featureKey)
          .map((permission) => ({
            workspace_id: workspaceId,
            user_id: targetUserId,
            feature_key: permission.featureKey,
            can_view: Boolean(permission.can_view),
            can_create: Boolean(permission.can_create),
            can_edit: Boolean(permission.can_edit),
            can_delete: Boolean(permission.can_delete),
            can_approve: Boolean(permission.can_approve),
            can_export: Boolean(permission.can_export),
            created_by: userId,
          }));
        if (rows.length) {
          const { error } = await admin
            .from("workspace_member_permissions")
            .upsert(rows, { onConflict: "workspace_id,user_id,feature_key" });
          if (error) throw error;
        }
      }
    }

    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: "team.member_updated",
      entity_type: "membership",
      entity_id: targetUserId,
      metadata: { ...changes, permissions_updated: Boolean(permissions) },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { admin, workspaceId, userId, actorProfile, canEdit } = await context();
    if (!canEdit) throw new Error("FORBIDDEN");
    const body = (await request.json()) as { userId?: string };
    const targetUserId = String(body.userId ?? "");
    if (!targetUserId) return Response.json({ error: "Choose a team member." }, { status: 400 });

    const { data: targetMembership } = await admin
      .from("workspace_memberships")
      .select("role,access_profile,status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!targetMembership) throw new Error("NOT_FOUND");
    await ensureCanChangeOwner(admin, workspaceId, actorProfile, targetMembership, "employee", "suspended");

    const { error } = await admin
      .from("workspace_memberships")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId);
    if (error) throw error;

    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: "team.member_removed",
      entity_type: "membership",
      entity_id: targetUserId,
      metadata: {},
    });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

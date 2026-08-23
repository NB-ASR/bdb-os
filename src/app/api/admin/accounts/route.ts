import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { activationRedirectUrl, invitationExpiresAt } from "@/lib/auth/invitations";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

const accessProfiles = new Set(["owner", "manager", "employee", "custom"]);
const membershipStatuses = new Set(["active", "suspended"]);

function mappedRole(accessProfile: string) {
  if (accessProfile === "owner") return "owner";
  if (accessProfile === "manager") return "manager";
  return "staff";
}

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
  const authClient = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) throw error;
}

async function writeAudit(admin: AdminClient, record: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert(record);
  if (error) throw error;
}

async function copyCustomPermissions(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
  actorUserId: string,
) {
  const { data: defaults, error: defaultsError } = await admin
    .from("workspace_access_profile_permissions")
    .select("feature_key,can_view,can_create,can_edit,can_delete,can_approve,can_export")
    .eq("workspace_id", workspaceId)
    .eq("access_profile", "custom");
  if (defaultsError) throw defaultsError;
  if (!defaults?.length) return;

  const { error } = await admin.from("workspace_member_permissions").upsert(
    defaults.map((permission) => ({
      workspace_id: workspaceId,
      user_id: userId,
      ...permission,
      created_by: actorUserId,
    })),
    { onConflict: "workspace_id,user_id,feature_key" },
  );
  if (error) throw error;
}

function accountErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const errors: Record<string, { status: number; message: string }> = {
    MEMBER_EXISTS: { status: 409, message: "This account already has access or a pending invitation for that workspace." },
    LAST_OWNER: { status: 409, message: "A workspace must keep at least one active Owner." },
    INVITATION_PENDING: { status: 409, message: "Pending invitations must be accepted before access can be changed." },
    SELF_PRIVILEGE_CHANGE: { status: 403, message: "You cannot change your own workspace privileges from Founder Admin." },
    NOT_FOUND: { status: 404, message: "The account or workspace membership could not be found." },
  };
  const known = errors[code];
  if (known) return Response.json({ error: known.message, code }, { status: known.status });
  return adminErrorResponse(error);
}

export async function POST(request: Request) {
  let createdAuthUser: User | undefined;
  let createdMembership: { workspaceId: string; userId: string } | undefined;
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      action?: string;
      workspaceId?: string;
      userId?: string;
      email?: string;
      fullName?: string;
      accessProfile?: string;
    };

    if (body.action === "resend-invitation") {
      const workspaceId = String(body.workspaceId ?? "");
      const targetUserId = String(body.userId ?? "");
      if (!workspaceId || !targetUserId) {
        return Response.json({ error: "Choose a pending workspace invitation." }, { status: 400 });
      }
      if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

      const { data: membership, error: membershipError } = await admin
        .from("workspace_memberships")
        .select("user_id,status")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("NOT_FOUND");
      if (membership.status !== "invited") {
        return Response.json({ error: "Only pending invitations can be resent." }, { status: 409 });
      }

      const email = (await listUsers(admin)).find((user) => user.id === targetUserId)?.email;
      if (!email) throw new Error("NOT_FOUND");
      await sendExistingUserInvite(email, activationRedirectUrl(request.url));
      const now = new Date();
      const expiry = invitationExpiresAt(now);
      const { error: updateError } = await admin
        .from("workspace_memberships")
        .update({ invitation_last_sent_at: now.toISOString(), invitation_expires_at: expiry })
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (updateError) throw updateError;

      await writeAudit(admin, {
        workspace_id: workspaceId,
        actor_user_id: identity.userId,
        action: "admin.account-invitation-resent",
        entity_type: "membership",
        entity_id: targetUserId,
        metadata: { email, invitation_expires_at: expiry },
      });
      return Response.json({ ok: true, message: `Invitation resent to ${email}.` });
    }

    if (body.action !== "invite-account") {
      return Response.json({ error: "Unsupported account action." }, { status: 400 });
    }

    const workspaceId = String(body.workspaceId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.fullName ?? "").trim();
    const accessProfile = accessProfiles.has(String(body.accessProfile))
      ? String(body.accessProfile)
      : "employee";
    if (!workspaceId || fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Workspace, full name and a valid work email are required." }, { status: 400 });
    }

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id,name,status")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace) throw new Error("NOT_FOUND");
    if (!["trial", "active"].includes(workspace.status)) {
      return Response.json({ error: "Accounts can only be invited to trial or active workspaces." }, { status: 409 });
    }

    const existing = await findUserByEmail(admin, email);
    if (existing?.id === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");
    if (existing) {
      const { data: existingMembership, error: lookupError } = await admin
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", existing.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingMembership) throw new Error("MEMBER_EXISTS");
    }

    let invitedUser = existing;
    const redirectTo = activationRedirectUrl(request.url);
    if (!invitedUser) {
      const invite = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, workspace_id: workspaceId, access_profile: accessProfile },
        redirectTo,
      });
      if (invite.error || !invite.data.user) throw invite.error ?? new Error("Invite failed");
      invitedUser = invite.data.user;
      createdAuthUser = invitedUser;
    } else {
      await sendExistingUserInvite(email, redirectTo);
    }

    const now = new Date();
    const expiry = invitationExpiresAt(now);
    const { error: membershipInsertError } = await admin.from("workspace_memberships").insert({
      workspace_id: workspaceId,
      user_id: invitedUser.id,
      role: mappedRole(accessProfile),
      access_profile: accessProfile,
      status: "invited",
      invited_by: identity.userId,
      joined_at: null,
      invitation_last_sent_at: now.toISOString(),
      invitation_expires_at: expiry,
    });
    if (membershipInsertError) throw membershipInsertError;
    createdMembership = { workspaceId, userId: invitedUser.id };

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: invitedUser.id, full_name: fullName }, { onConflict: "id" });
    if (profileError) throw profileError;
    if (accessProfile === "custom") {
      await copyCustomPermissions(admin, workspaceId, invitedUser.id, identity.userId);
    }

    await writeAudit(admin, {
      workspace_id: workspaceId,
      actor_user_id: identity.userId,
      action: "admin.account-invited",
      entity_type: "membership",
      entity_id: invitedUser.id,
      metadata: {
        email,
        full_name: fullName,
        workspace_name: workspace.name,
        access_profile: accessProfile,
        existing_account: Boolean(existing),
        invitation_expires_at: expiry,
      },
    });
    return Response.json({ ok: true, message: `${email} invited to ${workspace.name}.` });
  } catch (error) {
    if (createdAuthUser) {
      const rollbackAdmin = createAdminClient();
      if (rollbackAdmin) {
        if (createdMembership) {
          await rollbackAdmin
            .from("workspace_memberships")
            .delete()
            .eq("workspace_id", createdMembership.workspaceId)
            .eq("user_id", createdMembership.userId)
            .then(() => undefined, () => undefined);
        }
        await rollbackAdmin.auth.admin.deleteUser(createdAuthUser.id).then(() => undefined, () => undefined);
      }
    } else if (createdMembership) {
      const rollbackAdmin = createAdminClient();
      if (rollbackAdmin) {
        await rollbackAdmin
          .from("workspace_memberships")
          .delete()
          .eq("workspace_id", createdMembership.workspaceId)
          .eq("user_id", createdMembership.userId)
          .then(() => undefined, () => undefined);
      }
    }
    return accountErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      workspaceId?: string;
      userId?: string;
      accessProfile?: string;
      status?: string;
    };
    const workspaceId = String(body.workspaceId ?? "");
    const targetUserId = String(body.userId ?? "");
    const accessProfile = accessProfiles.has(String(body.accessProfile)) ? String(body.accessProfile) : undefined;
    const status = membershipStatuses.has(String(body.status)) ? String(body.status) : undefined;
    if (!workspaceId || !targetUserId || (!accessProfile && !status)) {
      return Response.json({ error: "Choose an account, workspace and valid access change." }, { status: 400 });
    }
    if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

    const { data: membership, error: membershipError } = await admin
      .from("workspace_memberships")
      .select("access_profile,status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) throw new Error("NOT_FOUND");
    if (membership.status === "invited") throw new Error("INVITATION_PENDING");

    const removesActiveOwner = membership.access_profile === "owner"
      && membership.status === "active"
      && ((accessProfile && accessProfile !== "owner") || status === "suspended");
    if (removesActiveOwner) {
      const { count, error: countError } = await admin
        .from("workspace_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("access_profile", "owner")
        .eq("status", "active");
      if (countError) throw countError;
      if ((count ?? 0) <= 1) throw new Error("LAST_OWNER");
    }

    const changes = {
      ...(accessProfile ? { access_profile: accessProfile, role: mappedRole(accessProfile) } : {}),
      ...(status ? { status } : {}),
    };
    const effectiveProfile = accessProfile ?? membership.access_profile;
    if (effectiveProfile !== "custom") {
      const { error: permissionError } = await admin
        .from("workspace_member_permissions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (permissionError) throw permissionError;
    }

    const { error: updateError } = await admin
      .from("workspace_memberships")
      .update(changes)
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId);
    if (updateError) throw updateError;

    if (effectiveProfile === "custom" && membership.access_profile !== "custom") {
      await copyCustomPermissions(admin, workspaceId, targetUserId, identity.userId);
    }

    await writeAudit(admin, {
      workspace_id: workspaceId,
      actor_user_id: identity.userId,
      action: "admin.workspace-account-updated",
      entity_type: "membership",
      entity_id: targetUserId,
      metadata: {
        previous_access_profile: membership.access_profile,
        previous_status: membership.status,
        access_profile: accessProfile ?? membership.access_profile,
        status: status ?? membership.status,
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return accountErrorResponse(error);
  }
}

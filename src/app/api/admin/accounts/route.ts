import type { User } from "@supabase/supabase-js";
import {
  AdminProductError,
  adminErrorResponse,
  adminProductError,
  requirePlatformAdmin,
} from "@/lib/admin-auth";
import { invitationCooldownSeconds } from "@/lib/founder-admin";
import {
  attemptFounderInvitationDelivery,
  ensureFounderManagedUser,
  findFounderAuthUserByEmail,
  listFounderAuthUsers,
} from "@/lib/server/founder-admin-invitations";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

const accessProfiles = new Set(["owner", "manager", "employee", "custom"]);
const membershipStatuses = new Set(["active", "suspended"]);

function mappedRole(accessProfile: string) {
  if (accessProfile === "owner") return "owner";
  if (accessProfile === "manager") return "manager";
  return "staff";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    MEMBER_EXISTS: { status: 409, message: "This person already has access or a pending invitation for that business." },
    LAST_OWNER: { status: 409, message: "A business must keep at least one active Owner." },
    INVITATION_PENDING: { status: 409, message: "Pending invitations must be accepted before access can be changed." },
    SELF_PRIVILEGE_CHANGE: { status: 403, message: "You cannot change your own essential access from Founder Admin." },
    NOT_FOUND: { status: 404, message: "That person or business access record could not be found." },
  };
  const known = errors[code];
  if (known) return Response.json({ error: known.message, code }, { status: known.status });
  return adminErrorResponse(error);
}

async function findUserById(admin: AdminClient, userId: string) {
  const users = await listFounderAuthUsers(admin);
  return users.find((user) => user.id === userId);
}

async function protectLastOwner(
  admin: AdminClient,
  input: {
    workspaceId: string;
    membership: { access_profile: string; status: string };
    removesOrSuspends: boolean;
  },
) {
  if (
    input.membership.access_profile !== "owner"
    || input.membership.status !== "active"
    || !input.removesOrSuspends
  ) return;

  const { count, error } = await admin
    .from("workspace_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("access_profile", "owner")
    .eq("status", "active");
  if (error) throw error;
  if ((count ?? 0) <= 1) throw new Error("LAST_OWNER");
}

export async function POST(request: Request) {
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
        throw adminProductError("INVITATION_REQUIRED", 400, "Choose a pending business invitation.");
      }
      if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

      const { data: membership, error: membershipError } = await admin
        .from("workspace_memberships")
        .select("user_id,status,invitation_delivery_status,invitation_delivery_attempted_at,invitation_last_sent_at,invitation_expires_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("NOT_FOUND");
      if (membership.status !== "invited") {
        throw adminProductError("INVITATION_NOT_PENDING", 409, "Only pending invitations can be resent.");
      }
      const retryAfterSeconds = invitationCooldownSeconds(membership.invitation_delivery_attempted_at);
      if (retryAfterSeconds > 0) {
        throw adminProductError(
          "INVITATION_RESEND_COOLDOWN",
          429,
          `Wait ${retryAfterSeconds} seconds before resending this invitation.`,
          { retryAfterSeconds },
        );
      }

      const email = (await findUserById(admin, targetUserId))?.email;
      if (!email) throw new Error("NOT_FOUND");
      const delivery = await attemptFounderInvitationDelivery(admin, {
        workspaceId,
        userId: targetUserId,
        email,
        requestUrl: request.url,
      });
      await writeAudit(admin, {
        workspace_id: workspaceId,
        actor_user_id: identity.userId,
        action: "admin.account-invitation-resent",
        entity_type: "membership",
        entity_id: targetUserId,
        metadata: { email, previous: membership, new: delivery },
      });
      return Response.json({ ok: true, invitation: delivery, message: `Invitation resent to ${email}.` });
    }

    if (body.action === "cancel-invitation") {
      const workspaceId = String(body.workspaceId ?? "");
      const targetUserId = String(body.userId ?? "");
      if (!workspaceId || !targetUserId) {
        throw adminProductError("INVITATION_REQUIRED", 400, "Choose a pending business invitation.");
      }
      if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");
      const { data: membership, error: membershipError } = await admin
        .from("workspace_memberships")
        .select("access_profile,status,invitation_delivery_status,invitation_delivery_attempted_at,invitation_last_sent_at,invitation_expires_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("NOT_FOUND");
      if (membership.status !== "invited") {
        throw adminProductError("INVITATION_NOT_PENDING", 409, "Only a pending invitation can be cancelled.");
      }
      const { error: deleteError } = await admin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (deleteError) throw deleteError;
      await writeAudit(admin, {
        workspace_id: workspaceId,
        actor_user_id: identity.userId,
        action: "admin.account-invitation-cancelled",
        entity_type: "membership",
        entity_id: targetUserId,
        metadata: { previous: membership, new: null, auth_account_retained: true },
      });
      return Response.json({ ok: true, message: "Invitation cancelled. The sign-in account was retained." });
    }

    if (body.action !== "invite-account") {
      throw adminProductError("UNSUPPORTED_ACCOUNT_ACTION", 400, "That user action is not supported.");
    }

    const workspaceId = String(body.workspaceId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.fullName ?? "").trim();
    const accessProfile = accessProfiles.has(String(body.accessProfile))
      ? String(body.accessProfile)
      : "employee";
    if (!workspaceId || fullName.length < 2 || !validEmail(email)) {
      throw adminProductError(
        "INVALID_ACCOUNT_INVITATION",
        400,
        "Full name and a valid work email are required.",
      );
    }

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id,name,status")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace) throw new Error("NOT_FOUND");
    if (!["trial", "active"].includes(workspace.status)) {
      throw adminProductError(
        "WORKSPACE_NOT_INVITABLE",
        409,
        "People can only be invited to trial or active businesses.",
      );
    }

    let managedUser: { user: User; created: boolean } | null = null;
    let membershipCreated = false;
    try {
      const existingUser = await findFounderAuthUserByEmail(admin, email);
      if (existingUser?.id === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");
      if (existingUser) {
        const { data: existingMembership, error: existingMembershipError } = await admin
          .from("workspace_memberships")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", existingUser.id)
          .maybeSingle();
        if (existingMembershipError) throw existingMembershipError;
        if (existingMembership) throw new Error("MEMBER_EXISTS");
      }
      managedUser = await ensureFounderManagedUser(admin, email, fullName);
      if (managedUser.user.id === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

      const { error: membershipInsertError } = await admin.from("workspace_memberships").insert({
        workspace_id: workspaceId,
        user_id: managedUser.user.id,
        role: mappedRole(accessProfile),
        access_profile: accessProfile,
        status: "invited",
        invited_by: identity.userId,
        joined_at: null,
        invitation_delivery_status: "pending",
        invitation_delivery_attempted_at: null,
        invitation_last_sent_at: null,
        invitation_expires_at: null,
      });
      if (membershipInsertError) throw membershipInsertError;
      if (accessProfile === "custom") {
        await copyCustomPermissions(admin, workspaceId, managedUser.user.id, identity.userId);
      }

      await writeAudit(admin, {
        workspace_id: workspaceId,
        actor_user_id: identity.userId,
        action: "admin.account-invited",
        entity_type: "membership",
        entity_id: managedUser.user.id,
        metadata: {
          previous: null,
          new: { email, full_name: fullName, access_profile: accessProfile, status: "invited" },
          existing_account: !managedUser.created,
          invitation: { status: "pending" },
        },
      });
      membershipCreated = true;

      try {
        const delivery = await attemptFounderInvitationDelivery(admin, {
          workspaceId,
          userId: managedUser.user.id,
          email,
          requestUrl: request.url,
        });
        await writeAudit(admin, {
          workspace_id: workspaceId,
          actor_user_id: identity.userId,
          action: "admin.account-invitation-sent",
          entity_type: "membership",
          entity_id: managedUser.user.id,
          metadata: {
            previous: { invitation_status: "pending" },
            new: delivery,
            email,
          },
        }).catch((auditError) => {
          console.error("Founder Admin invitation audit failed after durable delivery", auditError);
        });
        return Response.json({
          ok: true,
          userId: managedUser.user.id,
          invitation: delivery,
          message: `${email} was invited to ${workspace.name}.`,
        }, { status: 201 });
      } catch (deliveryError) {
        if (!(deliveryError instanceof AdminProductError)) throw deliveryError;
        await writeAudit(admin, {
          workspace_id: workspaceId,
          actor_user_id: identity.userId,
          action: "admin.account-invitation-failed",
          entity_type: "membership",
          entity_id: managedUser.user.id,
          metadata: {
            previous: null,
            new: { email, full_name: fullName, access_profile: accessProfile, status: "invited" },
            invitation: { status: "failed", code: deliveryError.code },
          },
        }).catch((auditError) => {
          console.error("Founder Admin failed-invitation audit could not be written", auditError);
        });
        throw adminProductError(
          deliveryError.code,
          deliveryError.status,
          deliveryError.publicMessage,
          {
            ...deliveryError.details,
            membershipCreated: true,
            userId: managedUser.user.id,
            invitationState: "failed",
          },
        );
      }
    } catch (error) {
      if (!membershipCreated && managedUser) {
        await admin
          .from("workspace_memberships")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("user_id", managedUser.user.id);
        if (managedUser.created) {
          const { count } = await admin
            .from("workspace_memberships")
            .select("workspace_id", { count: "exact", head: true })
            .eq("user_id", managedUser.user.id);
          if ((count ?? 0) === 0) await admin.auth.admin.deleteUser(managedUser.user.id);
        }
      }
      throw error;
    }
  } catch (error) {
    return accountErrorResponse(error);
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
      userId?: string;
      accessProfile?: string;
      status?: string;
      fullName?: string;
      email?: string;
      accountStatus?: string;
    };
    const targetUserId = String(body.userId ?? "");
    if (!targetUserId) throw adminProductError("USER_REQUIRED", 400, "Choose a person to update.");

    if (body.action === "account-auth-status") {
      if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");
      if (!["active", "suspended"].includes(String(body.accountStatus))) {
        throw adminProductError("INVALID_ACCOUNT_STATUS", 400, "Choose Active or Suspended for this sign-in account.");
      }
      const currentUser = await findUserById(admin, targetUserId);
      if (!currentUser) throw new Error("NOT_FOUND");
      const { data: platformAdmin, error: platformAdminError } = await admin
        .from("platform_admins")
        .select("active")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (platformAdminError) throw platformAdminError;
      if (platformAdmin?.active) {
        throw adminProductError(
          "PLATFORM_ADMIN_PROTECTED",
          403,
          "Active platform-admin sign-in cannot be suspended from the account directory.",
        );
      }
      if (body.accountStatus === "suspended") {
        const { data: ownerMemberships, error: ownerMembershipError } = await admin
          .from("workspace_memberships")
          .select("workspace_id,access_profile,status")
          .eq("user_id", targetUserId)
          .eq("access_profile", "owner")
          .eq("status", "active");
        if (ownerMembershipError) throw ownerMembershipError;
        for (const ownerMembership of ownerMemberships ?? []) {
          await protectLastOwner(admin, {
            workspaceId: ownerMembership.workspace_id,
            membership: ownerMembership,
            removesOrSuspends: true,
          });
        }
      }
      const update = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: body.accountStatus === "suspended" ? "876000h" : "none",
      });
      if (update.error) throw update.error;
      await writeAudit(admin, {
        actor_user_id: identity.userId,
        action: `admin.auth-account-${body.accountStatus}`,
        entity_type: "user",
        entity_id: targetUserId,
        metadata: {
          previous: { banned_until: currentUser.banned_until ?? null },
          new: { account_status: body.accountStatus },
        },
      });
      return Response.json({
        ok: true,
        message: body.accountStatus === "suspended"
          ? "Sign-in suspended across all businesses. Membership records were retained."
          : "Sign-in restored across all businesses.",
      });
    }

    if (body.action === "edit-user") {
      const fullName = String(body.fullName ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      if (fullName.length < 2 || !validEmail(email)) {
        throw adminProductError("INVALID_USER", 400, "Enter a full name and valid work email.");
      }
      const currentUser = await findUserById(admin, targetUserId);
      if (!currentUser?.email) throw new Error("NOT_FOUND");
      const existingEmailOwner = (await listFounderAuthUsers(admin)).find(
        (user) => user.id !== targetUserId && user.email?.toLowerCase() === email,
      );
      if (existingEmailOwner) {
        throw adminProductError(
          "AUTH_EMAIL_CONFLICT",
          409,
          "That email address already belongs to another BDB OS account.",
        );
      }
      const previousProfile = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", targetUserId)
        .maybeSingle();
      if (previousProfile.error) throw previousProfile.error;
      const previous = {
        email: currentUser.email,
        auth_full_name: typeof currentUser.user_metadata?.full_name === "string"
          ? currentUser.user_metadata.full_name
          : null,
        profile_full_name: previousProfile.data?.full_name ?? null,
      };
      const authUpdate = await admin.auth.admin.updateUserById(targetUserId, {
        email,
        user_metadata: { ...currentUser.user_metadata, full_name: fullName },
      });
      if (authUpdate.error || !authUpdate.data.user) throw authUpdate.error ?? new Error("AUTH_UPDATE_FAILED");
      const { error: profileError } = await admin
        .from("profiles")
        .upsert({ id: targetUserId, full_name: fullName }, { onConflict: "id" });
      if (profileError) {
        await admin.auth.admin.updateUserById(targetUserId, {
          email: currentUser.email,
          user_metadata: currentUser.user_metadata,
        });
        throw profileError;
      }
      const next = { email, auth_full_name: fullName, profile_full_name: fullName };
      await writeAudit(admin, {
        actor_user_id: identity.userId,
        action: "admin.user-identity-updated",
        entity_type: "user",
        entity_id: targetUserId,
        metadata: { previous, new: next, email_change_status: "changed_immediately" },
      });
      return Response.json({
        ok: true,
        user: { id: targetUserId, email, full_name: fullName },
        emailChangeStatus: "changed_immediately",
        message: "Name and email were updated immediately and kept consistent.",
      });
    }

    const workspaceId = String(body.workspaceId ?? "");
    const accessProfile = accessProfiles.has(String(body.accessProfile)) ? String(body.accessProfile) : undefined;
    const status = membershipStatuses.has(String(body.status)) ? String(body.status) : undefined;
    if (!workspaceId || (!accessProfile && !status)) {
      throw adminProductError("INVALID_ACCESS_CHANGE", 400, "Choose valid business access to update.");
    }
    if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

    const { data: membership, error: membershipError } = await admin
      .from("workspace_memberships")
      .select("access_profile,status,role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) throw new Error("NOT_FOUND");
    if (membership.status === "invited") throw new Error("INVITATION_PENDING");
    await protectLastOwner(admin, {
      workspaceId,
      membership,
      removesOrSuspends: Boolean((accessProfile && accessProfile !== "owner") || status === "suspended"),
    });

    const changes = {
      ...(accessProfile ? { access_profile: accessProfile, role: mappedRole(accessProfile) } : {}),
      ...(status ? { status } : {}),
    };
    const effectiveProfile = accessProfile ?? membership.access_profile;
    if (effectiveProfile === "custom" && membership.access_profile !== "custom") {
      await copyCustomPermissions(admin, workspaceId, targetUserId, identity.userId);
    }
    const { error: updateError } = await admin
      .from("workspace_memberships")
      .update(changes)
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId);
    if (updateError) throw updateError;
    if (effectiveProfile !== "custom") {
      const { error: permissionError } = await admin
        .from("workspace_member_permissions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (permissionError) throw permissionError;
    }

    const next = {
      access_profile: accessProfile ?? membership.access_profile,
      status: status ?? membership.status,
      role: accessProfile ? mappedRole(accessProfile) : membership.role,
    };
    await writeAudit(admin, {
      workspace_id: workspaceId,
      actor_user_id: identity.userId,
      action: "admin.workspace-account-updated",
      entity_type: "membership",
      entity_id: targetUserId,
      metadata: { previous: membership, new: next },
    });
    return Response.json({ ok: true, membership: next });
  } catch (error) {
    return accountErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      action?: string;
      workspaceId?: string;
      userId?: string;
    };
    const targetUserId = String(body.userId ?? "");
    if (!targetUserId) throw adminProductError("USER_REQUIRED", 400, "Choose a person.");
    if (targetUserId === identity.userId) throw new Error("SELF_PRIVILEGE_CHANGE");

    if (body.action === "remove-membership") {
      const workspaceId = String(body.workspaceId ?? "");
      if (!workspaceId) throw adminProductError("WORKSPACE_REQUIRED", 400, "Choose a business.");
      const { data: membership, error: membershipError } = await admin
        .from("workspace_memberships")
        .select("access_profile,status,role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("NOT_FOUND");
      await protectLastOwner(admin, { workspaceId, membership, removesOrSuspends: true });
      const { error: deleteError } = await admin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", targetUserId);
      if (deleteError) throw deleteError;
      await writeAudit(admin, {
        workspace_id: workspaceId,
        actor_user_id: identity.userId,
        action: "admin.workspace-access-removed",
        entity_type: "membership",
        entity_id: targetUserId,
        metadata: { previous: membership, new: null, auth_account_retained: true },
      });
      return Response.json({
        ok: true,
        accountRetained: true,
        message: "Access to this business was removed. The sign-in account and any other business access were retained.",
      });
    }

    if (body.action !== "delete-unused-account") {
      throw adminProductError("UNSUPPORTED_ACCOUNT_ACTION", 400, "That user action is not supported.");
    }
    const { data: preview, error: previewError } = await admin.rpc("founder_unused_auth_user_preview", {
      target_user_id: targetUserId,
    });
    if (previewError) throw previewError;
    const result = (preview ?? {}) as Record<string, unknown>;
    if (!result.can_delete) {
      throw adminProductError(
        "DELETION_BLOCKED_HISTORY",
        409,
        "This account is still used by business access or protected history. Remove business access first; historical attribution must be retained.",
        { preview: result },
      );
    }
    const user = await findUserById(admin, targetUserId);
    if (!user) throw new Error("NOT_FOUND");
    await writeAudit(admin, {
      actor_user_id: identity.userId,
      action: "admin.unused-account-deletion-requested",
      entity_type: "user",
      entity_id: targetUserId,
      metadata: { previous: { email: user.email }, new: null, preview: result },
    });
    const deletion = await admin.auth.admin.deleteUser(targetUserId);
    if (deletion.error) {
      throw adminProductError(
        "DELETION_BLOCKED_HISTORY",
        409,
        "This account is protected by historical records and cannot be deleted.",
      );
    }
    return Response.json({ ok: true, message: "The unused sign-in account was permanently deleted." });
  } catch (error) {
    return accountErrorResponse(error);
  }
}

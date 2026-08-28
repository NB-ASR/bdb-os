import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { adminProductError } from "@/lib/admin-auth";
import { activationRedirectUrl, invitationExpiresAt } from "@/lib/auth/invitations";
import { classifyFounderAdminError } from "@/lib/founder-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export type FounderAdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

export async function listFounderAuthUsers(admin: FounderAdminClient) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

export async function findFounderAuthUserByEmail(
  admin: FounderAdminClient,
  email: string,
): Promise<User | undefined> {
  const users = await listFounderAuthUsers(admin);
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

export async function ensureFounderManagedUser(
  admin: FounderAdminClient,
  email: string,
  fullName: string,
) {
  let user = await findFounderAuthUserByEmail(admin, email);
  const created = !user;
  const previousMetadata = user?.user_metadata ?? null;
  let authMetadataUpdated = false;

  if (!user) {
    const createdUser = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name: fullName },
    });
    if (createdUser.error || !createdUser.data.user) {
      throw createdUser.error ?? adminProductError(
        "AUTH_ACCOUNT_CREATE_FAILED",
        502,
        "The BDB OS account could not be prepared for invitation.",
      );
    }
    user = createdUser.data.user;
  } else {
    const metadataName = typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "";
    if (metadataName !== fullName) {
      const updatedUser = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, full_name: fullName },
      });
      if (updatedUser.error || !updatedUser.data.user) {
        throw updatedUser.error ?? adminProductError(
          "AUTH_ACCOUNT_UPDATE_FAILED",
          502,
          "The BDB OS account identity could not be updated.",
        );
      }
      user = updatedUser.data.user;
      authMetadataUpdated = true;
    }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" });
  if (profileError) {
    if (created) {
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    } else if (authMetadataUpdated && previousMetadata) {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: previousMetadata,
      }).catch((rollbackError) => {
        console.error("Founder Admin Auth metadata rollback failed", rollbackError);
      });
    }
    throw profileError;
  }

  return { user, created };
}

async function sendInvitationEmail(email: string, requestUrl: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NOT_CONFIGURED");
  const authClient = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: activationRedirectUrl(requestUrl),
      shouldCreateUser: false,
    },
  });
  if (error) throw error;
}

export async function attemptFounderInvitationDelivery(
  admin: FounderAdminClient,
  input: {
    workspaceId: string;
    userId: string;
    email: string;
    requestUrl: string;
  },
) {
  const attemptedAt = new Date();
  const attemptedAtIso = attemptedAt.toISOString();
  const target = admin
    .from("workspace_memberships")
    .update({
      invitation_delivery_status: "pending",
      invitation_delivery_attempted_at: attemptedAtIso,
      invitation_delivery_error_code: null,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "invited");
  const { error: pendingError } = await target;
  if (pendingError) throw pendingError;

  try {
    await sendInvitationEmail(input.email, input.requestUrl);
  } catch (error) {
    const classified = classifyFounderAdminError(error) ?? {
      code: "EMAIL_SEND_FAILED",
      status: 502,
      message: "The invitation was saved, but the email could not be sent. Try resending it shortly.",
    };
    const { error: failedStateError } = await admin
      .from("workspace_memberships")
      .update({
        invitation_delivery_status: "failed",
        invitation_delivery_attempted_at: attemptedAtIso,
        invitation_delivery_error_code: classified.code,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("status", "invited");
    if (failedStateError) throw failedStateError;
    throw adminProductError(classified.code, classified.status, classified.message, {
      invitationState: "failed",
      invitationAttemptedAt: attemptedAtIso,
    });
  }

  const expiresAt = invitationExpiresAt(attemptedAt);
  const { error: sentStateError } = await admin
    .from("workspace_memberships")
    .update({
      invitation_delivery_status: "sent",
      invitation_delivery_attempted_at: attemptedAtIso,
      invitation_delivery_error_code: null,
      invitation_last_sent_at: attemptedAtIso,
      invitation_expires_at: expiresAt,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "invited");
  if (sentStateError) throw sentStateError;

  return {
    status: "sent" as const,
    attemptedAt: attemptedAtIso,
    lastSentAt: attemptedAtIso,
    expiresAt,
  };
}

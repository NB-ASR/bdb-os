import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function bootstrapFounder(userId: string, email?: string | null) {
  const allowed = (process.env.BDB_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!email || !allowed.includes(email.toLowerCase())) return;
  const admin = createAdminClient();
  if (!admin) return;

  const { data: existing } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  await admin
    .from("platform_admins")
    .upsert(
      { user_id: userId, role: "founder", active: true },
      { onConflict: "user_id" },
    );

  if (!existing) {
    await admin.from("audit_logs").insert({
      actor_user_id: userId,
      action: "platform.founder_bootstrapped",
      entity_type: "platform_admin",
      entity_id: userId,
      metadata: { email },
    });
  }
}

export async function activatePendingMemberships(userId: string) {
  const admin = createAdminClient();
  if (!admin) throw new Error("NOT_CONFIGURED");

  const now = new Date().toISOString();
  const { data: pending, error: pendingError } = await admin
    .from("workspace_memberships")
    .select("workspace_id,invitation_expires_at")
    .eq("user_id", userId)
    .eq("status", "invited");
  if (pendingError) throw pendingError;

  const validWorkspaceIds = (pending ?? [])
    .filter(
      (membership) =>
        !membership.invitation_expires_at ||
        membership.invitation_expires_at > now,
    )
    .map((membership) => membership.workspace_id);

  const expiredWorkspaceIds = (pending ?? [])
    .filter(
      (membership) =>
        Boolean(membership.invitation_expires_at) &&
        membership.invitation_expires_at <= now,
    )
    .map((membership) => membership.workspace_id);

  if (!validWorkspaceIds.length) {
    return { activated: [], expired: expiredWorkspaceIds };
  }

  const { data, error } = await admin
    .from("workspace_memberships")
    .update({
      status: "active",
      joined_at: now,
      invitation_expires_at: null,
    })
    .eq("user_id", userId)
    .eq("status", "invited")
    .in("workspace_id", validWorkspaceIds)
    .select("workspace_id");
  if (error) throw error;

  const activated = (data ?? []).map((membership) => membership.workspace_id);
  if (activated.length) {
    const { data: profile } = await admin
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.active_workspace_id) {
      await admin
        .from("profiles")
        .update({ active_workspace_id: activated[0] })
        .eq("id", userId);
    }

    await admin.from("audit_logs").insert(
      activated.map((workspaceId) => ({
        actor_user_id: userId,
        workspace_id: workspaceId,
        action: "team.invitation_accepted",
        entity_type: "membership",
        entity_id: userId,
        metadata: {},
      })),
    );
  }

  return { activated, expired: expiredWorkspaceIds };
}

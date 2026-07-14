import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function bootstrapFounder(userId: string, email?: string | null) {
  const allowed = (process.env.BDB_FOUNDER_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowed.includes(email.toLowerCase())) return;
  const admin = createAdminClient();
  if (!admin) return;
  await admin.from("platform_admins").upsert({ user_id: userId, role: "founder", active: true }, { onConflict: "user_id" });
  await admin.from("audit_logs").insert({ actor_user_id: userId, action: "platform.founder_bootstrapped", entity_type: "platform_admin", entity_id: userId, metadata: { email } });
}

export async function activatePendingMemberships(userId: string) {
  const admin = createAdminClient(); if (!admin) return;
  const { data } = await admin.from("workspace_memberships").update({ status: "active", joined_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "invited").select("workspace_id");
  for (const membership of data ?? []) await admin.from("audit_logs").insert({ actor_user_id: userId, workspace_id: membership.workspace_id, action: "team.invitation_accepted", entity_type: "membership", entity_id: userId, metadata: {} });
}

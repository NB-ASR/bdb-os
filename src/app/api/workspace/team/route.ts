import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function context() {
  const supabase = await createClient(); const admin = createAdminClient(); const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !admin || !workspaceId) throw new Error("UNAUTHENTICATED");
  const { data: claims } = await supabase.auth.getClaims(); const userId = String(claims?.claims?.sub ?? "");
  if (!userId) throw new Error("UNAUTHENTICATED");
  const { data: membership } = await supabase.from("workspace_memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!membership || !["owner", "admin", "manager"].includes(membership.role)) throw new Error("FORBIDDEN");
  return { supabase, admin, workspaceId, userId };
}

function failure(error: unknown) { const message = error instanceof Error ? error.message : "FORBIDDEN"; return Response.json({ error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 403 }); }

export async function GET() {
  try { const { admin, workspaceId } = await context(); const { data, error } = await admin.from("workspace_memberships").select("user_id,role,status,joined_at,profiles(full_name)").eq("workspace_id", workspaceId).order("created_at"); if (error) throw error; const members = await Promise.all((data ?? []).map(async (member) => { const user = await admin.auth.admin.getUserById(member.user_id); return { ...member, email: user.data.user?.email ?? "" }; })); return Response.json({ members }); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try { const { admin, workspaceId, userId } = await context(); const body = await request.json() as { email?: string; role?: string }; const email = String(body.email ?? "").trim().toLowerCase(); const role = body.role === "manager" ? "manager" : body.role === "owner" ? "owner" : "staff"; if (!email) return Response.json({ error: "Email is required" }, { status: 400 }); const invite = await admin.auth.admin.inviteUserByEmail(email, { data: { workspace_id: workspaceId, workspace_role: role }, redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/workspace` }); if (invite.error || !invite.data.user) throw invite.error ?? new Error("Invite failed"); const { error } = await admin.from("workspace_memberships").upsert({ workspace_id: workspaceId, user_id: invite.data.user.id, role, status: "invited", invited_by: userId }, { onConflict: "workspace_id,user_id" }); if (error) throw error; await admin.from("audit_logs").insert({ workspace_id: workspaceId, actor_user_id: userId, action: "team.member_invited", entity_type: "membership", entity_id: invite.data.user.id, metadata: { email, role } }); return Response.json({ ok: true }); } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try { const { admin, workspaceId, userId } = await context(); const body = await request.json() as { userId?: string; role?: string; status?: string }; const target = String(body.userId ?? ""); const role = ["owner", "manager", "staff"].includes(String(body.role)) ? body.role : undefined; const status = ["active", "suspended"].includes(String(body.status)) ? body.status : undefined; if (!target || (!role && !status)) return Response.json({ error: "Invalid update" }, { status: 400 }); const changes = { ...(role ? { role } : {}), ...(status ? { status } : {}) }; const { error } = await admin.from("workspace_memberships").update(changes).eq("workspace_id", workspaceId).eq("user_id", target); if (error) throw error; await admin.from("audit_logs").insert({ workspace_id: workspaceId, actor_user_id: userId, action: "team.member_updated", entity_type: "membership", entity_id: target, metadata: changes }); return Response.json({ ok: true }); } catch (error) { return failure(error); }
}

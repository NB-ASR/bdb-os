import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient(); const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !workspaceId) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { data: claims } = await supabase.auth.getClaims(); const userId = String(claims?.claims?.sub ?? ""); if (!userId) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  const { error } = await supabase.from("push_subscriptions").upsert({ workspace_id: workspaceId, user_id: userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, user_agent: request.headers.get("user-agent") }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true });
}

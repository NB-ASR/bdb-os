import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

async function context() {
  const supabase = await createClient();
  const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !workspaceId) return null;
  const { data: claims } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  return userId ? { supabase, workspaceId, userId } : null;
}

export async function GET() {
  const current = await context();
  if (!current) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const { count, error } = await current.supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", current.workspaceId)
    .eq("user_id", current.userId);
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true, count: Number(count ?? 0) });
}

export async function POST(request: Request) {
  const current = await context();
  if (!current) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  }
  const { error } = await current.supabase.from("push_subscriptions").upsert({
    workspace_id: current.workspaceId,
    user_id: current.userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    user_agent: request.headers.get("user-agent"),
  }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const current = await context();
  if (!current) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { endpoint?: string };
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint) return Response.json({ error: "Push endpoint is required" }, { status: 400 });
  const { error } = await current.supabase
    .from("push_subscriptions")
    .delete()
    .eq("workspace_id", current.workspaceId)
    .eq("user_id", current.userId)
    .eq("endpoint", endpoint);
  if (error) return Response.json({ error: error.message }, { status: 403 });
  return Response.json({ ok: true });
}

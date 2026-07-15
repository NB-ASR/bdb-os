import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function identity() {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  if (error || !userId) throw new Error("UNAUTHENTICATED");
  return { supabase, admin, userId };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "REQUEST_FAILED";
  const status = code === "NOT_CONFIGURED" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 500;
  const message = code === "FORBIDDEN"
    ? "This business is not linked to your current company or you do not have active access."
    : code === "NOT_CONFIGURED"
      ? "Cloud workspace switching is not configured."
      : code === "UNAUTHENTICATED"
        ? "Sign in to continue."
        : "The business context could not be loaded.";
  return Response.json({ error: message, code }, { status });
}

export async function GET() {
  try {
    const { supabase, admin, userId } = await identity();
    const { data, error } = await supabase.rpc("get_my_linked_workspaces");
    if (error) throw error;
    const workspaces = data ?? [];
    const current = workspaces.find((workspace: { is_active?: boolean }) => workspace.is_active) ?? workspaces[0];

    if (current) {
      const { data: profile } = await admin
        .from("profiles")
        .select("active_workspace_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.active_workspace_id) {
        await admin.from("profiles").update({ active_workspace_id: current.workspace_id }).eq("id", userId);
      }
    }

    const response = Response.json({ workspaces, currentWorkspaceId: current?.workspace_id ?? null });
    if (current) {
      response.headers.append(
        "Set-Cookie",
        `bdb-workspace=${encodeURIComponent(current.workspace_id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      );
    }
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, userId } = await identity();
    const body = (await request.json()) as { workspaceId?: string };
    const targetWorkspaceId = String(body.workspaceId ?? "");
    if (!targetWorkspaceId) return Response.json({ error: "Choose a business." }, { status: 400 });

    const { data: targetMembership } = await admin
      .from("workspace_memberships")
      .select("workspace_id,status")
      .eq("workspace_id", targetWorkspaceId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!targetMembership) throw new Error("FORBIDDEN");

    const cookieStore = await cookies();
    const { data: profile } = await admin
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", userId)
      .maybeSingle();
    const currentWorkspaceId = profile?.active_workspace_id ?? cookieStore.get("bdb-workspace")?.value ?? null;

    if (currentWorkspaceId && currentWorkspaceId !== targetWorkspaceId) {
      const { data: links, error: linksError } = await admin
        .from("business_group_workspaces")
        .select("group_id,workspace_id")
        .in("workspace_id", [currentWorkspaceId, targetWorkspaceId]);
      if (linksError) throw linksError;
      const currentGroups = new Set((links ?? []).filter((link) => link.workspace_id === currentWorkspaceId).map((link) => link.group_id));
      const linked = (links ?? []).some((link) => link.workspace_id === targetWorkspaceId && currentGroups.has(link.group_id));
      if (!linked) throw new Error("FORBIDDEN");
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ active_workspace_id: targetWorkspaceId })
      .eq("id", userId);
    if (profileError) throw profileError;

    await admin.from("audit_logs").insert({
      workspace_id: targetWorkspaceId,
      actor_user_id: userId,
      action: "workspace.context_switched",
      entity_type: "workspace",
      entity_id: targetWorkspaceId,
      metadata: { previous_workspace_id: currentWorkspaceId },
    });

    const response = Response.json({ ok: true, workspaceId: targetWorkspaceId });
    response.headers.append(
      "Set-Cookie",
      `bdb-workspace=${encodeURIComponent(targetWorkspaceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}

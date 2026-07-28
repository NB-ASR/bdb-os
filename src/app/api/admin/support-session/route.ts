import { cookies } from "next/headers";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { supportAccessMode, type SupportAccessMode } from "@/lib/dev-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const READ_ONLY_SESSION_MINUTES = 30;
const TEST_WRITE_SESSION_MINUTES = 20;

type SupportSession = {
  id: string;
  workspace_id: string;
  reason: string;
  access_mode: SupportAccessMode;
  started_at: string;
  expires_at: string;
};

function sessionMinutes(mode: SupportAccessMode) {
  return mode === "test_write" ? TEST_WRITE_SESSION_MINUTES : READ_ONLY_SESSION_MINUTES;
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

async function activeSession(admin: NonNullable<ReturnType<typeof createAdminClient>>, userId: string) {
  const { data, error } = await admin
    .from("platform_support_sessions")
    .select("id,workspace_id,reason,access_mode,started_at,expires_at")
    .eq("admin_user_id", userId)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as SupportSession | null;
}

export async function GET() {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const issuedAccessMode = supportAccessMode();

    const [workspaceResult, session] = await Promise.all([
      admin
        .from("workspaces")
        .select("id,name,slug,status,plan_id,created_at")
        .in("status", ["trial", "active"])
        .order("name"),
      activeSession(admin, identity.userId),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;

    const active = session
      ? {
          ...session,
          workspace: (workspaceResult.data ?? []).find((workspace) => workspace.id === session.workspace_id) ?? null,
        }
      : null;

    return response({
      enabled: true,
      accessMode: issuedAccessMode,
      sessionMinutes: sessionMinutes(issuedAccessMode),
      active,
      workspaces: workspaceResult.data ?? [],
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const body = (await request.json().catch(() => null)) as { workspaceId?: unknown; reason?: unknown } | null;
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!workspaceId) return response({ error: "Choose a workspace." }, 400);
    if (reason.length < 5 || reason.length > 500) {
      return response({ error: "Enter a support reason between 5 and 500 characters." }, 400);
    }

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id,name,slug,status")
      .eq("id", workspaceId)
      .in("status", ["trial", "active"])
      .maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace) return response({ error: "This workspace is not available for support access." }, 404);

    const accessMode = supportAccessMode();
    const durationMinutes = sessionMinutes(accessMode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    const { error: endError } = await admin
      .from("platform_support_sessions")
      .update({ ended_at: now.toISOString() })
      .eq("admin_user_id", identity.userId)
      .is("ended_at", null);
    if (endError) throw endError;

    const { data: session, error: sessionError } = await admin
      .from("platform_support_sessions")
      .insert({
        admin_user_id: identity.userId,
        workspace_id: workspace.id,
        reason,
        access_mode: accessMode,
        expires_at: expiresAt.toISOString(),
        metadata: {
          source: "founder_admin",
          testing_mode: accessMode === "test_write",
          git_ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
          vercel_environment: process.env.VERCEL_ENV ?? null,
        },
      })
      .select("id,workspace_id,reason,access_mode,started_at,expires_at")
      .single();
    if (sessionError) throw sessionError;

    const { error: profileError } = await admin
      .from("profiles")
      .update({ active_workspace_id: workspace.id })
      .eq("id", identity.userId);
    if (profileError) throw profileError;

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: identity.userId,
      workspace_id: workspace.id,
      action: "admin.support_session_started",
      entity_type: "platform_support_session",
      entity_id: session.id,
      metadata: {
        reason,
        access_mode: accessMode,
        workspace_name: workspace.name,
        expires_at: expiresAt.toISOString(),
        testing_mode: accessMode === "test_write",
      },
    });
    if (auditError) throw auditError;

    const cookieStore = await cookies();
    cookieStore.set("bdb-workspace", workspace.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: durationMinutes * 60,
    });

    return response({
      ok: true,
      session,
      workspace,
      redirect: "/workspace",
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const session = await activeSession(admin, identity.userId);
    const now = new Date().toISOString();

    if (session) {
      const { error: endError } = await admin
        .from("platform_support_sessions")
        .update({ ended_at: now })
        .eq("id", session.id)
        .eq("admin_user_id", identity.userId);
      if (endError) throw endError;

      const { error: auditError } = await admin.from("audit_logs").insert({
        actor_user_id: identity.userId,
        workspace_id: session.workspace_id,
        action: "admin.support_session_ended",
        entity_type: "platform_support_session",
        entity_id: session.id,
        metadata: {
          access_mode: session.access_mode,
          started_at: session.started_at,
          ended_at: now,
        },
      });
      if (auditError) throw auditError;
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ active_workspace_id: null })
      .eq("id", identity.userId);
    if (profileError) throw profileError;

    const cookieStore = await cookies();
    cookieStore.delete("bdb-workspace");

    return response({ ok: true, redirect: "/admin" });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

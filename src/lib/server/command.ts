import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type WorkspaceCommandContext = {
  commandId: string;
  idempotencyKey: string | null;
  userId: string;
  workspaceId: string;
  role: string;
  accessProfile: string;
  accessMode: "member" | "support_read_only";
  isSupportSession: boolean;
};

export function commandJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init?.headers },
  });
}

export async function parseCommandBody<T extends Record<string, unknown>>(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CommandError("INVALID_JSON", "A valid JSON object is required.", 400);
  }
  return body as T;
}

async function activeReadOnlySupportSession(userId: string, workspaceId: string) {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("platform_support_sessions")
    .select("id,access_mode,workspaces!inner(status)")
    .eq("admin_user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("access_mode", "read_only")
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .in("workspaces.status", ["trial", "active"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function requireWorkspaceCommand(
  request: Request,
  workspaceId: string,
): Promise<WorkspaceCommandContext> {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new CommandError("INVALID_WORKSPACE", "A valid workspace is required.", 400);
  }

  const supabase = await createClient();
  if (!supabase) {
    throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);
  }

  const userId = userData.user.id;
  const [membershipResult, supportSession] = await Promise.all([
    // Use the authenticated client rather than the service role. Existing RLS
    // enforces active-profile, workspace and approved Business Group context.
    supabase
      .from("workspace_memberships")
      .select("role,access_profile,status,workspaces!inner(status)")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    activeReadOnlySupportSession(userId, workspaceId),
  ]);
  if (membershipResult.error) throw membershipResult.error;

  const membership = membershipResult.data as unknown as {
    role: string;
    access_profile: string;
    status: string;
    workspaces: { status: string };
  } | null;
  const memberAccess = Boolean(
    membership && ["trial", "active"].includes(membership.workspaces.status),
  );

  // Founder support access is deliberately read-only even when the Founder also
  // has an operational membership. Trusted database commands retain the same
  // guard, so this server boundary and the database fail closed together.
  if (supportSession && request.method !== "GET") {
    throw new CommandError(
      "SUPPORT_READ_ONLY",
      "Founder support access is read-only. Switch to an operational workspace account to make changes.",
      403,
    );
  }

  if (!memberAccess && !(supportSession && request.method === "GET")) {
    throw new CommandError("WORKSPACE_FORBIDDEN", "This workspace is not available.", 403);
  }

  const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  if (rawIdempotencyKey && rawIdempotencyKey.length > 128) {
    throw new CommandError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is too long.", 400);
  }

  return {
    commandId: randomUUID(),
    idempotencyKey: rawIdempotencyKey,
    userId,
    workspaceId,
    role: supportSession ? "support" : membership?.role ?? "",
    accessProfile: supportSession ? "support_read_only" : membership?.access_profile ?? "",
    accessMode: supportSession ? "support_read_only" : "member",
    isSupportSession: Boolean(supportSession),
  };
}

export async function runCommand<T>(handler: () => Promise<T>) {
  try {
    const result = await handler();
    return commandJson({ ok: true, result });
  } catch (error) {
    if (error instanceof CommandError) {
      return commandJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error("BDB OS command failed", error);
    return commandJson(
      { ok: false, error: "The operation could not be completed.", code: "COMMAND_FAILED" },
      { status: 500 },
    );
  }
}

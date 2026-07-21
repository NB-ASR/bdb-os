import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

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

  // Use the authenticated client rather than the service role. The existing RLS
  // policy enforces active-profile, active-workspace and approved Business Group
  // context. A client-supplied workspace ID must never bypass that boundary.
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role,access_profile,status,workspaces!inner(status)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;

  const membership = data as unknown as {
    role: string;
    access_profile: string;
    status: string;
    workspaces: { status: string };
  } | null;
  if (!membership || !["trial", "active"].includes(membership.workspaces.status)) {
    throw new CommandError("WORKSPACE_FORBIDDEN", "This workspace is not available.", 403);
  }

  const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
  if (rawIdempotencyKey && rawIdempotencyKey.length > 128) {
    throw new CommandError("INVALID_IDEMPOTENCY_KEY", "The idempotency key is too long.", 400);
  }

  return {
    commandId: randomUUID(),
    idempotencyKey: rawIdempotencyKey,
    userId: userData.user.id,
    workspaceId,
    role: membership.role,
    accessProfile: membership.access_profile,
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

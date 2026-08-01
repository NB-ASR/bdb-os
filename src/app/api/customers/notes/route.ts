import { createAdminClient } from "@/lib/supabase/admin";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create", "void"]);

type NoteBody = Record<string, unknown> & {
  workspaceId?: unknown;
  customerId?: unknown;
  action?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_CUSTOMER_NOTE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_CUSTOMER_NOTE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return new Date().toISOString();
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_CUSTOMER_NOTE_INPUT", "Note date is invalid.");
  }
  return parsed.toISOString();
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("CUSTOMER_NOTE_FORBIDDEN", "You do not have permission to change Customer notes.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("CUSTOMER_NOTE_NOT_FOUND", error.message, 404);
  }
  if (message.includes("already been voided") || error.code === "23505") {
    return new CommandError("CUSTOMER_NOTE_CONFLICT", error.message, 409);
  }
  return new CommandError("CUSTOMER_NOTE_COMMAND_FAILED", error.message, 400);
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<NoteBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const customerId = uuid(body.customerId, "Customer");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_CUSTOMER_NOTE_ACTION", "Customer note action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Customer note changes.");
    }

    const admin = createAdminClient();
    if (!admin) {
      throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    }

    const result = action === "create"
      ? await admin.rpc("create_customer_note", {
        p_workspace_id: workspaceId,
        p_note_id: uuid(body.id, "Customer note ID"),
        p_customer_id: customerId,
        p_body: text(body.body, "Customer note", 1, 4000),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      })
      : await admin.rpc("void_customer_note", {
        p_workspace_id: workspaceId,
        p_void_note_id: uuid(body.id, "Customer note void ID"),
        p_customer_id: customerId,
        p_note_id: uuid(body.noteId, "Customer note"),
        p_reason: text(body.reason, "Void reason", 5, 500),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      });

    if (result.error) throw friendlyError(result.error);
    return result.data as Record<string, unknown>;
  });
}

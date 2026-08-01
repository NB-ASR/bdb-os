import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(["Email", "WhatsApp", "Instagram", "Web"]);
const DIRECTIONS = new Set(["inbound", "outbound"]);
const DRAFT_STATES = new Set(["none", "review"]);
const ACTIONS = new Set(["record_message", "mark_read", "dismiss_draft", "close_thread"]);

type CommunicationCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  threadId?: unknown;
  messageId?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_COMMUNICATION_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalUuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_COMMUNICATION_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_COMMUNICATION_INPUT", `${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return new Date().toISOString();
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_COMMUNICATION_INPUT", "Communication date is invalid.");
  }
  return parsed.toISOString();
}

function navigationParameter(request: Request, name: string) {
  const direct = new URL(request.url).searchParams.get(name);
  if (direct) return direct;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).searchParams.get(name);
  } catch {
    return null;
  }
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied") || message.includes("customer access denied")) {
    return new CommandError("COMMUNICATION_FORBIDDEN", "You do not have permission to change this communication.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("COMMUNICATION_NOT_FOUND", error.message, 404);
  }
  if (message.includes("already") || message.includes("conflict") || message.includes("closed") || error.code === "23505") {
    return new CommandError("COMMUNICATION_CONFLICT", error.message, 409);
  }
  return new CommandError("COMMUNICATION_COMMAND_FAILED", error.message, 400);
}

async function existingReceipt(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const result = await admin
    .from("communication_command_receipts")
    .select("result")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (result.error) throw friendlyError(result.error);
  return result.data?.result as Record<string, unknown> | undefined;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const requestedThreadId = optionalUuid(navigationParameter(request, "threadId"), "Thread");
    const customerId = optionalUuid(navigationParameter(request, "customerId"), "Customer");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accessResult = await supabase.rpc("get_customer_360_access", {
      target_workspace_id: workspaceId,
    });
    if (accessResult.error) throw accessResult.error;
    const access = Object.fromEntries(
      ((accessResult.data ?? []) as Array<{ feature_key: string; can_view: boolean }>).map((item) => [
        item.feature_key,
        Boolean(item.can_view),
      ]),
    ) as Record<string, boolean>;

    if (!access.communications) {
      throw new CommandError("COMMUNICATION_FORBIDDEN", "Communications access is required.", 403);
    }

    let threadsQuery = supabase
      .from("unified_communication_index")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (customerId) threadsQuery = threadsQuery.eq("customer_id", customerId);
    const threadsResult = await threadsQuery;
    if (threadsResult.error) throw friendlyError(threadsResult.error);

    const threads = threadsResult.data ?? [];
    const threadId = requestedThreadId ?? (threads[0]?.id ? String(threads[0].id) : null);
    if (threadId && !threads.some((thread) => String(thread.id) === threadId)) {
      throw new CommandError("COMMUNICATION_NOT_FOUND", "The communication thread could not be found.", 404);
    }

    const [messagesResult, customersResult] = await Promise.all([
      threadId
        ? supabase
          .from("messages")
          .select("id,workspace_id,customer_id,thread_id,channel,direction,subject,body,preview,occurred_at,unread,status,draft_state,read_at,reply_to_message_id,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("thread_id", threadId)
          .order("occurred_at", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(250)
        : Promise.resolve({ data: [], error: null }),
      access.customers
        ? supabase
          .from("customers")
          .select("id,code,name,company,email,phone,status")
          .eq("workspace_id", workspaceId)
          .eq("status", "active")
          .order("name")
          .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (messagesResult.error) throw friendlyError(messagesResult.error);
    if (customersResult.error) throw customersResult.error;

    return {
      workspaceId,
      access,
      threads,
      selectedThreadId: threadId,
      messages: messagesResult.data ?? [],
      customers: customersResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<CommunicationCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = text(body.action, "Communication action", 1, 40);
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_COMMUNICATION_ACTION", "Communication action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for communication changes.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const previous = await existingReceipt(admin, workspaceId, context.idempotencyKey);
    if (previous) return previous;

    const threadId = uuid(body.threadId, "Thread ID");
    let result;

    if (action === "record_message") {
      const channel = text(body.channel, "Communication channel", 1, 40);
      const direction = text(body.direction, "Communication direction", 1, 20);
      const draftState = text(body.draftState ?? "none", "Draft state", 1, 20);
      if (!CHANNELS.has(channel)) {
        throw new CommandError("INVALID_COMMUNICATION_CHANNEL", "Communication channel is invalid.");
      }
      if (!DIRECTIONS.has(direction)) {
        throw new CommandError("INVALID_COMMUNICATION_DIRECTION", "Communication direction is invalid.");
      }
      if (!DRAFT_STATES.has(draftState)) {
        throw new CommandError("INVALID_COMMUNICATION_DRAFT", "Communication draft state is invalid.");
      }

      result = await admin.rpc("record_communication_message", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_message_id: uuid(body.messageId, "Message ID"),
        p_customer_id: uuid(body.customerId, "Customer"),
        p_channel: channel,
        p_direction: direction,
        p_subject: text(body.subject, "Subject", 1, 240),
        p_body: text(body.body, "Message", 1, 10000),
        p_reply_to_message_id: optionalUuid(body.replyToMessageId, "Reply target"),
        p_draft_state: draftState,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      });
    } else if (action === "mark_read") {
      result = await admin.rpc("mark_communication_message_read", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_message_id: uuid(body.messageId, "Message ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      });
    } else if (action === "dismiss_draft") {
      result = await admin.rpc("dismiss_communication_draft", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_message_id: uuid(body.messageId, "Message ID"),
        p_reason: text(body.reason, "Dismissal reason", 5, 500),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      });
    } else {
      result = await admin.rpc("close_communication_thread", {
        p_workspace_id: workspaceId,
        p_thread_id: threadId,
        p_reason: text(body.reason, "Closure reason", 5, 500),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: timestamp(body.occurredAt),
      });
    }

    if (result.error) throw friendlyError(result.error);
    return result.data as Record<string, unknown>;
  });
}

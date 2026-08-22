export type SupplierPayablesCommandAction =
  | "payable-post"
  | "payable-reverse"
  | "payment-record"
  | "payment-allocate"
  | "payment-allocation-reverse"
  | "payment-reverse"
  | "credit-allocate"
  | "credit-allocation-reverse";

export type SupplierPayablesQueueFailureKind = "confirmed_rejection" | "ambiguous";

export type SupplierPayablesQueuedCommand = {
  id: string;
  workspaceId: string;
  action: SupplierPayablesCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
  lastErrorStatus?: number;
  failureKind?: SupplierPayablesQueueFailureKind;
};

type SupplierPayablesSubmissionError = Error & {
  code?: string;
  status?: number;
  failureKind?: SupplierPayablesQueueFailureKind;
};

const QUEUE_PREFIX = "bdb-supplier-payables-queue-v1";
const queueKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

function confirmedServerRejection(status: number) {
  if (status < 400 || status >= 500) return false;
  return !new Set([401, 403, 408, 425, 429]).has(status);
}

export function readSupplierPayablesQueue(workspaceId: string): SupplierPayablesQueuedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queueKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SupplierPayablesQueuedCommand => Boolean(
      item
      && typeof item === "object"
      && typeof (item as SupplierPayablesQueuedCommand).id === "string"
      && (item as SupplierPayablesQueuedCommand).workspaceId === workspaceId
      && typeof (item as SupplierPayablesQueuedCommand).action === "string"
      && (item as SupplierPayablesQueuedCommand).payload
      && typeof (item as SupplierPayablesQueuedCommand).payload === "object",
    ));
  } catch {
    window.localStorage.removeItem(queueKey(workspaceId));
    return [];
  }
}

function writeQueue(workspaceId: string, queue: SupplierPayablesQueuedCommand[]) {
  if (typeof window === "undefined") return;
  if (!queue.length) window.localStorage.removeItem(queueKey(workspaceId));
  else window.localStorage.setItem(queueKey(workspaceId), JSON.stringify(queue));
}

export function enqueueSupplierPayablesCommand(
  workspaceId: string,
  action: SupplierPayablesCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  const existing = readSupplierPayablesQueue(workspaceId);
  const duplicate = existing.find((item) => item.id === id);
  if (duplicate) return duplicate;
  const command: SupplierPayablesQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  writeQueue(workspaceId, [...existing, command]);
  return command;
}

export function removeSupplierPayablesCommand(workspaceId: string, id: string) {
  writeQueue(workspaceId, readSupplierPayablesQueue(workspaceId).filter((item) => item.id !== id));
}

export function canDiscardSupplierPayablesCommand(command: SupplierPayablesQueuedCommand) {
  return Boolean(command.lastError) && command.failureKind === "confirmed_rejection";
}

function failSupplierPayablesCommand(
  workspaceId: string,
  commandId: string,
  error: string,
  details: { code?: string; status?: number; failureKind?: SupplierPayablesQueueFailureKind } = {},
) {
  writeQueue(workspaceId, readSupplierPayablesQueue(workspaceId).map((item) => item.id === commandId
    ? {
      ...item,
      attempts: item.attempts + 1,
      lastError: error.slice(0, 240),
      lastErrorCode: details.code,
      lastErrorStatus: details.status,
      failureKind: details.failureKind ?? "ambiguous",
    }
    : item));
}

export async function submitSupplierPayablesCommand(command: SupplierPayablesQueuedCommand) {
  let response: Response;
  try {
    response = await fetch("/api/supplier-payables", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.id,
      },
      body: JSON.stringify({
        workspaceId: command.workspaceId,
        action: command.action,
        ...command.payload,
      }),
    });
  } catch (cause) {
    const error = new Error(cause instanceof Error ? cause.message : "The Supplier Accounts command transport failed.") as SupplierPayablesSubmissionError;
    error.failureKind = "ambiguous";
    throw error;
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "The Supplier Accounts command could not be completed.") as SupplierPayablesSubmissionError;
    error.code = result.code;
    error.status = response.status;
    error.failureKind = confirmedServerRejection(response.status) ? "confirmed_rejection" : "ambiguous";
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushSupplierPayablesQueue(workspaceId: string) {
  const queue = readSupplierPayablesQueue(workspaceId);
  let completed = 0;
  for (const command of queue) {
    try {
      await submitSupplierPayablesCommand(command);
      removeSupplierPayablesCommand(workspaceId, command.id);
      completed += 1;
    } catch (error) {
      const failure = error as SupplierPayablesSubmissionError;
      const message = error instanceof Error ? error.message : "The Supplier Accounts command could not be completed.";
      failSupplierPayablesCommand(workspaceId, command.id, message, {
        code: failure.code,
        status: failure.status,
        failureKind: failure.failureKind ?? "ambiguous",
      });
      throw new Error(message);
    }
  }
  return completed;
}

export type SupplierPayablesCommandAction =
  | "payable-post"
  | "payable-reverse"
  | "payment-record"
  | "payment-allocate"
  | "payment-allocation-reverse"
  | "payment-reverse"
  | "credit-allocate"
  | "credit-allocation-reverse";

export type SupplierPayablesQueuedCommand = {
  id: string;
  workspaceId: string;
  action: SupplierPayablesCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-supplier-payables-queue-v1";
const queueKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

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
  window.localStorage.setItem(queueKey(workspaceId), JSON.stringify(queue));
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

export async function submitSupplierPayablesCommand(command: SupplierPayablesQueuedCommand) {
  const response = await fetch("/api/supplier-payables", {
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
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? "The Supplier Accounts command could not be completed.");
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
      const message = error instanceof Error ? error.message : "The Supplier Accounts command could not be completed.";
      writeQueue(workspaceId, readSupplierPayablesQueue(workspaceId).map((item) => item.id === command.id
        ? { ...item, attempts: item.attempts + 1, lastError: message }
        : item));
      throw new Error(message);
    }
  }
  return completed;
}

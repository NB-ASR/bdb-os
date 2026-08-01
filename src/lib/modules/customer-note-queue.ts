export type CustomerNoteCommandAction = "create" | "void";

export type CustomerNoteQueuedCommand = {
  id: string;
  workspaceId: string;
  customerId: string;
  action: CustomerNoteCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-customer-note-queue-v1";
const queueKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

export function readCustomerNoteQueue(workspaceId: string): CustomerNoteQueuedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queueKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CustomerNoteQueuedCommand => Boolean(
      item
      && typeof item === "object"
      && typeof (item as CustomerNoteQueuedCommand).id === "string"
      && (item as CustomerNoteQueuedCommand).workspaceId === workspaceId
      && typeof (item as CustomerNoteQueuedCommand).customerId === "string"
      && ["create", "void"].includes((item as CustomerNoteQueuedCommand).action)
      && (item as CustomerNoteQueuedCommand).payload
      && typeof (item as CustomerNoteQueuedCommand).payload === "object",
    ));
  } catch {
    window.localStorage.removeItem(queueKey(workspaceId));
    return [];
  }
}

function writeCustomerNoteQueue(workspaceId: string, queue: CustomerNoteQueuedCommand[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(queueKey(workspaceId), JSON.stringify(queue));
}

export function enqueueCustomerNoteCommand(
  workspaceId: string,
  customerId: string,
  action: CustomerNoteCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  const queue = readCustomerNoteQueue(workspaceId);
  const duplicate = queue.find((command) => command.id === id);
  if (duplicate) return duplicate;
  const command: CustomerNoteQueuedCommand = {
    id,
    workspaceId,
    customerId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  writeCustomerNoteQueue(workspaceId, [...queue, command]);
  return command;
}

export function removeCustomerNoteCommand(workspaceId: string, id: string) {
  writeCustomerNoteQueue(
    workspaceId,
    readCustomerNoteQueue(workspaceId).filter((command) => command.id !== id),
  );
}

export async function submitCustomerNoteCommand(command: CustomerNoteQueuedCommand) {
  const response = await fetch("/api/customers/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": command.id,
    },
    body: JSON.stringify({
      workspaceId: command.workspaceId,
      customerId: command.customerId,
      action: command.action,
      ...command.payload,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "The Customer note command could not be completed.") as Error & { code?: string };
    error.code = result.code;
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushCustomerNoteQueue(workspaceId: string) {
  const queue = readCustomerNoteQueue(workspaceId);
  let completed = 0;
  for (const command of queue) {
    try {
      await submitCustomerNoteCommand(command);
      removeCustomerNoteCommand(workspaceId, command.id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Customer note command could not be completed.";
      writeCustomerNoteQueue(
        workspaceId,
        readCustomerNoteQueue(workspaceId).map((item) => item.id === command.id
          ? { ...item, attempts: item.attempts + 1, lastError: message }
          : item),
      );
      throw error;
    }
  }
  return completed;
}

export type CustomerCommandAction = "create" | "update" | "archive" | "restore";

export type CustomerQueuedCommand = {
  id: string;
  workspaceId: string;
  action: CustomerCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-customer-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is CustomerQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<CustomerQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "archive", "restore"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readCustomerQueue(workspaceId: string): CustomerQueuedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isCommand).filter((command) => command.workspaceId === workspaceId)
      : [];
  } catch {
    window.localStorage.removeItem(storageKey(workspaceId));
    return [];
  }
}

export function writeCustomerQueue(workspaceId: string, commands: readonly CustomerQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueCustomerCommand(
  workspaceId: string,
  action: CustomerCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): CustomerQueuedCommand {
  const command: CustomerQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readCustomerQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeCustomerQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeCustomerCommand(workspaceId: string, commandId: string) {
  writeCustomerQueue(
    workspaceId,
    readCustomerQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failCustomerCommand(workspaceId: string, commandId: string, error: string) {
  writeCustomerQueue(
    workspaceId,
    readCustomerQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitCustomerCommand(command: CustomerQueuedCommand) {
  const response = await fetch("/api/customers", {
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
    const error = new Error(result.error ?? "Customer command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushCustomerQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readCustomerQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readCustomerQueue(workspaceId)) {
    try {
      await submitCustomerCommand(command);
      removeCustomerCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readCustomerQueue(workspaceId).length);
    } catch (error) {
      failCustomerCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Customer command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readCustomerQueue(workspaceId).length };
}

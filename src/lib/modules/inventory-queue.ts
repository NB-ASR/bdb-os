export type InventoryCommandAction =
  | "create-location"
  | "create-item"
  | "post-movement"
  | "transfer-stock"
  | "reverse-movement";

export type InventoryQueuedCommand = {
  id: string;
  workspaceId: string;
  action: InventoryCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-inventory-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is InventoryQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<InventoryQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && typeof command.action === "string"
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readInventoryQueue(workspaceId: string): InventoryQueuedCommand[] {
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

export function writeInventoryQueue(workspaceId: string, commands: readonly InventoryQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (relevant.length === 0) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueInventoryCommand(
  workspaceId: string,
  action: InventoryCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): InventoryQueuedCommand {
  const command: InventoryQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readInventoryQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeInventoryQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeInventoryCommand(workspaceId: string, commandId: string) {
  writeInventoryQueue(
    workspaceId,
    readInventoryQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failInventoryCommand(workspaceId: string, commandId: string, error: string) {
  writeInventoryQueue(
    workspaceId,
    readInventoryQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitInventoryCommand(command: InventoryQueuedCommand) {
  const response = await fetch("/api/inventory", {
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
    throw new Error(result.error ?? "Inventory command failed.");
  }
  return result.result as Record<string, unknown>;
}

export async function flushInventoryQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { completed: 0, remaining: readInventoryQueue(workspaceId).length };

  let completed = 0;
  for (const command of readInventoryQueue(workspaceId)) {
    try {
      await submitInventoryCommand(command);
      removeInventoryCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readInventoryQueue(workspaceId).length);
    } catch (error) {
      failInventoryCommand(workspaceId, command.id, error instanceof Error ? error.message : "Inventory command failed.");
      break;
    }
  }

  return { completed, remaining: readInventoryQueue(workspaceId).length };
}

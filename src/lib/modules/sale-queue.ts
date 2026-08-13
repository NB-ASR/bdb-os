export type SaleCommandAction = "complete" | "reverse";

export type SaleQueuedCommand = {
  id: string;
  workspaceId: string;
  action: SaleCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-sale-queue-v1";
const storageKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

function isCommand(value: unknown): value is SaleQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<SaleQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["complete", "reverse"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readSaleQueue(workspaceId: string): SaleQueuedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(isCommand).filter((command) => command.workspaceId === workspaceId)
      : [];
  } catch {
    window.localStorage.removeItem(storageKey(workspaceId));
    return [];
  }
}

export function writeSaleQueue(workspaceId: string, commands: readonly SaleQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) window.localStorage.removeItem(storageKey(workspaceId));
  else window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueSaleCommand(
  workspaceId: string,
  action: SaleCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  const command: SaleQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readSaleQueue(workspaceId);
  if (!queue.some((item) => item.id === id)) writeSaleQueue(workspaceId, [...queue, command]);
  return command;
}

export function removeSaleCommand(workspaceId: string, commandId: string) {
  writeSaleQueue(workspaceId, readSaleQueue(workspaceId).filter((command) => command.id !== commandId));
}

export function failSaleCommand(workspaceId: string, commandId: string, error: string) {
  writeSaleQueue(workspaceId, readSaleQueue(workspaceId).map((command) => command.id === commandId
    ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
    : command));
}

export async function submitSaleCommand(command: SaleQueuedCommand) {
  const response = await fetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command.id },
    body: JSON.stringify({ workspaceId: command.workspaceId, action: command.action, ...command.payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "Sale command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushSaleQueue(workspaceId: string, onProgress?: (remaining: number) => void) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readSaleQueue(workspaceId).length };
  }
  let completed = 0;
  for (const command of readSaleQueue(workspaceId)) {
    try {
      await submitSaleCommand(command);
      removeSaleCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readSaleQueue(workspaceId).length);
    } catch (error) {
      failSaleCommand(workspaceId, command.id, error instanceof Error ? error.message : "Sale command failed.");
      break;
    }
  }
  return { completed, remaining: readSaleQueue(workspaceId).length };
}

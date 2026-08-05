export type SupplierCommandAction = "create" | "update" | "archive" | "restore";

export type SupplierQueuedCommand = {
  id: string;
  workspaceId: string;
  action: SupplierCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-supplier-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is SupplierQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<SupplierQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "archive", "restore"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readSupplierQueue(workspaceId: string): SupplierQueuedCommand[] {
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

export function writeSupplierQueue(workspaceId: string, commands: readonly SupplierQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueSupplierCommand(
  workspaceId: string,
  action: SupplierCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): SupplierQueuedCommand {
  const command: SupplierQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readSupplierQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeSupplierQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeSupplierCommand(workspaceId: string, commandId: string) {
  writeSupplierQueue(
    workspaceId,
    readSupplierQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failSupplierCommand(workspaceId: string, commandId: string, error: string) {
  writeSupplierQueue(
    workspaceId,
    readSupplierQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitSupplierCommand(command: SupplierQueuedCommand) {
  const response = await fetch("/api/suppliers", {
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
    const error = new Error(result.error ?? "Supplier command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushSupplierQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readSupplierQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readSupplierQueue(workspaceId)) {
    try {
      await submitSupplierCommand(command);
      removeSupplierCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readSupplierQueue(workspaceId).length);
    } catch (error) {
      failSupplierCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Supplier command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readSupplierQueue(workspaceId).length };
}

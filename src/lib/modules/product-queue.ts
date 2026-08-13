export type ProductCommandAction = "create" | "update" | "archive" | "restore";

export type ProductQueuedCommand = {
  id: string;
  workspaceId: string;
  action: ProductCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-product-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is ProductQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<ProductQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "archive", "restore"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readProductQueue(workspaceId: string): ProductQueuedCommand[] {
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

export function writeProductQueue(workspaceId: string, commands: readonly ProductQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueProductCommand(
  workspaceId: string,
  action: ProductCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): ProductQueuedCommand {
  const command: ProductQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readProductQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeProductQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeProductCommand(workspaceId: string, commandId: string) {
  writeProductQueue(
    workspaceId,
    readProductQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failProductCommand(workspaceId: string, commandId: string, error: string) {
  writeProductQueue(
    workspaceId,
    readProductQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitProductCommand(command: ProductQueuedCommand) {
  const response = await fetch("/api/products", {
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
    const error = new Error(result.error ?? "Product command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushProductQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readProductQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readProductQueue(workspaceId)) {
    try {
      await submitProductCommand(command);
      removeProductCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readProductQueue(workspaceId).length);
    } catch (error) {
      failProductCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Product command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readProductQueue(workspaceId).length };
}

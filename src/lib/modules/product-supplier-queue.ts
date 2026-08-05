export type ProductSupplierCommandAction = "create" | "update" | "archive" | "restore";

export interface ProductSupplierQueuedCommand {
  id: string;
  workspaceId: string;
  action: ProductSupplierCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const QUEUE_PREFIX = "bdb-product-supplier-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is ProductSupplierQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<ProductSupplierQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "archive", "restore"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readProductSupplierQueue(workspaceId: string): ProductSupplierQueuedCommand[] {
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

export function writeProductSupplierQueue(
  workspaceId: string,
  commands: readonly ProductSupplierQueuedCommand[],
) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueProductSupplierCommand(
  workspaceId: string,
  action: ProductSupplierCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): ProductSupplierQueuedCommand {
  const command: ProductSupplierQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readProductSupplierQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeProductSupplierQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeProductSupplierCommand(workspaceId: string, commandId: string) {
  writeProductSupplierQueue(
    workspaceId,
    readProductSupplierQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failProductSupplierCommand(workspaceId: string, commandId: string, error: string) {
  writeProductSupplierQueue(
    workspaceId,
    readProductSupplierQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitProductSupplierCommand(command: ProductSupplierQueuedCommand) {
  const response = await fetch("/api/product-suppliers", {
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
    const error = new Error(result.error ?? "Product Supplier command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushProductSupplierQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readProductSupplierQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readProductSupplierQueue(workspaceId)) {
    try {
      await submitProductSupplierCommand(command);
      removeProductSupplierCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readProductSupplierQueue(workspaceId).length);
    } catch (error) {
      failProductSupplierCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Product Supplier command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readProductSupplierQueue(workspaceId).length };
}

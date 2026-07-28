export type ServiceCommandAction = "create" | "update" | "archive" | "restore";

export type ServiceQueuedCommand = {
  id: string;
  workspaceId: string;
  action: ServiceCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-service-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is ServiceQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<ServiceQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "archive", "restore"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readServiceQueue(workspaceId: string): ServiceQueuedCommand[] {
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

export function writeServiceQueue(workspaceId: string, commands: readonly ServiceQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueServiceCommand(
  workspaceId: string,
  action: ServiceCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): ServiceQueuedCommand {
  const command: ServiceQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readServiceQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeServiceQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeServiceCommand(workspaceId: string, commandId: string) {
  writeServiceQueue(
    workspaceId,
    readServiceQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failServiceCommand(workspaceId: string, commandId: string, error: string) {
  writeServiceQueue(
    workspaceId,
    readServiceQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitServiceCommand(command: ServiceQueuedCommand) {
  const response = await fetch("/api/services", {
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
    const error = new Error(result.error ?? "Service command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushServiceQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readServiceQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readServiceQueue(workspaceId)) {
    try {
      await submitServiceCommand(command);
      removeServiceCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readServiceQueue(workspaceId).length);
    } catch (error) {
      failServiceCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Service command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readServiceQueue(workspaceId).length };
}

export type AppointmentCommandAction = "create" | "update" | "confirm" | "cancel" | "complete";

export type AppointmentQueuedCommand = {
  id: string;
  workspaceId: string;
  action: AppointmentCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-appointment-queue-v1";

function storageKey(workspaceId: string) {
  return `${QUEUE_PREFIX}:${workspaceId}`;
}

function isCommand(value: unknown): value is AppointmentQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<AppointmentQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ["create", "update", "confirm", "cancel", "complete"].includes(String(command.action))
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && !Array.isArray(command.payload)
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readAppointmentQueue(workspaceId: string): AppointmentQueuedCommand[] {
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

export function writeAppointmentQueue(
  workspaceId: string,
  commands: readonly AppointmentQueuedCommand[],
) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueAppointmentCommand(
  workspaceId: string,
  action: AppointmentCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): AppointmentQueuedCommand {
  const command: AppointmentQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readAppointmentQueue(workspaceId);
  if (!queue.some((item) => item.id === command.id)) {
    writeAppointmentQueue(workspaceId, [...queue, command]);
  }
  return command;
}

export function removeAppointmentCommand(workspaceId: string, commandId: string) {
  writeAppointmentQueue(
    workspaceId,
    readAppointmentQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failAppointmentCommand(
  workspaceId: string,
  commandId: string,
  error: string,
) {
  writeAppointmentQueue(
    workspaceId,
    readAppointmentQueue(workspaceId).map((command) => command.id === commandId
      ? {
        ...command,
        attempts: command.attempts + 1,
        lastError: error.slice(0, 240),
      }
      : command),
  );
}

export async function submitAppointmentCommand(command: AppointmentQueuedCommand) {
  const response = await fetch("/api/appointments", {
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
    const error = new Error(result.error ?? "Appointment command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushAppointmentQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readAppointmentQueue(workspaceId).length };
  }

  let completed = 0;
  for (const command of readAppointmentQueue(workspaceId)) {
    try {
      await submitAppointmentCommand(command);
      removeAppointmentCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readAppointmentQueue(workspaceId).length);
    } catch (error) {
      failAppointmentCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Appointment command failed.",
      );
      break;
    }
  }

  return { completed, remaining: readAppointmentQueue(workspaceId).length };
}

export type AppointmentCommandAction = "create" | "update" | "confirm" | "cancel" | "complete";
export type AppointmentQueueFailureKind = "confirmed_rejection" | "ambiguous";

export type AppointmentQueuedCommand = {
  id: string;
  actorUserId: string;
  workspaceId: string;
  action: AppointmentCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
  lastErrorStatus?: number;
  failureKind?: AppointmentQueueFailureKind;
};

type AppointmentSubmissionError = Error & {
  code?: string;
  status?: number;
  failureKind?: AppointmentQueueFailureKind;
};

const QUEUE_PREFIX = "bdb-appointment-queue-v2";
const MAX_QUEUE_COMMANDS = 100;
const MAX_COMMAND_BYTES = 32_000;
const ACTIONS = new Set<AppointmentCommandAction>(["create", "update", "confirm", "cancel", "complete"]);

function storageKey(actorUserId: string, workspaceId: string) {
  return `${QUEUE_PREFIX}:${actorUserId}:${workspaceId}`;
}

function isCommand(value: unknown): value is AppointmentQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<AppointmentQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.actorUserId === "string"
    && typeof command.workspaceId === "string"
    && ACTIONS.has(command.action as AppointmentCommandAction)
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && !Array.isArray(command.payload)
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

function confirmedServerRejection(status: number) {
  if (status < 400 || status >= 500) return false;
  return !new Set([401, 403, 408, 425, 429]).has(status);
}

export function readAppointmentQueue(
  actorUserId: string,
  workspaceId: string,
): AppointmentQueuedCommand[] {
  if (typeof window === "undefined") return [];
  const key = storageKey(actorUserId, workspaceId);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed
        .filter(isCommand)
        .filter((command) => command.actorUserId === actorUserId && command.workspaceId === workspaceId)
        .slice(0, MAX_QUEUE_COMMANDS)
      : [];
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

function writeAppointmentQueue(
  actorUserId: string,
  workspaceId: string,
  commands: readonly AppointmentQueuedCommand[],
) {
  if (typeof window === "undefined") return;
  const relevant = commands
    .filter((command) => command.actorUserId === actorUserId && command.workspaceId === workspaceId)
    .slice(0, MAX_QUEUE_COMMANDS);
  const key = storageKey(actorUserId, workspaceId);
  if (!relevant.length) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(relevant));
}

export function enqueueAppointmentCommand(
  actorUserId: string,
  workspaceId: string,
  action: AppointmentCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): AppointmentQueuedCommand {
  const queue = readAppointmentQueue(actorUserId, workspaceId);
  const duplicate = queue.find((item) => item.id === id);
  if (duplicate) return duplicate;
  if (queue.length >= MAX_QUEUE_COMMANDS) {
    throw new Error("The local Appointment queue is full. Reconnect and resolve queued changes before adding another.");
  }
  const command: AppointmentQueuedCommand = {
    id,
    actorUserId,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  if (new TextEncoder().encode(JSON.stringify(command)).byteLength > MAX_COMMAND_BYTES) {
    throw new Error("This Appointment change is too large to store safely offline.");
  }
  writeAppointmentQueue(actorUserId, workspaceId, [...queue, command]);
  return command;
}

export function canDiscardAppointmentCommand(command: AppointmentQueuedCommand) {
  return Boolean(command.lastError) && command.failureKind === "confirmed_rejection";
}

export function removeAppointmentCommand(
  actorUserId: string,
  workspaceId: string,
  commandId: string,
  force = false,
) {
  const queue = readAppointmentQueue(actorUserId, workspaceId);
  const command = queue.find((item) => item.id === commandId);
  if (!command) return false;
  if (!force && !canDiscardAppointmentCommand(command)) return false;
  writeAppointmentQueue(
    actorUserId,
    workspaceId,
    queue.filter((item) => item.id !== commandId),
  );
  return true;
}

export function failAppointmentCommand(
  actorUserId: string,
  workspaceId: string,
  commandId: string,
  error: string,
  details: { code?: string; status?: number; failureKind?: AppointmentQueueFailureKind } = {},
) {
  writeAppointmentQueue(
    actorUserId,
    workspaceId,
    readAppointmentQueue(actorUserId, workspaceId).map((command) => command.id === commandId
      ? {
        ...command,
        attempts: command.attempts + 1,
        lastError: error.slice(0, 240),
        lastErrorCode: details.code,
        lastErrorStatus: details.status,
        failureKind: details.failureKind ?? "ambiguous",
      }
      : command),
  );
}

export async function submitAppointmentCommand(command: AppointmentQueuedCommand) {
  let response: Response;
  try {
    response = await fetch("/api/appointments", {
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
  } catch (cause) {
    const error = new Error(cause instanceof Error ? cause.message : "Appointment command transport failed.") as AppointmentSubmissionError;
    error.failureKind = "ambiguous";
    throw error;
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "Appointment command failed.") as AppointmentSubmissionError;
    error.code = result.code;
    error.status = response.status;
    error.failureKind = confirmedServerRejection(response.status) ? "confirmed_rejection" : "ambiguous";
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushAppointmentQueue(
  actorUserId: string,
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readAppointmentQueue(actorUserId, workspaceId).length };
  }

  let completed = 0;
  for (const command of readAppointmentQueue(actorUserId, workspaceId)) {
    try {
      await submitAppointmentCommand(command);
      removeAppointmentCommand(actorUserId, workspaceId, command.id, true);
      completed += 1;
      onProgress?.(readAppointmentQueue(actorUserId, workspaceId).length);
    } catch (error) {
      const failure = error as AppointmentSubmissionError;
      failAppointmentCommand(
        actorUserId,
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Appointment command failed.",
        {
          code: failure.code,
          status: failure.status,
          failureKind: failure.failureKind ?? "ambiguous",
        },
      );
      break;
    }
  }

  return { completed, remaining: readAppointmentQueue(actorUserId, workspaceId).length };
}

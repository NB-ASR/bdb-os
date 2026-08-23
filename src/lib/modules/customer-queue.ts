export type CustomerCommandAction = "create" | "update" | "archive" | "restore";
export type CustomerFailureKind = "offline" | "ambiguous";

export type CustomerQueuedCommand = {
  id: string;
  workspaceId: string;
  action: CustomerCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  lastFailureKind?: CustomerFailureKind;
};

export type CustomerCommandRejection = {
  commandId: string;
  code: string;
  message: string;
};

export class CustomerSubmitError extends Error {
  code: string;
  confirmedRejected: boolean;

  constructor(message: string, code = "", confirmedRejected = false) {
    super(message);
    this.name = "CustomerSubmitError";
    this.code = code;
    this.confirmedRejected = confirmedRejected;
  }
}

const QUEUE_PREFIX = "bdb-customer-queue-v1";
export const CUSTOMER_QUEUE_LIMIT = 200;

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
      ? parsed.filter(isCommand).filter((command) => command.workspaceId === workspaceId).slice(0, CUSTOMER_QUEUE_LIMIT)
      : [];
  } catch {
    window.localStorage.removeItem(storageKey(workspaceId));
    return [];
  }
}

export function writeCustomerQueue(workspaceId: string, commands: readonly CustomerQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands
    .filter((command) => command.workspaceId === workspaceId)
    .slice(0, CUSTOMER_QUEUE_LIMIT);
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
  const queue = readCustomerQueue(workspaceId);
  const existing = queue.find((item) => item.id === id);
  if (existing) return existing;
  if (queue.length >= CUSTOMER_QUEUE_LIMIT) {
    throw new Error(`Customer offline queue is full (${CUSTOMER_QUEUE_LIMIT} changes). Reconnect before making more Customer changes.`);
  }

  const command: CustomerQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  writeCustomerQueue(workspaceId, [...queue, command]);
  return command;
}

export function removeCustomerCommand(workspaceId: string, commandId: string) {
  writeCustomerQueue(
    workspaceId,
    readCustomerQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failCustomerCommand(
  workspaceId: string,
  commandId: string,
  error: string,
  kind: CustomerFailureKind = "ambiguous",
) {
  writeCustomerQueue(
    workspaceId,
    readCustomerQueue(workspaceId).map((command) => command.id === commandId
      ? {
        ...command,
        attempts: command.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: error.slice(0, 240),
        lastFailureKind: kind,
      }
      : command),
  );
}

export async function submitCustomerCommand(command: CustomerQueuedCommand) {
  let response: Response;
  try {
    response = await fetch("/api/customers", {
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
  } catch (error) {
    throw new CustomerSubmitError(
      error instanceof Error ? error.message : "Customer command did not receive a server response.",
      "",
      false,
    );
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const code = typeof result.code === "string" ? result.code : "";
    const message = typeof result.error === "string" ? result.error : "Customer command failed.";
    const confirmedRejected = response.status >= 400 && response.status < 500 && Boolean(code);
    throw new CustomerSubmitError(message, code, confirmedRejected);
  }
  return result.result as Record<string, unknown>;
}

export async function flushCustomerQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      completed: 0,
      remaining: readCustomerQueue(workspaceId).length,
      rejected: null as CustomerCommandRejection | null,
      ambiguous: false,
    };
  }

  let completed = 0;
  for (const command of readCustomerQueue(workspaceId)) {
    try {
      await submitCustomerCommand(command);
      removeCustomerCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readCustomerQueue(workspaceId).length);
    } catch (error) {
      if (error instanceof CustomerSubmitError && error.confirmedRejected) {
        removeCustomerCommand(workspaceId, command.id);
        onProgress?.(readCustomerQueue(workspaceId).length);
        return {
          completed,
          remaining: readCustomerQueue(workspaceId).length,
          rejected: { commandId: command.id, code: error.code, message: error.message },
          ambiguous: false,
        };
      }

      failCustomerCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Customer command did not receive a confirmed outcome.",
        typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "ambiguous",
      );
      return {
        completed,
        remaining: readCustomerQueue(workspaceId).length,
        rejected: null,
        ambiguous: true,
      };
    }
  }

  return {
    completed,
    remaining: readCustomerQueue(workspaceId).length,
    rejected: null as CustomerCommandRejection | null,
    ambiguous: false,
  };
}

export type CatalogueQueuedCommand<Action extends string> = {
  id: string;
  workspaceId: string;
  action: Action;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
};

export type CatalogueQueueFlushResult = {
  completed: number;
  remaining: number;
  blockedCommandId?: string;
};

export class CatalogueQueueError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CatalogueQueueError";
    this.code = code;
  }
}

const MAX_QUEUE_COMMANDS = 200;
const MAX_COMMAND_SERIALIZED_CHARS = 24_576;
const MAX_QUEUE_SERIALIZED_CHARS = 262_144;

function serializedLength(value: unknown) {
  return JSON.stringify(value).length;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && value ? value.slice(0, 120) : undefined;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createCatalogueOfflineQueue<Action extends string>(options: {
  prefix: string;
  endpoint: string;
  label: string;
  actions: readonly Action[];
}) {
  const actionSet = new Set<string>(options.actions);

  function storageKey(workspaceId: string) {
    return `${options.prefix}:${workspaceId}`;
  }

  function isCommand(value: unknown): value is CatalogueQueuedCommand<Action> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const command = value as Partial<CatalogueQueuedCommand<Action>>;
    return typeof command.id === "string"
      && command.id.length > 0
      && typeof command.workspaceId === "string"
      && command.workspaceId.length > 0
      && typeof command.action === "string"
      && actionSet.has(command.action)
      && Boolean(command.payload)
      && typeof command.payload === "object"
      && !Array.isArray(command.payload)
      && typeof command.createdAt === "string"
      && Number.isInteger(command.attempts)
      && Number(command.attempts) >= 0
      && (command.lastError === undefined || typeof command.lastError === "string")
      && (command.lastErrorCode === undefined || typeof command.lastErrorCode === "string");
  }

  function read(workspaceId: string): CatalogueQueuedCommand<Action>[] {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey(workspaceId)) ?? "[]") as unknown;
      return Array.isArray(parsed)
        ? parsed.filter(isCommand).filter((command) => command.workspaceId === workspaceId)
        : [];
    } catch {
      try {
        window.localStorage.removeItem(storageKey(workspaceId));
      } catch {
        // The browser may deny storage entirely. Reading an empty queue remains safe.
      }
      return [];
    }
  }

  function write(workspaceId: string, commands: readonly CatalogueQueuedCommand<Action>[]) {
    if (typeof window === "undefined") return;
    const relevant = commands.filter((command) => command.workspaceId === workspaceId);
    if (!relevant.length) {
      try {
        window.localStorage.removeItem(storageKey(workspaceId));
      } catch {
        // Removal failure is non-destructive; a later read still validates workspace ownership.
      }
      return;
    }
    if (relevant.length > MAX_QUEUE_COMMANDS) {
      throw new CatalogueQueueError(
        "CATALOGUE_QUEUE_FULL",
        `${options.label} has too many pending offline changes. Reconnect and sync before adding more.`,
      );
    }
    const serialized = JSON.stringify(relevant);
    if (serialized.length > MAX_QUEUE_SERIALIZED_CHARS) {
      throw new CatalogueQueueError(
        "CATALOGUE_QUEUE_STORAGE_LIMIT",
        `${options.label} offline changes are using too much browser storage. Reconnect and sync before adding more.`,
      );
    }
    try {
      window.localStorage.setItem(storageKey(workspaceId), serialized);
    } catch {
      throw new CatalogueQueueError(
        "CATALOGUE_QUEUE_STORAGE_UNAVAILABLE",
        `${options.label} could not save this offline change in browser storage. Reconnect or free browser storage before continuing.`,
      );
    }
  }

  function enqueue(
    workspaceId: string,
    action: Action,
    payload: Record<string, unknown>,
    id = crypto.randomUUID(),
  ): CatalogueQueuedCommand<Action> {
    const command: CatalogueQueuedCommand<Action> = {
      id,
      workspaceId,
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    if (serializedLength(command) > MAX_COMMAND_SERIALIZED_CHARS) {
      throw new CatalogueQueueError(
        "CATALOGUE_COMMAND_TOO_LARGE",
        `${options.label} change is too large to store safely offline.`,
      );
    }

    const queue = read(workspaceId);
    const existing = queue.find((item) => item.id === command.id);
    if (existing) {
      const sameCommand = existing.action === command.action
        && JSON.stringify(existing.payload) === JSON.stringify(command.payload);
      if (!sameCommand) {
        throw new CatalogueQueueError(
          "CATALOGUE_QUEUE_ID_CONFLICT",
          `${options.label} retry key is already attached to a different pending change.`,
        );
      }
      return existing;
    }

    if (queue.length >= MAX_QUEUE_COMMANDS) {
      throw new CatalogueQueueError(
        "CATALOGUE_QUEUE_FULL",
        `${options.label} has too many pending offline changes. Reconnect and sync before adding more.`,
      );
    }
    write(workspaceId, [...queue, command]);
    return command;
  }

  function remove(workspaceId: string, commandId: string) {
    write(
      workspaceId,
      read(workspaceId).filter((command) => command.id !== commandId),
    );
  }

  function fail(workspaceId: string, commandId: string, message: string, code?: string) {
    write(
      workspaceId,
      read(workspaceId).map((command) => command.id === commandId
        ? {
          ...command,
          attempts: command.attempts + 1,
          lastError: message.slice(0, 240),
          lastErrorCode: code?.slice(0, 120),
        }
        : command),
    );
  }

  async function submit(command: CatalogueQueuedCommand<Action>) {
    const response = await fetch(options.endpoint, {
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
      const error = new Error(result.error ?? `${options.label} command failed.`);
      Object.assign(error, { code: result.code });
      throw error;
    }
    return result.result as Record<string, unknown>;
  }

  async function retry(workspaceId: string, commandId: string) {
    const queue = read(workspaceId);
    const commandIndex = queue.findIndex((command) => command.id === commandId);
    if (commandIndex === -1) {
      throw new CatalogueQueueError("CATALOGUE_QUEUE_COMMAND_MISSING", "That pending change is no longer in the queue.");
    }
    if (commandIndex !== 0) {
      throw new CatalogueQueueError(
        "CATALOGUE_QUEUE_ORDER_BLOCKED",
        "Earlier pending changes must be resolved first so offline edits remain in order.",
      );
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new CatalogueQueueError("CATALOGUE_QUEUE_OFFLINE", "Reconnect before retrying this pending change.");
    }

    const command = queue[0];
    try {
      const result = await submit(command);
      remove(workspaceId, command.id);
      return result;
    } catch (error) {
      fail(workspaceId, command.id, errorMessage(error, `${options.label} command failed.`), errorCode(error));
      throw error;
    }
  }

  async function flush(
    workspaceId: string,
    onProgress?: (remaining: number) => void,
  ): Promise<CatalogueQueueFlushResult> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { completed: 0, remaining: read(workspaceId).length };
    }

    let completed = 0;
    for (const command of read(workspaceId)) {
      try {
        await submit(command);
        remove(workspaceId, command.id);
        completed += 1;
        onProgress?.(read(workspaceId).length);
      } catch (error) {
        fail(workspaceId, command.id, errorMessage(error, `${options.label} command failed.`), errorCode(error));
        return {
          completed,
          remaining: read(workspaceId).length,
          blockedCommandId: command.id,
        };
      }
    }

    return { completed, remaining: read(workspaceId).length };
  }

  return {
    read,
    write,
    enqueue,
    remove,
    fail,
    submit,
    retry,
    flush,
  };
}

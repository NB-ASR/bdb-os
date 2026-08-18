export type AccountsCommandAction =
  | "invoice-create-manual"
  | "invoice-create-sale"
  | "invoice-update"
  | "invoice-issue"
  | "invoice-void"
  | "credit-note-create"
  | "credit-note-update"
  | "credit-note-issue"
  | "delivery-note-create"
  | "delivery-note-update"
  | "delivery-note-issue"
  | "payment-record"
  | "payment-allocate"
  | "allocation-reverse"
  | "payment-reverse";

export type AccountsQueuedCommand = {
  id: string;
  workspaceId: string;
  action: AccountsCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-accounts-queue-v1";
const ACTIONS = new Set<AccountsCommandAction>([
  "invoice-create-manual",
  "invoice-create-sale",
  "invoice-update",
  "invoice-issue",
  "invoice-void",
  "credit-note-create",
  "credit-note-update",
  "credit-note-issue",
  "delivery-note-create",
  "delivery-note-update",
  "delivery-note-issue",
  "payment-record",
  "payment-allocate",
  "allocation-reverse",
  "payment-reverse",
]);

const storageKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

function isCommand(value: unknown): value is AccountsQueuedCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<AccountsQueuedCommand>;
  return typeof command.id === "string"
    && typeof command.workspaceId === "string"
    && ACTIONS.has(command.action as AccountsCommandAction)
    && Boolean(command.payload)
    && typeof command.payload === "object"
    && typeof command.createdAt === "string"
    && typeof command.attempts === "number";
}

export function readAccountsQueue(workspaceId: string): AccountsQueuedCommand[] {
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

export function writeAccountsQueue(workspaceId: string, commands: readonly AccountsQueuedCommand[]) {
  if (typeof window === "undefined") return;
  const relevant = commands.filter((command) => command.workspaceId === workspaceId);
  if (!relevant.length) window.localStorage.removeItem(storageKey(workspaceId));
  else window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(relevant));
}

export function enqueueAccountsCommand(
  workspaceId: string,
  action: AccountsCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  const command: AccountsQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readAccountsQueue(workspaceId);
  if (!queue.some((item) => item.id === id)) writeAccountsQueue(workspaceId, [...queue, command]);
  return command;
}

export function removeAccountsCommand(workspaceId: string, commandId: string) {
  writeAccountsQueue(
    workspaceId,
    readAccountsQueue(workspaceId).filter((command) => command.id !== commandId),
  );
}

export function failAccountsCommand(workspaceId: string, commandId: string, error: string) {
  writeAccountsQueue(
    workspaceId,
    readAccountsQueue(workspaceId).map((command) => command.id === commandId
      ? { ...command, attempts: command.attempts + 1, lastError: error.slice(0, 240) }
      : command),
  );
}

export async function submitAccountsCommand(command: AccountsQueuedCommand) {
  const response = await fetch("/api/accounts", {
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
    const error = new Error(result.error ?? "Accounts command failed.");
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushAccountsQueue(
  workspaceId: string,
  onProgress?: (remaining: number) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, remaining: readAccountsQueue(workspaceId).length };
  }
  let completed = 0;
  for (const command of readAccountsQueue(workspaceId)) {
    try {
      await submitAccountsCommand(command);
      removeAccountsCommand(workspaceId, command.id);
      completed += 1;
      onProgress?.(readAccountsQueue(workspaceId).length);
    } catch (error) {
      failAccountsCommand(
        workspaceId,
        command.id,
        error instanceof Error ? error.message : "Accounts command failed.",
      );
      break;
    }
  }
  return { completed, remaining: readAccountsQueue(workspaceId).length };
}

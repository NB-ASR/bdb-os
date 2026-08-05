export type BankingCommandAction =
  | "reconcile"
  | "reconciliation-reverse"
  | "transaction-reverse";

export type BankingQueuedCommand = {
  id: string;
  workspaceId: string;
  action: BankingCommandAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PREFIX = "bdb-banking-reconciliation-queue-v1";
const queueKey = (workspaceId: string) => `${QUEUE_PREFIX}:${workspaceId}`;

export function readBankingQueue(workspaceId: string): BankingQueuedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queueKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BankingQueuedCommand => Boolean(
      item
      && typeof item === "object"
      && typeof (item as BankingQueuedCommand).id === "string"
      && (item as BankingQueuedCommand).workspaceId === workspaceId
      && typeof (item as BankingQueuedCommand).action === "string"
      && (item as BankingQueuedCommand).payload
      && typeof (item as BankingQueuedCommand).payload === "object",
    ));
  } catch {
    window.localStorage.removeItem(queueKey(workspaceId));
    return [];
  }
}

function writeBankingQueue(workspaceId: string, queue: BankingQueuedCommand[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(queueKey(workspaceId), JSON.stringify(queue));
}

export function enqueueBankingCommand(
  workspaceId: string,
  action: BankingCommandAction,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  const existing = readBankingQueue(workspaceId);
  const duplicate = existing.find((item) => item.id === id);
  if (duplicate) return duplicate;
  const command: BankingQueuedCommand = {
    id,
    workspaceId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  writeBankingQueue(workspaceId, [...existing, command]);
  return command;
}

export function removeBankingCommand(workspaceId: string, id: string) {
  writeBankingQueue(workspaceId, readBankingQueue(workspaceId).filter((item) => item.id !== id));
}

export async function submitBankingCommand(command: BankingQueuedCommand) {
  const response = await fetch("/api/banking", {
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
    throw new Error(result.error ?? "The Banking command could not be completed.");
  }
  return result.result as Record<string, unknown>;
}

export async function flushBankingQueue(workspaceId: string) {
  const queue = readBankingQueue(workspaceId);
  let completed = 0;
  for (const command of queue) {
    try {
      await submitBankingCommand(command);
      removeBankingCommand(workspaceId, command.id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Banking command could not be completed.";
      writeBankingQueue(workspaceId, readBankingQueue(workspaceId).map((item) => item.id === command.id
        ? { ...item, attempts: item.attempts + 1, lastError: message }
        : item));
      throw new Error(message);
    }
  }
  return completed;
}

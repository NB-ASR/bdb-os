const DATABASE_NAME = "bdb-os-unified-communications";
const DATABASE_VERSION = 1;
const STORE_NAME = "communication-commands";

export type UnifiedCommunicationAction =
  | "record_message"
  | "mark_read"
  | "dismiss_draft"
  | "close_thread";

export type UnifiedCommunicationQueuedCommand = {
  id: string;
  workspaceId: string;
  threadId: string;
  messageId?: string;
  action: UnifiedCommunicationAction;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("workspaceId", "workspaceId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The Communications offline queue could not be opened."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    operation(store, resolve, reject);
    tx.oncomplete = () => database.close();
    tx.onerror = () => {
      database.close();
      reject(tx.error ?? new Error("The Communications offline queue could not be updated."));
    };
  });
}

async function putCommand(command: UnifiedCommunicationQueuedCommand) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(command);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return command;
}

export async function listUnifiedCommunicationCommands(workspaceId: string) {
  return transaction<UnifiedCommunicationQueuedCommand[]>("readonly", (store, resolve, reject) => {
    const request = store.index("workspaceId").getAll(workspaceId);
    request.onsuccess = () => resolve(
      (request.result as UnifiedCommunicationQueuedCommand[])
        .filter((item) => item.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueUnifiedCommunicationCommand(
  workspaceId: string,
  threadId: string,
  action: UnifiedCommunicationAction,
  payload: Record<string, unknown>,
  messageId?: string,
  id = crypto.randomUUID(),
) {
  return putCommand({
    id,
    workspaceId,
    threadId,
    messageId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function removeUnifiedCommunicationCommand(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function failUnifiedCommunicationCommand(
  command: UnifiedCommunicationQueuedCommand,
  error: string,
) {
  await putCommand({
    ...command,
    attempts: command.attempts + 1,
    lastError: error,
  });
}

export async function submitUnifiedCommunicationCommand(command: UnifiedCommunicationQueuedCommand) {
  const response = await fetch("/api/communications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": command.id,
    },
    body: JSON.stringify({
      workspaceId: command.workspaceId,
      threadId: command.threadId,
      messageId: command.messageId,
      action: command.action,
      ...command.payload,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "The communication command could not be completed.") as Error & { code?: string };
    error.code = result.code;
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushUnifiedCommunicationQueue(workspaceId: string) {
  const queue = await listUnifiedCommunicationCommands(workspaceId);
  let completed = 0;
  for (const command of queue) {
    try {
      await submitUnifiedCommunicationCommand(command);
      await removeUnifiedCommunicationCommand(command.id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The communication command could not be completed.";
      await failUnifiedCommunicationCommand(command, message);
      throw error;
    }
  }
  return completed;
}

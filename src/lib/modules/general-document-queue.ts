const DATABASE_NAME = "bdb-os-general-documents";
const DATABASE_VERSION = 1;
const STORE_NAME = "document-commands";

export type GeneralDocumentCommandAction =
  | "create_document"
  | "add_link"
  | "revoke_link"
  | "archive_document";

export type GeneralDocumentQueuedCommand = {
  id: string;
  workspaceId: string;
  documentId: string;
  action: GeneralDocumentCommandAction;
  payload: Record<string, unknown>;
  file?: Blob;
  fileName?: string;
  fileType?: string;
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
    request.onerror = () => reject(request.error ?? new Error("The Document offline queue could not be opened."));
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
      reject(tx.error ?? new Error("The Document offline queue could not be updated."));
    };
  });
}

async function putCommand(command: GeneralDocumentQueuedCommand) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(command);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return command;
}

export async function listGeneralDocumentCommands(workspaceId: string) {
  return transaction<GeneralDocumentQueuedCommand[]>("readonly", (store, resolve, reject) => {
    const request = store.index("workspaceId").getAll(workspaceId);
    request.onsuccess = () => resolve(
      (request.result as GeneralDocumentQueuedCommand[])
        .filter((item) => item.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueGeneralDocumentUpload(
  workspaceId: string,
  documentId: string,
  file: File,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  return putCommand({
    id,
    workspaceId,
    documentId,
    action: "create_document",
    payload,
    file: file.slice(0, file.size, file.type),
    fileName: file.name,
    fileType: file.type,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function enqueueGeneralDocumentAction(
  workspaceId: string,
  documentId: string,
  action: Exclude<GeneralDocumentCommandAction, "create_document">,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  return putCommand({
    id,
    workspaceId,
    documentId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function removeGeneralDocumentCommand(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function failGeneralDocumentCommand(
  command: GeneralDocumentQueuedCommand,
  error: string,
) {
  await putCommand({
    ...command,
    attempts: command.attempts + 1,
    lastError: error,
  });
}

export async function submitGeneralDocumentCommand(command: GeneralDocumentQueuedCommand) {
  let response: Response;
  if (command.action === "create_document") {
    if (!command.file || !command.fileName) {
      throw new Error("The queued Document file is no longer available.");
    }
    const form = new FormData();
    form.set("workspaceId", command.workspaceId);
    form.set("documentId", command.documentId);
    for (const [key, value] of Object.entries(command.payload)) {
      if (value !== null && value !== undefined) form.set(key, String(value));
    }
    form.set("file", new File(
      [command.file],
      command.fileName,
      { type: command.fileType || command.file.type },
    ));
    response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Idempotency-Key": command.id },
      body: form,
    });
  } else {
    response = await fetch("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.id,
      },
      body: JSON.stringify({
        workspaceId: command.workspaceId,
        documentId: command.documentId,
        action: command.action,
        ...command.payload,
      }),
    });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.error ?? "The Document command could not be completed.") as Error & { code?: string };
    error.code = result.code;
    throw error;
  }
  return result.result as Record<string, unknown>;
}

export async function flushGeneralDocumentQueue(workspaceId: string) {
  const queue = await listGeneralDocumentCommands(workspaceId);
  let completed = 0;
  for (const command of queue) {
    try {
      await submitGeneralDocumentCommand(command);
      await removeGeneralDocumentCommand(command.id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Document command could not be completed.";
      await failGeneralDocumentCommand(command, message);
      throw error;
    }
  }
  return completed;
}

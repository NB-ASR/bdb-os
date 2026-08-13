const DATABASE_NAME = "bdb-os-purchasing";
const DATABASE_VERSION = 1;
const STORE_NAME = "supplier-document-uploads";

export type PendingSupplierDocumentUpload = {
  id: string;
  workspaceId: string;
  documentId: string;
  file: Blob;
  fileName: string;
  currency: string;
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
    request.onerror = () => reject(request.error ?? new Error("The offline upload queue could not be opened."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    operation(store, resolve, reject);
    tx.oncomplete = () => database.close();
    tx.onerror = () => {
      database.close();
      reject(tx.error ?? new Error("The offline upload queue could not be updated."));
    };
  });
}

export async function enqueueSupplierDocumentUpload(
  workspaceId: string,
  documentId: string,
  file: File,
  currency: string,
  id = crypto.randomUUID(),
) {
  const item: PendingSupplierDocumentUpload = {
    id,
    workspaceId,
    documentId,
    file: file.slice(0, file.size, file.type),
    fileName: file.name,
    currency,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return item;
}

export async function listSupplierDocumentUploads(workspaceId: string) {
  return transaction<PendingSupplierDocumentUpload[]>("readonly", (store, resolve, reject) => {
    const request = store.index("workspaceId").getAll(workspaceId);
    request.onsuccess = () => resolve((request.result as PendingSupplierDocumentUpload[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

export async function removeSupplierDocumentUpload(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function failSupplierDocumentUpload(item: PendingSupplierDocumentUpload, error: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put({ ...item, attempts: item.attempts + 1, lastError: error });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function submitSupplierDocumentUpload(item: PendingSupplierDocumentUpload) {
  const form = new FormData();
  form.set("workspaceId", item.workspaceId);
  form.set("documentId", item.documentId);
  form.set("currency", item.currency);
  form.set("file", new File([item.file], item.fileName, { type: item.file.type }));
  const response = await fetch("/api/purchasing/documents", {
    method: "POST",
    headers: { "Idempotency-Key": item.id },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? "The supplier document could not be uploaded.");
  }
  return result.result as Record<string, unknown>;
}

import {
  createCatalogueOfflineQueue,
  type CatalogueQueuedCommand,
} from "./catalogue-offline-queue";

export type ProductSupplierCommandAction = "create" | "update" | "archive" | "restore";
export type ProductSupplierQueuedCommand = CatalogueQueuedCommand<ProductSupplierCommandAction>;

const productSupplierQueue = createCatalogueOfflineQueue<ProductSupplierCommandAction>({
  prefix: "bdb-product-supplier-queue-v1",
  endpoint: "/api/product-suppliers",
  label: "Product Supplier catalogue",
  actions: ["create", "update", "archive", "restore"],
});

export const readProductSupplierQueue = productSupplierQueue.read;
export const writeProductSupplierQueue = productSupplierQueue.write;
export const enqueueProductSupplierCommand = productSupplierQueue.enqueue;
export const removeProductSupplierCommand = productSupplierQueue.remove;
export const failProductSupplierCommand = productSupplierQueue.fail;
export const submitProductSupplierCommand = productSupplierQueue.submit;
export const retryProductSupplierCommand = productSupplierQueue.retry;
export const flushProductSupplierQueue = productSupplierQueue.flush;

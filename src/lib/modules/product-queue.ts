import {
  createCatalogueOfflineQueue,
  type CatalogueQueuedCommand,
} from "./catalogue-offline-queue";

export type ProductCommandAction = "create" | "update" | "archive" | "restore";
export type ProductQueuedCommand = CatalogueQueuedCommand<ProductCommandAction>;

const productQueue = createCatalogueOfflineQueue<ProductCommandAction>({
  prefix: "bdb-product-queue-v1",
  endpoint: "/api/products",
  label: "Product catalogue",
  actions: ["create", "update", "archive", "restore"],
});

export const readProductQueue = productQueue.read;
export const writeProductQueue = productQueue.write;
export const enqueueProductCommand = productQueue.enqueue;
export const removeProductCommand = productQueue.remove;
export const failProductCommand = productQueue.fail;
export const submitProductCommand = productQueue.submit;
export const retryProductCommand = productQueue.retry;
export const flushProductQueue = productQueue.flush;

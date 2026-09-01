import {
  createCatalogueOfflineQueue,
  type CatalogueQueuedCommand,
} from "./catalogue-offline-queue";

export type ServiceCommandAction = "create" | "update" | "archive" | "restore";
export type ServiceQueuedCommand = CatalogueQueuedCommand<ServiceCommandAction>;

const serviceQueue = createCatalogueOfflineQueue<ServiceCommandAction>({
  prefix: "bdb-service-queue-v1",
  endpoint: "/api/services",
  label: "Service catalogue",
  actions: ["create", "update", "archive", "restore"],
});

export const readServiceQueue = serviceQueue.read;
export const writeServiceQueue = serviceQueue.write;
export const enqueueServiceCommand = serviceQueue.enqueue;
export const removeServiceCommand = serviceQueue.remove;
export const discardServiceCommand = serviceQueue.discard;
export const failServiceCommand = serviceQueue.fail;
export const submitServiceCommand = serviceQueue.submit;
export const retryServiceCommand = serviceQueue.retry;
export const flushServiceQueue = serviceQueue.flush;

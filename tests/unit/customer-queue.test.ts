import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_QUEUE_LIMIT,
  CustomerSubmitError,
  enqueueCustomerCommand,
  failCustomerCommand,
  readCustomerQueue,
  removeCustomerCommand,
  submitCustomerCommand,
  writeCustomerQueue,
} from "../../src/lib/modules/customer-queue.ts";

class MemoryStorage {
  #values = new Map<string, string>();
  getItem(key: string) { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string) { this.#values.set(key, value); }
  removeItem(key: string) { this.#values.delete(key); }
}

function installStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  });
}

test("Customer queues remain isolated by workspace", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "create", { id: "customer-a" }, "command-a");
  enqueueCustomerCommand("workspace-b", "create", { id: "customer-b" }, "command-b");
  assert.equal(readCustomerQueue("workspace-a").length, 1);
  assert.equal(readCustomerQueue("workspace-b").length, 1);
  assert.equal(readCustomerQueue("workspace-a")[0]?.id, "command-a");
});

test("Customer command IDs are not queued twice", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "update", { id: "customer-a" }, "stable-command");
  enqueueCustomerCommand("workspace-a", "update", { id: "customer-a" }, "stable-command");
  assert.equal(readCustomerQueue("workspace-a").length, 1);
});

test("failed Customer commands retain ambiguous retry diagnostics", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "archive", { id: "customer-a" }, "failed-command");
  failCustomerCommand("workspace-a", "failed-command", "connection reset", "ambiguous");
  const command = readCustomerQueue("workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "connection reset");
  assert.equal(command?.lastFailureKind, "ambiguous");
  assert.ok(command?.lastAttemptAt);
});

test("Customer queue is bounded before localStorage can grow without limit", () => {
  installStorage();
  for (let index = 0; index < CUSTOMER_QUEUE_LIMIT; index += 1) {
    enqueueCustomerCommand("workspace-a", "create", { id: `customer-${index}` }, `command-${index}`);
  }
  assert.equal(readCustomerQueue("workspace-a").length, CUSTOMER_QUEUE_LIMIT);
  assert.throws(
    () => enqueueCustomerCommand("workspace-a", "create", { id: "overflow" }, "overflow-command"),
    /offline queue is full/i,
  );
});

test("confirmed structured 4xx responses are classified as rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: "CUSTOMER_CONFLICT", error: "Refresh first." }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
  try {
    await assert.rejects(
      () => submitCustomerCommand({
        id: "stable-command",
        workspaceId: "workspace-a",
        action: "update",
        payload: { id: "customer-a" },
        createdAt: new Date().toISOString(),
        attempts: 0,
      }),
      (error: unknown) => error instanceof CustomerSubmitError
        && error.code === "CUSTOMER_CONFLICT"
        && error.confirmedRejected,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server failures without a confirmed 4xx rejection remain ambiguous", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: "SERVER_ERROR", error: "Failed after request." }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
  try {
    await assert.rejects(
      () => submitCustomerCommand({
        id: "stable-command",
        workspaceId: "workspace-a",
        action: "create",
        payload: { id: "customer-a" },
        createdAt: new Date().toISOString(),
        attempts: 0,
      }),
      (error: unknown) => error instanceof CustomerSubmitError && !error.confirmedRejected,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("confirmed commands can be removed explicitly", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "restore", { id: "customer-a" }, "remove-command");
  removeCustomerCommand("workspace-a", "remove-command");
  assert.deepEqual(readCustomerQueue("workspace-a"), []);

  enqueueCustomerCommand("workspace-a", "create", { id: "customer-a" }, "legacy-clear-command");
  writeCustomerQueue("workspace-a", []);
  assert.deepEqual(readCustomerQueue("workspace-a"), []);
});

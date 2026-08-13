import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueCustomerCommand,
  failCustomerCommand,
  readCustomerQueue,
  removeCustomerCommand,
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

test("failed Customer commands retain retry diagnostics", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "archive", { id: "customer-a" }, "failed-command");
  failCustomerCommand("workspace-a", "failed-command", "version conflict");
  const command = readCustomerQueue("workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "version conflict");
});

test("Customer commands can be removed or discarded", () => {
  installStorage();
  enqueueCustomerCommand("workspace-a", "restore", { id: "customer-a" }, "remove-command");
  removeCustomerCommand("workspace-a", "remove-command");
  assert.deepEqual(readCustomerQueue("workspace-a"), []);

  enqueueCustomerCommand("workspace-a", "create", { id: "customer-a" }, "discard-command");
  writeCustomerQueue("workspace-a", []);
  assert.deepEqual(readCustomerQueue("workspace-a"), []);
});

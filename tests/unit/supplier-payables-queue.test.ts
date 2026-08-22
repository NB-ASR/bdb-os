import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueSupplierPayablesCommand,
  readSupplierPayablesQueue,
  removeSupplierPayablesCommand,
} from "../../src/lib/modules/supplier-payables-queue.ts";

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

test("Supplier Payables queues remain workspace-scoped and ordered", () => {
  installStorage();
  enqueueSupplierPayablesCommand("workspace-a", "payable-post", { id: "payable-a" }, "command-a1");
  enqueueSupplierPayablesCommand("workspace-a", "payment-record", { id: "payment-a" }, "command-a2");
  enqueueSupplierPayablesCommand("workspace-b", "credit-allocate", { id: "credit-b" }, "command-b1");

  assert.deepEqual(readSupplierPayablesQueue("workspace-a").map((command) => command.id), ["command-a1", "command-a2"]);
  assert.deepEqual(readSupplierPayablesQueue("workspace-b").map((command) => command.id), ["command-b1"]);
});

test("Supplier Payables stable command IDs are queued only once", () => {
  installStorage();
  enqueueSupplierPayablesCommand("workspace-a", "payment-allocate", { id: "allocation-a" }, "stable-command");
  enqueueSupplierPayablesCommand("workspace-a", "payment-allocate", { id: "allocation-a" }, "stable-command");
  assert.equal(readSupplierPayablesQueue("workspace-a").length, 1);
});

test("fresh Supplier financial commands cannot be discarded before their outcome is known", () => {
  installStorage();
  enqueueSupplierPayablesCommand("workspace-a", "payable-reverse", { payableId: "payable-a" }, "remove-command");
  enqueueSupplierPayablesCommand("workspace-b", "payment-reverse", { paymentId: "payment-b" }, "keep-command");

  assert.equal(removeSupplierPayablesCommand("workspace-a", "remove-command"), false);
  assert.deepEqual(readSupplierPayablesQueue("workspace-a").map((command) => command.id), ["remove-command"]);
  assert.equal(readSupplierPayablesQueue("workspace-b").length, 1);

  // Force-removal is reserved for the queue's internal confirmed-success cleanup path.
  assert.equal(removeSupplierPayablesCommand("workspace-a", "remove-command", true), true);
  assert.deepEqual(readSupplierPayablesQueue("workspace-a"), []);
  assert.equal(readSupplierPayablesQueue("workspace-b").length, 1);
});

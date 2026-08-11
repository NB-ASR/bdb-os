import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueInventoryCommand,
  failInventoryCommand,
  readInventoryQueue,
  removeInventoryCommand,
  writeInventoryQueue,
} from "../../src/lib/modules/inventory-queue.ts";

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

test("Inventory commands retain their submission order", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "create-location", { id: "location-a" }, "command-a");
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "command-b");
  enqueueInventoryCommand("workspace-a", "transfer-stock", { transferGroupId: "transfer-a" }, "command-c");

  assert.deepEqual(
    readInventoryQueue("workspace-a").map((command) => command.id),
    ["command-a", "command-b", "command-c"],
  );
});

test("Inventory command IDs remain stable and workspace isolated", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "stable");
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "stable");
  enqueueInventoryCommand("workspace-b", "post-movement", { id: "movement-b" }, "other");

  assert.equal(readInventoryQueue("workspace-a").length, 1);
  assert.equal(readInventoryQueue("workspace-b").length, 1);
});

test("failed Inventory work remains available for review", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "failed");
  failInventoryCommand("workspace-a", "failed", "Movement no longer qualifies");

  const command = readInventoryQueue("workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "Movement no longer qualifies");
});

test("commands can be removed without discarding other Inventory work", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "manual");
  enqueueInventoryCommand("workspace-a", "reverse-movement", { id: "movement-b" }, "reverse");
  removeInventoryCommand("workspace-a", "reverse");

  assert.deepEqual(readInventoryQueue("workspace-a").map((command) => command.id), ["manual"]);
  writeInventoryQueue("workspace-a", []);
  assert.deepEqual(readInventoryQueue("workspace-a"), []);
});

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

test("Appointment consumption shares ordered Inventory commands", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "command-a");
  enqueueInventoryCommand(
    "workspace-a",
    "post-appointment-consumption",
    { id: "movement-b", appointmentId: "appointment-a" },
    "command-b",
  );
  enqueueInventoryCommand(
    "workspace-a",
    "reverse-appointment-consumption",
    { id: "movement-c", movementId: "movement-b" },
    "command-c",
  );

  assert.deepEqual(
    readInventoryQueue("workspace-a").map((command) => command.id),
    ["command-a", "command-b", "command-c"],
  );
});

test("Inventory command IDs remain stable and workspace isolated", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-appointment-consumption", { id: "movement-a" }, "stable");
  enqueueInventoryCommand("workspace-a", "post-appointment-consumption", { id: "movement-a" }, "stable");
  enqueueInventoryCommand("workspace-b", "post-appointment-consumption", { id: "movement-b" }, "other");

  assert.equal(readInventoryQueue("workspace-a").length, 1);
  assert.equal(readInventoryQueue("workspace-b").length, 1);
});

test("failed Appointment consumption remains available for review", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-appointment-consumption", { id: "movement-a" }, "failed");
  failInventoryCommand("workspace-a", "failed", "Appointment no longer qualifies");

  const command = readInventoryQueue("workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "Appointment no longer qualifies");
});

test("consumption commands can be removed without discarding other Inventory work", () => {
  installStorage();
  enqueueInventoryCommand("workspace-a", "post-movement", { id: "movement-a" }, "manual");
  enqueueInventoryCommand("workspace-a", "post-appointment-consumption", { id: "movement-b" }, "consume");
  removeInventoryCommand("workspace-a", "consume");

  assert.deepEqual(readInventoryQueue("workspace-a").map((command) => command.id), ["manual"]);
  writeInventoryQueue("workspace-a", []);
  assert.deepEqual(readInventoryQueue("workspace-a"), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueAppointmentCommand,
  failAppointmentCommand,
  readAppointmentQueue,
  removeAppointmentCommand,
  writeAppointmentQueue,
} from "../../src/lib/modules/appointment-queue.ts";

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

test("Appointment queues remain isolated by workspace", () => {
  installStorage();
  enqueueAppointmentCommand("workspace-a", "create", { id: "appointment-a" }, "command-a");
  enqueueAppointmentCommand("workspace-b", "create", { id: "appointment-b" }, "command-b");
  assert.equal(readAppointmentQueue("workspace-a").length, 1);
  assert.equal(readAppointmentQueue("workspace-b").length, 1);
  assert.equal(readAppointmentQueue("workspace-a")[0]?.id, "command-a");
});

test("Appointment command IDs are not queued twice", () => {
  installStorage();
  enqueueAppointmentCommand("workspace-a", "update", { id: "appointment-a" }, "stable-command");
  enqueueAppointmentCommand("workspace-a", "update", { id: "appointment-a" }, "stable-command");
  assert.equal(readAppointmentQueue("workspace-a").length, 1);
});

test("failed Appointment commands retain retry diagnostics", () => {
  installStorage();
  enqueueAppointmentCommand("workspace-a", "cancel", { id: "appointment-a" }, "failed-command");
  failAppointmentCommand("workspace-a", "failed-command", "staff conflict");
  const command = readAppointmentQueue("workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "staff conflict");
});

test("Appointment commands preserve their order", () => {
  installStorage();
  enqueueAppointmentCommand("workspace-a", "create", { id: "appointment-a" }, "command-create");
  enqueueAppointmentCommand("workspace-a", "confirm", { id: "appointment-a" }, "command-confirm");
  assert.deepEqual(
    readAppointmentQueue("workspace-a").map((command) => command.action),
    ["create", "confirm"],
  );
});

test("Appointment commands can be removed or discarded", () => {
  installStorage();
  enqueueAppointmentCommand("workspace-a", "complete", { id: "appointment-a" }, "remove-command");
  removeAppointmentCommand("workspace-a", "remove-command");
  assert.deepEqual(readAppointmentQueue("workspace-a"), []);

  enqueueAppointmentCommand("workspace-a", "create", { id: "appointment-a" }, "discard-command");
  writeAppointmentQueue("workspace-a", []);
  assert.deepEqual(readAppointmentQueue("workspace-a"), []);
});

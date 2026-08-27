import assert from "node:assert/strict";
import test from "node:test";
import {
  canDiscardAppointmentCommand,
  enqueueAppointmentCommand,
  failAppointmentCommand,
  readAppointmentQueue,
  removeAppointmentCommand,
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

test("Appointment queues remain isolated by actor and workspace", () => {
  installStorage();
  enqueueAppointmentCommand("actor-a", "workspace-a", "create", { id: "appointment-a" }, "command-a");
  enqueueAppointmentCommand("actor-a", "workspace-b", "create", { id: "appointment-b" }, "command-b");
  enqueueAppointmentCommand("actor-b", "workspace-a", "create", { id: "appointment-c" }, "command-c");
  assert.equal(readAppointmentQueue("actor-a", "workspace-a").length, 1);
  assert.equal(readAppointmentQueue("actor-a", "workspace-b").length, 1);
  assert.equal(readAppointmentQueue("actor-b", "workspace-a").length, 1);
  assert.equal(readAppointmentQueue("actor-a", "workspace-a")[0]?.id, "command-a");
});

test("Appointment command IDs are not queued twice", () => {
  installStorage();
  enqueueAppointmentCommand("actor-a", "workspace-a", "update", { id: "appointment-a" }, "stable-command");
  enqueueAppointmentCommand("actor-a", "workspace-a", "update", { id: "appointment-a" }, "stable-command");
  assert.equal(readAppointmentQueue("actor-a", "workspace-a").length, 1);
});

test("ambiguous Appointment outcomes retain retry diagnostics and cannot be discarded", () => {
  installStorage();
  enqueueAppointmentCommand("actor-a", "workspace-a", "cancel", { id: "appointment-a" }, "failed-command");
  failAppointmentCommand("actor-a", "workspace-a", "failed-command", "network ended", {
    status: 503,
    failureKind: "ambiguous",
  });
  const command = readAppointmentQueue("actor-a", "workspace-a")[0];
  assert.equal(command?.attempts, 1);
  assert.equal(command?.lastError, "network ended");
  assert.equal(command?.failureKind, "ambiguous");
  assert.equal(canDiscardAppointmentCommand(command!), false);
  assert.equal(removeAppointmentCommand("actor-a", "workspace-a", "failed-command"), false);
});

test("Appointment commands preserve their order", () => {
  installStorage();
  enqueueAppointmentCommand("actor-a", "workspace-a", "create", { id: "appointment-a" }, "command-create");
  enqueueAppointmentCommand("actor-a", "workspace-a", "confirm", { id: "appointment-a" }, "command-confirm");
  assert.deepEqual(
    readAppointmentQueue("actor-a", "workspace-a").map((command) => command.action),
    ["create", "confirm"],
  );
});

test("only confirmed server rejections can be discarded without force", () => {
  installStorage();
  enqueueAppointmentCommand("actor-a", "workspace-a", "create", { id: "appointment-a" }, "discard-command");
  failAppointmentCommand("actor-a", "workspace-a", "discard-command", "staff conflict", {
    status: 409,
    failureKind: "confirmed_rejection",
  });
  const command = readAppointmentQueue("actor-a", "workspace-a")[0];
  assert.equal(canDiscardAppointmentCommand(command!), true);
  assert.equal(removeAppointmentCommand("actor-a", "workspace-a", "discard-command"), true);
  assert.deepEqual(readAppointmentQueue("actor-a", "workspace-a"), []);
});

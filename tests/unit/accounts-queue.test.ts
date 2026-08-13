import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueAccountsCommand,
  failAccountsCommand,
  readAccountsQueue,
  removeAccountsCommand,
  writeAccountsQueue,
} from "../../src/lib/modules/accounts-queue.ts";

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

test("Accounts queues remain isolated by workspace and ordered", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "invoice-create-manual", { id: "invoice-a" }, "command-a1");
  enqueueAccountsCommand("workspace-a", "payment-record", { id: "payment-a" }, "command-a2");
  enqueueAccountsCommand("workspace-b", "invoice-issue", { id: "invoice-b" }, "command-b1");

  assert.deepEqual(readAccountsQueue("workspace-a").map((command) => command.id), ["command-a1", "command-a2"]);
  assert.deepEqual(readAccountsQueue("workspace-b").map((command) => command.id), ["command-b1"]);
});

test("stable Accounts command IDs are never queued twice", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "payment-allocate", { id: "allocation-a" }, "stable-command");
  enqueueAccountsCommand("workspace-a", "payment-allocate", { id: "allocation-a" }, "stable-command");
  assert.equal(readAccountsQueue("workspace-a").length, 1);
});

test("failed Accounts commands retain diagnostics and block later review ordering", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "allocation-reverse", { id: "reversal-a" }, "failed-command");
  enqueueAccountsCommand("workspace-a", "payment-reverse", { id: "payment-a" }, "later-command");
  failAccountsCommand("workspace-a", "failed-command", "allocation was already reversed");

  const commands = readAccountsQueue("workspace-a");
  assert.equal(commands[0]?.attempts, 1);
  assert.equal(commands[0]?.lastError, "allocation was already reversed");
  assert.equal(commands[1]?.id, "later-command");
});

test("Accounts commands can be removed or discarded without affecting other workspaces", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "invoice-void", { id: "invoice-a" }, "remove-command");
  enqueueAccountsCommand("workspace-b", "payment-record", { id: "payment-b" }, "keep-command");
  removeAccountsCommand("workspace-a", "remove-command");

  assert.deepEqual(readAccountsQueue("workspace-a"), []);
  assert.equal(readAccountsQueue("workspace-b").length, 1);

  writeAccountsQueue("workspace-b", []);
  assert.deepEqual(readAccountsQueue("workspace-b"), []);
});

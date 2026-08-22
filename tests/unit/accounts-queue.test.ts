import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueAccountsCommand,
  failAccountsCommand,
  flushAccountsQueue,
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

function installOnline() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
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
  assert.equal(commands[0]?.failureKind, "ambiguous");
  assert.equal(commands[1]?.id, "later-command");
});

test("fresh and ambiguous Accounts financial commands cannot be discarded", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "payment-record", { id: "payment-a" }, "fresh-command");
  enqueueAccountsCommand("workspace-b", "payment-record", { id: "payment-b" }, "keep-command");

  assert.equal(removeAccountsCommand("workspace-a", "fresh-command"), false);
  failAccountsCommand("workspace-a", "fresh-command", "connection disappeared", { failureKind: "ambiguous" });
  assert.equal(removeAccountsCommand("workspace-a", "fresh-command"), false);
  assert.deepEqual(readAccountsQueue("workspace-a").map((command) => command.id), ["fresh-command"]);
  assert.deepEqual(readAccountsQueue("workspace-b").map((command) => command.id), ["keep-command"]);
});

test("only confirmed Accounts rejections may be discarded without force", () => {
  installStorage();
  enqueueAccountsCommand("workspace-a", "payment-allocate", { id: "allocation-a" }, "rejected-command");
  failAccountsCommand("workspace-a", "rejected-command", "allocation exceeds outstanding", {
    status: 409,
    failureKind: "confirmed_rejection",
  });

  assert.equal(removeAccountsCommand("workspace-a", "rejected-command"), true);
  assert.deepEqual(readAccountsQueue("workspace-a"), []);

  enqueueAccountsCommand("workspace-a", "payment-reverse", { id: "payment-a" }, "completed-command");
  assert.equal(removeAccountsCommand("workspace-a", "completed-command", true), true);
  assert.deepEqual(readAccountsQueue("workspace-a"), []);

  writeAccountsQueue("workspace-a", []);
});

test("offline replay stops at the first ambiguous command so later financial work cannot arrive out of order", async () => {
  installStorage();
  installOnline();
  enqueueAccountsCommand("workspace-a", "payment-record", { id: "payment-first" }, "ordered-command-1");
  enqueueAccountsCommand("workspace-a", "payment-reverse", { paymentId: "payment-first" }, "ordered-command-2");

  let calls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      calls += 1;
      throw new Error("response lost after submit");
    },
  });

  const result = await flushAccountsQueue("workspace-a");
  const queue = readAccountsQueue("workspace-a");
  assert.deepEqual(result, { completed: 0, remaining: 2 });
  assert.equal(calls, 1);
  assert.equal(queue[0]?.id, "ordered-command-1");
  assert.equal(queue[0]?.failureKind, "ambiguous");
  assert.equal(queue[1]?.id, "ordered-command-2");
  assert.equal(queue[1]?.attempts, 0);
});

test("a lost response retries the same stable idempotency key and removes the command only after confirmed success", async () => {
  installStorage();
  installOnline();
  enqueueAccountsCommand("workspace-a", "payment-record", { id: "payment-retry" }, "stable-retry-command");

  const keys: Array<string | null> = [];
  let attempt = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: RequestInfo | URL, init?: RequestInit) => {
      attempt += 1;
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      if (attempt === 1) throw new Error("connection reset after server commit");
      return new Response(JSON.stringify({ ok: true, result: { id: "payment-retry" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const first = await flushAccountsQueue("workspace-a");
  assert.deepEqual(first, { completed: 0, remaining: 1 });
  assert.deepEqual(readAccountsQueue("workspace-a").map((command) => command.id), ["stable-retry-command"]);

  const second = await flushAccountsQueue("workspace-a");
  assert.deepEqual(second, { completed: 1, remaining: 0 });
  assert.deepEqual(readAccountsQueue("workspace-a"), []);
  assert.deepEqual(keys, ["stable-retry-command", "stable-retry-command"]);
});

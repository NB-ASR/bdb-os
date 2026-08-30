import assert from "node:assert/strict";
import test from "node:test";
import {
  CatalogueQueueError,
  createCatalogueOfflineQueue,
} from "../../src/lib/modules/catalogue-offline-queue.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function installBrowser(storage: MemoryStorage, online = true) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online },
  });
}

function createQueue(prefix = "test-catalogue") {
  return createCatalogueOfflineQueue({
    prefix,
    endpoint: "/api/test-catalogue",
    label: "Test catalogue",
    actions: ["create", "update", "archive", "restore"] as const,
  });
}

test("Catalogue offline queue is bounded, workspace-safe and preserves FIFO recovery", async () => {
  const storage = new MemoryStorage();
  installBrowser(storage, true);
  const queue = createQueue();

  const first = queue.enqueue("workspace-a", "create", { id: "record-a", name: "First" }, "command-a");
  const second = queue.enqueue("workspace-a", "update", { id: "record-a", name: "Second", expectedVersion: 1 }, "command-b");
  queue.enqueue("workspace-b", "create", { id: "record-b", name: "Other workspace" }, "command-c");

  assert.deepEqual(queue.read("workspace-a").map((command) => command.id), ["command-a", "command-b"]);
  assert.deepEqual(queue.read("workspace-b").map((command) => command.id), ["command-c"]);

  const duplicate = queue.enqueue("workspace-a", "create", { id: "record-a", name: "First" }, "command-a");
  assert.equal(duplicate.id, first.id);
  assert.equal(queue.read("workspace-a").length, 2);
  assert.throws(
    () => queue.enqueue("workspace-a", "update", { id: "different" }, "command-a"),
    (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_QUEUE_ID_CONFLICT",
  );

  assert.throws(
    () => queue.enqueue("workspace-a", "create", { id: "large", notes: "x".repeat(30_000) }, "too-large"),
    (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_COMMAND_TOO_LARGE",
  );
  assert.equal(queue.read("workspace-a").length, 2, "An oversized command must never evict existing pending work.");

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCount += 1;
    const idempotencyKey = new Headers(init?.headers).get("Idempotency-Key");
    if (idempotencyKey === "command-a") {
      return new Response(JSON.stringify({ ok: true, result: { action: "create" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (idempotencyKey === "command-b" && fetchCount === 2) {
      return new Response(JSON.stringify({ ok: false, error: "Changed elsewhere", code: "TEST_CONFLICT" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { action: "update" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await queue.flush("workspace-a");
    assert.deepEqual(result, {
      completed: 1,
      remaining: 1,
      blockedCommandId: "command-b",
      blockedKind: "rejected",
    });
    const blocked = queue.read("workspace-a")[0];
    assert.equal(blocked.id, second.id);
    assert.equal(blocked.attempts, 1);
    assert.equal(blocked.lastError, "Changed elsewhere");
    assert.equal(blocked.lastErrorCode, "TEST_CONFLICT");
    assert.equal(blocked.lastFailureKind, "rejected");

    queue.discard("workspace-a", "command-b");
    assert.equal(queue.read("workspace-a").length, 0, "A confirmed 4xx rejection may be discarded after review.");
  } finally {
    globalThis.fetch = originalFetch;
  }

  queue.enqueue("workspace-a", "create", { id: "one" }, "one");
  queue.enqueue("workspace-a", "create", { id: "two" }, "two");
  queue.enqueue("workspace-a", "create", { id: "three" }, "three");
  queue.discard("workspace-a", "two");
  assert.deepEqual(
    queue.read("workspace-a").map((command) => command.id),
    ["one", "three"],
    "Discarding one never-submitted offline change must preserve unrelated queued work and order.",
  );

  installBrowser(storage, false);
  let offlineFetches = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    offlineFetches += 1;
    throw new Error("fetch should not run while offline");
  };
  try {
    const offlineResult = await queue.flush("workspace-a");
    assert.deepEqual(offlineResult, { completed: 0, remaining: 2 });
    assert.equal(offlineFetches, 0);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("ambiguous Catalogue outcomes cannot be discarded and retry the same stable key", async () => {
  const storage = new MemoryStorage();
  installBrowser(storage, true);
  const queue = createQueue("test-catalogue-ambiguous");
  queue.enqueue("workspace-a", "update", { id: "record-a", expectedVersion: 2 }, "stable-command");
  queue.enqueue("workspace-a", "archive", { id: "record-b", expectedVersion: 4 }, "later-command");

  const originalFetch = globalThis.fetch;
  const seenKeys: string[] = [];
  let firstAttempt = true;
  globalThis.fetch = async (_input, init) => {
    const key = new Headers(init?.headers).get("Idempotency-Key") ?? "";
    seenKeys.push(key);
    if (firstAttempt) {
      firstAttempt = false;
      throw new Error("Connection dropped after send");
    }
    return new Response(JSON.stringify({ ok: true, result: { action: "update" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await queue.flush("workspace-a");
    assert.deepEqual(result, {
      completed: 0,
      remaining: 2,
      blockedCommandId: "stable-command",
      blockedKind: "ambiguous",
    });
    const blocked = queue.read("workspace-a")[0];
    assert.equal(blocked.lastFailureKind, "ambiguous");
    assert.equal(blocked.attempts, 1);
    assert.throws(
      () => queue.discard("workspace-a", "stable-command"),
      (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_QUEUE_AMBIGUOUS_DISCARD_BLOCKED",
    );
    await assert.rejects(
      queue.retry("workspace-a", "later-command"),
      (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_QUEUE_ORDER_BLOCKED",
    );

    await queue.retry("workspace-a", "stable-command");
    assert.deepEqual(seenKeys, ["stable-command", "stable-command"], "Retry must reuse the original idempotency key.");
    assert.deepEqual(queue.read("workspace-a").map((command) => command.id), ["later-command"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Catalogue offline queue refuses overflow and browser storage failure without silently dropping commands", () => {
  const storage = new MemoryStorage();
  installBrowser(storage, true);
  const queue = createQueue("test-catalogue-bounds");

  for (let index = 0; index < 200; index += 1) {
    queue.enqueue("workspace-a", "create", { id: `record-${index}` }, `command-${index}`);
  }
  assert.equal(queue.read("workspace-a").length, 200);
  assert.throws(
    () => queue.enqueue("workspace-a", "create", { id: "overflow" }, "overflow"),
    (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_QUEUE_FULL",
  );
  assert.equal(queue.read("workspace-a").length, 200);

  const failingStorage = new MemoryStorage();
  failingStorage.setItem = () => { throw new Error("quota"); };
  installBrowser(failingStorage, true);
  const failingQueue = createQueue("test-catalogue-storage-failure");
  assert.throws(
    () => failingQueue.enqueue("workspace-a", "create", { id: "record" }, "command"),
    (error) => error instanceof CatalogueQueueError && error.code === "CATALOGUE_QUEUE_STORAGE_UNAVAILABLE",
  );
});

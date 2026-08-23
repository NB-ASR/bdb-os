import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_CACHE_LIMIT,
  mergeCustomerCache,
  readCustomerCache,
  readCustomerSummary,
  rememberCustomerWorkspace,
  readLastCustomerWorkspace,
  writeCustomerCache,
  writeCustomerSummary,
} from "../../src/lib/modules/customer-cache.ts";

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

test("Customer offline cache is capped and strips optimistic pending flags", () => {
  installStorage();
  const rows = Array.from({ length: CUSTOMER_CACHE_LIMIT + 25 }, (_, index) => ({
    id: `customer-${index}`,
    name: `Customer ${index}`,
    pending: true,
  }));
  writeCustomerCache("workspace-a", rows);
  const cached = readCustomerCache<typeof rows[number]>("workspace-a");
  assert.equal(cached.length, CUSTOMER_CACHE_LIMIT);
  assert.equal(cached[0]?.pending, undefined);
});

test("recently viewed Customer pages replace duplicate cached rows without growing the cache", () => {
  installStorage();
  writeCustomerCache("workspace-a", [
    { id: "customer-a", name: "Old name" },
    { id: "customer-b", name: "Customer B" },
  ]);
  const merged = mergeCustomerCache("workspace-a", [
    { id: "customer-a", name: "New name" },
    { id: "customer-c", name: "Customer C" },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((row) => row.id === "customer-a")?.name, "New name");
});

test("Customer cache remains isolated by workspace", () => {
  installStorage();
  writeCustomerCache("workspace-a", [{ id: "customer-a" }]);
  writeCustomerCache("workspace-b", [{ id: "customer-b" }]);
  assert.deepEqual(readCustomerCache("workspace-a").map((row) => row.id), ["customer-a"]);
  assert.deepEqual(readCustomerCache("workspace-b").map((row) => row.id), ["customer-b"]);
});

test("last synced Customer summary is retained separately from bounded rows", () => {
  installStorage();
  writeCustomerSummary("workspace-a", {
    activeCount: 25000,
    archivedCount: 1200,
    importedCount: 300,
    companyCount: 4800,
  });
  assert.deepEqual(readCustomerSummary("workspace-a"), {
    activeCount: 25000,
    archivedCount: 1200,
    importedCount: 300,
    companyCount: 4800,
  });
});

test("last Customer workspace is remembered for cold offline startup", () => {
  installStorage();
  rememberCustomerWorkspace("workspace-a");
  assert.equal(readLastCustomerWorkspace(), "workspace-a");
});

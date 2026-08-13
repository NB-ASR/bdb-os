import assert from "node:assert/strict";
import test from "node:test";
import { extractVanitaClients } from "../../src/lib/modules/customer-import.ts";

test("extracts a direct Vanita client array", () => {
  const clients = [{ id: "client-1", name: "Sample Client" }];
  assert.deepEqual(extractVanitaClients(clients), clients);
});

test("extracts clients from an app_state data object", () => {
  const clients = [{ id: "client-2", name: "Elena" }];
  assert.deepEqual(extractVanitaClients({ data: { clients } }), clients);
});

test("extracts clients from a direct snapshot object", () => {
  const clients = [{ id: "client-3", name: "Sofia" }];
  assert.deepEqual(extractVanitaClients({ clients }), clients);
});

test("rejects snapshots without a clients array", () => {
  assert.throws(
    () => extractVanitaClients({ products: [] }),
    /does not contain a clients array/i,
  );
});

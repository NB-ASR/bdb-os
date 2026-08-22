import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Supplier financial queue preserves ambiguous outcomes for idempotent retry", async () => {
  const queue = await source("src/lib/modules/supplier-payables-queue.ts");

  assert.match(queue, /"confirmed_rejection" \| "ambiguous"/);
  assert.match(queue, /confirmedServerRejection\(response\.status\)/);
  assert.match(queue, /failureKind = "ambiguous"/);
  assert.match(queue, /command\.failureKind === "confirmed_rejection"/);
  assert.match(queue, /if \(!force && !canDiscardSupplierPayablesCommand\(command\)\) return false/);
  assert.match(queue, /removeSupplierPayablesCommand\(workspaceId, command\.id, true\)/);
});

test("Supplier financial route binds idempotency keys to canonical command input", async () => {
  const route = await source("src/app/api/supplier-payables/route.ts");

  assert.match(route, /import \{ hashJson \} from "@\/lib\/server\/workspace-snapshot"/);
  assert.match(route, /admin\.rpc\("claim_accounts_command"/);
  assert.match(route, /p_idempotency_key: context\.idempotencyKey/);
  assert.match(route, /p_request_hash: hashJson\(\{ workspaceId, action, body \}\)/);
  assert.match(route, /if \(claim\.error\) throw friendlyError\(claim\.error\)/);
});

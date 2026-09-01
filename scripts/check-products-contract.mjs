import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/release-sources/vanita-integration-20260813/20260727152000_product_catalogue_foundation.sql",
  "utf8",
);
const hardening = await readFile("supabase/migrations/20260830190000_catalogue_engine_pass1.sql", "utf8");
const api = await readFile("src/app/api/products/route.ts", "utf8");
const queue = await readFile("src/lib/modules/product-queue.ts", "utf8");
const offlineQueue = await readFile("src/lib/modules/catalogue-offline-queue.ts", "utf8");
const page = await readFile("src/app/products/page.tsx", "utf8");

for (const statement of [
  "create table public.products",
  "create table public.product_command_receipts",
  "unique (workspace_id, sku)",
  "products_workspace_barcode_idx",
  "version integer not null default 1",
  "create or replace function public.apply_product_command",
  "product changed on another device",
  "private.has_workspace_permission(workspace_id, 'products', 'view')",
  "grant select on table public.products to authenticated",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Products contract: ${statement}`);
}

assert.doesNotMatch(migration, /\b(quantity|stock_on_hand|on_hand)\b\s+(?:numeric|integer|bigint)/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.products\s+to\s+authenticated/i);
assert.match(migration, /revoke all on function public\.apply_product_command[\s\S]*authenticated/i);
assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /status text not null default 'active'[\s\S]*'archived'/i);
assert.match(migration, /p_expected_version[\s\S]*product_record\.version <> p_expected_version/i);
assert.doesNotMatch(migration, /delete from public\.products/i);
assert.doesNotMatch(migration, /platform_support_sessions/i);

assert.match(hardening, /receipt\.product_id, receipt\.action, receipt\.result/i);
assert.match(hardening, /previous_product_id <> p_product_id or previous_action <> p_action/i);
assert.match(hardening, /Product idempotency key was already used for another command/i);
assert.match(hardening, /grant execute on function public\.apply_product_command[\s\S]*service_role/i);
assert.doesNotMatch(hardening, /grant execute on function public\.apply_product_command[\s\S]*authenticated/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_product_command/);
assert.match(api, /PRODUCT_CONFLICT/);
assert.match(api, /PRODUCT_DUPLICATE/);

assert.match(queue, /createCatalogueOfflineQueue/);
assert.match(queue, /bdb-product-queue-v1/);
assert.match(queue, /retryProductCommand/);
assert.match(queue, /flushProductQueue/);
assert.match(offlineQueue, /MAX_QUEUE_COMMANDS = 200/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_STORAGE_UNAVAILABLE/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_ID_CONFLICT/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_ORDER_BLOCKED/);
assert.match(offlineQueue, /blockedCommandId/);
assert.match(offlineQueue, /lastErrorCode/);
assert.match(offlineQueue, /Idempotency-Key/);
assert.match(offlineQueue, /for \(const command of read\(workspaceId\)\)/);

assert.match(page, /readCache/);
assert.match(page, /enqueueProductCommand/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.match(page, /Supplier relationships come next/);
assert.match(page, /Opening stock is a separate movement/);

console.log("Products schema, command, RLS, idempotency, bounded offline and UI contracts are internally consistent.");

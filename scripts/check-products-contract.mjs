import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/release-sources/vanita-integration-20260813/20260727152000_product_catalogue_foundation.sql",
  "utf8",
);
const api = await readFile("src/app/api/products/route.ts", "utf8");
const queue = await readFile("src/lib/modules/product-queue.ts", "utf8");
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

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_product_command/);
assert.match(api, /PRODUCT_CONFLICT/);
assert.match(api, /PRODUCT_DUPLICATE/);

assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushProductQueue/);
assert.match(queue, /break;/);

assert.match(page, /readCache/);
assert.match(page, /enqueueProductCommand/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.match(page, /Supplier relationships come next/);
assert.match(page, /Opening stock is a separate movement/);

console.log("Products schema, command, RLS, support, offline and UI contracts are internally consistent.");

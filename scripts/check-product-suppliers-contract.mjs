import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/release-sources/vanita-integration-20260813/20260727155000_product_supplier_relationship.sql",
  "utf8",
);
const hardening = await readFile("supabase/migrations/20260830190000_catalogue_engine_pass1.sql", "utf8");
const api = await readFile("src/app/api/product-suppliers/route.ts", "utf8");
const queue = await readFile("src/lib/modules/product-supplier-queue.ts", "utf8");
const offlineQueue = await readFile("src/lib/modules/catalogue-offline-queue.ts", "utf8");
const layout = await readFile("src/app/products/layout.tsx", "utf8");
const indexPage = await readFile("src/app/products/suppliers/page.tsx", "utf8");
const detailPage = await readFile("src/app/products/[productId]/suppliers/page.tsx", "utf8");

for (const statement of [
  "create table public.product_suppliers",
  "create table public.product_supplier_command_receipts",
  "unique (workspace_id, product_id, supplier_id)",
  "product_suppliers_supplier_sku_idx",
  "product_suppliers_preferred_product_idx",
  "version integer not null default 1",
  "create or replace function public.apply_product_supplier_command",
  "product supplier relationship changed on another device",
  "private.has_workspace_permission(workspace_id, 'products', 'view')",
  "private.has_workspace_permission(workspace_id, 'suppliers', 'view')",
  "grant select on table public.product_suppliers to authenticated",
  "grant all on table public.product_suppliers, public.product_supplier_command_receipts to service_role",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Product Supplier contract: ${statement}`);
}

assert.match(migration, /foreign key \(workspace_id, product_id\)[\s\S]*public\.products\(workspace_id, id\) on delete restrict/i);
assert.match(migration, /foreign key \(workspace_id, supplier_id\)[\s\S]*public\.suppliers\(workspace_id, id\) on delete restrict/i);
assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /private\.has_feature\(target_workspace_id, 'products'\)/i);
assert.match(migration, /private\.has_feature\(target_workspace_id, 'suppliers'\)/i);
assert.doesNotMatch(migration, /platform_support_sessions/i);
assert.match(migration, /product Supplier identities cannot be changed/i);
assert.match(migration, /supplier_type <> 'product'/i);
assert.doesNotMatch(migration, /delete from public\.product_suppliers/i);
assert.doesNotMatch(migration, /\b(bank_account|iban|bic|swift|payment_approval|settlement)\b/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.product_suppliers\s+to\s+authenticated/i);
assert.match(migration, /revoke all on function public\.apply_product_supplier_command[\s\S]*authenticated/i);

assert.match(hardening, /receipt\.relationship_id, receipt\.action, receipt\.result/i);
assert.match(hardening, /previous_relationship_id <> p_relationship_id or previous_action <> p_action/i);
assert.match(hardening, /Product Supplier idempotency key was already used for another command/i);
assert.match(hardening, /grant execute on function public\.apply_product_supplier_command[\s\S]*service_role/i);
assert.doesNotMatch(hardening, /grant execute on function public\.apply_product_supplier_command[\s\S]*authenticated/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_product_supplier_command/);
assert.match(api, /PRODUCT_SUPPLIER_CONFLICT/);
assert.match(api, /PRODUCT_SUPPLIER_PREFERRED_EXISTS/);
assert.match(api, /PRODUCT_SUPPLIER_SKU_DUPLICATE/);

assert.match(queue, /createCatalogueOfflineQueue/);
assert.match(queue, /bdb-product-supplier-queue-v1/);
assert.match(queue, /retryProductSupplierCommand/);
assert.match(queue, /flushProductSupplierQueue/);
assert.match(offlineQueue, /MAX_QUEUE_COMMANDS = 200/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_STORAGE_UNAVAILABLE/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_ID_CONFLICT/);
assert.match(offlineQueue, /CATALOGUE_QUEUE_ORDER_BLOCKED/);
assert.match(offlineQueue, /blockedCommandId/);
assert.match(offlineQueue, /lastErrorCode/);
assert.match(offlineQueue, /Idempotency-Key/);

assert.match(layout, /Catalogue/);
assert.match(layout, /Supplier terms/);
assert.match(indexPage, /Product purchasing terms/);
assert.match(indexPage, /Manage terms/);
assert.match(detailPage, /readCache/);
assert.match(detailPage, /enqueueProductSupplierCommand/);
assert.match(detailPage, /archive/);
assert.match(detailPage, /restore/);
assert.match(detailPage, /Linking a Supplier does not change stock/);
assert.match(detailPage, /actual historical cost and currency/);
assert.doesNotMatch(`${indexPage}\n${detailPage}`, /platform-support|Founder support/i);

console.log("Product Supplier schema, permissions, command, idempotency, bounded offline and UI contracts are internally consistent.");

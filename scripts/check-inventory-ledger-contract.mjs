import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260727190000_inventory_movement_ledger.sql",
  "utf8",
);
const api = await readFile("src/app/api/inventory/route.ts", "utf8");
const domain = await readFile("src/lib/modules/inventory.ts", "utf8");
const queue = await readFile("src/lib/modules/inventory-queue.ts", "utf8");
const workspace = await readFile("src/app/inventory/inventory-workspace.tsx", "utf8");
const page = await readFile("src/app/inventory/page.tsx", "utf8");

for (const statement of [
  "create table public.inventory_locations",
  "create table public.inventory_movements",
  "create table public.inventory_command_receipts",
  "create view public.inventory_stock_balances",
  "create view public.inventory_product_totals",
  "create or replace function public.apply_inventory_location_command",
  "create or replace function public.post_inventory_movement",
  "create or replace function public.transfer_inventory_stock",
  "create or replace function public.post_supplier_document_to_inventory",
  "create or replace function public.reverse_supplier_document_inventory",
  "inventory_movements_immutable",
  "inventory_movements_single_reversal_idx",
  "inventory_movements_single_document_line_post_idx",
  "grant select on table public.inventory_locations, public.inventory_movements to authenticated",
  "grant all on table public.inventory_locations, public.inventory_movements, public.inventory_command_receipts to service_role",
]) {
  assert.ok(
    migration.toLowerCase().includes(statement.toLowerCase()),
    `Missing Inventory contract: ${statement}`,
  );
}

assert.match(
  migration,
  /foreign key \(workspace_id, product_id\)[\s\S]*references public\.products\(workspace_id, id\) on delete restrict/i,
);
assert.doesNotMatch(migration, /create table public\.inventory_items/i);
assert.doesNotMatch(migration, /\bquantity\b[\s\S]*alter table public\.products/i);
assert.match(migration, /Posted Inventory movements are immutable/i);
assert.match(migration, /Purchasing stock changes must be posted from an approved supplier document/i);
assert.match(migration, /Every Product line must be matched before Inventory posting/i);
assert.match(migration, /Supplier document must be approved before Inventory posting/i);
assert.match(migration, /inventory_posting_status in \('not_available', 'ready', 'posted', 'reversed'\)/i);
assert.match(migration, /A reversal cannot be reversed again/i);
assert.match(migration, /Transfer movements must be corrected as a complete transfer/i);
assert.match(migration, /inventory_actor_can_view_feature[\s\S]*'purchasing'[\s\S]*'documents'[\s\S]*'products'/i);
assert.doesNotMatch(migration, /platform_support_sessions/i);
assert.match(migration, /revoke all on function public\.post_inventory_movement[\s\S]*authenticated/i);
assert.doesNotMatch(
  migration,
  /grant\s+(?:insert|update|delete)[\s\S]*public\.inventory_movements\s+to\s+authenticated/i,
);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /post_supplier_document_to_inventory/);
assert.match(api, /reverse_supplier_document_inventory/);
assert.match(api, /Purchasing, Sales and Appointment movements must be posted from their owning records/);
assert.match(api, /Manual Inventory changes cannot claim a Purchasing, Sales or Appointment source record/);
assert.doesNotMatch(api, /post_appointment_product_consumption|reverse_appointment_product_consumption/i);

assert.match(domain, /normaliseInventoryMovementDelta/);
assert.match(domain, /inventoryStockStatus/);
assert.match(domain, /summariseInventory/);
assert.match(domain, /inventoryBalances/);

assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushInventoryQueue/);
assert.match(queue, /break;/);

assert.match(page, /InventoryWorkspace/);
assert.match(workspace, /Append-only stock ledger/);
assert.match(workspace, /Post approved document/);
assert.match(workspace, /Reverse supplier-document posting/);
assert.doesNotMatch(workspace, /platform-support|Founder support/i);
assert.match(workspace, /Purchasing posting requires current cloud validation/);
assert.match(workspace, /Conflicts stop synchronisation|Synchronisation stops on the first validation or conflict error/);

console.log("Inventory Product identity, append-only ledger, Purchasing posting, security and offline contracts are intact.");

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/migrations/20260722103000_inventory_ledger_foundation.sql",
  "utf8",
);
const api = await readFile("src/app/api/inventory/route.ts", "utf8");
const queue = await readFile("src/lib/modules/inventory-queue.ts", "utf8");

for (const statement of [
  "create table public.inventory_items",
  "create table public.inventory_locations",
  "create table public.inventory_movements",
  "unique (workspace_id, idempotency_key)",
  "inventory_movements_immutable",
  "create view public.inventory_stock_balances",
  "with (security_invoker = true)",
  "create or replace function public.post_inventory_movement",
  "create or replace function public.transfer_inventory_stock",
  "private.has_workspace_permission(workspace_id, 'inventory', 'view')",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Inventory contract: ${statement}`);
}

assert.match(migration, /foreign key \(workspace_id, item_id\)[\s\S]*inventory_items\(workspace_id, id\)/i);
assert.match(migration, /foreign key \(workspace_id, location_id\)[\s\S]*inventory_locations\(workspace_id, id\)/i);
assert.match(migration, /raise exception 'Posted inventory movements are immutable/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*inventory_movements\s+to\s+authenticated/i);
assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);

console.log("Inventory ledger, command and offline queue contracts are internally consistent.");

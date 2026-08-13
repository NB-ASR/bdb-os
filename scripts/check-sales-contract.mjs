import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile("supabase/release-sources/vanita-integration-20260813/20260728100000_sales_transaction_foundation.sql", "utf8");
const referenceMigration = await readFile("supabase/release-sources/vanita-integration-20260813/20260728100500_sales_reference_uniqueness.sql", "utf8");
const api = await readFile("src/app/api/sales/route.ts", "utf8");
const queue = await readFile("src/lib/modules/sale-queue.ts", "utf8");
const page = await readFile("src/app/sales/page.tsx", "utf8");

for (const statement of [
  "create table public.sales", "create table public.sale_lines", "create table public.sale_command_receipts",
  "create or replace function public.complete_sale", "create or replace function public.reverse_sale",
  "inventory_movements_single_sale_line_idx", "sale_lines_immutable", "sales_immutable_except_reversal",
  "settlement_status = 'not_recorded'",
  "private.has_workspace_permission(workspace_id, 'sales', 'view')",
]) assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Sales contract: ${statement}`);

assert.match(migration, /line_type = 'product'[\s\S]*product_id is not null[\s\S]*service_id is null/i);
assert.match(migration, /line_type = 'service'[\s\S]*service_id is not null[\s\S]*product_id is null/i);
assert.match(migration, /movement_type[\s\S]*'sale'[\s\S]*-abs\(quantity_value\)/i);
assert.match(migration, /movement_type[\s\S]*'reversal'[\s\S]*-original_movement\.quantity_delta/i);
assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.doesNotMatch(migration, /delete from public\.(sales|sale_lines)/i);
assert.doesNotMatch(migration, /platform_support_sessions|support_test_write/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.(sales|sale_lines)\s+to\s+authenticated/i);
assert.doesNotMatch(migration, /insert into public\.(payments|invoices|bank_transactions)/i);
assert.match(migration, /business-supply Products cannot be sold/i);
assert.match(migration, /Product Sales require an Inventory location/i);

assert.match(referenceMigration, /create trigger sales_prepare_reference/i);
assert.match(referenceMigration, /right\(replace\(new\.id::text, '-', ''\), 16\)/i);
assert.doesNotMatch(referenceMigration, /substr\([^\n]*,\s*1,\s*8\)/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /complete_sale/);
assert.match(api, /reverse_sale/);
assert.match(api, /select\("\*,sale_lines\(\*\)"\)/);
assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushSaleQueue/);
assert.match(queue, /break;/);
assert.match(page, /readDraft/);
assert.match(page, /enqueueSaleCommand/);
assert.match(page, /Product quantities post atomically/);
assert.match(page, /Completed does not mean paid/);
assert.match(page, /Settlement not recorded/);
assert.doesNotMatch(page, /Payment successful|Invoice created|Paid in full/i);

console.log("Sales schema, Inventory orchestration, deterministic references, settlement boundary, offline and UI contracts are internally consistent.");

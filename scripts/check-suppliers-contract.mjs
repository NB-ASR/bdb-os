import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/migrations/20260727154000_supplier_directory_foundation.sql",
  "utf8",
);
const api = await readFile("src/app/api/suppliers/route.ts", "utf8");
const queue = await readFile("src/lib/modules/supplier-queue.ts", "utf8");
const page = await readFile("src/app/suppliers/page.tsx", "utf8");

for (const statement of [
  "create table public.suppliers",
  "create table public.supplier_command_receipts",
  "unique (workspace_id, code)",
  "version integer not null default 1",
  "create or replace function public.apply_supplier_command",
  "supplier changed on another device",
  "private.has_workspace_permission(workspace_id, 'suppliers', 'view')",
  "grant select on table public.suppliers to authenticated",
  "platform_support_sessions",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Suppliers contract: ${statement}`);
}

assert.doesNotMatch(migration, /\b(bank_account|iban|swift|bic|payment_approval|settled_at)\b/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.suppliers\s+to\s+authenticated/i);
assert.match(migration, /revoke all on function public\.apply_supplier_command[\s\S]*authenticated/i);
assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /status text not null default 'active'[\s\S]*'archived'/i);
assert.match(migration, /p_expected_version[\s\S]*supplier_record\.version <> p_expected_version/i);
assert.doesNotMatch(migration, /delete from public\.suppliers/i);
assert.match(migration, /select not exists[\s\S]*platform_support_sessions/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_supplier_command/);
assert.match(api, /SUPPLIER_CONFLICT/);
assert.match(api, /SUPPLIER_DUPLICATE/);

assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushSupplierQueue/);
assert.match(queue, /break;/);

assert.match(page, /readCache/);
assert.match(page, /enqueueSupplierCommand/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.match(page, /Product-specific prices follow in the relationship slice/);
assert.match(page, /Bank details, payment approval and settlement remain controlled by Accounts and Banking/);

console.log("Suppliers schema, command, RLS, support, offline and UI contracts are internally consistent.");

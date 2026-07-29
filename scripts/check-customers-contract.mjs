import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationFiles = [
  "supabase/migrations/20260729090000_customer_foundation_schema.sql",
  "supabase/migrations/20260729090500_customer_foundation_commands.sql",
  "supabase/migrations/20260729091000_customer_vanita_import.sql",
  "supabase/migrations/20260729091500_customer_code_collision_hardening.sql",
  "supabase/migrations/20260729092000_customer_reference_indexes.sql",
].map((path) => readFile(path, "utf8"));
const migrationText = (await Promise.all(migrationFiles)).join("\n");
const api = await readFile("src/app/api/customers/route.ts", "utf8");
const importApi = await readFile("src/app/api/customers/import/route.ts", "utf8");
const queue = await readFile("src/lib/modules/customer-queue.ts", "utf8");
const importer = await readFile("src/lib/modules/customer-import.ts", "utf8");
const page = await readFile("src/app/customers/page.tsx", "utf8");
const databaseTest = await readFile("supabase/tests/customer_foundation.sql", "utf8");

for (const statement of [
  "alter table public.customers",
  "preferences jsonb",
  "status text",
  "version integer",
  "legacy_source text",
  "legacy_id text",
  "create table if not exists public.customer_command_receipts",
  "create table if not exists public.customer_import_batches",
  "create table if not exists public.customer_import_receipts",
  "create or replace function private.customer_actor_can_write",
  "create or replace function public.apply_customer_command",
  "create or replace function public.import_vanita_customers",
  "private.actor_has_workspace_permission",
  "potential duplicate customer requires review",
  "customer changed on another device",
  "revoke all on table public.customers from anon, authenticated",
  "grant select on table public.customers to authenticated",
  "customer imported",
  "vanita customers imported",
  "right(replace(p_customer_id::text",
  "right(replace(new_customer_id::text",
  "customers_created_by_idx",
  "customers_updated_by_idx",
  "customer_import_batches_created_by_idx",
  "customer_import_receipts_batch_idx",
]) {
  assert.ok(migrationText.toLowerCase().includes(statement.toLowerCase()), `Missing Customer migration contract: ${statement}`);
}

assert.match(api, /const ACTIONS = new Set\(\["create", "update", "archive", "restore"\]\)/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /CUSTOMER_DUPLICATE_REVIEW/);
assert.match(api, /optionalEmail/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_customer_command/);
assert.doesNotMatch(api, /\.from\("customers"\)\.insert/);

assert.match(importApi, /import_vanita_customers/);
assert.match(importApi, /CUSTOMER_IMPORT_TOO_LARGE/);
assert.match(importApi, /IDEMPOTENCY_REQUIRED/);
assert.match(importApi, /requireWorkspaceCommand/);

assert.match(queue, /bdb-customer-queue-v1/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /break;/);
assert.match(importer, /record\.clients/);
assert.match(importer, /data\.clients/);

assert.match(page, /Email is optional/);
assert.match(page, /Import Vanita JSON/);
assert.match(page, /Saved offline/);
assert.match(page, /CUSTOMER_DUPLICATE_REVIEW/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.doesNotMatch(page, /addCustomer/);

assert.match(databaseTest, /Customer commands are idempotent/i);
assert.match(databaseTest, /Customer imports preserve provenance/i);
assert.match(databaseTest, /browser clients cannot insert Customers directly/i);
assert.match(databaseTest, /final 64 UUID bits/i);
assert.match(databaseTest, /covering indexes/i);

console.log("Customer foundation, offline queue and Vanita migration contracts are internally consistent.");

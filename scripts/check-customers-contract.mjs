import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationFiles = [
  "supabase/release-sources/vanita-integration-20260813/20260729090000_customer_foundation_schema.sql",
  "supabase/release-sources/vanita-integration-20260813/20260729090500_customer_foundation_commands.sql",
  "supabase/release-sources/vanita-integration-20260813/20260729091000_customer_vanita_import.sql",
  "supabase/release-sources/vanita-integration-20260813/20260729091500_customer_code_collision_hardening.sql",
  "supabase/release-sources/vanita-integration-20260813/20260729092000_customer_reference_indexes.sql",
].map((path) => readFile(path, "utf8"));
const migrationText = (await Promise.all(migrationFiles)).join("\n");
const pass1Migration = await readFile("supabase/migrations/20260823195500_customer_foundation_pass1.sql", "utf8");
const archiveGuardMigration = await readFile("supabase/migrations/20260823202000_customer_archived_sale_guard_pass1.sql", "utf8");
const pass2Migration = await readFile("supabase/migrations/20260823203500_customer_scale_offline_pass2.sql", "utf8");
const pass4Migration = await readFile("supabase/migrations/20260823224000_customer_engine_closure_pass4.sql", "utf8");
const api = await readFile("src/app/api/customers/route.ts", "utf8");
const documentIdentityApi = await readFile("src/app/api/customers/document-identity/route.ts", "utf8");
const importApi = await readFile("src/app/api/customers/import/route.ts", "utf8");
const queue = await readFile("src/lib/modules/customer-queue.ts", "utf8");
const cache = await readFile("src/lib/modules/customer-cache.ts", "utf8");
const importer = await readFile("src/lib/modules/customer-import.ts", "utf8");
const page = await readFile("src/app/customers/page.tsx", "utf8");
const profilePage = await readFile("src/app/customers/[customerId]/page.tsx", "utf8");
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
assert.match(api, /CUSTOMER_IDEMPOTENCY_CONFLICT/);
assert.match(api, /optionalEmail/);
assert.match(api, /createAdminClient/);
assert.match(api, /execute_customer_command/);
assert.doesNotMatch(api, /admin\.rpc\("apply_customer_command"/i, "Customer API must not bypass the Pass 4 runtime command boundary.");
assert.match(api, /p_vat_number: values\.vatNumber/, "Customer API must explicitly pass Customer-owned VAT identity.");
assert.match(api, /p_notes: null/, "Normal Customer lifecycle API must not mutate legacy Customer notes.");
assert.doesNotMatch(api, /body\.notes/, "Normal Customer lifecycle API must not accept the legacy notes field.");
assert.doesNotMatch(api, /\.from\("customers"\)\.insert/);
assert.match(api, /DEFAULT_PAGE_SIZE = 100/);
assert.match(api, /MAX_PAGE_SIZE = 100/);
assert.match(api, /list_customer_register_page/, "Customer GET must use the bounded database register.");
assert.match(api, /customer_register_summary/, "Customer totals must be loaded separately from page rows.");
assert.match(api, /afterName/);
assert.match(api, /afterId/);
assert.match(documentIdentityApi, /execute_customer_command/, "Business Document VAT updates must use the hardened Customer command boundary.");
assert.doesNotMatch(documentIdentityApi, /admin\.rpc\("apply_customer_command"/i, "Business Document VAT updates must not use the retired Customer RPC.");
assert.match(documentIdentityApi, /p_notes: null/, "Business Document VAT updates must preserve legacy Customer context rather than rewriting it.");

assert.match(importApi, /execute_vanita_customer_import/);
assert.doesNotMatch(importApi, /admin\.rpc\("import_vanita_customers"/i, "Vanita imports must not bypass the Pass 4 runtime command boundary.");
assert.match(importApi, /CUSTOMER_IMPORT_TOO_LARGE/);
assert.match(importApi, /IDEMPOTENCY_REQUIRED/);
assert.match(importApi, /requireWorkspaceCommand/);

assert.match(queue, /bdb-customer-queue-v1/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /CUSTOMER_QUEUE_LIMIT = 200/);
assert.match(queue, /confirmedRejected/);
assert.match(queue, /lastFailureKind/);
assert.match(queue, /ambiguous/);
assert.match(queue, /response\.status >= 400 && response\.status < 500/);
assert.match(cache, /CUSTOMER_CACHE_LIMIT = 300/);
assert.match(cache, /bdb-customers-cache-v2/);
assert.match(cache, /mergeCustomerCache/);
assert.match(cache, /readCustomerSummary/);
assert.match(importer, /record\.clients/);
assert.match(importer, /data\.clients/);

assert.match(page, /Email is optional/);
assert.match(page, /Import Customers/);
assert.doesNotMatch(page, /Import Vanita JSON/, "Customer UI must use the generic import label for every workspace.");
assert.match(page, /Saved offline/);
assert.match(page, /CUSTOMER_DUPLICATE_REVIEW/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.match(page, /slice\(-16\)/);
assert.match(page, /useRouter/);
assert.match(page, /VAT number/, "Customer master-data form must own VAT identity.");
assert.match(page, /vatNumber: form\.vatNumber/, "Customer create and edit commands must include VAT identity.");
assert.match(page, /notes: customer\.notes/, "Optimistic Customer edits must preserve any legacy imported context.");
assert.doesNotMatch(page, /customer-notes/, "Customer directory must not expose a second mutable notes field.");
assert.match(page, /router\.push\(`\/customers\/\$\{id\}`\)/, "A confirmed new Customer must land on its Customer profile.");
assert.match(page, /PAGE_SIZE = 100/);
assert.match(page, /Load next \$\{PAGE_SIZE\}/, "Customer register must expose bounded keyset continuation.");
assert.match(page, /mergeCustomerCache/, "Cloud pages must feed a bounded offline working set.");
assert.match(page, /CustomerSubmitError/);
assert.match(page, /commandError\.confirmedRejected/, "Only confirmed server rejections may be removed as failed Customer commands.");
assert.match(page, /same retry key/, "Ambiguous outcomes must keep the original idempotency key.");
assert.doesNotMatch(page, /Discard local changes/, "Customer UI must not offer blanket discard for ambiguous commands.");
assert.doesNotMatch(page, /writeCustomerQueue/, "Customer UI must not directly clear the durable queue.");
assert.doesNotMatch(page, /addCustomer/);

assert.match(profilePage, /vat_number: string \| null/, "Customer 360 must type the canonical VAT identity.");
assert.match(profilePage, /customer\.vat_number/, "Customer 360 must display the canonical VAT identity.");
assert.match(profilePage, /Legacy\/imported context/, "Legacy Customer directory notes must be labelled as preserved context, not operational notes.");
assert.match(profilePage, /Notes are append-only/, "Operational Customer notes must remain append-only from Customer 360.");

assert.match(pass1Migration, /comment on column public\.customers\.notes[\s\S]*legacy\/imported customer context/i);
assert.match(pass1Migration, /operational Customer notes are canonical in public\.customer_notes/i);
assert.match(pass1Migration, /comment on column public\.customers\.vat_number[\s\S]*canonical Customer VAT\/legal tax identity/i);
assert.match(pass1Migration, /comment on column public\.documents\.customer_id[\s\S]*canonical general Document relationships are public\.document_links/i);
assert.match(pass1Migration, /insert into public\.document_links[\s\S]*from public\.documents document[\s\S]*document\.customer_id is not null/i, "Legacy direct Customer document pointers must be preserved in canonical document_links.");
assert.match(pass1Migration, /insert into public\.customers[\s\S]*notes,[\s\S]*null,[\s\S]*p_preferences/i, "New Customer lifecycle creation must not populate the legacy notes column.");
const customerUpdateBlock = pass1Migration.match(/if p_action = 'update' then([\s\S]*?)elsif p_action = 'archive'/i)?.[1] ?? "";
assert.ok(customerUpdateBlock, "Customer Pass 1 update block must exist.");
assert.doesNotMatch(customerUpdateBlock, /notes\s*=/i, "Customer lifecycle updates must preserve legacy notes unchanged.");
const generalDocumentInsert = pass1Migration.match(/insert into public\.documents \(([\s\S]*?)returning \* into document_record;/i)?.[0] ?? "";
assert.ok(generalDocumentInsert, "Customer Pass 1 general Document insert must exist.");
assert.match(generalDocumentInsert, /customer_id,[\s\S]*null,[\s\S]*case/i, "New general Documents must not maintain the legacy direct Customer pointer.");
assert.match(pass1Migration, /grant execute on function public\.apply_customer_command[\s\S]*to service_role/i);
assert.match(pass1Migration, /grant execute on function public\.create_general_document[\s\S]*to service_role/i);

assert.match(archiveGuardMigration, /function private\.enforce_active_sale_customer/i, "Archived Customer Sale enforcement must live at the Sale table boundary.");
assert.match(archiveGuardMigration, /customer\.status = 'active'/i, "New Sales must require an active Customer when a Customer is supplied.");
assert.match(archiveGuardMigration, /before insert on public\.sales/i, "Every new completed Sale path must inherit the active-Customer guard.");
assert.match(archiveGuardMigration, /Archived or unavailable Customers cannot receive new Sales/i);

assert.match(pass2Migration, /create extension if not exists pg_trgm/i);
assert.match(pass2Migration, /search_text text generated always as/i);
assert.match(pass2Migration, /customers_search_text_trgm_idx/i);
assert.match(pass2Migration, /customers_workspace_status_name_cursor_idx/i);
assert.match(pass2Migration, /customers_workspace_imported_name_cursor_idx/i);
assert.match(pass2Migration, /create or replace function public\.list_customer_register_page/i);
assert.match(pass2Migration, /\(customer\.name, customer\.id\) > \(p_after_name, p_after_id\)/i);
assert.match(pass2Migration, /limit least\(greatest\(coalesce\(p_limit, 100\), 1\), 100\) \+ 1/i);
assert.match(pass2Migration, /customer\.search_text like '%' \|\| lower\(trim\(p_search\)\) \|\| '%'/i);
assert.match(pass2Migration, /security invoker/i, "Paged Customer reads must retain the caller's RLS boundary.");
assert.match(pass2Migration, /customer_register_summary/i);

assert.match(pass4Migration, /create table public\.customer_command_claims/i, "Pass 4 must bind Customer retry keys to request identity.");
assert.match(pass4Migration, /private\.claim_customer_command/i, "Pass 4 must centralize Customer request claiming.");
assert.match(pass4Migration, /sha256/i, "Pass 4 Customer request claims must use a collision-resistant hash.");
assert.match(pass4Migration, /customer idempotency key was reused with different input/i, "Pass 4 must reject retry-key payload drift.");
assert.match(pass4Migration, /pg_advisory_xact_lock_shared/i, "Live Customer lifecycle commands must coordinate with imports.");
assert.match(pass4Migration, /customer-email:/i, "Concurrent email duplicate review must be serialized.");
assert.match(pass4Migration, /customer-phone:/i, "Concurrent phone duplicate review must be serialized.");
assert.match(pass4Migration, /execute_customer_command/i, "Pass 4 must expose the hardened lifecycle runtime command.");
assert.match(pass4Migration, /execute_vanita_customer_import/i, "Pass 4 must expose the hardened import runtime command.");
assert.match(pass4Migration, /revoke all on function public\.apply_customer_command[\s\S]*service_role/i, "The older Customer lifecycle RPC must be retired from service traffic.");
assert.match(pass4Migration, /revoke all on function public\.import_vanita_customers[\s\S]*service_role/i, "The older Customer import RPC must be retired from service traffic.");
assert.doesNotMatch(pass4Migration, /(insert into|update|delete from) public\.(invoices|payments|credit_notes|delivery_notes|payment_allocations)/i, "Customer Pass 4 must not mutate frozen Accounts financial records.");

assert.match(databaseTest, /Customer commands are idempotent/i);
assert.match(databaseTest, /Customer imports preserve provenance/i);
assert.match(databaseTest, /browser clients cannot insert Customers directly/i);
assert.match(databaseTest, /final 64 UUID bits/i);
assert.match(databaseTest, /covering indexes/i);
assert.match(databaseTest, /sales_active_customer_guard/i, "Database tests must pin the archived-Customer Sale guard.");

console.log("Customer foundation, scale, bounded offline state, archive guards, hardened replay and closure contracts are internally consistent.");

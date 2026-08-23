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
const api = await readFile("src/app/api/customers/route.ts", "utf8");
const documentIdentityApi = await readFile("src/app/api/customers/document-identity/route.ts", "utf8");
const importApi = await readFile("src/app/api/customers/import/route.ts", "utf8");
const queue = await readFile("src/lib/modules/customer-queue.ts", "utf8");
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
assert.match(api, /optionalEmail/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_customer_command/);
assert.match(api, /p_vat_number: values\.vatNumber/, "Customer API must explicitly pass Customer-owned VAT identity.");
assert.match(api, /p_notes: null/, "Normal Customer lifecycle API must not mutate legacy Customer notes.");
assert.doesNotMatch(api, /body\.notes/, "Normal Customer lifecycle API must not accept the legacy notes field.");
assert.doesNotMatch(api, /\.from\("customers"\)\.insert/);
assert.match(documentIdentityApi, /p_notes: null/, "Business Document VAT updates must preserve legacy Customer context rather than rewriting it.");

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
assert.match(page, /slice\(-16\)/);
assert.match(page, /useRouter/);
assert.match(page, /VAT number/, "Customer master-data form must own VAT identity.");
assert.match(page, /vatNumber: form\.vatNumber/, "Customer create and edit commands must include VAT identity.");
assert.match(page, /notes: customer\.notes/, "Optimistic Customer edits must preserve any legacy imported context.");
assert.doesNotMatch(page, /customer-notes/, "Customer directory must not expose a second mutable notes field.");
assert.match(page, /router\.push\(`\/customers\/\$\{id\}`\)/, "A confirmed new Customer must land on its Customer profile.");
assert.match(page, /This Customer has not been confirmed by BDB OS yet/, "Failed online creates must not masquerade as confirmed Customers.");
assert.match(page, /if \(code\) \{[\s\S]*removeCustomerCommand/, "Deterministic server rejections must roll back the optimistic Customer row.");
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

assert.match(databaseTest, /Customer commands are idempotent/i);
assert.match(databaseTest, /Customer imports preserve provenance/i);
assert.match(databaseTest, /browser clients cannot insert Customers directly/i);
assert.match(databaseTest, /final 64 UUID bits/i);
assert.match(databaseTest, /covering indexes/i);

console.log("Customer foundation, canonical identity boundaries, offline queue and confirmed-create navigation contracts are internally consistent.");

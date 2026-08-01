import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [schema, commands, views, indexes, profileApi, notesApi, queue, page] = await Promise.all([
  read("supabase/migrations/20260801090000_customer_360_notes_schema.sql"),
  read("supabase/migrations/20260801090500_customer_360_note_commands.sql"),
  read("supabase/migrations/20260801091000_customer_360_views_security.sql"),
  read("supabase/migrations/20260801091500_customer_360_reference_indexes.sql"),
  read("src/app/api/customers/profile/route.ts"),
  read("src/app/api/customers/notes/route.ts"),
  read("src/lib/modules/customer-note-queue.ts"),
  read("src/app/customers/[customerId]/page.tsx"),
]);

assert.match(schema, /create table if not exists public\.customer_notes/i, "Customer notes ledger must exist.");
assert.match(schema, /note_kind in \('note', 'void'\)/i, "Customer note and void records must be explicit.");
assert.match(schema, /Customer notes are append-only/i, "Customer notes must reject mutation.");
assert.match(schema, /customer_notes_one_void_per_note_idx/i, "One note may be voided only once.");
assert.match(schema, /enable row level security/i, "Customer note tables must use RLS.");
assert.match(schema, /private\.has_workspace_permission\(workspace_id, 'customers', 'view'\)/i, "Customer note reads must follow Customer permission.");
assert.doesNotMatch(schema, /grant (insert|update|delete)/i, "Browser Customer note writes must not be granted.");

for (const command of ["create_customer_note", "void_customer_note"]) {
  assert.match(commands, new RegExp(`function public\\.${command}\\b`, "i"), `${command} must exist.`);
  assert.match(commands, new RegExp(`grant execute on function public\\.${command}`, "i"), `${command} must remain service-role-only.`);
}
assert.match(commands, /actor_has_workspace_permission[\s\S]*'customers'[\s\S]*'create'/i, "Note creation must use Customer create permission.");
assert.match(commands, /actor_has_workspace_permission[\s\S]*'customers'[\s\S]*'edit'/i, "Note voiding must use Customer edit permission.");
assert.match(commands, /insert into public\.activity_items/i, "Customer note changes must emit business activity.");
assert.doesNotMatch(commands, /update public\.customer_notes/i, "Customer note commands must not mutate notes.");
assert.doesNotMatch(commands, /delete from public\.customer_notes/i, "Customer note commands must not delete notes.");
for (const table of ["bookings", "sales", "invoices", "payments", "documents", "messages"]) {
  assert.doesNotMatch(commands, new RegExp(`(insert into|update|delete from) public\\.${table}`, "i"), `Customer notes must not mutate ${table}.`);
}

for (const view of [
  "customer_note_status",
  "customer_360_financial_summary",
  "customer_360_operational_summary",
  "customer_360_activity",
]) {
  assert.match(views, new RegExp(`view public\\.${view}\\b`, "i"), `${view} must exist.`);
  assert.match(views, /security_invoker = true/i, "Customer 360 views must preserve source RLS.");
}
assert.match(views, /from public\.bookings/i, "Customer activity must connect Calendar records.");
assert.match(views, /from public\.sales/i, "Customer activity must connect Sales records.");
assert.match(views, /from public\.invoice_account_balances/i, "Customer activity must connect Invoice balances.");
assert.match(views, /from public\.payment_account_balances/i, "Customer activity must connect Customer Payments.");
assert.match(views, /from public\.documents/i, "Customer activity must connect Documents.");
assert.match(views, /from public\.messages/i, "Customer activity must connect Communications.");
assert.match(views, /get_customer_360_access/i, "Customer 360 must expose source-department access decisions.");
assert.match(views, /group by invoice\.workspace_id, invoice\.customer_id, invoice\.currency/i, "Financial summaries must remain separated by currency.");

for (const index of [
  "bookings_customer_activity_idx",
  "sales_customer_activity_idx",
  "invoices_customer_activity_idx",
  "payments_customer_activity_idx",
  "documents_customer_activity_idx",
  "messages_customer_activity_idx",
]) assert.match(indexes, new RegExp(index, "i"), `${index} must exist.`);

assert.match(profileApi, /customer_360_operational_summary/, "Profile API must use the operational read model.");
assert.match(profileApi, /customer_360_financial_summary/, "Profile API must use the currency-safe financial read model.");
assert.match(profileApi, /customer_360_activity/, "Profile API must use the unified activity read model.");
assert.match(profileApi, /get_customer_360_access/, "Profile API must expose permission-aware sections.");
assert.match(notesApi, /create_customer_note/, "Notes API must use the trusted create command.");
assert.match(notesApi, /void_customer_note/, "Notes API must use the trusted void command.");
assert.match(notesApi, /Idempotency|required for Customer note changes/i, "Notes API must require idempotency.");

assert.match(queue, /Idempotency-Key/, "Queued Customer note commands must preserve stable command identities.");
assert.match(queue, /for \(const command of queue\)/, "Customer note queue must replay in order.");
assert.match(queue, /throw error/, "Customer note queue must stop on the first failure.");

assert.match(page, /Customer-centred operating record/i, "Customer 360 must explain the source-of-truth boundary.");
assert.match(page, /append-only/i, "Customer note correction behaviour must be explicit.");
assert.match(page, /bundle\.financial\.map/i, "Customer financial cards must render per currency.");
assert.doesNotMatch(page, /reduce\([^)]*net_balance/i, "Customer 360 must not combine balances across currencies.");
assert.match(page, /Appointments/i, "Customer 360 must connect Calendar.");
assert.match(page, /Invoices and Payments/i, "Customer 360 must connect Accounts.");
assert.match(page, /Documents/i, "Customer 360 must connect Documents.");
assert.match(page, /Communications/i, "Customer 360 must connect Communications.");

console.log("Customer 360 architecture contract passed.");

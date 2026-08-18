import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile("supabase/migrations/20260818155000_accounts_business_documents_v1.sql", "utf8");
const hardening = await readFile("supabase/migrations/20260818155500_accounts_business_documents_hardening.sql", "utf8");
const accountsPage = await readFile("src/app/accounts/page.tsx", "utf8");
const queue = await readFile("src/lib/modules/accounts-queue.ts", "utf8");
const renderer = await readFile("src/lib/server/business-document.ts", "utf8");
const outputRoute = await readFile("src/app/api/accounts/document-output/route.ts", "utf8");
const commandRoute = await readFile("src/app/api/accounts/business-documents/route.ts", "utf8");

for (const table of ["credit_notes", "credit_note_lines", "delivery_notes", "delivery_note_lines", "workspace_document_sequences"]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`), `${table} must exist in the reviewed migration.`);
}
for (const table of ["credit_notes", "credit_note_lines", "delivery_notes", "delivery_note_lines", "workspace_document_sequences"]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} must enable RLS.`);
}
assert.match(migration, /private\.next_business_document_number/);
assert.match(migration, /workspace_id, document_type, series_year/);
assert.match(migration, /apply_credit_note_command/);
assert.match(migration, /apply_delivery_note_command/);
assert.match(migration, /business_document_index/);
assert.match(migration, /credit_note_amount/);
assert.match(migration, /excess_allocated_amount/);
assert.match(hardening, /private\.write_manual_invoice_lines/);
assert.match(hardening, /productId/);
assert.match(hardening, /serviceId/);
assert.match(hardening, /Issued Credit Notes are immutable/);
assert.match(hardening, /Issued Delivery Notes are immutable/);

assert.match(accountsPage, /New Document/);
assert.match(accountsPage, /"documents" \| "payments" \| "customers"/);
assert.match(accountsPage, /Credit Note/);
assert.match(accountsPage, /Delivery Note/);
assert.match(accountsPage, /Download/);
assert.match(accountsPage, /Printer/);
assert.doesNotMatch(accountsPage, /StatCard/);
assert.doesNotMatch(accountsPage, /Finance boundary/);

for (const action of ["credit-note-create", "credit-note-issue", "delivery-note-create", "delivery-note-issue"]) {
  assert.match(queue, new RegExp(action));
  assert.match(commandRoute, new RegExp(action));
}
assert.match(queue, /BUSINESS_DOCUMENT_ACTIONS/);
assert.match(renderer, /renderBusinessDocumentHtml/);
assert.match(renderer, /renderBusinessDocumentPdf/);
assert.match(renderer, /delivery_note/);
assert.match(outputRoute, /custom_branding/);
assert.match(outputRoute, /Content-Type.*application\/pdf/);

console.log("Accounts Business Documents V1 static contract passed.");

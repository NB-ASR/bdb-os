import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260818135000_accounts_business_documents_v1.sql", "utf8");
const accounts = await readFile("src/app/accounts/page.tsx", "utf8");
const api = await readFile("src/app/api/accounts/route.ts", "utf8");
const renderRoute = await readFile("src/app/api/business-documents/render/route.ts", "utf8");
const renderer = await readFile("src/lib/server/business-document-render.ts", "utf8");
const queue = await readFile("src/lib/modules/accounts-queue.ts", "utf8");

for (const table of ["business_document_sequences", "credit_notes", "credit_note_lines", "delivery_notes", "delivery_note_lines"]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`), `${table} must be part of the authoritative business-document migration.`);
}
assert.match(migration, /private\.next_business_document_number/);
assert.match(migration, /invoices_assign_issue_identity/);
assert.match(migration, /Credit Note quantity exceeds the uncredited Invoice quantity/);
assert.match(migration, /Delivery Note quantity exceeds the undelivered/);
assert.match(migration, /create or replace view public\.business_document_index/);
assert.match(migration, /overallocated_credit/);
assert.doesNotMatch(migration, /create table public\.business_documents\b/i, "Do not create a duplicate catch-all document database.");

for (const action of ["credit-note-create", "credit-note-update", "credit-note-issue", "delivery-note-create", "delivery-note-update", "delivery-note-issue"]) {
  assert.match(queue, new RegExp(action));
  assert.match(api, new RegExp(action));
}
assert.match(api, /from\("products"\)/);
assert.match(api, /from\("services"\)/);
assert.match(api, /lineType/);
assert.match(api, /productId/);
assert.match(api, /serviceId/);

assert.match(accounts, /New Document/);
assert.match(accounts, /Documents/);
assert.match(accounts, /Payments/);
assert.match(accounts, /Customers/);
assert.match(accounts, /Credit Note/);
assert.match(accounts, /Delivery Note/);
assert.match(accounts, /Download/);
assert.match(accounts, /Print/);
assert.match(accounts, /BDB OS has not recorded external delivery/);
assert.doesNotMatch(accounts, /stat-grid/, "Accounts must not regress to a KPI-heavy generic dashboard.");
assert.doesNotMatch(accounts, /Finance boundary/, "Technical finance boundary copy must stay out of the normal Accounts surface.");

assert.match(renderRoute, /requireWorkspaceCommand/);
assert.match(renderRoute, /get_effective_features/);
assert.match(renderRoute, /custom_branding/);
assert.match(renderRoute, /application\/pdf/);
assert.match(renderer, /businessDocumentHtml/);
assert.match(renderer, /businessDocumentPdf/);
assert.match(renderer, /delivery_note/);
assert.match(renderer, /Print \/ Save as PDF/);

console.log("Business Documents contract preserves One Engine, offline commands, document safety and restrained Accounts UX.");

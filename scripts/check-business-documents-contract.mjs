import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260818150236_accounts_business_documents_v1.sql", "utf8");
const polishMigration = await readFile("supabase/migrations/20260818220613_accounts_invoice_ux_pricing.sql", "utf8");
const headerReconcileMigration = await readFile("supabase/migrations/20260818221234_accounts_invoice_header_reconcile.sql", "utf8");
const accounts = await readFile("src/app/accounts/page.tsx", "utf8");
const accountsCss = await readFile("src/app/accounts/accounts.module.css", "utf8");
const api = await readFile("src/app/api/accounts/route.ts", "utf8");
const renderRoute = await readFile("src/app/api/business-documents/render/route.ts", "utf8");
const renderer = await readFile("src/lib/server/business-document-render.ts", "utf8");
const pricing = await readFile("src/lib/invoice-pricing.ts", "utf8");
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

assert.match(polishMigration, /alter column due_at drop not null/i);
assert.match(polishMigration, /default_invoice_without_due_date/);
assert.match(polishMigration, /net_value \* vat_rate_value \/ 100/);
assert.match(polishMigration, /total_value := round\(net_value \+ vat_value/);
assert.doesNotMatch(polishMigration, /\/ \(100 \+ vat_rate_value\)/, "Direct Invoice pricing must not back VAT out of the entered unit price.");
assert.match(polishMigration, /source_sale_id is null/i, "Draft correction must not rewrite Sale-derived pricing snapshots.");
assert.match(headerReconcileMigration, /round\(sum\(line\.net_amount\), 4\) as net_amount/);
assert.match(headerReconcileMigration, /round\(sum\(line\.vat_amount\), 4\) as vat_amount/);
assert.match(headerReconcileMigration, /round\(sum\(line\.total_amount\), 4\) as total_amount/);
assert.match(headerReconcileMigration, /invoice\.source_sale_id is null/i, "Header reconciliation must not rewrite Sale-derived Invoice snapshots.");
assert.match(headerReconcileMigration, /invoice\.status = 'draft'/i, "Header reconciliation must remain draft-only.");
assert.match(pricing, /vatAmount = moneyRound\(netAmount \* Math\.max\(0, vatRate\) \/ 100\)/);

assert.match(accounts, /New Document/);
assert.match(accounts, /documents/i);
assert.match(accounts, /Payments/);
assert.match(accounts, /Customers/);
assert.match(accounts, /Credit Note/);
assert.match(accounts, /Delivery Note/);
assert.match(accounts, /Download/);
assert.match(accounts, /Print/);
assert.match(accounts, /BDB OS has not recorded external delivery/);
assert.match(accounts, /Visible to customer/);
assert.match(accounts, /Internal only/);
assert.match(accounts, /Printed on the Invoice/);
assert.match(accounts, /Never printed on the Invoice/);
assert.match(accounts, /Unit price/);
assert.match(accounts, /excl\. VAT/);
assert.doesNotMatch(accounts, /<label>Due date<\/label>/, "The normal Invoice composer must not ask for a Due Date.");
assert.doesNotMatch(accounts, /Default payment terms \(days\)/, "Payment terms must not clutter normal Document Setup.");
assert.doesNotMatch(accounts, /stat-grid/, "Accounts must not regress to a KPI-heavy generic dashboard.");
assert.doesNotMatch(accounts, /Finance boundary/, "Technical finance boundary copy must stay out of the normal Accounts surface.");
assert.match(accountsCss, /\.documentComposer/);
assert.match(accountsCss, /background: #1a1a17/);
assert.doesNotMatch(accountsCss, /background:\s*var\(--panel\)/, "The New Document menu must not depend on an undefined transparent panel token.");

assert.match(renderRoute, /requireWorkspaceCommand/);
assert.match(renderRoute, /get_effective_features/);
assert.match(renderRoute, /custom_branding/);
assert.match(renderRoute, /description: String\(row\.description/);
assert.match(renderRoute, /application\/pdf/);
assert.match(renderer, /businessDocumentHtml/);
assert.match(renderer, /businessDocumentPdf/);
assert.match(renderer, /delivery_note/);
assert.match(renderer, /Print \/ Save as PDF/);
assert.match(renderer, /SKU \/ Code/);
assert.match(renderer, /Unit prices are shown exclusive of VAT/);
assert.match(renderer, /Powered by BDB/);
assert.match(renderer, /Client signature/);
assert.match(renderer, /Payment acknowledgement/);
assert.doesNotMatch(renderer, /Due date/);
assert.doesNotMatch(renderer, /Payment instructions/i);
assert.doesNotMatch(renderer, /document\.footer \?/, "Permanent footer/payment instructions must not be printed on customer Invoices.");

console.log("Business Documents contract preserves One Engine, VAT-exclusive Invoice pricing, reconciled draft totals, offline commands, document safety and restrained Accounts UX.");

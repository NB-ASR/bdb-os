import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260818150236_accounts_business_documents_v1.sql", "utf8");
const lifecycleMigration = await readFile("supabase/migrations/20260819110118_accounts_document_lifecycle_v1.sql", "utf8");
const creditVatNumberingMigration = await readFile("supabase/migrations/20260819110205_accounts_credit_vat_and_numbering.sql", "utf8");
const salesOrderMigration = await readFile("supabase/migrations/20260819122420_accounts_partial_credit_sales_order.sql", "utf8");
const catalogueRulesMigration = await readFile("supabase/migrations/20260819132042_accounts_catalogue_credit_rules.sql", "utf8");
const brandingSnapshotMigration = await readFile("supabase/migrations/20260819145020_business_document_branding_snapshots.sql", "utf8");
const newDocumentPage = await readFile("src/app/accounts/sales/new/page.tsx", "utf8");
const invoiceComposer = await readFile("src/components/accounts/invoice-composer.tsx", "utf8");
const creditNoteComposer = await readFile("src/components/accounts/credit-note-composer.tsx", "utf8");
const deliveryNoteComposer = await readFile("src/components/accounts/delivery-note-composer.tsx", "utf8");
const invoiceDetail = await readFile("src/app/accounts/sales/invoices/[id]/page.tsx", "utf8");
const composerCss = await readFile("src/components/accounts/accounts-composer.module.css", "utf8");
const finalDocumentsApi = await readFile("src/app/api/accounts/final-documents/route.ts", "utf8");
const renderRoute = await readFile("src/app/api/business-documents/render/route.ts", "utf8");
const renderer = await readFile("src/lib/server/business-document-render.ts", "utf8");
const queue = await readFile("src/lib/modules/accounts-queue.ts", "utf8");

for (const table of ["business_document_sequences", "credit_notes", "credit_note_lines", "delivery_notes", "delivery_note_lines"]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
}
assert.match(migration, /private\.next_business_document_number/);
assert.match(migration, /Credit Note quantity exceeds the uncredited Invoice quantity/);
assert.match(migration, /Delivery Note quantity exceeds the undelivered/);
assert.doesNotMatch(migration, /create table public\.business_documents\b/i);

assert.match(lifecycleMigration, /create_and_issue_invoice_command/);
assert.match(lifecycleMigration, /create_and_issue_credit_note_command/);
assert.match(lifecycleMigration, /business_document_notes/);
assert.match(lifecycleMigration, /Issued Invoices can only be cancelled by an issued Credit Note/);

assert.match(creditVatNumberingMigration, /source_line\.net_amount \* factor/);
assert.match(creditVatNumberingMigration, /source_line\.vat_amount \* factor/);
assert.match(creditVatNumberingMigration, /invoice_prefix = 'INV'/);
assert.match(creditVatNumberingMigration, /credit_note_prefix = 'CN'/);
assert.match(creditVatNumberingMigration, /delivery_note_prefix = 'DN'/);
assert.match(salesOrderMigration, /sales_order_reference/);
assert.match(salesOrderMigration, /snapshot_credit_note_sales_order/);

// New V1 discipline: catalogue-only Invoice lines, percentage discounts, and quantity-backed Credit Notes.
assert.match(catalogueRulesMigration, /Invoice lines must use a catalogue Product or Service/);
assert.match(catalogueRulesMigration, /product_record\.selling_price/);
assert.match(catalogueRulesMigration, /service_record\.price/);
assert.match(catalogueRulesMigration, /discountPercent/);
assert.match(catalogueRulesMigration, /gross_value \* discount_percent_value \/ 100/);
assert.match(catalogueRulesMigration, /Credit Notes cannot deduct an arbitrary amount/);
assert.match(catalogueRulesMigration, /write_credit_note_lines_by_quantity/);
assert.match(catalogueRulesMigration, /invoice\.total_amount as total_amount/);
assert.match(catalogueRulesMigration, /invoice\.outstanding_amount as balance_amount/);
assert.match(catalogueRulesMigration, /security_invoker = true/);

// Issued documents freeze the logo state that existed at issue time.
for (const table of ["invoices", "credit_notes", "delivery_notes"]) {
  assert.match(brandingSnapshotMigration, new RegExp(`alter table public\\.${table}[\\s\\S]*supplier_logo_path_snapshot`));
  assert.match(brandingSnapshotMigration, new RegExp(`alter table public\\.${table}[\\s\\S]*branding_snapshot_at`));
}
assert.match(brandingSnapshotMigration, /private\.current_custom_branding_logo_path/);
assert.match(brandingSnapshotMigration, /private\.snapshot_business_document_branding/);
assert.match(brandingSnapshotMigration, /historical_custom_branding_logo_path/);
assert.match(brandingSnapshotMigration, /admin\.custom_branding\.logo_updated/);
assert.match(brandingSnapshotMigration, /admin\.feature-override/);
assert.match(brandingSnapshotMigration, /invoices_snapshot_branding/);
assert.match(brandingSnapshotMigration, /credit_notes_snapshot_branding/);
assert.match(brandingSnapshotMigration, /delivery_notes_snapshot_branding/);

assert.match(finalDocumentsApi, /catalogueInvoiceLines/);
assert.match(finalDocumentsApi, /discountPercent/);
assert.match(finalDocumentsApi, /quantityCreditLines/);
assert.match(finalDocumentsApi, /Credit Notes cannot be created from an arbitrary monetary amount/);
assert.match(finalDocumentsApi, /from\("products"\)/);
assert.match(finalDocumentsApi, /from\("services"\)/);

// The redundant chooser is retired; accounting rules live with the dedicated composers.
assert.match(newDocumentPage, /redirect\("\/accounts\/sales"\)/);
assert.doesNotMatch(newDocumentPage, /\/accounts\/sales\/(?:invoices|credit-notes|delivery-notes)\/new/);
assert.match(invoiceComposer, /Catalogue price and VAT stay authoritative/);
assert.match(invoiceComposer, /Discount %/);
assert.match(invoiceComposer, /Sales Order reference is required/);
assert.doesNotMatch(invoiceComposer, /<option value="manual">Manual<\/option>/, "Normal Invoice creation must be catalogue-only.");
assert.doesNotMatch(invoiceComposer, /<label>Due date<\/label>/);
assert.match(creditNoteComposer, /Product \/ Service quantity reduction/);
assert.match(creditNoteComposer, /Full Invoice cancellation/);
assert.match(creditNoteComposer, /exact Invoice number/);
assert.match(creditNoteComposer, /Original Invoice/);
assert.match(creditNoteComposer, /Sales Order reference/);
assert.doesNotMatch(creditNoteComposer, /credit-invoice-options|<datalist/i, "Credit Note Invoice entry must not suggest Invoice numbers.");
assert.doesNotMatch(creditNoteComposer, /Amount to credit/, "Arbitrary money-first Credit Notes must not return.");
assert.match(deliveryNoteComposer, /Standalone Delivery Note/);
assert.match(invoiceDetail, /Original Invoice/);
assert.match(invoiceDetail, /Remaining balance/);
assert.match(invoiceDetail, /> View<\/a>/);
assert.match(invoiceDetail, /> Print<\/a>/);
assert.match(invoiceDetail, /> PDF<\/a>/);
assert.match(invoiceDetail, /> Email<\/a>/);
assert.match(invoiceDetail, /Append Note/);
assert.match(queue, /bdb-accounts-queue-v1/);
assert.match(composerCss, /\.formPanel/);
assert.match(composerCss, /var\(--gold\)/);

// An issued Invoice is a permanent document. Re-rendering cannot substitute live balances or branding.
assert.match(renderRoute, /totalAmount: num\(row\.total_amount\)/);
assert.doesNotMatch(renderRoute, /totalAmount: num\(row\.adjusted_total_amount/);
assert.doesNotMatch(renderRoute, /paidAmount: num\(row\.allocated_amount\)/);
assert.doesNotMatch(renderRoute, /balanceAmount: num\(row\.outstanding_amount\)/);
assert.match(renderRoute, /supplier_logo_path_snapshot/);
assert.match(renderRoute, /let logoPath = model\.draft \? null : logoSnapshotPath/);
assert.match(renderRoute, /Issued documents never fall back to live branding/);
assert.match(renderRoute, /if \(model\.draft\)/);
assert.match(renderRoute, /discountPercent/);
assert.match(renderRoute, /salesOrderReference/);
assert.match(renderer, /Discount/);
assert.match(renderer, /Credit subtotal/);
assert.match(renderer, /"Subtotal"/);
assert.doesNotMatch(renderer, /Subtotal after discount/);
assert.match(renderer, /Credit total/);
assert.doesNotMatch(renderer, /Balance due/);
assert.doesNotMatch(renderer, /Payment acknowledgement/);
assert.match(renderer, /Client signature/);
assert.match(renderer, /Powered by BDB/);
assert.match(renderer, /Print \/ Save as PDF/);
assert.doesNotMatch(renderer, /Payment instructions/i);

console.log("Business Documents preserve catalogue pricing, quantity-backed Credit Notes, immutable issued totals/branding and separate running balances.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260818150236_accounts_business_documents_v1.sql", "utf8");
const lifecycleMigration = await readFile("supabase/migrations/20260819110118_accounts_document_lifecycle_v1.sql", "utf8");
const creditVatNumberingMigration = await readFile("supabase/migrations/20260819110205_accounts_credit_vat_and_numbering.sql", "utf8");
const salesOrderMigration = await readFile("supabase/migrations/20260819122420_accounts_partial_credit_sales_order.sql", "utf8");
const catalogueRulesMigration = await readFile("supabase/migrations/20260819143000_accounts_catalogue_credit_rules.sql", "utf8");
const accounts = await readFile("src/app/accounts/page.tsx", "utf8");
const accountsCss = await readFile("src/app/accounts/accounts.module.css", "utf8");
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

assert.match(finalDocumentsApi, /catalogueInvoiceLines/);
assert.match(finalDocumentsApi, /discountPercent/);
assert.match(finalDocumentsApi, /quantityCreditLines/);
assert.match(finalDocumentsApi, /Credit Notes cannot be created from an arbitrary monetary amount/);
assert.match(finalDocumentsApi, /from\("products"\)/);
assert.match(finalDocumentsApi, /from\("services"\)/);

assert.match(accounts, /Catalogue price/);
assert.match(accounts, /Discount %/);
assert.match(accounts, /Product \/ Service quantity returned or cancelled/);
assert.match(accounts, /Full Invoice cancellation/);
assert.match(accounts, /exact Invoice number/);
assert.match(accounts, /Original total/);
assert.match(accounts, /<th>Credit Note<\/th>/);
assert.match(accounts, /Remaining balance/);
assert.match(accounts, /linkedCreditNotes/);
assert.match(accounts, /creditedTotal/);
assert.match(accounts, /useState<DocumentType>\("invoice"\)/);
assert.match(accounts, /\["invoice", "credit_note", "delivery_note"\]/);
assert.doesNotMatch(accounts, /\["all", "invoice", "credit_note", "delivery_note"\]/, "The mixed All register must not return.");
assert.match(accounts, /bundle\.creditNotes\.find\(\(note\) => note\.id === document\.id\)\?\.created_at/);
assert.match(accounts, /bundle\.deliveryNotes\.find\(\(note\) => note\.id === document\.id\)\?\.created_at/);
assert.match(accounts, /sort\(\(left, right\) => new Date\(createdAt\(right\)\)\.getTime\(\) - new Date\(createdAt\(left\)\)\.getTime\(\)\)/);
assert.match(accounts, /function documentActions/);
assert.match(accounts, /> View<\/Button>/);
assert.match(accounts, /> Print<\/Button>/);
assert.match(accounts, /> PDF<\/a>/);
assert.match(accounts, /> Notes<\/Button>/);
assert.match(accounts, /> Email<\/Button>/);
assert.doesNotMatch(accounts, /Issue legacy draft/, "Document registers must not expose lifecycle shortcuts.");
assert.doesNotMatch(accounts, />Credit<\/Button>/, "Invoice rows must not expose Credit shortcuts.");
assert.doesNotMatch(accounts, />Deliver<\/Button>/, "Invoice rows must not expose Delivery shortcuts.");
assert.doesNotMatch(accounts, />Payment<\/Button>/, "Invoice rows must not expose Payment shortcuts.");
assert.match(accounts, /Inherited from Invoice/);
assert.doesNotMatch(accounts, /credit-invoice-options|<datalist/i, "Credit Note Invoice entry must not suggest Invoice numbers.");
assert.doesNotMatch(accounts, /Amount to credit/, "Arbitrary money-first Credit Notes must not return.");
assert.doesNotMatch(accounts, /<option value="manual">Manual<\/option>/, "Normal Invoice creation must be catalogue-only.");
assert.doesNotMatch(accounts, /<label>Due date<\/label>/);
assert.doesNotMatch(accounts, /stat-grid/);
assert.match(queue, /bdb-accounts-queue-v1/);
assert.match(accountsCss, /\.documentComposer/);
assert.match(accountsCss, /background: #1a1a17/);

// An issued Invoice is a permanent document. Re-rendering cannot substitute live balance values.
assert.match(renderRoute, /totalAmount: num\(row\.total_amount\)/);
assert.doesNotMatch(renderRoute, /totalAmount: num\(row\.adjusted_total_amount/);
assert.doesNotMatch(renderRoute, /paidAmount: num\(row\.allocated_amount\)/);
assert.doesNotMatch(renderRoute, /balanceAmount: num\(row\.outstanding_amount\)/);
assert.match(renderRoute, /discountPercent/);
assert.match(renderRoute, /salesOrderReference/);
assert.match(renderer, /Discount/);
assert.match(renderer, /Subtotal after discount/);
assert.match(renderer, /Credit total/);
assert.doesNotMatch(renderer, /Balance due/);
assert.doesNotMatch(renderer, /Payment acknowledgement/);
assert.match(renderer, /Client signature/);
assert.match(renderer, /Powered by BDB/);
assert.match(renderer, /Print \/ Save as PDF/);
assert.doesNotMatch(renderer, /Payment instructions/i);

console.log("Business Documents preserve catalogue pricing, percentage discounts, quantity-backed Credit Notes, permanent issued Invoices and separate running balances.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const invoiceSchema = await readFile("supabase/release-sources/vanita-integration-20260813/20260729160500_accounts_invoice_schema.sql", "utf8");
const paymentSchema = await readFile("supabase/release-sources/vanita-integration-20260813/20260729161000_accounts_payment_allocation_schema.sql", "utf8");
const views = await readFile("supabase/release-sources/vanita-integration-20260813/20260729161500_accounts_balance_views_security.sql", "utf8");
const invoiceCommands = await readFile("supabase/release-sources/vanita-integration-20260813/20260729162000_accounts_invoice_commands.sql", "utf8");
const paymentCommands = await readFile("supabase/release-sources/vanita-integration-20260813/20260729162500_accounts_payment_commands.sql", "utf8");
const scalabilityMigration = await readFile("supabase/migrations/20260819221325_accounts_scalable_registers.sql", "utf8");
const invoiceCursorMigration = await readFile("supabase/migrations/20260819222047_accounts_invoice_register_cursor.sql", "utf8");
const api = await readFile("src/app/api/accounts/route.ts", "utf8");
const overviewApi = await readFile("src/app/api/accounts/overview/route.ts", "utf8");
const invoicesApi = await readFile("src/app/api/accounts/invoices/route.ts", "utf8");
const invoiceDetailApi = await readFile("src/app/api/accounts/invoices/[id]/route.ts", "utf8");
const paymentsApi = await readFile("src/app/api/accounts/payments/route.ts", "utf8");
const customersApi = await readFile("src/app/api/accounts/customers/route.ts", "utf8");
const creditNotesApi = await readFile("src/app/api/accounts/credit-notes/route.ts", "utf8");
const deliveryNotesApi = await readFile("src/app/api/accounts/delivery-notes/route.ts", "utf8");
const finalDocumentsApi = await readFile("src/app/api/accounts/final-documents/route.ts", "utf8");
const composerApi = await readFile("src/app/api/accounts/composer/route.ts", "utf8");
const overviewPage = await readFile("src/app/accounts/page.tsx", "utf8");
const operationsPage = await readFile("src/app/accounts/operations/page.tsx", "utf8");
const salesPage = await readFile("src/app/accounts/sales/page.tsx", "utf8");
const newDocumentPage = await readFile("src/app/accounts/sales/new/page.tsx", "utf8");
const invoiceRegister = await readFile("src/app/accounts/sales/invoices/page.tsx", "utf8");
const creditNoteRegister = await readFile("src/app/accounts/sales/credit-notes/page.tsx", "utf8");
const deliveryNoteRegister = await readFile("src/app/accounts/sales/delivery-notes/page.tsx", "utf8");
const paymentsPage = await readFile("src/app/accounts/payments/page.tsx", "utf8");
const invoiceDetail = await readFile("src/app/accounts/sales/invoices/[id]/page.tsx", "utf8");
const invoiceComposer = await readFile("src/components/accounts/invoice-composer.tsx", "utf8");
const creditNoteComposer = await readFile("src/components/accounts/credit-note-composer.tsx", "utf8");
const deliveryNoteComposer = await readFile("src/components/accounts/delivery-note-composer.tsx", "utf8");
const paymentComposer = await readFile("src/components/accounts/payment-composer.tsx", "utf8");
const documentIdentitySettings = await readFile("src/components/accounts/document-identity-settings.tsx", "utf8");
const commandRuntime = await readFile("src/components/accounts/accounts-command-runtime.ts", "utf8");
const queue = await readFile("src/lib/modules/accounts-queue.ts", "utf8");
const salesLayout = await readFile("src/app/sales/layout.tsx", "utf8");

assert.match(invoiceSchema, /alter table public\.invoices[\s\S]*source_sale_id/i);
assert.match(invoiceSchema, /create table public\.invoice_lines/i);
assert.match(invoiceSchema, /Issued Invoice lines are immutable/i);
assert.match(paymentSchema, /create table public\.payments/i);
assert.match(paymentSchema, /create table public\.payment_allocations/i);
assert.match(paymentSchema, /payment_allocations_enforce_immutability/i);
assert.match(paymentSchema, /Posted Payments are immutable/i);
assert.match(paymentSchema, /accounts_command_receipts/i);

assert.match(views, /create or replace view public\.invoice_account_balances/i);
assert.match(views, /create or replace view public\.customer_account_balances/i);
assert.match(views, /outstanding_amount/i);
assert.match(views, /unallocated_credit/i);
assert.match(views, /net_balance/i);
assert.match(views, /revoke all on public\.invoices from anon, authenticated/i);
assert.doesNotMatch(views, /grant (insert|update|delete)/i);

assert.match(invoiceCommands, /create or replace function public\.apply_invoice_command/i);
assert.match(invoiceCommands, /create_from_sale/i);
assert.match(invoiceCommands, /Only draft Invoices can be issued/i);
assert.match(invoiceCommands, /accounts_actor_can_write/i);
assert.match(paymentCommands, /create or replace function public\.record_payment/i);
assert.match(paymentCommands, /create or replace function public\.allocate_payment/i);
assert.match(paymentCommands, /Payment allocation exceeds the unallocated Payment amount/i);
assert.match(paymentCommands, /Payment and Invoice must belong to the same Customer/i);
assert.match(paymentCommands, /grant execute[\s\S]*to service_role/i);

assert.match(api, /invoice_account_balances/i);
assert.match(api, /customer_account_balances/i);
assert.match(api, /apply_invoice_command/i);
assert.match(api, /record_payment/i);
assert.match(api, /allocate_payment/i);
assert.match(api, /ACCOUNTS_STATE_CONFLICT/i);
assert.match(finalDocumentsApi, /catalogueInvoiceLines/);
assert.match(finalDocumentsApi, /quantityCreditLines/);

// Write-side financial commands remain unchanged and offline-first during the workspace split.
assert.match(queue, /bdb-accounts-queue-v1/i);
assert.match(queue, /for \(const command of readAccountsQueue/i);
assert.match(queue, /break;/i);
assert.match(commandRuntime, /enqueueAccountsCommand/i);
assert.match(commandRuntime, /flushAccountsQueue/i);
assert.match(commandRuntime, /Accounts synchronisation stopped for review/i);
assert.match(operationsPage, /redirect\("\/accounts"\)/i);
assert.doesNotMatch(operationsPage, /enqueueAccountsCommand|invoice_account_balances/i);
assert.match(salesLayout, /Invoices & Payments/i);

// Dedicated composers remain direct; the redundant Sales chooser is retired safely.
assert.match(newDocumentPage, /redirect\("\/accounts\/sales"\)/);
assert.doesNotMatch(newDocumentPage, /\/accounts\/sales\/(?:invoices|credit-notes|delivery-notes)\/new/);
assert.doesNotMatch(salesPage, /href="\/accounts\/sales\/new"/);
assert.doesNotMatch(salesPage, /Create a document|New document/);
assert.match(overviewPage, /href="\/accounts\/sales\/invoices\/new"/);
assert.doesNotMatch(overviewPage, /href="\/accounts\/sales\/new"/);
assert.match(invoiceComposer, /invoice-create-manual/);
assert.match(invoiceComposer, /Catalogue price and VAT stay authoritative/);
assert.match(invoiceComposer, /Discount %/);
assert.match(creditNoteComposer, /credit-note-create/);
assert.match(creditNoteComposer, /No standalone Credit Note/);
assert.match(creditNoteComposer, /never from an arbitrary money amount/);
assert.match(deliveryNoteComposer, /delivery-note-create/);
assert.match(deliveryNoteComposer, /Standalone Delivery Note/);
assert.match(paymentComposer, /payment-record/);
assert.match(paymentComposer, /initially remain unallocated/);
assert.match(documentIdentitySettings, /\/api\/workspace\/document-identity/);
assert.match(documentIdentitySettings, /Existing issued documents remain unchanged/);
assert.match(composerApi, /requireWorkspaceCommand/);
assert.match(composerApi, /resource === "credit-invoice"/);
assert.match(composerApi, /\.limit\(25\)/);

for (const userFacingPage of [overviewPage, salesPage, newDocumentPage, invoiceRegister, creditNoteRegister, deliveryNoteRegister, paymentsPage, invoiceDetail]) {
  assert.doesNotMatch(userFacingPage, /\/accounts\/operations/, "Normal Accounts navigation must never expose the retired workbench.");
}

// Accounts now has a scalable read shell instead of one browser-loaded financial bundle.
assert.match(overviewPage, /Financial control without the clutter/);
assert.match(overviewPage, /\/accounts\/sales\/invoices/);
assert.match(overviewPage, /\/accounts\/payments/);
assert.match(overviewPage, /\/accounts\/customers/);
assert.doesNotMatch(overviewPage, /invoice_account_balances/);
assert.match(overviewApi, /accounts_workspace_summary/);
assert.match(overviewApi, /\.limit\(8\)/);

for (const boundedApi of [invoicesApi, paymentsApi, creditNotesApi, deliveryNotesApi]) {
  assert.match(boundedApi, /pageSize/);
  assert.match(boundedApi, /\.limit\(limit \+ 1\)/);
  assert.match(boundedApi, /nextCursor/);
}
assert.match(invoicesApi, /\.order\("created_at"/);
assert.match(invoicesApi, /createdAt/);
assert.match(invoicesApi, /customer_name_snapshot\.ilike/);
assert.match(paymentsApi, /\.order\("received_at"/);
assert.match(paymentsApi, /dateFrom/);
assert.match(paymentsApi, /dateTo/);
assert.match(customersApi, /\.range\(from, to\)/);
assert.match(customersApi, /workspace_settings/);
assert.match(invoiceRegister, /50/);
assert.match(invoiceRegister, /nextCursor/);
assert.match(invoiceDetailApi, /invoice_lines\(\*\)/);
assert.match(invoiceDetailApi, /payment_allocations/);
assert.match(invoiceDetailApi, /credit_notes/);
assert.match(invoiceDetailApi, /delivery_notes/);
assert.match(invoiceDetail, /Original Invoice/);
assert.match(invoiceDetail, /Remaining balance/);
assert.match(invoiceDetail, /document-note-add/);
assert.match(invoiceDetail, /credit-notes\/new\?invoiceId=/);

assert.match(scalabilityMigration, /create extension if not exists pg_trgm/);
assert.match(scalabilityMigration, /invoices_workspace_issued_cursor_idx/);
assert.match(scalabilityMigration, /payments_workspace_received_cursor_idx/);
assert.match(scalabilityMigration, /gin_trgm_ops/);
assert.match(scalabilityMigration, /create or replace view public\.accounts_workspace_summary/);
assert.match(scalabilityMigration, /security_invoker = true/);
assert.match(scalabilityMigration, /revoke all on public\.accounts_workspace_summary from anon/);
assert.match(invoiceCursorMigration, /invoices_workspace_created_cursor_idx/);
assert.match(invoiceCursorMigration, /workspace_id, created_at desc, id desc/);

console.log("Accounts preserves immutable financial commands while high-volume reads use bounded registers, dedicated detail loading and indexed database search.");

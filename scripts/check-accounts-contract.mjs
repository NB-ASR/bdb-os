import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const invoiceSchema = await readFile("supabase/release-sources/vanita-integration-20260813/20260729160500_accounts_invoice_schema.sql", "utf8");
const paymentSchema = await readFile("supabase/release-sources/vanita-integration-20260813/20260729161000_accounts_payment_allocation_schema.sql", "utf8");
const views = await readFile("supabase/release-sources/vanita-integration-20260813/20260729161500_accounts_balance_views_security.sql", "utf8");
const invoiceCommands = await readFile("supabase/release-sources/vanita-integration-20260813/20260729162000_accounts_invoice_commands.sql", "utf8");
const paymentCommands = await readFile("supabase/release-sources/vanita-integration-20260813/20260729162500_accounts_payment_commands.sql", "utf8");
const api = await readFile("src/app/api/accounts/route.ts", "utf8");
const finalDocumentsApi = await readFile("src/app/api/accounts/final-documents/route.ts", "utf8");
const page = await readFile("src/app/accounts/page.tsx", "utf8");
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

assert.match(queue, /bdb-accounts-queue-v1/i);
assert.match(queue, /for \(const command of readAccountsQueue/i);
assert.match(queue, /break;/i);
assert.match(page, /enqueueAccountsCommand/i);
assert.match(page, /Running balance = issued Invoices minus Credit Notes and Payments/);
assert.match(page, /unallocated_credit/i);
assert.match(page, /Original total/);
assert.match(page, /Credits/);
assert.match(page, /Balance/);
assert.doesNotMatch(page, /reconcile|bank transaction/i, "The simplified Accounts surface must not imply Banking reconciliation.");
assert.doesNotMatch(page, /markInvoicePaid|Approve paid/i);
assert.match(salesLayout, /Invoices & Payments/i);

console.log("Accounts keeps immutable issued documents, separate Payments/Credits and derived customer balances under the catalogue-only workflow.");

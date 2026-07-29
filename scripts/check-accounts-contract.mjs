import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const invoiceSchema = await readFile("supabase/migrations/20260729160500_accounts_invoice_schema.sql", "utf8");
const paymentSchema = await readFile("supabase/migrations/20260729161000_accounts_payment_allocation_schema.sql", "utf8");
const views = await readFile("supabase/migrations/20260729161500_accounts_balance_views_security.sql", "utf8");
const invoiceCommands = await readFile("supabase/migrations/20260729162000_accounts_invoice_commands.sql", "utf8");
const paymentCommands = await readFile("supabase/migrations/20260729162500_accounts_payment_commands.sql", "utf8");
const api = await readFile("src/app/api/accounts/route.ts", "utf8");
const page = await readFile("src/app/accounts/page.tsx", "utf8");
const queue = await readFile("src/lib/modules/accounts-queue.ts", "utf8");
const salesLayout = await readFile("src/app/sales/layout.tsx", "utf8");

assert.match(invoiceSchema, /alter table public\.invoices[\s\S]*source_sale_id/i, "Existing Invoices must be upgraded in place.");
assert.match(invoiceSchema, /create table public\.invoice_lines/i, "Invoice line ledger is missing.");
assert.match(invoiceSchema, /invoices_workspace_active_sale_idx/i, "A completed Sale must have at most one active Invoice.");
assert.match(invoiceSchema, /Issued Invoice lines are immutable/i, "Issued Invoice lines must be immutable.");
assert.match(invoiceSchema, /references public\.sales\(workspace_id, id\)/i, "Invoices must reference canonical Sales.");
assert.match(invoiceSchema, /references public\.customers\(workspace_id, id\)/i, "Invoices must reference canonical Customers.");

assert.match(paymentSchema, /create table public\.payments/i, "Payment ledger is missing.");
assert.match(paymentSchema, /create table public\.payment_allocations/i, "Payment allocation ledger is missing.");
assert.match(paymentSchema, /amount_delta numeric/i, "Allocations must use signed immutable deltas.");
assert.match(paymentSchema, /payment_allocations_enforce_immutability/i, "Allocations must be append-only.");
assert.match(paymentSchema, /Posted Payments are immutable/i, "Posted Payments must be immutable.");
assert.match(paymentSchema, /reversal_of_id/i, "Allocation corrections must preserve reversal links.");
assert.match(paymentSchema, /accounts_command_receipts/i, "Finance commands must be idempotent.");

assert.match(views, /create or replace view public\.invoice_account_balances/i, "Invoice balances must be derived.");
assert.match(views, /create or replace view public\.payment_account_balances/i, "Payment balances must be derived.");
assert.match(views, /create or replace view public\.customer_account_balances/i, "Customer balances must be derived.");
assert.match(views, /create or replace view public\.sale_account_status/i, "Sales need a derived Accounts status.");
assert.match(views, /outstanding_amount/i, "Outstanding Invoice balance is missing.");
assert.match(views, /unallocated_credit/i, "Unallocated customer credit is missing.");
assert.match(views, /net_balance/i, "Customer net balance is missing.");
assert.match(views, /revoke all on public\.invoices from anon, authenticated/i, "Direct Invoice browser writes must be revoked.");
assert.match(views, /grant select on public\.payments to authenticated/i, "Authenticated Accounts reads must remain RLS-scoped.");
assert.doesNotMatch(views, /grant (insert|update|delete)/i, "Browser finance mutations must never be granted.");

assert.match(invoiceCommands, /create or replace function public\.apply_invoice_command/i, "Trusted Invoice command is missing.");
assert.match(invoiceCommands, /create_from_sale/i, "Explicit Sale-to-Invoice conversion is missing.");
assert.match(invoiceCommands, /Only draft Invoices can be issued/i, "Invoice issue transition is missing.");
assert.match(invoiceCommands, /Reverse Invoice Payment allocations before voiding/i, "Invoice void must protect active allocations.");
assert.match(invoiceCommands, /accounts_actor_can_write/i, "Invoice commands must use Accounts permissions.");
assert.match(invoiceCommands, /activity_items/i, "Invoice commands must write Activity history.");
assert.doesNotMatch(invoiceCommands, /insert into public\.bank_transactions/i, "Invoice commands must not create Banking activity.");

assert.match(paymentCommands, /create or replace function public\.record_payment/i, "Trusted Payment recording is missing.");
assert.match(paymentCommands, /create or replace function public\.allocate_payment/i, "Trusted Payment allocation is missing.");
assert.match(paymentCommands, /create or replace function public\.reverse_payment_allocation/i, "Allocation reversal is missing.");
assert.match(paymentCommands, /create or replace function public\.reverse_payment/i, "Payment reversal is missing.");
assert.match(paymentCommands, /Payment allocation exceeds the unallocated Payment amount/i, "Over-allocation protection is missing.");
assert.match(paymentCommands, /Payment and Invoice must belong to the same Customer/i, "Cross-customer allocation protection is missing.");
assert.match(paymentCommands, /Payment and Invoice currencies must match/i, "Cross-currency allocation protection is missing.");
assert.match(paymentCommands, /Reverse Payment allocations before reversing the Payment/i, "Payment reversal must protect allocations.");
assert.doesNotMatch(paymentCommands, /insert into public\.bank_transactions/i, "Payment recording must not imply Banking reconciliation.");
assert.match(paymentCommands, /grant execute[\s\S]*to service_role/i, "Finance commands must remain service-role-only.");

assert.match(api, /invoice_account_balances/i, "Accounts API must expose derived Invoice balances.");
assert.match(api, /customer_account_balances/i, "Accounts API must expose derived Customer balances.");
assert.match(api, /apply_invoice_command/i, "Accounts API must call the trusted Invoice command.");
assert.match(api, /record_payment/i, "Accounts API must call the trusted Payment command.");
assert.match(api, /allocate_payment/i, "Accounts API must call the trusted allocation command.");
assert.match(api, /ACCOUNTS_STATE_CONFLICT/i, "Finance conflicts need an operational error.");

assert.match(queue, /bdb-accounts-queue-v1/i, "Accounts queue must be workspace-scoped.");
assert.match(queue, /for \(const command of readAccountsQueue/i, "Accounts queue must replay sequentially.");
assert.match(queue, /break;/i, "Accounts synchronisation must stop on the first failure.");
assert.match(page, /enqueueAccountsCommand/i, "Accounts UI must use the offline command queue.");
assert.match(page, /Unallocated credit/i, "Accounts UI must expose customer credit.");
assert.match(page, /Recording a Payment does not create or match a bank transaction/i, "Accounts UI must preserve the Banking boundary.");
assert.doesNotMatch(page, /markInvoicePaid|Approve paid/i, "The legacy mark-paid shortcut must not return.");
assert.match(salesLayout, /Invoices & Payments/i, "Accounts must be discoverable from Sales.");

console.log("Accounts, Invoice, Payment and balance contracts are intact.");

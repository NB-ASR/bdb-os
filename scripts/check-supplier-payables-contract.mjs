import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("supabase/release-sources/vanita-integration-20260813/20260731110000_supplier_payables_schema.sql", "utf8");
const views = await readFile("supabase/release-sources/vanita-integration-20260813/20260731110500_supplier_payables_views_security.sql", "utf8");
const posting = await readFile("supabase/release-sources/vanita-integration-20260813/20260731111000_supplier_payables_posting_commands.sql", "utf8");
const settlement = await readFile("supabase/release-sources/vanita-integration-20260813/20260731111500_supplier_payables_settlement_commands.sql", "utf8");
const readBoundary = await readFile("supabase/release-sources/vanita-integration-20260813/20260731112000_supplier_payables_cross_department_read.sql", "utf8");
const api = await readFile("src/app/api/supplier-payables/route.ts", "utf8");
const registers = await readFile("src/lib/server/supplier-payables-registers.ts", "utf8");
const page = await readFile("src/app/accounts/payables/page.tsx", "utf8");
const queue = await readFile("src/lib/modules/supplier-payables-queue.ts", "utf8");
const purchasingStatus = await readFile("src/app/documents/purchasing/purchasing-accounts-status.tsx", "utf8");

for (const table of [
  "supplier_payables",
  "supplier_payments",
  "supplier_payment_allocations",
  "supplier_credit_allocations",
  "supplier_accounts_command_receipts",
]) {
  assert.match(schema, new RegExp(`create table public\\.${table}`), `${table} is missing.`);
}

assert.match(schema, /supplier_payables_active_document_idx/i, "One approved source document may have only one active payable posting.");
assert.match(schema, /Posted Supplier payables are immutable/i, "Supplier payable postings must be immutable.");
assert.match(schema, /Posted Supplier Payments are immutable/i, "Supplier Payments must be immutable.");
assert.match(schema, /Supplier settlement allocations are append-only/i, "Supplier allocations must be append-only.");
assert.match(schema, /accounts_posting_status in \('not_available', 'ready', 'posted', 'reversed'\)/i, "Purchasing must expose the AP posting lifecycle.");
assert.match(schema, /supplier_documents_prepare_accounts_status/i, "Approved source documents must become ready for AP posting.");

assert.match(views, /create or replace view public\.supplier_payable_balances/i, "Supplier payable balances must be derived.");
assert.match(views, /create or replace view public\.supplier_payment_balances/i, "Supplier Payment balances must be derived.");
assert.match(views, /create or replace view public\.supplier_account_balances/i, "Supplier account balances must be derived.");
assert.match(views, /unallocated_credit/i, "Supplier credit notes must retain unallocated credit.");
assert.match(views, /net_balance/i, "Supplier net balance is missing.");
assert.doesNotMatch(views, /grant (insert|update|delete)/i, "Browser AP writes must never be granted.");
assert.match(readBoundary, /Supplier documents Accounts read/i, "Accounts must be able to read approved Purchasing source documents.");
assert.match(readBoundary, /Suppliers Accounts read/i, "Accounts must be able to read Supplier identities.");

assert.match(posting, /create or replace function public\.post_supplier_document_payable/i, "Trusted Supplier-document posting is missing.");
assert.match(posting, /create or replace function public\.reverse_supplier_payable/i, "Supplier payable reversal is missing.");
assert.match(posting, /Only approved Supplier documents can be posted/i, "Only approved Purchasing documents may enter AP.");
assert.match(posting, /Reverse Supplier allocations before reversing the payable posting/i, "Payable reversal must protect allocation history.");
assert.doesNotMatch(posting, /insert into public\.bank_transactions/i, "Posting a payable must not create Banking activity.");
assert.doesNotMatch(posting, /insert into public\.inventory_movements/i, "Posting a payable must not create Inventory activity.");

assert.match(settlement, /create or replace function public\.record_supplier_payment/i, "Supplier Payment recording is missing.");
assert.match(settlement, /create or replace function public\.allocate_supplier_payment/i, "Supplier Payment allocation is missing.");
assert.match(settlement, /create or replace function public\.reverse_supplier_payment_allocation/i, "Supplier Payment allocation reversal is missing.");
assert.match(settlement, /create or replace function public\.allocate_supplier_credit/i, "Supplier credit allocation is missing.");
assert.match(settlement, /create or replace function public\.reverse_supplier_credit_allocation/i, "Supplier credit allocation reversal is missing.");
assert.match(settlement, /same Supplier/i, "Cross-Supplier allocations must be rejected.");
assert.match(settlement, /currencies must match/i, "Cross-currency allocations must be rejected.");
assert.match(settlement, /exceeds the unallocated Payment amount/i, "Supplier Payment over-allocation protection is missing.");
assert.doesNotMatch(settlement, /insert into public\.bank_transactions/i, "Supplier Payment recording must not imply Banking reconciliation.");
assert.match(settlement, /grant execute[\s\S]*to service_role/i, "Supplier finance commands must remain service-role-only.");

assert.match(api, /readSupplierPayablesView/i, "Supplier Payables API must delegate reads to the bounded register layer.");
assert.match(registers, /supplier_payable_balances/i, "Supplier Payables register layer must expose derived payable balances.");
assert.match(registers, /supplier_account_balances/i, "Supplier Payables register layer must expose derived Supplier balances.");
assert.match(registers, /limit\(limit \+ 1\)/i, "Supplier financial registers must remain bounded.");
assert.match(registers, /nextCursor/i, "Supplier financial registers must expose keyset cursor progress.");
assert.match(api, /post_supplier_document_payable/i, "Supplier Payables API must use the trusted posting command.");
assert.match(api, /record_supplier_payment/i, "Supplier Payables API must use the trusted Payment command.");
assert.match(api, /SUPPLIER_PAYABLES_STATE_CONFLICT/i, "Supplier finance conflicts need an operational response.");

assert.match(queue, /bdb-supplier-payables-queue-v1/i, "Supplier Payables queue must be workspace-scoped.");
assert.match(queue, /for \(const command of queue\)/i, "Supplier Payables queue must replay sequentially.");
assert.match(queue, /throw new Error\(message\)/i, "Supplier Payables queue must stop on the first failure.");
assert.match(queue, /canDiscardSupplierPayablesCommand/i, "Ambiguous Supplier financial outcomes must not be discardable.");
assert.match(page, /enqueueSupplierPayablesCommand/i, "Supplier Payables UI must use the offline queue.");
assert.match(page, /Banking remains separate/i, "Supplier Payables UI must preserve the Banking boundary.");
assert.match(page, /Supplier balances by currency/i, "Supplier balances must not mix currencies.");
assert.match(purchasingStatus, /Post to Accounts/i, "Purchasing must expose explicit AP posting.");

console.log("Supplier Payables contracts are intact.");

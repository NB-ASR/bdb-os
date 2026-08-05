import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [
  schema,
  security,
  commands,
  api,
  importApi,
  csv,
  queue,
  page,
] = await Promise.all([
  read("supabase/migrations/20260731120000_banking_reconciliation_schema.sql"),
  read("supabase/migrations/20260731120500_banking_reconciliation_views_security.sql"),
  read("supabase/migrations/20260731121000_banking_reconciliation_commands.sql"),
  read("src/app/api/banking/route.ts"),
  read("src/app/api/banking/import/route.ts"),
  read("src/lib/modules/banking-csv.ts"),
  read("src/lib/modules/banking-queue.ts"),
  read("src/app/banking/page.tsx"),
]);

for (const table of [
  "bank_accounts",
  "bank_statement_imports",
  "bank_reconciliation_allocations",
  "banking_command_receipts",
]) {
  assert.match(schema, new RegExp(`create table public\\.${table}\\b`, "i"), `${table} must exist.`);
}

assert.match(schema, /alter table public\.bank_transactions/i, "The existing Bank transaction catalogue must be upgraded in place.");
assert.doesNotMatch(schema, /create table public\.bank_transactions/i, "A parallel Bank transaction catalogue must not be created.");
assert.match(schema, /unique \(workspace_id, bank_account_id, source_file_hash\)/i, "Duplicate statement files must be rejected per account.");
assert.match(schema, /bank_transactions_fingerprint_unique_idx/i, "Imported Bank transaction fingerprints must be unique per account.");
assert.match(schema, /Bank reconciliation allocations are append-only/i, "Reconciliation evidence must be append-only.");
assert.match(schema, /Imported Bank transactions are immutable/i, "Imported Bank transactions must be immutable.");

for (const view of [
  "bank_transaction_reconciliation_balances",
  "customer_payment_reconciliation_balances",
  "supplier_payment_reconciliation_balances",
  "bank_account_reconciliation_summaries",
]) {
  assert.match(security, new RegExp(`view public\\.${view}\\b`, "i"), `${view} must exist.`);
}

assert.match(security, /drop policy if exists "Banking permission insert"/i, "Legacy browser Bank transaction inserts must be removed.");
assert.match(security, /revoke all on public\.bank_transactions from anon, authenticated/i, "Browser Bank transaction writes must be revoked.");
assert.match(security, /Payments Accounts or Banking read/i, "Banking must receive RLS-scoped Customer Payment reads.");
assert.match(security, /Supplier Payments Accounts or Banking read/i, "Banking must receive RLS-scoped Supplier Payment reads.");
assert.match(security, /Reverse Bank reconciliation allocations before reversing the Payment/i, "Payments must not reverse while Bank reconciliation remains active.");

for (const command of [
  "create_bank_account",
  "update_bank_account",
  "archive_bank_account",
  "import_bank_statement",
  "reconcile_bank_transaction",
  "reverse_bank_reconciliation",
  "reverse_bank_transaction",
]) {
  assert.match(commands, new RegExp(`function public\\.${command}\\b`, "i"), `${command} must exist.`);
  assert.match(commands, new RegExp(`grant execute on function public\\.${command}`, "i"), `${command} must remain service-role-only.`);
}

assert.match(commands, /Money received can only reconcile to a Customer Payment/i, "Credits must reconcile only to Customer Payments.");
assert.match(commands, /Money sent can only reconcile to a Supplier Payment/i, "Debits must reconcile only to Supplier Payments.");
assert.match(commands, /Bank transaction and Customer Payment currencies must match/i, "Customer Payment currency must be enforced.");
assert.match(commands, /Bank transaction and Supplier Payment currencies must match/i, "Supplier Payment currency must be enforced.");
assert.match(commands, /exceeds the unmatched Bank transaction amount/i, "Bank transaction over-reconciliation must be rejected.");
assert.match(commands, /exceeds the unreconciled Payment amount/i, "Payment over-reconciliation must be rejected.");
assert.doesNotMatch(commands, /update public\.invoices/i, "Banking commands must not mutate Customer Invoices.");
assert.doesNotMatch(commands, /update public\.supplier_payables/i, "Banking commands must not mutate Supplier payables.");
assert.doesNotMatch(commands, /insert into public\.payments/i, "Banking must not silently create Customer Payments.");
assert.doesNotMatch(commands, /insert into public\.supplier_payments/i, "Banking must not silently create Supplier Payments.");

assert.match(api, /from\("customer_payment_reconciliation_balances"\)/, "The Banking API must expose Customer Payment reconciliation candidates.");
assert.match(api, /from\("supplier_payment_reconciliation_balances"\)/, "The Banking API must expose Supplier Payment reconciliation candidates.");
assert.match(api, /reconcile_bank_transaction/, "The Banking API must use the trusted reconciliation command.");
assert.match(importApi, /parseBankStatementCsv/, "The import API must parse CSV server-side.");
assert.match(importApi, /hashBankStatementFile/, "The import API must hash statement files.");
assert.match(importApi, /import_bank_statement/, "The import API must use the trusted import command.");
assert.match(importApi, /2 MB/i, "The V1 import size boundary must be explicit.");

assert.match(csv, /5,000 transactions/i, "The V1 CSV row limit must be enforced.");
assert.match(csv, /createHash\("sha256"\)/, "Statement files and rows must use SHA-256 identities.");
assert.match(csv, /occurrence/, "Repeated identical rows must receive occurrence-aware fingerprints.");
assert.match(queue, /for \(const command of queue\)[\s\S]*catch \(error\)[\s\S]*throw new Error\(message\)/, "The Banking queue must stop on the first command failure.");
assert.match(queue, /Idempotency-Key/, "Queued Banking commands must retain stable idempotency identities.");

assert.match(page, /Banking verifies Payments; it does not settle Invoices directly/i, "The Banking UI must state the settlement boundary.");
assert.match(page, /Customer Payment/i, "The Banking UI must reconcile incoming cash to Customer Payments.");
assert.match(page, /Supplier Payment/i, "The Banking UI must reconcile outgoing cash to Supplier Payments.");
assert.doesNotMatch(page, /reconcileTransaction/, "The legacy local direct-Invoice reconciliation path must not return.");
assert.doesNotMatch(page, /markInvoicePaid/, "Banking must not mark an Invoice paid directly.");

console.log("Banking reconciliation architecture contract passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Accounts working cache is bounded and workspace-scoped", async () => {
  const cache = await source("src/lib/modules/accounts-working-cache.ts");
  assert.match(cache, /bdb-accounts-working-cache-v1/);
  assert.match(cache, /CUSTOMER_LIMIT = 100/);
  assert.match(cache, /CATALOGUE_LIMIT = 150/);
  assert.match(cache, /PAYMENT_DETAIL_LIMIT = 20/);
  assert.match(cache, /workspaceId: string/);
});

test("Accounts runtime can reopen from cached workspace context and keeps offline commands pending", async () => {
  const runtime = await source("src/components/accounts/accounts-command-runtime.ts");
  assert.match(runtime, /readAccountsWorkspaceContext/);
  assert.match(runtime, /Offline working context loaded/);
  assert.match(runtime, /Saved as Pending sync\. It will be revalidated and applied safely after reconnection\./);
});

test("Customer and catalogue working sets fall back locally", async () => {
  const [picker, invoice] = await Promise.all([
    source("src/components/accounts/customer-picker.tsx"),
    source("src/components/accounts/invoice-composer.tsx"),
  ]);
  assert.match(picker, /searchAccountsCustomers/);
  assert.match(picker, /cacheAccountsCustomers/);
  assert.match(invoice, /searchAccountsCatalogue/);
  assert.match(invoice, /cacheAccountsCatalogue/);
  assert.match(invoice, /readAccountsSettings/);
  assert.match(invoice, /cacheAccountsSettings/);
});

test("offline Invoice commands capture seen price and VAT and server revalidates them", async () => {
  const [invoice, route] = await Promise.all([
    source("src/components/accounts/invoice-composer.tsx"),
    source("src/app/api/accounts/final-documents/route.ts"),
  ]);
  assert.match(invoice, /catalogueUnitPrice: Number\(line\.item\.unitPrice\)/);
  assert.match(invoice, /catalogueVatRate: Number\(line\.item\.vatRate\)/);
  assert.match(route, /catalogueUnitPrice: numberValue/);
  assert.match(route, /catalogueVatRate: numberValue/);
  assert.match(route, /ACCOUNTS_CATALOGUE_REVIEW_REQUIRED/);
  assert.match(route, /Review the Invoice against the current catalogue before issuing/);
});

test("pre-hardening queued Invoices without captured catalogue values stop for review", async () => {
  const route = await source("src/app/api/accounts/final-documents/route.ts");
  assert.match(route, /raw\.catalogueUnitPrice === undefined/);
  assert.match(route, /raw\.catalogueVatRate === undefined/);
  assert.match(route, /does not contain a verified catalogue snapshot/);
  assert.match(route, /ACCOUNTS_CATALOGUE_REVIEW_REQUIRED/);
});

test("ambiguous financial command outcomes cannot be discarded as confirmed rejections", async () => {
  const [queue, overview] = await Promise.all([
    source("src/lib/modules/accounts-queue.ts"),
    source("src/app/accounts/page.tsx"),
  ]);
  assert.match(queue, /"confirmed_rejection" \| "ambiguous"/);
  assert.match(queue, /failureKind = "ambiguous"/);
  assert.match(queue, /confirmedServerRejection\(response\.status\)/);
  assert.match(queue, /command\.failureKind === "confirmed_rejection"/);
  assert.match(overview, /canDiscardAccountsCommand\(command\)/);
  assert.match(overview, /Retry required/);
  assert.match(overview, /idempotent retry/);
});

test("Invoice composer uses plain Subtotal wording without changing the calculation", async () => {
  const invoice = await source("src/components/accounts/invoice-composer.tsx");
  assert.match(invoice, /<span>Subtotal<\/span><strong>\{formatMoney\(totals\.netAmount, currency\)\}/);
  assert.doesNotMatch(invoice, /Subtotal after discounts/);
});

test("Payment lifecycle has a detail workspace backed by existing command actions", async () => {
  const [register, detailRoute, detailPage] = await Promise.all([
    source("src/app/accounts/payments/page.tsx"),
    source("src/app/api/accounts/payments/[id]/route.ts"),
    source("src/app/accounts/payments/[id]/page.tsx"),
  ]);
  assert.match(register, /\/accounts\/payments\/\$\{payment\.id\}/);
  assert.match(detailRoute, /payment_account_balances/);
  assert.match(detailRoute, /payment_allocations/);
  assert.match(detailRoute, /eligibleInvoices/);
  assert.match(detailPage, /runtime\.dispatch\("payment-allocate"/);
  assert.match(detailPage, /runtime\.dispatch\("allocation-reverse"/);
  assert.match(detailPage, /runtime\.dispatch\("payment-reverse"/);
});

test("service worker caches Accounts route shells but never financial API responses", async () => {
  const worker = await source("public/sw.js");
  assert.match(worker, /request\.mode !== "navigate"/);
  assert.match(worker, /url\.pathname === "\/accounts" \|\| url\.pathname\.startsWith\("\/accounts\/"\)/);
  assert.match(worker, /ACCOUNTS_SHELL_CACHE/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*\/api\//);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Supplier financial queue preserves ambiguous outcomes for idempotent retry", async () => {
  const [queue, page] = await Promise.all([
    source("src/lib/modules/supplier-payables-queue.ts"),
    source("src/app/accounts/payables/page.tsx"),
  ]);

  assert.match(queue, /"confirmed_rejection" \| "ambiguous"/);
  assert.match(queue, /confirmedServerRejection\(response\.status\)/);
  assert.match(queue, /failureKind = "ambiguous"/);
  assert.match(queue, /command\.failureKind === "confirmed_rejection"/);
  assert.match(queue, /if \(!force && !canDiscardSupplierPayablesCommand\(command\)\) return false/);
  assert.match(queue, /removeSupplierPayablesCommand\(workspaceId, command\.id, true\)/);
  assert.match(page, /canDiscardSupplierPayablesCommand\(item\)/);
  assert.match(page, /Retry required · outcome not safe to discard/);
});

test("Supplier financial route binds idempotency keys to canonical command input", async () => {
  const route = await source("src/app/api/supplier-payables/route.ts");

  assert.match(route, /import \{ hashJson \} from "@\/lib\/server\/workspace-snapshot"/);
  assert.match(route, /admin\.rpc\("claim_accounts_command"/);
  assert.match(route, /p_idempotency_key: context\.idempotencyKey/);
  assert.match(route, /p_request_hash: hashJson\(\{ workspaceId, action, body \}\)/);
  assert.match(route, /if \(claim\.error\) throw friendlyError\(claim\.error\)/);
});

test("Supplier Payables registers are bounded and use keyset cursors for financial history", async () => {
  const registers = await source("src/lib/server/supplier-payables-registers.ts");

  assert.match(registers, /Math\.min\(Math\.max\(parsed, 25\), maximum\)/);
  assert.match(registers, /\.limit\(limit \+ 1\)/);
  assert.match(registers, /encodeCursor/);
  assert.match(registers, /decodeCursor/);
  assert.match(registers, /approved_at\.lt/);
  assert.match(registers, /posted_at\.lt/);
  assert.match(registers, /paid_at\.lt/);
  assert.match(registers, /occurred_at\.lt/);
  assert.match(registers, /get_supplier_accounts_summary/);
});

test("Supplier Accounts summary crosses the service-role boundary only after workspace authorisation", async () => {
  const [route, registers] = await Promise.all([
    source("src/app/api/supplier-payables/route.ts"),
    source("src/lib/server/supplier-payables-registers.ts"),
  ]);

  const membershipCheck = route.indexOf("await requireWorkspaceCommand(request, workspaceId)");
  const privilegedSummaryClient = route.indexOf("readSupplierPayablesView(supabase, workspaceId, url, adminClient())");
  assert.ok(membershipCheck >= 0 && privilegedSummaryClient > membershipCheck);
  assert.match(registers, /summaryClient\.rpc\("get_supplier_accounts_summary"/);
  assert.match(registers, /supplierMapForDocuments\(supabase/);
});

test("Supplier Accounts browser cache remains a bounded working set", async () => {
  const page = await source("src/app/accounts/payables/page.tsx");

  assert.match(page, /bdb-supplier-payables-cache-v2/);
  assert.match(page, /documents: bundle\.documents\.slice\(0, 50\)/);
  assert.match(page, /payments: bundle\.payments\.slice\(0, 50\)/);
  assert.match(page, /supplierBalances: bundle\.supplierBalances\.slice\(0, 50\)/);
  assert.match(page, /50-row keyset pages · no full-history browser load/);
  assert.match(page, /view, \.\.\.params/);
});

test("Pass 4 Supplier scale migration adds read indexes and a server-side summary", async () => {
  const migration = await source("supabase/migrations/20260823121552_accounts_supplier_scale_pass4.sql");

  assert.match(migration, /supplier_documents_accounts_cursor_idx/);
  assert.match(migration, /supplier_payables_register_cursor_idx/);
  assert.match(migration, /supplier_payments_register_cursor_idx/);
  assert.match(migration, /supplier_payment_allocations_workspace_time_idx/);
  assert.match(migration, /supplier_credit_allocations_workspace_time_idx/);
  assert.match(migration, /get_supplier_accounts_summary/);
  assert.match(migration, /grant execute on function public\.get_supplier_accounts_summary\(uuid\) to service_role/);
  assert.match(migration, /revoke all on function public\.get_supplier_accounts_summary\(uuid\) from public, anon, authenticated/);
});

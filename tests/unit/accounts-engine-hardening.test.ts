import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Accounts financial POST routes bind idempotency keys to canonical request hashes", async () => {
  const [accountsRoute, finalDocumentsRoute] = await Promise.all([
    source("src/app/api/accounts/route.ts"),
    source("src/app/api/accounts/final-documents/route.ts"),
  ]);

  for (const route of [accountsRoute, finalDocumentsRoute]) {
    assert.match(route, /import \{ hashJson \} from "@\/lib\/server\/workspace-snapshot"/);
    assert.match(route, /admin\.rpc\("claim_accounts_command"/);
    assert.match(route, /p_idempotency_key: context\.idempotencyKey/);
    assert.match(route, /p_request_hash: hashJson\(\{ workspaceId, action, body \}\)/);
  }
});


test("legacy Accounts endpoint cannot create or mutate official business documents", async () => {
  const accountsRoute = await source("src/app/api/accounts/route.ts");
  const actions = accountsRoute.match(/const ACTIONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";

  assert.match(actions, /payment-record/);
  assert.match(actions, /payment-allocate/);
  assert.doesNotMatch(actions, /invoice-|credit-note-|delivery-note-/);
  assert.match(accountsRoute, /Official business documents now mutate only through \/api\/accounts\/final-documents/);
});

test("Accounts command parsing rejects duplicate Credit and Delivery source rows before database mutation", async () => {
  const [accountsRoute, finalDocumentsRoute] = await Promise.all([
    source("src/app/api/accounts/route.ts"),
    source("src/app/api/accounts/final-documents/route.ts"),
  ]);

  assert.match(accountsRoute, /Each original Invoice line can appear only once on a Credit Note/);
  assert.match(accountsRoute, /Each source line can appear only once on a Delivery Note/);
  assert.match(finalDocumentsRoute, /Each original Invoice line can appear only once on a Credit Note/);
});

test("Pass 1 migration keeps financial safeguards at the database boundary", async () => {
  const migration = await source("supabase/migrations/20260821004000_accounts_engine_hardening_pass1.sql");

  assert.match(migration, /invoice_record\.total_amount - invoice_credited - invoice_allocated/);
  assert.match(migration, /source_line\.total_amount - credited_total/);
  assert.match(migration, /delivery_notes_issue_quantity_guard/);
  assert.match(migration, /workspace_settings_currency_lock/);
  assert.match(migration, /revoke all on function public\.create_workspace_invoice/);
  assert.match(migration, /revoke all on function public\.reconcile_bank_transaction\(uuid,uuid,uuid\)/);
});

test("final Credit quantity slices close exactly over deterministic rounding stress cases", () => {
  function round4(value: number) {
    return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
  }

  let state = 0x5eed1234;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let caseIndex = 0; caseIndex < 25_000; caseIndex += 1) {
    const sourceQuantity = 2 + Math.floor(next() * 99);
    const sourceNet = round4(0.01 + next() * 100_000);
    const sourceVat = round4(sourceNet * ([0, 5, 7, 18, 20][Math.floor(next() * 5)] ?? 0) / 100);
    const sourceTotal = round4(sourceNet + sourceVat);
    let remainingQuantity = sourceQuantity;
    let creditedNet = 0;
    let creditedVat = 0;
    let creditedTotal = 0;

    while (remainingQuantity > 0) {
      const quantity = remainingQuantity === 1
        ? 1
        : 1 + Math.floor(next() * remainingQuantity);
      const isFinal = quantity === remainingQuantity;
      const net = isFinal
        ? round4(sourceNet - creditedNet)
        : round4(sourceNet * quantity / sourceQuantity);
      const vat = isFinal
        ? round4(sourceVat - creditedVat)
        : round4(sourceVat * quantity / sourceQuantity);
      const total = isFinal
        ? round4(sourceTotal - creditedTotal)
        : round4(net + vat);

      creditedNet = round4(creditedNet + net);
      creditedVat = round4(creditedVat + vat);
      creditedTotal = round4(creditedTotal + total);
      remainingQuantity -= quantity;
    }

    assert.equal(creditedNet, sourceNet);
    assert.equal(creditedVat, sourceVat);
    assert.equal(creditedTotal, sourceTotal);
  }
});

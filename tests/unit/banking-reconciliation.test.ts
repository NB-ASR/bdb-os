import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueBankingCommand,
  readBankingQueue,
  removeBankingCommand,
} from "../../src/lib/modules/banking-queue.ts";
import { parseBankStatementCsv } from "../../src/lib/modules/banking-csv.ts";

class MemoryStorage {
  #values = new Map<string, string>();
  getItem(key: string) { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string) { this.#values.set(key, value); }
  removeItem(key: string) { this.#values.delete(key); }
}

function installStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  });
}

function idFactory() {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

test("Banking commands remain workspace-scoped and ordered", () => {
  installStorage();
  enqueueBankingCommand("workspace-a", "reconcile", { bankTransactionId: "bank-a" }, "command-a1");
  enqueueBankingCommand("workspace-a", "reconciliation-reverse", { allocationId: "allocation-a" }, "command-a2");
  enqueueBankingCommand("workspace-b", "transaction-reverse", { bankTransactionId: "bank-b" }, "command-b1");

  assert.deepEqual(readBankingQueue("workspace-a").map((command) => command.id), ["command-a1", "command-a2"]);
  assert.deepEqual(readBankingQueue("workspace-b").map((command) => command.id), ["command-b1"]);
});

test("Banking stable command identities are queued once", () => {
  installStorage();
  enqueueBankingCommand("workspace-a", "reconcile", { id: "allocation-a" }, "stable-command");
  enqueueBankingCommand("workspace-a", "reconcile", { id: "allocation-a" }, "stable-command");
  assert.equal(readBankingQueue("workspace-a").length, 1);
});

test("Banking commands can be removed without affecting another workspace", () => {
  installStorage();
  enqueueBankingCommand("workspace-a", "transaction-reverse", { bankTransactionId: "bank-a" }, "remove-command");
  enqueueBankingCommand("workspace-b", "reconcile", { bankTransactionId: "bank-b" }, "keep-command");
  removeBankingCommand("workspace-a", "remove-command");

  assert.deepEqual(readBankingQueue("workspace-a"), []);
  assert.equal(readBankingQueue("workspace-b").length, 1);
});

test("Bank statement parser accepts signed amount rows", () => {
  const statement = parseBankStatementCsv(
    [
      "Date,Description,Amount,Reference,Currency",
      "2026-07-01,Customer receipt,120.50,REC-1,EUR",
      "2026-07-02,Supplier transfer,-45.25,SUP-1,EUR",
    ].join("\n"),
    "EUR",
    "11111111-1111-4111-8111-111111111111",
    idFactory(),
  );

  assert.equal(statement.delimiter, ",");
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[0].transactionType, "credit");
  assert.equal(statement.rows[0].amount, 120.5);
  assert.equal(statement.rows[1].transactionType, "debit");
  assert.equal(statement.rows[1].amount, 45.25);
  assert.equal(statement.rows[1].externalReference, "SUP-1");
});

test("Bank statement parser accepts separate credit and debit columns with decimal commas", () => {
  const statement = parseBankStatementCsv(
    [
      "Date;Description;Credit;Debit;Reference",
      '31/07/2026;"Customer, card receipt";"1.234,56";;CARD-1',
      '30/07/2026;Supplier payment;;"75,40";SUP-2',
    ].join("\n"),
    "EUR",
    "22222222-2222-4222-8222-222222222222",
    idFactory(),
  );

  assert.equal(statement.delimiter, ";");
  assert.equal(statement.rows[0].transactionDate, "2026-07-31");
  assert.equal(statement.rows[0].description, "Customer, card receipt");
  assert.equal(statement.rows[0].amount, 1234.56);
  assert.equal(statement.rows[0].transactionType, "credit");
  assert.equal(statement.rows[1].amount, 75.4);
  assert.equal(statement.rows[1].transactionType, "debit");
});

test("Duplicate-looking rows receive stable occurrence-aware fingerprints", () => {
  const csv = [
    "Date,Description,Amount",
    "2026-07-01,Card settlement,50",
    "2026-07-01,Card settlement,50",
  ].join("\n");

  const first = parseBankStatementCsv(csv, "EUR", "33333333-3333-4333-8333-333333333333", idFactory());
  const second = parseBankStatementCsv(csv, "EUR", "33333333-3333-4333-8333-333333333333", idFactory());

  assert.notEqual(first.rows[0].fingerprint, first.rows[1].fingerprint);
  assert.equal(first.rows[0].fingerprint, second.rows[0].fingerprint);
  assert.equal(first.rows[1].fingerprint, second.rows[1].fingerprint);
  assert.match(first.rows[0].fingerprint, /^[0-9a-f]{64}$/);
});

test("Bank statement parser rejects missing required headers", () => {
  assert.throws(
    () => parseBankStatementCsv(
      "Description,Amount\nReceipt,10",
      "EUR",
      "44444444-4444-4444-8444-444444444444",
      idFactory(),
    ),
    /date column/i,
  );
});

test("Bank statement parser rejects currency mismatches", () => {
  assert.throws(
    () => parseBankStatementCsv(
      "Date,Description,Amount,Currency\n2026-07-01,Receipt,10,USD",
      "EUR",
      "55555555-5555-4555-8555-555555555555",
      idFactory(),
    ),
    /does not match the Bank account currency/i,
  );
});

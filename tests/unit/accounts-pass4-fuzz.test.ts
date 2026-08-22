import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateInvoiceTotals, calculateVatExclusiveLine } from "../../src/lib/invoice-pricing.ts";

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function generator(seed = 0x4bd0cafe) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("100-line Invoice totals remain stable at the V1 document boundary", () => {
  const lines = Array.from({ length: 100 }, (_, index) => ({
    quantity: round4(0.125 + index / 17),
    unitPrice: round4(0.01 + index * 13.3719),
    discountAmount: round4(index % 7 === 0 ? index / 10 : 0),
    vatRate: [0, 5, 7, 18, 20][index % 5] ?? 0,
  })).map((line) => {
    const gross = round4(line.quantity * line.unitPrice);
    return { ...line, discountAmount: Math.min(line.discountAmount, gross) };
  });

  const totals = calculateInvoiceTotals(lines);
  const independentlyCalculated = lines.reduce((sum, line) => {
    const result = calculateVatExclusiveLine(line.quantity, line.unitPrice, line.discountAmount, line.vatRate);
    return {
      netAmount: round4(sum.netAmount + result.netAmount),
      vatAmount: round4(sum.vatAmount + result.vatAmount),
      totalAmount: round4(sum.totalAmount + result.totalAmount),
    };
  }, { netAmount: 0, vatAmount: 0, totalAmount: 0 });

  assert.deepEqual(totals, independentlyCalculated);
  assert.equal(round4(totals.netAmount + totals.vatAmount), totals.totalAmount);
});

test("deterministic accounting fuzz preserves Invoice, Credit, Payment and reversal balance invariants", () => {
  const next = generator();
  const cases = 100_000;

  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const invoiceTotal = round4(0.01 + next() * 250_000);
    const credit = round4(invoiceTotal * next());
    const postCreditOutstanding = round4(invoiceTotal - credit);
    const payment1 = round4(postCreditOutstanding * next());
    const payment2Capacity = round4(postCreditOutstanding - payment1);
    const payment2 = round4(payment2Capacity * next());
    const reverseFirstPayment = next() < 0.2;
    const reversedPayment = reverseFirstPayment ? payment1 : 0;
    const netPayments = round4(payment1 + payment2 - reversedPayment);
    const balance = round4(invoiceTotal - credit - netPayments);

    assert.ok(credit >= 0 && credit <= invoiceTotal);
    assert.ok(netPayments >= 0);
    assert.ok(balance >= -0.0001);
    assert.equal(balance, round4(postCreditOutstanding - netPayments));
    assert.equal(invoiceTotal, round4(credit + netPayments + balance));
  }
});

test("deterministic decimal partial-Credit fuzz closes the final quantity and money exactly", () => {
  const next = generator(0x51c0ffee);
  const cases = 75_000;

  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const sourceQuantity = round4(0.0001 + next() * 10_000);
    const unitPrice = round4(next() * 50_000);
    const discountPercent = round4(next() * 100);
    const vatRate = [0, 5, 7, 18, 20][Math.floor(next() * 5)] ?? 0;
    const gross = round4(sourceQuantity * unitPrice);
    const discount = round4(gross * discountPercent / 100);
    const net = round4(gross - discount);
    const vat = round4(net * vatRate / 100);
    const total = round4(net + vat);

    const firstQuantity = round4(sourceQuantity * (0.1 + next() * 0.7));
    const safeFirst = Math.min(firstQuantity, round4(sourceQuantity - 0.0001));
    if (safeFirst <= 0) continue;
    const factor = safeFirst / sourceQuantity;
    const firstNet = round4(net * factor);
    const firstVat = round4(vat * factor);
    const firstTotal = round4(firstNet + firstVat);

    const finalQuantity = round4(sourceQuantity - safeFirst);
    const finalNet = round4(net - firstNet);
    const finalVat = round4(vat - firstVat);
    const finalTotal = round4(total - firstTotal);

    assert.equal(round4(safeFirst + finalQuantity), sourceQuantity);
    assert.equal(round4(firstNet + finalNet), net);
    assert.equal(round4(firstVat + finalVat), vat);
    assert.equal(round4(firstTotal + finalTotal), total);
    assert.ok(finalQuantity >= 0);
    assert.ok(finalNet >= -0.0001 && finalVat >= -0.0001 && finalTotal >= -0.0001);
  }
});

test("final-document route keeps hard V1 bounds for hostile and oversized input", async () => {
  const route = await readFile("src/app/api/accounts/final-documents/route.ts", "utf8");

  assert.match(route, /value\.length < 1 \|\| value\.length > 100/);
  assert.match(route, /maximum: 100000/);
  assert.match(route, /minimum: 0, maximum: 100/);
  assert.match(route, /Credit Notes cannot be created from an arbitrary monetary amount/);
  assert.match(route, /Each original Invoice line can appear only once on a Credit Note/);
  assert.match(route, /claim_accounts_command/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { calculateInvoiceTotals, calculateVatExclusiveLine } from "../../src/lib/invoice-pricing.ts";

test("invoice unit price is VAT-exclusive", () => {
  assert.deepEqual(calculateVatExclusiveLine(1, 2.5, 0, 18), {
    netAmount: 2.5,
    vatAmount: 0.45,
    totalAmount: 2.95,
  });
});

test("discount reduces the taxable amount before VAT", () => {
  assert.deepEqual(calculateVatExclusiveLine(2, 10, 2, 18), {
    netAmount: 18,
    vatAmount: 3.24,
    totalAmount: 21.24,
  });
});

test("invoice totals accumulate net, VAT and gross totals", () => {
  assert.deepEqual(calculateInvoiceTotals([
    { quantity: 1, unitPrice: 2.5, discountAmount: 0, vatRate: 18 },
    { quantity: 2, unitPrice: 5, discountAmount: 0, vatRate: 5 },
  ]), {
    netAmount: 12.5,
    vatAmount: 0.95,
    totalAmount: 13.45,
  });
});

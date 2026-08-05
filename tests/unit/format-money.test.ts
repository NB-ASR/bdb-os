import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney } from "../../src/lib/format.ts";

test("cross-currency Banking totals are not combined into a false amount", () => {
  assert.equal(formatMoney(1234.56, "MULTI"), "Multiple currencies");
});

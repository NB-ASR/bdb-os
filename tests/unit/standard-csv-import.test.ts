import test from "node:test";
import assert from "node:assert/strict";
import { importValue, numericImportValue, parseCsv } from "../../src/lib/modules/standard-csv-import.ts";

test("standard CSV import parses Excel-style comma CSV with quoted values", () => {
  const rows = parseCsv('name,email,address\r\n"Jane, Borg",jane@example.com,"1, Main Street"\r\n');
  assert.deepEqual(rows, [{ name: "Jane, Borg", email: "jane@example.com", address: "1, Main Street" }]);
});

test("standard CSV import accepts semicolon-delimited exports", () => {
  const rows = parseCsv("sku;name;unit_cost\nP-1;Product One;10.50\n");
  assert.equal(rows[0].sku, "P-1");
  assert.equal(rows[0].name, "Product One");
});

test("standard CSV import normalises common headings", () => {
  const [row] = parseCsv("Customer Name,Phone Number,VAT Number\nJane Borg,21234567,MT123\n");
  assert.equal(importValue(row, ["customer_name"]), "Jane Borg");
  assert.equal(importValue(row, ["phone_number"]), "21234567");
  assert.equal(importValue(row, ["vat_number"]), "MT123");
});

test("numeric import values support decimal commas", () => {
  assert.equal(numericImportValue("€ 12,50"), 12.5);
  assert.equal(numericImportValue("", 18), 18);
  assert.ok(Number.isNaN(numericImportValue("not-a-number") as number));
});

test("CSV import rejects duplicate headers", () => {
  assert.throws(() => parseCsv("name,name\nA,B\n"), /duplicate column headers/i);
});

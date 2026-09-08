import test from "node:test";
import assert from "node:assert/strict";
import { importValue, numericImportValue, parseCsv, sha256Hex, stableImportUuid } from "../../src/lib/modules/standard-csv-import.ts";

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

test("numeric import never turns malformed nonempty values into defaults", () => {
  for (const value of ["abc", "12abc34", "1e3", "€", "--10", "1,2,3", "1 2", "NaN", "Infinity"]) {
    assert.ok(Number.isNaN(numericImportValue(value, 18)), value);
  }
  assert.equal(numericImportValue("€ 1.234,50"), 1234.5);
  assert.equal(numericImportValue("$1,234.50"), 1234.5);
  assert.equal(numericImportValue("1 234,50"), 1234.5);
  assert.equal(numericImportValue("1,234"), 1234);
  assert.equal(numericImportValue("18%"), 18);
  assert.equal(numericImportValue("0"), 0);
  assert.equal(numericImportValue("-12.50"), -12.5);
  assert.equal(numericImportValue("  ", null), null);
});

test("CSV rejects surplus fields instead of silently discarding business data", () => {
  assert.throws(() => parseCsv("name,email\nCustomer,,lost-company\n"), /more values than column headers/);
  assert.throws(() => parseCsv('name,email\n"Unfinished,email\n'), /unfinished quoted field/);
});

test("import retry identity is stable and isolated by workspace, entity, file and row", async () => {
  const hash = await sha256Hex("name,email\nA,a@example.invalid\n");
  const seed = `workspace-a:customers:${hash}:2`;
  const id = await stableImportUuid(seed);
  assert.equal(id, await stableImportUuid(seed));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const other of [`workspace-b:customers:${hash}:2`, `workspace-a:products:${hash}:2`, `workspace-a:customers:${hash}:3`, `workspace-a:customers:${await sha256Hex("different")}:2`]) {
    assert.notEqual(id, await stableImportUuid(other));
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [standard, importer, customers, products, services] = await Promise.all([
  readFile("docs/architecture/v1-engine-closure-standard.md", "utf8"),
  readFile("src/components/standard-data-import.tsx", "utf8"),
  readFile("src/app/customers/page.tsx", "utf8"),
  readFile("src/app/products/page.tsx", "utf8"),
  readFile("src/app/services/page.tsx", "utf8"),
]);

assert.match(standard, /Customer Operational Acceptance Gate/i);
assert.match(standard, /Every visible business action/i);
assert.match(standard, /representative real files/i);
assert.match(standard, /unconditional disabled business action/i);
assert.match(standard, /Pass 1 → Pass 2 → Pass 3 → Pass 4 → Customer Operational Acceptance/i);

assert.match(importer, /accept="\.csv,text\/csv"/);
assert.match(importer, /Download.*CSV template/i);
assert.match(importer, /stableImportUuid/);
assert.match(importer, /sha256Hex/);
assert.match(importer, /Idempotency-Key/);
assert.match(importer, /\/api\/customers/);
assert.match(importer, /\/api\/products/);
assert.match(importer, /\/api\/services/);
assert.match(importer, /duplicate checks use current shared data/i);

assert.match(customers, /StandardDataImport entity="customers"/);
assert.match(customers, /Legacy Vanita JSON/);
assert.match(customers, /accept="application\/json,\.json"/);
assert.doesNotMatch(customers, />Import Customers<\/Button>/, "Customer page must not masquerade the legacy JSON picker as the standard Customer importer.");

assert.match(products, /StandardDataImport entity="products"/);
assert.doesNotMatch(products, /Import catalogue/i, "Products must not expose the old permanently disabled catalogue-import placeholder.");

assert.match(services, /StandardDataImport entity="services"/);

console.log("V1 closure now requires customer-operational acceptance and Customer/Product/Service imports use real canonical write paths.");

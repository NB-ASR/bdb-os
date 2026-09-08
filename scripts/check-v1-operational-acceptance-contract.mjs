import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [standard, importer, xlsxImporter, customers, products, services] = await Promise.all([
  readFile("docs/architecture/v1-engine-closure-standard.md", "utf8"),
  readFile("src/components/standard-data-import.tsx", "utf8"),
  readFile("src/lib/modules/xlsx-import.ts", "utf8"),
  readFile("src/app/customers/page.tsx", "utf8"),
  readFile("src/app/products/page.tsx", "utf8"),
  readFile("src/app/services/page.tsx", "utf8"),
]);

assert.match(standard, /Customer Operational Acceptance Gate/i);
assert.match(standard, /Every visible business action/i);
assert.match(standard, /representative real files/i);
assert.match(standard, /unconditional disabled business action/i);
assert.match(standard, /Pass 1 → Pass 2 → Pass 3 → Pass 4 → Customer Operational Acceptance/i);

assert.match(importer, /\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(importer, /MAX_CUSTOMER_ROWS = 5000/);
assert.match(importer, /parseXlsx/);
assert.match(importer, /Download.*CSV template/i);
assert.match(importer, /stableImportUuid/);
assert.match(importer, /sha256Hex/);
assert.match(importer, /Idempotency-Key/);
assert.match(importer, /fetch\("\/api\/workspace\/context", \{ cache: "no-store" \}\)/, "Imports must verify authenticated workspace context at commit time.");
assert.match(importer, /WORKSPACE_CHANGED/, "Imports must reject stale reviewed workspace context.");
assert.match(importer, /this\.status === 401 \|\| this\.status === 403/, "Imports must fail fast on workspace-level authorization failures.");
assert.match(importer, /\/api\/customers/);
assert.match(importer, /\/api\/products/);
assert.match(importer, /\/api\/services/);
assert.match(importer, /duplicate checks use current shared data/i);
assert.match(importer, /first_name/);
assert.match(importer, /last_name/);
assert.match(importer, /await onImported\(\)/, "Standard imports with a register callback must await the canonical refresh before reporting completion.");
assert.match(xlsxImporter, /sharedStrings\.xml/);
assert.match(xlsxImporter, /normaliseImportHeader/);
assert.match(xlsxImporter, /findImportHeader/);
assert.match(xlsxImporter, /state.*hidden/);
assert.match(xlsxImporter, /first_name/);
assert.match(xlsxImporter, /last_name/);
assert.match(xlsxImporter, /multiple equally likely Customer worksheets/, "Ambiguous visible Customer worksheets must be rejected instead of selecting one silently.");

assert.match(customers, /<StandardDataImport[\s\S]*?entity="customers"[\s\S]*?onImported=\{\(\) => reloadCurrent\(true\)\}/);
assert.match(customers, /Legacy Vanita JSON/);
assert.match(customers, /accept="application\/json,\.json"/);
assert.match(customers, /<StandardDataImport[\s\S]*?disabled=\{[^}]*!workspaceReady[^}]*\}/, "Customer imports must wait for authenticated workspace readiness.");
assert.doesNotMatch(customers, />Import Customers<\/Button>/, "Customer page must not masquerade the legacy JSON picker as the standard Customer importer.");

assert.match(products, /StandardDataImport entity="products"/);
assert.match(products, /<StandardDataImport[^>]*disabled=\{[^}]*!workspaceReady[^}]*\}/, "Product imports must wait for authenticated workspace readiness.");
assert.doesNotMatch(products, /Import catalogue/i, "Products must not expose the old permanently disabled catalogue-import placeholder.");

assert.match(services, /StandardDataImport entity="services"/);
assert.match(services, /<StandardDataImport[^>]*disabled=\{[^}]*!workspaceReady[^}]*\}/, "Service imports must wait for authenticated workspace readiness.");

console.log("V1 closure requires customer-operational acceptance; Customer import supports generic CSV/XLSX up to the hardened 5,000-row boundary, waits for the canonical register refresh, and Catalogue imports use canonical write paths.");

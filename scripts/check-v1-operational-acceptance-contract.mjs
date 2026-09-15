import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [standard, importer, xlsxImporter, customers, products, services, calendarAcceptance, calendarShell, calendarPage, calendarAvailability, calendarEligibility, calendarAcceptanceDoc, calendarArchitecture] = await Promise.all([
  readFile("docs/architecture/v1-engine-closure-standard.md", "utf8"),
  readFile("src/components/standard-data-import.tsx", "utf8"),
  readFile("src/lib/modules/xlsx-import.ts", "utf8"),
  readFile("src/app/customers/page.tsx", "utf8"),
  readFile("src/app/products/page.tsx", "utf8"),
  readFile("src/app/services/page.tsx", "utf8"),
  readFile("tests/e2e/calendar-operational-acceptance.spec.ts", "utf8"),
  readFile("src/components/app-shell.tsx", "utf8"),
  readFile("src/app/calendar/page.tsx", "utf8"),
  readFile("src/app/calendar/availability/page.tsx", "utf8"),
  readFile("src/app/calendar/eligibility/page.tsx", "utf8"),
  readFile("docs/acceptance/calendar-v1-operational-acceptance.md", "utf8"),
  readFile("docs/architecture/calendar-availability.md", "utf8"),
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

assert.match(customers, /<StandardDataImport[\s\S]*?entity="customers"[\s\S]*?onImported=\{\(\) => \{[\s\S]*?invalidateCustomerRegisterPages\(workspaceId\)[\s\S]*?reloadCurrent\(true\)/, "Customer imports must invalidate exact register pages before the awaited canonical refresh.");
assert.doesNotMatch(customers, /Legacy Vanita JSON/, "The retired Vanita migration must not remain customer-facing.");
assert.doesNotMatch(customers, /accept="application\/json,\.json"/, "The Customers screen must not retain a hidden legacy JSON picker.");
assert.match(customers, /<StandardDataImport[\s\S]*?disabled=\{[^}]*!workspaceReady[^}]*\}/, "Customer imports must wait for authenticated workspace readiness.");
assert.doesNotMatch(customers, />Import Customers<\/Button>/, "Customer page must not masquerade the legacy JSON picker as the standard Customer importer.");

assert.match(products, /StandardDataImport entity="products"/);
assert.match(products, /<StandardDataImport[^>]*disabled=\{[^}]*!workspaceReady[^}]*\}/, "Product imports must wait for authenticated workspace readiness.");
assert.doesNotMatch(products, /Import catalogue/i, "Products must not expose the old permanently disabled catalogue-import placeholder.");

assert.match(services, /StandardDataImport entity="services"/);
assert.match(services, /<StandardDataImport[^>]*disabled=\{[^}]*!workspaceReady[^}]*\}/, "Service imports must wait for authenticated workspace readiness.");

for (const proof of [
  /getByRole\("combobox", \{ name: "Day", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Customer", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Service", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Staff member", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Room", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Initial status", exact: true \}\)/,
  /getByRole\("combobox", \{ name: "Active Service", exact: true \}\)/,
  /Search appointments/,
  /Previous day/,
  /Next day/,
  /Keep appointment/,
  /Retry sync/,
  /Discard rejected change/,
  /Cancel edit/,
  /Open Services/,
  /Save offline/,
]) {
  assert.match(calendarAcceptance, proof, "Calendar V1 operational acceptance must prove the visible customer workflow with stable accessible controls.");
}
assert.match(calendarShell, /href: "\/calendar\/eligibility"/, "Service eligibility must be reachable from the Calendar V1 navigation.");
assert.doesNotMatch(calendarShell, /href: "\/calendar\/meetings"/, "Deferred Meetings must not be in the Calendar V1 action hierarchy.");
assert.doesNotMatch(calendarShell, /href: "\/calendar\/timesheets"/, "Deferred Timesheets must not be in the Calendar V1 action hierarchy.");
for (const marker of [/Edit break/, /Archive break/, /Edit leave/, /Cancel leave/, /Edit room/, /Archive room/, /Restore room/]) {
  assert.match(calendarAvailability, marker, "Calendar availability lifecycle controls must retain stable accessible action names.");
}
for (const marker of [/Search appointments/, /Previous day/, />Today</, /Next day/, /Keep appointment/, /Retry sync/, /Discard rejected change/]) {
  assert.match(calendarPage, marker, "Calendar daily-operation and recovery controls must remain visible and operational.");
}
for (const marker of [/Open Services/, /Active Service/, /"Assign"/, /"Remove"/]) {
  assert.match(calendarEligibility, marker, "Calendar Service eligibility operational controls must remain present.");
}
assert.match(calendarAcceptanceDoc, /Visible-action inventory/i);
assert.match(calendarAcceptanceDoc, /Operational V1/i);
assert.match(calendarAcceptanceDoc, /Service eligibility/i);
assert.doesNotMatch(calendarArchitecture, /eligibility is not part of this slice/i, "Authoritative Calendar architecture must not describe live eligibility as future work.");
assert.doesNotMatch(calendarArchitecture, /next Calendar integration is staff-to-Service eligibility/i, "Authoritative Calendar architecture must align with the frozen V1 closure decision.");

console.log("V1 closure requires customer-operational acceptance; Customer/Catalogue import paths and the complete Calendar V1 visible-action boundary are protected by exact-candidate acceptance contracts.");

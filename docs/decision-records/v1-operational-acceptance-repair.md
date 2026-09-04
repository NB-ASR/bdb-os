# V1 Operational Acceptance Repair

## Decision made

BDB OS will no longer treat technical engine closure as sufficient evidence of customer readiness.

Customer and Catalogue remain architecturally frozen, but their V1 acceptance is being repaired around the customer-visible import workflows that were either misleading or unavailable.

The new `docs/architecture/v1-engine-closure-standard.md` is the release standard for all future engine closures, including Purchasing Documents.

## Business problem

The Customer engine exposed a generic `Import Customers` action while only accepting a legacy Vanita JSON snapshot. The Product catalogue exposed a permanently disabled import action, and Services had no bulk import action.

These conditions were visible to a normal business user but were not caught by the prior technical closure programme because authenticated customer journeys were not a mandatory exact-candidate gate.

## Repair scope

### Customers

- Add a standard CSV import path for normal business migration/onboarding.
- Provide a downloadable CSV template.
- Require preview/review before records are created.
- Use the existing hardened canonical Customer command for standard rows.
- Keep legacy Vanita JSON migration available as a separately labelled legacy path with its existing provenance/receipt semantics.
- Do not create fake Vanita provenance for standard CSV imports.

### Products

- Replace the permanently disabled import action with a real standard CSV Product import.
- Provide a Product CSV template and review-before-commit flow.
- Use the canonical Product command for every imported row.
- Do not import stock quantity into Product master data; Inventory continues to own quantity and movements.
- Remove customer-visible deferred controls rather than presenting them as broken actions.

### Services

- Add a standard CSV Service import with template and review-before-commit flow.
- Use the canonical Service command for every imported row.
- Preserve Calendar ownership of staff eligibility and availability.

## Reliability model

Standard CSV import is intentionally online-only in V1 because each row must validate against current shared duplicate/uniqueness state.

The selected file is parsed locally and reviewed before any write occurs. Each file/row receives a deterministic entity ID and stable idempotency key derived from the file content so retrying the same import cannot silently create a second record after an ambiguous response.

Normal offline Customer/Product/Service create/edit/archive/restore queues remain unchanged.

## Alternatives considered

### Direct database bulk inserts

Rejected. They would bypass the frozen command boundaries, permissions, validation, Activity history and retry guarantees.

### Treat legacy Vanita JSON as the generic Customer importer

Rejected. It is a migration format for one historical application, not a reasonable customer-facing interchange format.

### Keep deferred Catalogue actions visible but disabled

Rejected. A V1-closed customer screen must not present a normal business action that cannot be used.

### Add stock quantity to Product CSV

Rejected. Quantity belongs to the Inventory movement ledger. Product import creates definitions only.

## Risks

- Standard CSV import deliberately stops/flags individual duplicate or invalid rows instead of silently merging data.
- Large imports are bounded; V1 is not a data-warehouse ingestion product.
- Spreadsheet-native `.xlsx` is not advertised by this repair. Businesses can use the supplied CSV template or export CSV from their spreadsheet software. Native workbook ingestion can be added later only if it adds real onboarding value.
- The exact authenticated customer acceptance gate still has to pass before this repair can merge.

## Future implications

Every future engine closure must inventory and exercise every visible action as a real authenticated customer on the exact candidate.

Purchasing Documents V1 therefore cannot close merely because upload/extraction/posting functions exist. The complete customer flow—including real-file selection, configured extraction, review, approval, Product/Supplier resolution, Inventory handoff and recovery—must be proven before `V1 Closed/Live` is used.

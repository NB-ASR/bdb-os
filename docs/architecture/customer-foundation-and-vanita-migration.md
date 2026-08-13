# Customer foundation and Vanita migration

## Decision

Upgrade the existing workspace-owned `customers` table in place. Do not introduce a second Vanita Customer catalogue.

Customers is the canonical identity referenced by Appointments, Sales, invoices, Documents and Communications. Calendar may proceed only after this record is authoritative.

## Business problem

The original BDB OS Customer screen wrote directly through the browser and required an email address. It had no archive lifecycle, optimistic concurrency, migration provenance, duplicate-review boundary or offline command queue. The old Vanita application stores possible Customer records under the `clients` array of its `app_state` JSON document.

## Ownership

Customers owns:

- identity and workspace-scoped Customer code;
- name, company and contact details;
- address, operational notes and structured preferences;
- active or archived lifecycle;
- legacy source identity and migration provenance.

Other departments reference the Customer ID. They do not copy or redefine the Customer.

## Functional model

Customer lifecycle actions are:

- `create`
- `update`
- `archive`
- `restore`

Trusted commands use service-role-only RPC functions, stable idempotency receipts, optimistic versions and Activity records. Browser clients retain RLS-scoped reads but cannot directly insert, update or delete Customer rows.

Email is optional. Exact normalised email or phone matches are not silently merged. The command returns a duplicate-review conflict unless an authorised user explicitly confirms that a separate Customer is required.

## Offline position

Customer reads are cached per workspace after one successful online load. Create, update, archive and restore commands may be queued offline with stable command IDs. Replay stops on the first conflict or validation failure.

Bulk Vanita migration is online-only because source receipts, duplicate checks and reconciliation counts must be committed atomically against current shared data.

## Vanita import

Accepted JSON forms are:

```json
[{ "id": "legacy-1", "name": "Customer" }]
```

```json
{ "clients": [{ "id": "legacy-1", "name": "Customer" }] }
```

```json
{ "data": { "clients": [{ "id": "legacy-1", "name": "Customer" }] } }
```

The importer:

1. Requires a reviewed JSON snapshot and authorised `customers.approve` access.
2. Limits a batch to 5,000 records.
3. Preserves source IDs through per-workspace import receipts.
4. Links an incoming source row to an existing Customer on an exact email or phone match without overwriting that Customer.
5. Creates a new Customer when no exact match exists.
6. Records malformed rows as batch exceptions without leaving partial rows for that source item.
7. Rejects changed source content for a previously imported legacy identity so changes are reviewed instead of silently ignored.
8. Returns received, created, linked, skipped and error counts.

The current production Vanita `clients` array is empty. The import path is still required so later snapshots and pilot data use the same controlled contract.

## Security

- All exposed tables use RLS.
- `authenticated` receives Customer SELECT only.
- Command and migration receipt tables are service-role-only.
- SECURITY DEFINER command functions use an empty search path and have EXECUTE revoked from `public`, `anon` and `authenticated`.
- Normal Founder support remains read-only.
- Guarded integration-preview `test_write` sessions use the shared actor permission boundary.
- Cross-workspace foreign keys remain intact for bookings, Documents, invoices, messages and Sales.

## Acceptance gate

Customers is complete when:

- email-optional create and edit work;
- archive and restore work without deleting history;
- duplicate review is explicit;
- stale versions are rejected;
- retries create no duplicate rows or Activity;
- offline commands replay once and stop on conflict;
- Vanita batches reconcile and can be safely rerun;
- source provenance and exceptions are visible;
- Sales can continue referencing the canonical Customer ID;
- workspace isolation and Founder support boundaries pass.

## Future implications

Calendar must reference this Customer ID. Customer merge is deliberately excluded from this slice because it would need to reassign records across multiple departments atomically. It should be designed only after Appointments and the financial ledgers have stable reference rules.

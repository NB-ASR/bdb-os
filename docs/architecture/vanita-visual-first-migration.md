# Vanita visual-first module migration

## Decision

Migrate the old Vanita application into BDB OS one workspace module at a time. Each module is introduced first as a complete visual shell in the shared BDB OS design language. Data models, writes, uploads, extraction and automation are restored only after the visual workflow is approved.

## Reason

The old Vanita application contains proven business workflows but uses a separate interface, local JSON state and Vanita-specific assumptions. Rebuilding the visual structure first lets the team validate terminology, navigation and workflow order without prematurely locking in the old data model or duplicating BDB OS records.

## Rules

1. A visual shell must be honest. Unavailable actions are disabled and labelled as not yet connected.
2. A visual shell must not create fake success states, local operational records or hidden temporary writes.
3. Every new tab is a registered workspace feature, not a globally hardcoded Vanita route.
4. Modules are enabled by plan or workspace override. Disabled modules do not appear in navigation.
5. Founder support access remains read-only.
6. Production and `main` remain unchanged until the integration branch is reviewed.
7. Functional restoration begins only after the relevant visual tab is approved.

## First slice

Inventory is the first visual migration:

- shared `/inventory` route;
- workspace feature key `inventory`;
- enabled for `vanita-integration` by workspace override;
- stock metrics, filters, table structure and empty state;
- supplier invoice and credit-note import window;
- no product, supplier, stock, upload, extraction or movement writes.

## Proposed visual sequence

1. Inventory and supplier-document import
2. Products
3. Services
4. Suppliers
5. Sales
6. Calendar and appointment enhancements
7. Documents and purchasing history
8. Customers/clients enhancements
9. Settings, access and reporting surfaces

## Functional restoration sequence

For each approved module:

1. Define normalized workspace-owned tables.
2. Add constraints, indexes and Row Level Security.
3. Add offline persistence and sync behaviour where operationally required.
4. Connect read models.
5. Connect create and edit commands.
6. Add activity history and audit records.
7. Transform and import old Vanita data into the integration project.
8. Validate workspace isolation, support read-only access and error states.

## Risks

- Visual approval may imply functionality that is not yet available.
- A visual-first process can accumulate dead screens if functional restoration is delayed.
- Copying the old interface too literally could preserve Vanita-specific assumptions.

## Mitigations

- Every preview screen displays its migration status.
- Disabled actions remain visibly disabled.
- Only one or two visual modules are open for review at a time.
- Functional design begins immediately after each tab is approved.
- Shared BDB OS records and module rules take priority over the old implementation.

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

## Navigation structure

The workspace sidebar scrolls independently from the brand and account footer so additional modules do not push important controls outside the viewport.

Related routes may be grouped under an expandable department heading without merging their feature entitlements.

```text
Calendar
├─ Appointments
├─ Timesheets
└─ Meetings

Catalogue & Stock
├─ Inventory
├─ Products
├─ Services
└─ Suppliers

Documents
├─ Document Library
└─ Purchasing
```

Appointments, Timesheets and Meetings remain separate feature keys. Appointments continues using the existing `/calendar` route, while Timesheets and Meetings use `/calendar/timesheets` and `/calendar/meetings`. When a workspace has only the Calendar feature, the shell renders Appointments as a normal standalone link. The Calendar dropdown appears only when another enabled child exists.

Timesheets is surfaced in Calendar because it is time-oriented, but its records and approvals are Workforce-owned. Calendar events may suggest expected time; they cannot prove attendance or replace an auditable time entry.

Meetings is surfaced in Calendar because it coordinates time and attendees. Invitations remain Communications records, minutes remain Documents, and customer or supplier context remains on the linked business record.

Inventory, Products, Services and Suppliers remain separate feature keys. When a workspace has at least two enabled children, the shell renders the expandable Catalogue & Stock group. When only one child is enabled, the shell renders that route as a normal standalone item instead of an unnecessary dropdown.

Document Library keeps the existing `documents` entitlement and `/documents` route. Purchasing uses a separate `purchasing` entitlement at `/documents/purchasing`. When Purchasing is disabled, Document Library remains a standalone link.

Sales remains a separate operational route because it coordinates catalogue, customers, stock and Accounts rather than belonging to the catalogue definition itself.

## First slice

Inventory is the first visual migration:

- shared `/inventory` route;
- workspace feature key `inventory`;
- enabled for `vanita-integration` by workspace override;
- stock metrics, filters, table structure and empty state;
- supplier-document entry point now routes to the shared Documents → Purchasing workflow;
- Inventory receives approved posting commands but does not own or duplicate the original supplier file;
- no product, supplier, stock, upload, extraction or movement writes.

## Second slice

Products is the second visual migration:

- shared `/products` route;
- workspace feature key `products`;
- enabled for `vanita-integration` by workspace override;
- representative preview rows for table and filter review only;
- product definition window covering SKU, barcode, supplier, category, purpose, pricing, VAT and reorder level;
- opening stock deliberately excluded from the product definition because it must become an auditable inventory movement;
- no product, price, supplier, barcode or stock writes.

## Third slice

Services is the third visual migration:

- shared `/services` route;
- workspace feature key `services`;
- enabled for `vanita-integration` by workspace override;
- representative service rows for table, filter and terminology review only;
- service definition window covering code, category, duration, preparation and recovery buffers, price, VAT, booking visibility, staff eligibility and lifecycle status;
- service definitions connect to Calendar, customer history and invoice lines without duplicating the service in each department;
- working hours, leave and appointment availability remain Calendar responsibilities;
- no service, pricing, booking, staff-assignment or invoice-line writes.

## Fourth slice

Suppliers is the fourth visual migration:

- shared `/suppliers` route;
- workspace feature key `suppliers`;
- enabled for `vanita-integration` by workspace override;
- representative supplier rows for directory, contact, terms, discount and relationship review only;
- supplier definition window covering code, type, contact details, tax identifier, payment terms, default discount, document currency, supplied categories, address and lifecycle status;
- supplier records connect products, purchasing documents, stock receipts and Accounts without storing separate copies in each department;
- default discounts and terms are starting rules; each supplier document must preserve its actual line discounts, paid costs and payment terms;
- bank details, payment approval and settlement remain Accounts and Banking responsibilities;
- no supplier, contact, discount, document, purchasing, payment or product-link writes.

## Fifth slice

Sales is the fifth visual migration:

- shared `/sales` route;
- workspace feature key `sales`;
- enabled for `vanita-integration` by workspace override;
- representative sales register with customer, channel, line summary, gross value, discounts, total, payment status and lifecycle state;
- visual Record Sale window connecting customer, staff member, products, services, discounts, VAT, payment method and optional invoice linkage;
- completed product lines will eventually create auditable Inventory movements, while draft sales must not change stock;
- invoices, payments, outstanding balances and settlement remain authoritative in Accounts and Banking;
- no sale, customer link, stock movement, invoice, payment, refund or balance writes.

## Sixth slice

Calendar and appointment enhancements are the sixth visual migration:

- Calendar becomes an expandable department instead of a single flat route;
- Appointments keeps the existing shared `/calendar` route and Calendar feature entitlement;
- Timesheets is introduced at `/calendar/timesheets` with feature key `timesheets`, enabled only for `vanita-integration` during visual review;
- Meetings is introduced at `/calendar/meetings` with feature key `meetings`, enabled only for `vanita-integration` during visual review;
- representative appointment agenda with date navigation, search, lifecycle filters, staff, room, service, value and attention states;
- visual appointment detail and New Appointment windows connecting customers, Services, eligible staff, rooms, invoice options and future Inventory consumption;
- representative Timesheets register with scheduled hours, recorded hours, variance, overtime, source, approval and exception states;
- visual Add Time Entry window with an explicit audit and approval boundary;
- representative Meetings workspace for internal, customer and supplier coordination;
- visual New Meeting window linking attendees, rooms, Communications, Documents and business records;
- Services owns duration, buffers, price and staff eligibility, while Calendar owns working hours, leave, room availability and conflict detection;
- Timesheets may use Calendar schedules as context but remain Workforce-owned and must preserve actual attendance entries;
- Meetings owns scheduling and participation context, while invitations remain Communications records and minutes remain Documents;
- no appointment, timesheet, attendance, approval, meeting, invitation, minutes, availability, invoice, payment, reminder, customer-history or Inventory writes.

## Seventh slice

Documents and Purchasing are the seventh visual migration:

- Documents becomes an expandable department with Document Library and Purchasing children;
- Document Library keeps the existing shared `/documents` route and `documents` entitlement;
- Purchasing is introduced at `/documents/purchasing` with feature key `purchasing`, enabled only for `vanita-integration` during visual review;
- representative supplier invoice and credit-note register with supplier, dates, values, extraction, review, product-match, Inventory, Accounts and payment states;
- visual Upload Supplier Document workflow using Upload → Review → Complete stages;
- visual document-detail lifecycle showing one source document referenced by Inventory, Accounts and Banking;
- Documents owns the original file, metadata, extraction and review status;
- Suppliers owns supplier identity, Products owns catalogue matching, Inventory owns stock movements, Accounts owns payables and Banking owns settlement;
- the duplicate supplier-document modal is removed from Inventory and replaced by a shortcut to Purchasing;
- no file, extraction, supplier-document, product-match, stock, payable, payment or reconciliation writes.

## Proposed visual sequence

1. Inventory and supplier-document import
2. Products
3. Services
4. Suppliers
5. Sales
6. Calendar department and appointment enhancements
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
- Excessive sidebar grouping could hide frequently used work from business users.
- Timesheets could accidentally become a payroll system if rate, tax and settlement boundaries are not enforced.
- Meetings could duplicate Communications or Documents if invitations and minutes are stored directly in Calendar.
- Purchasing could duplicate Inventory or Accounts if each department stores its own supplier-document copy.

## Mitigations

- Every preview screen displays its migration status.
- Disabled actions remain visibly disabled.
- Only one or two visual modules are open for review at a time.
- Functional design begins immediately after each tab is approved.
- Shared BDB OS records and module rules take priority over the old implementation.
- Navigation groups are used only when at least two enabled child routes exist.
- Cross-department records are linked rather than duplicated.
- Supplier documents use one lifecycle and controlled departmental posting states.

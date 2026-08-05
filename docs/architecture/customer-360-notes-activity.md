# Customer 360, Notes and Unified Activity

## Decision

BDB OS uses the existing `public.customers` catalogue as the authoritative Customer identity and adds a Customer-centred read workspace at `/customers/[customerId]`.

The profile does not copy Appointments, Sales, Invoices, Payments, Documents or Communications into a second Customer-owned database. Each source department retains ownership of its records and rules. Customer 360 presents permission-aware read models over those records.

## Business problem

Customer information was available only by moving independently through Calendar, Sales, Accounts, Documents and Communications. Business users could not answer basic questions from one record:

- What has happened with this Customer?
- What is scheduled next?
- What has been sold and invoiced?
- What is outstanding by currency?
- Which Payments, Documents and Communications belong to the Customer?
- Which internal notes remain active?

## Ownership

### Customers owns

- Customer identity and directory lifecycle
- Customer profile presentation
- Explicit internal Customer notes
- Customer-centred navigation

### Calendar owns

- Appointments, status, staff, room and Service scheduling

### Sales owns

- Completed and reversed Sales

### Accounts owns

- Invoices, Customer Payments, allocations and derived balances

### Documents owns

- Customer-linked Documents and storage access

### Communications owns

- Customer-linked message and conversation records

Customer 360 cannot bypass the source department's permissions or mutate a source record.

## Customer notes

`public.customer_notes` is an append-only Customer note ledger.

A note is created as `note_kind = 'note'`. Corrections never update or delete it. A correction creates one linked `note_kind = 'void'` row containing the reason, actor and timestamp.

Rules:

- Notes require Customers create permission.
- Voids require Customers edit permission.
- One note can be voided only once.
- Browser clients receive RLS-scoped reads only.
- Trusted mutations remain service-role-only.
- Stable idempotency receipts prevent duplicate notes during retry.
- Normal Founder support is read-only; guarded test-write follows the existing support boundary.

The original `customers.notes` field remains as legacy directory context. It is displayed separately and is not treated as append-only note history.

## Unified activity

`public.customer_360_activity` is a security-invoker read model. It normalises Customer-related events from existing source records:

- Customer lifecycle activity
- Explicit Customer notes and note voids
- Appointments
- Sales
- Invoices
- Customer Payments
- Documents
- Communications

The view does not create a second audit or event ledger. It derives a consistent presentation shape containing source type, source identity, event type, title, detail, tone, occurrence time, route and metadata.

Because the view is `security_invoker`, source-table RLS remains authoritative. The profile API also resolves department access and does not query restricted sections.

## Financial boundary

Customer balances are displayed separately by currency.

The profile never adds EUR, GBP, USD or any other currencies into one total. Each currency card derives:

- Issued Invoice amount
- Allocated amount
- Outstanding amount
- Customer Payments received
- Unallocated credit
- Net Customer position

Accounts remains the financial source of truth.

## Operational summary

`public.customer_360_operational_summary` derives counts and latest activity for:

- Appointments
- Sales
- Invoices
- Payments
- Documents
- Communications
- Customer notes

These counts are navigation aids, not editable dashboard metrics.

## Offline boundary

After one successful online load, the Customer profile bundle is cached per workspace and Customer.

Offline-capable commands:

- Add Customer note
- Void an active Customer note

Queued commands retain stable identities, replay in order and stop on the first conflict. The server revalidates workspace access, Customer existence, permissions and note state.

Source department records remain read-only from their last cached Customer 360 bundle while offline. Customer 360 does not invent offline mutations for Calendar, Sales, Accounts, Documents or Communications.

## Side-effect boundary

Customer note commands do not create, update or delete:

- Appointments
- Sales
- Invoices
- Customer Payments
- Payment allocations
- Documents
- Communications
- Inventory movements
- Bank transactions

## Version 1 boundary

Included:

- Customer identity and contact context
- Permission-aware connected sections
- Currency-separated Accounts position
- Unified activity
- Append-only Customer notes
- Cached reads and offline note queue

Deferred:

- AI-generated Customer summaries
- Automated next-action recommendations
- Cross-Customer household or organisation graphs
- Custom timeline builders
- Bulk note migration from unstructured external sources
- Customer-facing portal access

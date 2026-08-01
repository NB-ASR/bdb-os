# General Documents Integration

## Decision

BDB OS uses **Documents** as the sole owner of stored business files, document metadata and document lifecycle.

Other departments do not copy files or create department-specific document catalogues. They connect to a Document through typed links. Customers, Calendar, Sales, Accounts and Communications retain ownership of their own records and business rules.

The existing free-text `documents.linked_to` field is legacy display data. It is not a reliable integration contract and must not be used for new links.

## Business problem

The current Document Library can upload a file and attach a free-text label, but it cannot reliably answer:

- Which exact Customer, Appointment, Sale, Invoice, Payment or Communication owns the context?
- Is a link still valid?
- Can the same Document support more than one business record without copying the file?
- Can Customer 360 and unified history navigate to the authoritative Document?
- Can a queued upload or link retry without creating duplicate records?
- Can permissions be enforced consistently when Documents are opened from another department?

Free-text linkage creates ambiguous records and makes cross-department navigation fragile.

## Ownership

### Documents owns

- The stored file object
- File identity and immutable storage path
- Original file name, media type and byte size
- Business-facing title, category and description
- Active or archived lifecycle state
- Typed links to source-department records
- Document access and signed-download decisions
- Upload, link, revoke-link and archive commands

### Customers owns

- Customer identity
- Customer permission rules
- Customer 360 presentation of linked Documents

### Calendar owns

- Appointments and appointment permissions

### Sales owns

- Sales and commercial transaction permissions

### Accounts owns

- Invoices, Customer Payments and financial permissions

### Communications owns

- Conversations, messages and communication permissions

A Document link never transfers ownership of the source record to Documents.

## Typed links

`public.document_links` connects one authoritative Document to one typed business context.

Version 1 link types are:

- `business`
- `customer`
- `appointment`
- `sale`
- `invoice`
- `customer_payment`
- `communication`

A `business` link has no target record. Every other link requires an exact target UUID.

A Document may have multiple active links when the business context genuinely spans records. For example, one signed agreement may link to a Customer and an Appointment. The file remains stored once.

Links are revoked through a trusted command rather than deleted by the browser. Revocation preserves who removed the link, when and why.

## Legacy compatibility

The current `public.documents` table and stored objects remain authoritative. The integration extends that table rather than creating a replacement catalogue.

Existing rows are backfilled conservatively:

- Documents with `customer_id` receive a typed Customer link.
- Documents without `customer_id` receive a Business link.
- No Invoice, Appointment, Sale, Payment or Communication link is inferred from `linked_to` text.

This avoids inventing relationships that the existing data does not prove.

## Command boundary

Browser clients must not insert, update or delete `document_links` or command receipts directly.

Trusted server commands will own:

- Creating a Document record after storage succeeds
- Adding a typed link after validating the target record
- Revoking an active link
- Archiving a Document without deleting the stored history

Every write uses a stable idempotency key. Exact retries return the original result rather than creating another Document or link.

The current legacy direct-write upload path remains temporarily available only until the trusted command and offline queue cutover is complete. It must then be removed and database writes hardened in the same delivery slice.

## Permission boundary

Documents permission remains authoritative for reading and changing Document records.

Opening a Document through another department also requires access to that source context. The read API must not expose restricted source-record details merely because the user can view Documents.

Normal Founder support remains read-only. Guarded test-write support follows the existing integration-preview boundary.

## Customer 360 and unified history

Customer 360 reads Customer-linked Documents through typed active links. It does not copy Document metadata into a Customer-owned table.

Document activity enters unified history from the authoritative Document and link records. A link action must not create, modify or settle Appointments, Sales, Invoices, Payments, Communications, Inventory movements or Banking records.

## Offline boundary

After one successful online load, the General Documents index may be cached per workspace.

Version 1 offline-capable commands are intended to include:

- Queue Document metadata and file upload
- Add a typed Document link
- Revoke a typed Document link
- Archive a Document

Queued commands retain stable identities, replay in order and stop on the first conflict. A file is not shown as confirmed until storage and database creation both succeed.

Large file bytes remain subject to browser storage capacity. Metadata may be cached even when the original file cannot be retained offline.

## Side-effect boundary

Document commands do not create, update or delete:

- Customers
- Appointments
- Sales
- Invoices
- Customer Payments
- Payment allocations
- Communications
- Inventory movements
- Bank transactions

Documents records context; it does not execute the business transaction represented by the file.

## Version 1 boundary

Included:

- One authoritative General Documents catalogue
- Typed cross-department links
- Conservative legacy backfill
- Active and archived lifecycle state
- Permission-aware read model
- Stable idempotency receipts
- Cached index and ordered offline command design
- Customer 360 and unified-history integration

Deferred:

- AI extraction for general files
- OCR and automatic classification
- Full-text content search
- Document templates and e-signature
- Version trees and collaborative editing
- Retention-policy automation
- External cloud-drive synchronisation
- Customer portal access

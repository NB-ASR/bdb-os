# Customer 360 Manual Acceptance

## Environment

- Branch: `integration/vanita-workspace`
- Application: canonical Vercel branch preview
- Database: isolated integration Supabase project only
- Required role: Owner, Manager or a custom role with the relevant department permissions

Keep PR #23 draft and unmerged. Do not use production data.

## 1. Open the profile

1. Open **Customers**.
2. Choose an existing Customer.
3. Open the Customer 360 profile.
4. Confirm identity, contact information, status, code, company and legacy provenance.
5. Refresh the page and confirm the same Customer remains visible.

Expected:

- The profile represents the existing Customer record rather than a duplicate Customer catalogue.
- Archived Customers retain their profile and history.

## 2. Operational summary

Confirm the profile counts agree with source departments for:

- Appointments
- Sales
- Invoices
- Customer Payments
- Documents
- Communications
- Active and historical notes

Expected:

- Counts are derived and cannot be edited from Customer 360.
- Last activity reflects the most recent connected source event.

## 3. Currency-separated Accounts position

Use a Customer with Accounts records in one or more currencies.

1. Confirm each currency has a separate financial card.
2. Compare issued amount, outstanding amount, received amount and unallocated credit with Accounts.
3. Confirm the net position is `outstanding - unallocated credit` for that currency.

Expected:

- Different currencies are never combined into one amount.
- Customer 360 does not alter Invoice, Payment or allocation state.

## 4. Unified activity

1. Open **Activity**.
2. Filter by Customer, Note, Calendar, Sales, Invoice, Payment, Document and Communication.
3. Open source-record links where available.
4. Compare timestamps and statuses with the source departments.

Expected:

- Events are derived from source records.
- No duplicate Customer-owned copy is created.
- Source-record access remains subject to source-department permission.

## 5. Customer notes

1. Add a Customer note.
2. Refresh and confirm it remains visible.
3. Retry the same queued command identity and confirm only one note exists.
4. Void the note with a reason.
5. Confirm the original note remains in activity history and the active-note count decreases.
6. Attempt to void the same note again.

Expected:

- Notes cannot be edited or deleted.
- A linked void record preserves reason, actor and time.
- A note can be voided only once.
- Customer lifecycle and note events appear in unified activity without duplicate note events.

## 6. Permission-aware sections

Test Owner, Manager, Employee and custom roles.

For a custom role, vary permission to Customers, Calendar, Sales, Accounts, Documents and Communications.

Expected:

- Customer identity and notes follow Customers permission.
- Calendar records follow Calendar permission.
- Sales records follow Sales permission.
- Invoice, Payment and financial records follow Accounts permission.
- Documents follow Documents permission.
- Communications follow Communications permission.
- A restricted section never leaks records through counts, tables or activity.

## 7. Founder support boundary

1. Open the profile in normal Founder support mode.
2. Confirm reads work according to the audited support session.
3. Confirm Add note and Void note are blocked.
4. Repeat only inside the guarded integration test-write mode where applicable.

Expected:

- Normal Founder support remains read-only.
- Test-write follows the existing temporary support harness.

## 8. Offline behaviour

1. Load a Customer profile online.
2. Disconnect the browser.
3. Reopen the same profile.
4. Add a note offline.
5. Queue a void after it.
6. Reconnect.

Expected:

- Cached Customer 360 data remains visible.
- Note commands retain stable identities and replay in order.
- Exact retries create no duplicate notes or voids.
- Synchronisation stops at the first current-state conflict and preserves later commands.
- Source department records remain read-only while offline.

## 9. Side-effect verification

After adding and voiding notes, confirm there are no automatic changes to:

- Appointments
- Sales
- Invoices
- Customer Payments
- Payment allocations
- Documents
- Communications
- Inventory movements
- Bank transactions

## Acceptance record

Record:

- Tested deployment SHA
- Tester
- Date and time
- Customer ID/code used
- Currencies tested
- Roles and permissions tested
- Offline commands tested
- Passed checks
- Failed checks
- Screenshots or error messages
- Decision: accept, correct and retest, or defer

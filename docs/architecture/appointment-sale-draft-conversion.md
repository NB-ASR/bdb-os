# Appointment-to-Sale Draft Conversion

## Decision

A completed Appointment may create one Sales-owned review draft. The draft is stored separately from the immutable `sales` and `sale_lines` transaction tables.

Completing an Appointment does not automatically create a Sale. An authorised Sales user must:

1. Create the draft from the completed Appointment.
2. Review the Service price, discount, commercial date/time and notes.
3. Explicitly complete the draft as an immutable Sale.

The draft and Sale remain linked to the source Appointment through `sale_drafts.source_appointment_id` and `sale_drafts.converted_sale_id`.

## Business problem

Vanita needs completed Services to move into the commercial workflow without staff re-entering the Customer, Service, price and VAT context. The workflow must still separate operational completion from financial completion so that an Appointment is not treated as paid, invoiced or settled merely because the Service was delivered.

## Department ownership

- **Calendar** owns the Appointment and its lifecycle.
- **Sales** owns the review draft and completed commercial transaction.
- **Inventory** remains unaffected because this slice creates one Service line only.
- **Accounts, Payments and Banking** remain unaffected because settlement is still `not_recorded`.

## Connected records

Each Appointment Sale draft references:

- One workspace
- One completed Appointment
- One Customer
- One Service
- Zero or one completed Sale

The draft retains Customer, Service code, Service name, price, VAT, currency and completion-time snapshots for review and auditability.

## Why a separate draft table

The existing `sales` and `sale_lines` tables are completed-only and immutable. Adding an editable `draft` status to those tables would weaken a proven commercial invariant and complicate reversal logic.

A separate `sale_drafts` table preserves:

- Immutable completed Sales
- Mutable review state
- One-to-one Appointment conversion
- Explicit discard and restore lifecycle
- Clear audit history
- Safe idempotent retries

## Command model

`apply_appointment_sale_draft_command` is the only trusted mutation path. It supports:

- `create`
- `update`
- `discard`
- `restore`
- `complete`

Every command requires a stable idempotency key. Updates use optimistic versions. Browser clients receive RLS-scoped reads only and cannot mutate draft or receipt tables directly.

## Completion behaviour

Draft completion atomically creates:

- One immutable `sales` header
- One immutable Service `sale_lines` record
- One converted draft link
- Activity history
- One command receipt

Draft completion creates no:

- Inventory movement
- Payment
- Payment allocation
- Invoice
- Banking transaction

The Sale channel is `appointment`, while settlement remains `not_recorded`.

## Offline boundary

Appointment completion remains supported by the existing ordered offline Appointment queue.

Appointment Sale draft creation, review and completion are online-only because the server must atomically verify:

- The Appointment is completed
- No other draft exists for the Appointment
- The draft version is current
- No Sale has already been created

A user may complete an Appointment offline, but the Sales draft can only be created after the Appointment command has synchronised.

## Permissions

Sales create permission controls draft creation, review and completion. This includes:

- Owner
- Manager
- Employee where Sales creation is allowed
- Approved custom Sales permission
- Guarded Founder test-write access

Normal Founder support sessions remain read-only.

## Alternatives considered

### Automatically create a Sale when the Appointment completes

Rejected. Appointment completion does not prove the final price, discount, settlement method or invoice treatment.

### Add a `draft` status to `sales`

Rejected. This would weaken the completed-only immutable Sale model and complicate reversal and Inventory guarantees.

### Store the draft only in browser local storage

Rejected. A cross-department business record must be workspace-owned, auditable and visible across authorised devices.

### Add Product lines during this slice

Deferred. Appointment-related Product consumption and resale rules require explicit Inventory ownership and must not be inferred from the Service booking.

## Risks

- A Service with no Appointment price snapshot requires manual price review before completion.
- The draft review currently produces one Service line only.
- Payment and invoice status remain unavailable until their owning ledgers are integrated.
- The latest Vercel account permission issue may prevent preview deployment even when GitHub validation passes.

## Future implications

The draft relationship provides a stable bridge for:

- Appointment-related Product consumption
- Customer invoice creation
- Payment allocation
- Customer balance history
- Unified Activity
- Reports distinguishing delivered Appointments from completed Sales and settled cash

These downstream integrations must continue to use linked records rather than copying Appointment or Sale state.

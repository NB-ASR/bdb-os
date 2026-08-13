# Appointment Foundation

## Decision

The existing `bookings` table is upgraded in place as the canonical BDB OS Appointment record.

Calendar owns Appointment scheduling and lifecycle. It references canonical Customers, Services and active workspace staff, while retaining historical snapshots needed to understand what was booked at the time.

## Business problem

Vanita needs a reliable daily schedule that connects each booking to the Customer and Service records already used elsewhere in BDB OS. The previous Calendar screen displayed representative data and could not safely create or change business records.

## Department ownership

Calendar owns:

- Appointment identity and reference
- Customer, Service and staff assignment
- Local booking date and time
- Service duration, preparation and recovery snapshots
- Booking source and optional room label
- Appointment notes
- Pending, confirmed, completed and cancelled lifecycle
- Appointment Activity history

Other departments remain authoritative for:

- Customer identity: Customers
- Service definition and default commercial value: Services
- Staff membership: Team
- Working hours, leave and staff eligibility: future Calendar workforce layer
- Rooms and resources: future Calendar resource layer
- Product stock: Inventory
- Commercial transaction: Sales
- Invoices, Payments and balances: Accounts
- Reminders and external delivery: Communications

## Command model

Browser clients receive RLS-scoped reads only. All Appointment mutations use the service-role-only `apply_appointment_command` function through `/api/appointments`.

Each command includes:

- Workspace and actor identity
- Stable idempotency key
- Optimistic expected version
- One explicit lifecycle action
- Activity command identifier

Supported actions are:

- `create`
- `update` for rescheduling or connected-record changes
- `confirm`
- `cancel`
- `complete`

The original Appointment is preserved. Cancellation and completion are state transitions, not deletion.

## Conflict boundary

This foundation atomically rejects overlapping effective staff time using a PostgreSQL exclusion constraint.

Effective occupied time includes:

- Preparation buffer before the booked start
- Service duration
- Recovery buffer after the Service

This is deliberately not described as full availability. The following remain separate integration work:

- Working hours
- Breaks and leave
- Staff-to-Service eligibility
- Room and resource conflicts
- Authorised scheduling overrides

## Historical snapshots

Appointments store Customer name, Service code/name, duration, buffers, price, VAT and workspace timezone snapshots.

When an Appointment is rescheduled without changing Service, its original Service snapshot remains. Changing the selected Service creates a new snapshot from the replacement Service.

This prevents later catalogue changes from silently rewriting historical bookings.

## Offline behaviour

Calendar caches Appointment and option data per workspace after a successful online load.

Supported commands may be queued offline and retain stable command IDs. They replay in order after reconnection. Synchronisation stops on the first conflict or validation error so later commands cannot overtake an unresolved dependency.

A cold offline start is not supported until that workspace has completed one online Calendar load.

## Department side effects

Creating, confirming, cancelling or completing an Appointment does not create:

- A Sale
- An invoice
- A Payment or Customer balance
- A bank transaction
- An Inventory movement
- A reminder or external message

Those effects require explicit future commands owned by their respective departments.

## Alternatives considered

### Create a new `appointments` table

Rejected. It would duplicate the established `bookings` identity and break existing Customer and notification foreign keys.

### Keep direct browser writes under RLS

Rejected. Direct writes cannot reliably enforce idempotency, optimistic versions, lifecycle rules, cross-record validation and atomic overlap handling in one consistent path.

### Implement all availability rules now

Rejected for this slice. Working hours, leave, eligibility and resources require their own records and acceptance tests. Combining them with the foundation would make the release harder to validate and encourage placeholder logic.

## Risks

- Room labels are informational until the resource model is integrated.
- A staff member may still be scheduled outside working hours or during leave until the next Calendar layer is complete.
- Appointment completion currently records operational completion only; staff must still create any Sale or financial record separately.
- Offline conflicts require user review after reconnection.

## Future implications

The next Calendar work should add staff working hours, leave, Service eligibility and rooms/resources against this canonical Appointment model. Appointment-to-Sale conversion should follow only after the scheduling lifecycle passes authenticated acceptance.

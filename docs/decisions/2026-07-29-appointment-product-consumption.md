# Appointment Product Consumption

## Decision

Products used internally during a Service are recorded as explicit, immutable Inventory movements linked to the completed Appointment.

The movement uses:

- `movement_type = internal_consumption`
- a canonical `appointment_id` foreign key
- the Product's recorded unit cost and workspace currency
- the physical Inventory location
- the responsible actor and command identity

Appointment completion itself creates no Inventory movement.

## Business problem

Vanita needs to track disposable and internally consumed supplies used while delivering Services. Staff must not reduce stock merely because an Appointment was booked or completed, because the actual quantity can vary and some Services consume no stock.

The workflow must also prevent resale stock from bypassing Sales.

## Department ownership

- **Calendar** owns the Appointment and Service-delivery lifecycle.
- **Inventory** owns Product quantities and immutable stock movements.
- **Sales** owns Products sold to the Customer.
- **Accounts, Payments and Banking** are unaffected.

The operational screen is discoverable from both Calendar and Inventory, but the trusted command and source of truth remain Inventory-owned.

## Connected records

Each posted consumption movement references:

- One workspace
- One completed Service Appointment
- One `purpose = supply` Product
- One active Inventory location
- One responsible actor
- Zero or one reversal movement

The movement retains Appointment, Customer, Service, Product and location snapshots in metadata for historical display, while foreign keys remain authoritative for identity.

## Product boundary

### Internal supplies

Products with `purpose = supply` may be posted as `internal_consumption` after the Appointment is completed.

### Resale Products

Products with `purpose = resale` cannot be posted through Appointment consumption. They may leave Inventory only through a completed Sale, where the commercial line and stock movement are created atomically.

### Legacy movement type

The existing `appointment_consumption` movement type remains in the historical ledger enum but is rejected for all new writes. New Appointment-linked usage always uses the general `internal_consumption` type plus the canonical Appointment foreign key.

## Command model

Two trusted service-role-only functions own the workflow:

- `post_appointment_product_consumption`
- `reverse_appointment_product_consumption`

Posting requires:

- A completed Appointment with a canonical Service
- An active supply Product
- An active Inventory location
- Inventory create permission
- A stable idempotency key

Reversal requires:

- The original linked consumption movement
- Inventory edit permission
- A clear reason
- A stable idempotency key

Browser clients cannot execute either database function directly.

## Immutability

Posted consumption is never edited or deleted. A correction creates one positive `reversal` movement linked through `reversal_of_id` and preserving `appointment_id`.

The original movement remains visible for auditability.

## Offline boundary

Consumption posting and reversal use the existing workspace-scoped Inventory command queue.

This means:

- Commands retain stable identities offline.
- Inventory commands replay in the same order as locations, transfers and manual corrections.
- Synchronisation stops on the first conflict or validation failure.
- The server revalidates Appointment status, Product purpose and location state when the command reaches the database.

A cold offline start requires one successful cached read first.

## Recorded negative stock

The command does not hide actual Product usage when the recorded balance is insufficient. Posting may create a negative balance, which exposes a stock discrepancy for receiving, stocktake or explicit adjustment.

Blocking the real usage would make the ledger less truthful. A future global negative-stock policy must be designed consistently across Sales, consumption, transfers and write-offs rather than added only to this workflow.

## Side-effect boundary

Posting or reversing Appointment Product consumption creates no:

- Sale or Sale line
- Invoice
- Payment or allocation
- Banking transaction
- Appointment status change

The workflow changes Inventory and Activity only.

## Alternatives considered

### Automatically consume Products when the Appointment completes

Rejected. The booking does not prove which Products or quantities were physically used.

### Store Product usage directly on the Appointment

Rejected. Calendar must not become a second stock ledger. The Appointment is linked to Inventory movements instead.

### Use `appointment_consumption` as a new movement type

Rejected for new writes. `internal_consumption` already describes the stock consequence; the Appointment foreign key supplies the business context without multiplying movement categories.

### Allow resale Products in the same form

Rejected. Resale requires a commercial Sale line, price, VAT and Customer transaction before stock changes.

### Create a separate offline queue

Rejected. Independent queues could reorder stock changes and create conflicting balances. Appointment usage shares the canonical Inventory queue.

## Risks

- The integration workspace currently has no active Inventory locations and no supply Products, so manual acceptance requires configuration first.
- Negative balances reveal existing stock inaccuracies and may require operational reconciliation.
- Product usage is entered after Appointment completion in Version 1; in-progress staging is deferred.
- The migrated Vercel account permission issue may continue to block preview deployment even when GitHub validation passes.

## Future implications

This linked movement model supports:

- Appointment-level consumable cost reporting
- Service margin analysis
- Customer and Appointment history
- Reorder forecasting
- Staff usage review
- Stocktake discrepancy analysis
- Unified Activity

Future reporting must distinguish internal consumption, resale stock-out and cash settlement rather than combining them into one revenue or stock metric.

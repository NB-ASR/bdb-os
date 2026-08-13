# Sales transaction foundation

## Decision

BDB OS records a Sale as one immutable commercial transaction with immutable Product and Service line snapshots.

A completed Product line creates an Inventory stock-out movement in the same database transaction. A completed Service line creates no Inventory movement.

## Business problem

The original Vanita workflow allowed mixed Product and Service baskets, Customer or walk-in Sales, discounts and staff-assisted checkout. BDB OS needs to retain that simple selling workflow without creating a second Product catalogue, a second Service catalogue or mutable stock quantities.

## Department ownership

Sales owns:

- the commercial transaction;
- the selected Customer or walk-in designation;
- the Product and Service line snapshots;
- quantity, selling price and discount history;
- VAT-inclusive transaction totals;
- completion and reversal lifecycle.

Connected departments retain their own responsibilities:

- Products owns catalogue identity and current standard selling price.
- Services owns catalogue identity, duration, current standard price and VAT.
- Inventory owns quantity movements.
- Customers owns the customer profile.
- Payments will own settlement and allocations.
- Accounts will own receivables and accounting postings.
- Calendar will own appointment conversion.

## Commercial snapshot

Sale lines preserve the Product or Service code, description, selling price, VAT rate and discount used at transaction time. Later catalogue changes do not rewrite completed history.

Prices are VAT-inclusive. Discounts reduce the displayed VAT-inclusive value. The VAT portion is derived from the final discounted total using:

`VAT = discounted total × VAT rate ÷ (100 + VAT rate)`

## Inventory orchestration

Product Sales require an active Inventory location.

Completing a Sale atomically:

1. validates the Customer, Products, Services and Inventory location;
2. creates the completed Sale;
3. creates immutable Sale-line snapshots;
4. creates one negative `sale` Inventory movement per Product line;
5. writes a Sale command receipt;
6. writes transactional Activity history.

If any step fails, the complete operation rolls back.

Service-only Sales do not require an Inventory location.

Negative stock remains visible rather than silently rejecting an otherwise valid offline command. This preserves operational truth and allows later reconciliation.

## Reversal

Completed Sales are not edited or deleted.

Reversal:

- preserves the original Sale and lines;
- marks the Sale as reversed with actor, time and reason;
- creates one positive Inventory reversal for every original Product stock-out;
- stores an idempotency receipt;
- writes Activity history.

A reversed Sale cannot be reversed again.

## Settlement boundary

Version 1 Sales does not create or claim:

- payments;
- invoice settlement;
- customer receivable balances;
- Banking reconciliation;
- Accounts postings.

Every completed Sale currently stores `settlement_status = not_recorded`. This is deliberate. “Completed” means the goods or services were sold, not that payment was received.

## Offline model

The basket remains a browser-local draft until completion.

Completion and reversal commands can be queued offline. Each command retains a stable idempotency key and replays in order. Synchronisation stops at the first conflict or validation error.

A queued Product Sale does not alter the local Inventory balance optimistically. The interface displays the Sale as pending until the authoritative atomic command posts both the Sale and Inventory movements.

## Security

- Authenticated browser clients receive RLS-scoped reads only.
- Trusted mutations are service-role-only.
- Active workspace membership and Sales permissions are required.
- Employees may complete Sales but cannot reverse them by default.
- Managers and Owners may complete and reverse Sales.
- Active Founder support sessions are always read-only.
- Command receipts are not available to browser roles.

## Version 1 scope

Included:

- mixed Product and Service baskets;
- optional Customer or walk-in Sale;
- line discounts and basket-level discount;
- VAT-inclusive totals;
- local basket drafts;
- offline completion and reversal queue;
- Product Inventory posting;
- immutable reversal;
- Activity history.

Deferred:

- payment recording and allocation;
- receipt and invoice document generation;
- Customer returns and partial refunds;
- staff attribution per line;
- appointment-to-Sale conversion;
- packages, memberships and gift vouchers;
- advanced promotions and discount approval thresholds.

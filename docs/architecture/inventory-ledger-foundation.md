# Inventory Ledger Foundation

## Decision

BDB OS Inventory uses an append-only movement ledger as the source of stock truth.

Current stock is derived by summing signed movements for one workspace, item and location. Posted stock movements are not edited or deleted. Corrections create reversing movements.

This is a reusable BDB OS department module. Beauty & Wellness terminology and defaults may alter presentation, but Vanita-specific fields do not belong in the core schema.

## Business problem

A mutable quantity field cannot explain why stock changed, cannot be reconstructed reliably, and creates unsafe conflict behaviour when multiple devices work offline.

The movement ledger provides:

- traceable receipts, sales, service consumption, transfers, adjustments and write-offs;
- deterministic current stock;
- stable offline retries without duplicate quantity changes;
- workspace isolation at every relationship;
- correction history without destructive edits;
- links to the business event that caused each movement.

## Department ownership and connections

Primary owner: **Inventory**.

Inventory connects to:

- suppliers and purchase documents;
- customers and returns;
- appointments and service consumption;
- sales, invoice lines and payments;
- supporting documents;
- activity and audit history.

Version 1 stores a typed source reference (`source_type`, `source_id`) rather than coupling Inventory to every future module table. Explicit workspace-safe foreign keys can be introduced for mature, stable relationships later.

## Core records

### `inventory_locations`

A workspace-owned place where stock is held, such as a shop, treatment room, vehicle or storage area.

A workspace may have one default location. Locations can be made inactive without deleting their ledger history.

### `inventory_items`

A workspace-owned product or consumable with:

- SKU;
- neutral name;
- resale or consumable purpose;
- unit label;
- reorder point and target quantity;
- current unit cost;
- optional resale price;
- active and stock-tracking state.

Services remain non-stock records and are not represented as Inventory items.

### `inventory_movements`

The append-only stock ledger. Each row records:

- workspace, item and location;
- signed quantity delta;
- movement type;
- client-generated movement ID;
- workspace-scoped idempotency key;
- server command ID and actor;
- occurrence and posting timestamps;
- optional source reference, note and metadata;
- optional transfer group or original movement being reversed.

## Ledger invariants

1. Every item, location and movement belongs to one workspace.
2. Composite foreign keys prevent cross-workspace item, location and reversal references.
3. Quantity delta is never zero.
4. Receipts, customer returns and transfer-ins are positive.
5. Sales, appointment consumption, supplier returns, transfer-outs and write-offs are negative.
6. Manual adjustments may be positive or negative.
7. A transfer is one database transaction containing paired transfer-out and transfer-in movements with the same quantity and transfer group.
8. A posted movement cannot be updated or deleted.
9. One original movement may have at most one reversal.
10. A reversal uses the original item and location and negates the original quantity.
11. One workspace cannot accept the same movement idempotency key twice.

## Current stock

`inventory_stock_balances` is a security-invoker view derived from the ledger:

```text
quantity = sum(inventory_movements.quantity_delta)
```

It is grouped by workspace, item and location. Cached balances may be added only if they remain rebuildable and continuously checked against the ledger.

Negative stock is permitted in Version 1 so offline work is not silently rejected. The interface presents it as an explicit correction warning and increases the suggested reorder quantity.

## Trusted command boundary

Browser clients may read Inventory through RLS but cannot directly insert, update or delete ledger rows.

`/api/inventory`:

1. authenticates the user;
2. validates an active membership in the requested workspace;
3. requires an idempotency key for every mutation;
4. validates and normalises command input;
5. calls service-role-only database RPCs;
6. returns the committed result.

Database RPCs write the movement and activity entry within the same transaction.

## Offline-first behaviour

Inventory commands use client-generated UUIDs and stable command IDs.

When offline:

1. the command is stored in a workspace-specific local queue;
2. the local ledger projection is updated immediately;
3. the interface marks the change as pending;
4. reconnect triggers ordered retry;
5. the same command ID is reused as the `Idempotency-Key`;
6. successful commands are removed from the queue;
7. failed commands remain visible for retry or deliberate discard.

The cloud database remains authoritative after synchronization. The queue is not a second permanent source of truth.

## RLS and tenancy

- Anonymous users have no Inventory access.
- Authenticated users receive select privileges only.
- RLS checks the active workspace entitlement for the Inventory feature.
- Mutations execute through reviewed server commands and service-role-only RPCs.
- Composite workspace foreign keys prevent tenant relationship leakage even if application validation fails.

## Version 1 scope

Included:

- items and stock locations;
- opening balances;
- purchase receipts;
- sales and appointment consumption movement types;
- customer and supplier returns;
- manual adjustments;
- paired transfers;
- write-offs;
- reversals;
- low-stock thresholds;
- current stock by location;
- offline command queue and idempotent retry;
- activity history;
- local browser preview mode.

Deferred:

- supplier catalogue and purchasing workflow UI;
- purchase orders and goods-received documents;
- automatic appointment consumption recipes;
- invoice and sale-line automation;
- batches, serial numbers and expiry dates;
- demand forecasting;
- automated purchasing agents;
- complex warehouse workflows;
- FIFO, LIFO and advanced accounting valuation.

## Migration and rollback

The schema is introduced through ordered repository migrations. Shared Supabase environments must only receive these migrations after the dependent pull request is accepted.

Rollback must not discard posted business history. Before production use, rollback means removing the unused feature and new empty schema. After real movements exist, rollback means disabling the module while retaining ledger tables and exporting data; destructive down migrations are not acceptable.

## Test strategy

The implementation includes:

- domain tests for signed movements, location balances, transfers, negative stock and reversals;
- static contracts for append-only grants, workspace foreign keys, RLS, idempotency, command boundaries and offline queue behaviour;
- pgTAP checks for tables, view, RLS, privileges, immutability trigger, constraints and RPC availability;
- full migration replay in CI;
- TypeScript, lint and production build validation;
- browser journeys after the dependent PR environment is available.

## Dependency and integration sequence

This branch is based on `matthew/workspace-template-foundation` and must not be merged into `main` independently of that foundation.

Safe sequence:

1. merge PR #20;
2. rebase or retarget the Inventory branch to updated `main`;
3. rerun all CI checks;
4. review the migration and security contracts;
5. merge the Inventory pull request;
6. apply committed migrations through the normal deployment process;
7. seed test Inventory records in non-production workspaces only.

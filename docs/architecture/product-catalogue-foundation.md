# Product Catalogue Foundation

## Decision

BDB OS Products is the first operational capability restored after the Vanita visual-first migration.

Products owns reusable product definitions. Inventory owns quantities and stock movements. Suppliers own supplier organisations, while supplier-specific product codes, costs and purchasing terms will live in a separate Product–Supplier relationship.

## Business problem

Purchasing, Inventory, Sales, invoices and appointment consumption all need to reference the same product definition. Without a shared catalogue, each department would create partial or duplicated product records and historical transactions would become inconsistent.

## Department ownership and connections

Primary owner: **Catalogue & Stock → Products**.

```text
Product
├─ Product–Supplier relationships
├─ Purchasing document lines
├─ Inventory movements
├─ Sales lines
├─ Invoice lines
└─ Appointment consumption
```

Products does not own stock quantity, supplier balances, sales totals or invoice balances.

## Core record

`public.products` is workspace-owned and stores:

- SKU;
- name;
- optional barcode;
- optional brand and category;
- resale or business-supply purpose;
- unit label;
- current catalogue unit cost;
- optional selling price;
- VAT rate;
- reorder level;
- notes;
- active or archived lifecycle state;
- optimistic concurrency version;
- creation and update actors and timestamps.

SKU is unique within a workspace. Non-empty barcode is also unique within a workspace.

## Stock boundary

The Products table deliberately has no quantity column.

Opening stock, supplier receipts, credit-note returns, sales, appointment consumption, transfers, write-offs and corrections must become Inventory movements. Current stock will be derived from the Inventory ledger.

## Supplier boundary

A Product may have zero, one or several Suppliers. Therefore the Product record does not contain a supplier foreign key.

The next functional slice will introduce a Product–Supplier relationship for:

- supplier product code;
- preferred-supplier status;
- supplier-specific cost;
- lead time;
- minimum order quantity;
- last purchase cost;
- relationship lifecycle.

## Lifecycle

Products are archived rather than deleted.

Archived records remain available to historical supplier documents, Inventory movements, Sales, invoices and appointment history. Restoration reactivates the same record and identity.

## Trusted command boundary

Authenticated browser clients receive RLS-scoped reads only. They cannot insert, update or delete Products directly.

`/api/products`:

1. authenticates the session;
2. validates the requested workspace and active membership;
3. validates product input;
4. requires a stable idempotency key;
5. calls the service-role-only `apply_product_command` RPC;
6. returns the committed Product result.

The RPC supports create, update, archive and restore. It writes the Product, command receipt and Activity record transactionally.

Founder support sessions remain read-only because they do not have a workspace membership and never receive the service-role command path.

## Idempotency and offline retry

Every mutation uses a client-generated stable command ID as its idempotency key.

`product_command_receipts` stores the committed result by workspace and idempotency key. Retrying the same command returns the original result without repeating the mutation or Activity record.

Offline Product commands are stored in a workspace-specific local queue and replayed in order when connectivity returns.

## Conflict handling

Each Product has a monotonically increasing integer `version`.

Update, archive and restore commands must provide the version last read by the client. A mismatched version is rejected rather than overwriting a newer change from another device.

The user must refresh and deliberately reconcile the change. BDB OS does not silently apply last-write-wins behaviour to operational catalogue records.

## Offline behaviour

Included in this slice:

- cached catalogue reads;
- local create, edit, archive and restore projection;
- durable workspace-specific command queue;
- ordered retry;
- stable idempotency keys;
- visible pending state;
- visible conflict and duplicate errors;
- deliberate queue discard.

The cloud database remains authoritative after synchronization. Barcode scanning, bulk import and cross-device conflict resolution require cloud connectivity or later platform support.

## Security and tenancy

- Every Product belongs to one workspace.
- SKU and barcode uniqueness are workspace-scoped.
- Anonymous users have no Product access.
- Authenticated reads are controlled by the existing Products entitlement and RLS permission function.
- Browser clients receive no Product mutation privileges.
- Mutation RPCs are executable only by `service_role`.
- The command validates the actor's active workspace membership, profile, workspace status, entitlement and access profile.
- Every successful mutation creates an Activity item.

## Version 1 scope

Included:

- create Product;
- edit Product;
- archive Product;
- restore Product;
- search and lifecycle filters;
- workspace-scoped SKU and barcode validation;
- VAT, pricing and reorder definition;
- offline cache and command queue;
- optimistic concurrency;
- Activity history;
- Founder support read-only enforcement.

Deferred:

- Product–Supplier relationships;
- supplier-specific codes and costs;
- bulk import;
- camera barcode scanning;
- images and attachments;
- variants;
- batches, serials and expiry dates;
- Inventory quantity and movements;
- Purchasing document matching;
- Sales and appointment automation.

## Alternatives considered

### Reuse `inventory_items` as Products

Rejected. A Product catalogue definition is broader than a stock-tracked item and must exist before Inventory is enabled. Services and non-stock commercial products should not be forced into an Inventory-led schema.

### Put one Supplier directly on Products

Rejected. It would prevent multiple Suppliers and mix relationship-specific fields into the shared Product definition.

### Direct browser writes under RLS

Rejected. Product changes require idempotency, optimistic concurrency, Activity logging and consistent validation across online and offline clients.

### Last-write-wins offline edits

Rejected. Silent overwrites would make catalogue prices, VAT and identifiers unreliable.

## Risks

- The local queue currently uses browser local storage rather than the final IndexedDB persistence layer.
- A queued stale edit requires deliberate user resolution after another device changes the Product.
- Catalogue unit cost is a current definition and must not replace historical costs captured on Purchasing or Sales lines.
- Product and future Inventory schemas must be joined carefully to avoid duplicate item identities.

## Future implications

The Product identity becomes the stable reference for Purchasing, Inventory, Sales, invoices and appointment consumption.

The next functional slice should add Suppliers and Product–Supplier relationships before Purchasing or Inventory writes are enabled.

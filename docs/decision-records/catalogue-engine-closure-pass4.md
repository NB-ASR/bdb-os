# Catalogue Engine V1 — Pass 4 Closure and Freeze

## Decision
Catalogue Engine V1 is the canonical workspace-owned source for Product, Service and Product ↔ Supplier master data. Pass 4 closes the engine by freezing its cross-department boundaries rather than introducing another Catalogue layer.

Inventory references canonical Products but owns stock locations, immutable movements and quantity. Purchasing references canonical Suppliers, Products and Product ↔ Supplier relationships but owns supplier documents, extracted/reviewed line history and purchasing events. Sales and Accounts reference canonical Product/Service identities while retaining transaction/document snapshots so historical commercial facts do not change when Catalogue masters are later edited. Calendar references canonical Services while retaining the booked Service values needed for appointment history and availability. Customer 360 composes downstream operational and financial records; it does not duplicate Catalogue masters or invent a second financial truth.

Catalogue lifecycle commands may change Catalogue masters, command receipts and activity history only. They must not silently create Inventory movements, Sales, invoices or Appointments. Downstream posting remains an explicit action owned by the relevant department.

## Reason
BDB OS is valuable because departments share the same business records without becoming one coupled subsystem. Product and Service identity must be stable enough to connect Inventory, Purchasing, Sales, Accounts, Calendar and Customer history, while each department remains authoritative for its own operational facts.

Creating duplicate Product/Service records inside downstream departments would fragment reporting and customer history. Conversely, making Catalogue own stock, invoices, sales or appointment availability would turn a reusable master-data engine into a tightly coupled monolith and make offline recovery, accounting permanence and future maintenance harder.

Passes 1–3 already established Catalogue correctness, offline reliability and bounded scale. Pass 4 therefore freezes the integration contract and adds regression coverage instead of adding new user-facing capability.

## Alternatives considered
- Copy Product and Service data into each department as independent masters. Rejected because it creates conflicting identities and breaks the connected Business OS model.
- Make Catalogue responsible for stock quantity, financial posting and appointment availability. Rejected because those are Inventory, Accounts/Sales and Calendar responsibilities and would couple unrelated lifecycle rules.
- Remove historical snapshots and always read the latest Catalogue values. Rejected because past Sales, invoices and Appointments must remain historically accurate after a Product or Service is edited or archived.
- Add a new cross-department orchestration table for V1. Rejected because the existing workspace-scoped foreign keys and downstream records already provide the required connection; another table would duplicate state without solving a V1 problem.

## Risks
Future features may be tempted to bypass canonical Catalogue IDs, calculate stock inside Product screens, or make financial/appointment records depend on mutable current Catalogue values. These shortcuts can initially look simpler but would damage historical accuracy and create parallel sources of truth.

The Pass 4 pgTAP closure contract therefore checks the core workspace-scoped foreign keys, required downstream snapshots, Customer 360 composition and the absence of silent downstream posting inside Catalogue lifecycle commands.

## Future implications
Catalogue Engine V1 should be treated as frozen after the Pass 4 closure gates are green and the closure PR is merged. Future changes should normally be additive usability improvements or explicitly versioned capabilities. Any change that alters Product, Service or Product ↔ Supplier identity semantics, downstream ownership, offline command guarantees or bounded-register behaviour requires an explicit architectural decision and regression coverage before implementation.

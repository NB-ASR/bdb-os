# Decision Record — Accounts Invoice Polish V1

Date: 2026-08-18

## Decision

BDB OS direct Invoice creation will treat entered unit prices as **exclusive of VAT**. VAT is calculated on the net amount after any discount and added on top. The normal Invoice creation experience will not ask for or print a payment due date, and it will not print a permanent payment-instructions/footer block.

The document creator will clearly distinguish:

- **Description** — customer-facing text that is printed on the Invoice.
- **Notes** — internal-only context that is never printed on the Invoice.

Invoice, Credit Note and Delivery Note creation will use a full-screen document composer rather than the previous narrow scrolling modal. Business documents will retain the existing authoritative records, commands, permissions, idempotency, offline queue and workspace isolation.

The customer-facing Invoice template will use a professional Bill To / document-details structure, SKU / Code, quantity, VAT-exclusive unit price, VAT and amount columns, totals, client signature area, optional paid client logo, and a subtle `Powered by BDB` mark.

## Reason

The released document engine was structurally safe but the creation UX was cramped and the Invoice template was below the professional standard expected of an operating system used for real customer billing. More importantly, the previous direct-Invoice line calculation treated the entered unit price as VAT-inclusive and backed VAT out of it. For a line entered as EUR 2.50 at 18% VAT, the expected direct-Invoice result is EUR 2.50 net + EUR 0.45 VAT = EUR 2.95 total.

## Alternatives considered

1. Keep VAT-inclusive entry and add a toggle. Rejected for V1 because it increases ambiguity and makes the primary Invoice flow harder to understand.
2. Rewrite Sales pricing at the same time. Rejected because Sales currently has its own proven pricing snapshots and this release must not silently rewrite completed or sale-derived transactions.
3. Remove due-date fields from the database entirely. Rejected because historical issued Invoices already contain due dates and the Accounts balance architecture must preserve history. New drafts simply default to no due date.
4. Create a new Invoice/PDF subsystem. Rejected because it would duplicate the existing One Engine records and commands.

## Risks

- Catalogue/Sales pricing semantics and direct-Invoice pricing semantics are not yet fully unified. Direct Invoice now explicitly treats catalogue prices as VAT-exclusive when used in the Invoice builder, while existing Sales snapshots are preserved. This needs a separate One Engine pricing-semantics decision rather than a hidden cross-department rewrite.
- Existing issued Invoices remain historically unchanged. Only editable direct draft Invoices created under the former VAT-inclusive interpretation are recalculated by the migration.
- The HTML/print renderer can show an entitled client logo through the existing signed branding asset. The lightweight generated PDF remains intentionally dependency-free and does not embed arbitrary remote client image assets.

## Future implications

A later One Engine pricing consolidation should define one explicit catalogue price basis and ensure Sales, Invoices, quotations and future transaction entry points all consume it consistently. That work should be deliberate and migration-safe, not folded into this presentation correction.

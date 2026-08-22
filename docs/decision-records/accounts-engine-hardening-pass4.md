# Accounts Engine Hardening V1 — Pass 4

## Decision
Supplier Payables must use the same bounded-register discipline as Sales before Accounts V1 is considered closed. Browser state may keep only a recent workspace-scoped working set; deep Supplier financial history remains cloud-backed and is loaded on demand.

Supplier financial commands also inherit the customer-side integrity rules already established in Accounts: idempotency keys are bound to canonical command input, ambiguous command outcomes remain queued for safe retry, and only confirmed server rejections may be discarded.

## Reason
The previous Supplier Payables screen downloaded complete document, payable, Payment, allocation, balance and Supplier collections into one browser bundle. That works with a nearly empty ledger but becomes progressively slower and creates an unnecessary memory/offline-cache burden as a business grows. Its offline queue also allowed an ambiguous financial outcome to be discarded, and Supplier RPC receipts did not independently prove that an idempotency key represented the same command input.

## Alternatives considered
- Keep the existing full-ledger bundle until customers become larger. Rejected because it knowingly embeds a scale cliff in the V1 accounting engine.
- Build a separate Supplier accounting subsystem. Rejected because it would duplicate the scalable register and command patterns already proven in Accounts.
- Cache the entire Supplier ledger for stronger offline history. Rejected because BDB OS offline-first means a reliable bounded working set plus ordered commands, not an unlimited replica of financial history in browser storage.

## Risks
More paged reads introduce cursor/search state and require indexes that match the register access patterns. The new Supplier summary RPC is a trusted server read boundary and must remain unavailable to browser roles. Financial pagination must never be used to calculate totals in the browser; aggregates are computed in PostgreSQL.

## Future implications
Once Pass 4 torture tests and full CI are green, Accounts Engine V1 can be closed as an engine milestone. Future Accounts work should then focus on usability and visual refinement unless a new accounting capability explicitly changes the ledger model.

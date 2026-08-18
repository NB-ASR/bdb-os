# Decision Record: Client Usage Metering V1

## Decision made

BDB OS will measure client usage per workspace inside the shared multi-tenant platform before any usage-based charging is activated. V1 is Founder-only and measurement-only.

## Reason

BDB needs defensible per-client consumption evidence to protect margin and design future package allowances without exposing raw provider billing or making customer workflows dependent on a billing meter.

## Alternatives considered

- Separate Supabase project per client: rejected because it fragments the one-engine architecture and adds operational overhead.
- Allocate the shared Supabase invoice across clients: rejected because provider costs do not map cleanly to understandable customer usage.
- Mutable counters only: rejected because retries and failures can silently drift.
- Automatic charging in the first release: rejected because meters must be observed and validated first.

## Risks

Recorded outbound Email is durable BDB communication evidence but not yet provider-delivery evidence. SMS transport does not yet exist and therefore must remain explicitly unmetered. UTC calendar-month periods are a V1 simplification until subscription anniversary billing requires a different period model.

## Future implications

The append-only event ledger, point-in-time baselines, frozen period allowance snapshots and existing Plans relationship provide the foundation for later workspace allowance overrides, overage calculation, provider reconciliation and Stripe charging without replacing the measurement engine.

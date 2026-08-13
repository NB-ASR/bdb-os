# Decision: Business Hub and Reports are read-only orchestration

**Date:** 2026-08-02

## Decision

The Business Hub and Reports will aggregate authoritative department read models and will not own copies of operational or financial records.

Monetary metrics remain separated by recorded currency. The Business Hub presents one useful signal per department and routes actions to the exact source record.

## Reason

A separate Hub ledger or dashboard store would duplicate business truth, weaken permissions and create reconciliation problems. The integrated departments already own the records required by the Hub.

A circular business map is also more consistent with the BDB OS product identity than the previous rectangular module dashboard.

## Alternatives considered

### Continue calculating from the shared browser store

Rejected. The browser store is not the authoritative integration boundary and cannot represent all source ledgers, RLS or offline freshness accurately.

### Create a denormalised Hub table

Rejected for Version 1. It would introduce synchronisation and invalidation logic without solving a business problem that security-invoker views cannot solve.

### Build a configurable analytics dashboard

Deferred. Widget builders, cross-currency conversion and custom BI are unnecessary for the Version 1 operating system.

## Risks

- Large source tables may eventually require materialised or incremental projections.
- A security-invoker view can expose only what the caller can read, so incomplete permissions can produce partial signals.
- Exact source routes require department pages to preserve stable query-parameter contracts.
- Browser-cached snapshots can become stale and must always be labelled as cached.

## Future implications

- New departments should contribute a read-only signal and attention contract rather than writing into a Hub-owned table.
- Reporting can add verified metrics only after the owning ledger exists.
- Exchange-rate conversion, profit and tax calculations require explicit accounting decisions and are not inferred from current records.
- Performance optimisation may replace views with controlled projections later without changing the API contract.

# Accounts Engine Hardening V1 — Pass 1

## Decision

Before further Accounts visual refinement, BDB OS will harden the financial integrity boundary. Pass 1 keeps the current Accounts product architecture and changes only the rules required to make financial commands safe under credits, retries, concurrency and long-lived workspace settings.

The database remains the final authority for financial integrity. Browser/API validation may improve error messages, but it is never the only protection.

## Reason

The Accounts UX is now coherent enough for design refinement, but the engine audit found edge cases that normal clicking would not expose: Payment allocation could ignore Credit Notes, repeated partial Credit Notes could accumulate rounding residue, concurrent Delivery Notes could over-deliver a source, legacy authenticated RPCs could bypass current rules, Payment Terms were not consistently honored, base currency could change after financial history existed, and idempotency keys were not bound to the command input.

These are V1 reliability issues. Cosmetic refinement must not hide unresolved accounting risk.

## Chosen rules

- Payment capacity is calculated from original Invoice total minus issued Credit Notes minus posted Payment allocations.
- A Credit Note may reference a source Invoice line once per note. The final credited quantity absorbs the exact remaining source amounts at four-decimal precision.
- A Delivery Note may reference a source line once per note. Issue locks the source Invoice/Sale and revalidates delivered quantity after the lock is acquired.
- Final-first Invoice creation uses workspace `payment_terms_days` when no explicit due date is supplied.
- Workspace base currency cannot change after financial activity exists.
- Historical legacy financial RPC definitions may remain for migration readability, but browser roles cannot execute them.
- Private financial helpers are service-only.
- An Accounts idempotency key is permanently bound to a canonical SHA-256 request hash. Reuse with changed input is rejected.
- Internal document Note retries with the same identity become replay-safe rather than failing after a lost response.

## Alternatives considered

- Rely on UI validation only: rejected because offline commands, parallel devices and direct API calls must not bypass accounting rules.
- Rewrite the Accounts engine: rejected because the existing architecture and current BDB financial data are sound; targeted hardening is safer.
- Drop historical RPCs/functions entirely: rejected because retaining definitions helps migration/history reconciliation. Revoking browser execution achieves the safety goal without erasing history.
- Allow workspace currency changes and make every balance multi-currency immediately: deferred. V1 uses one stable base currency; full multi-currency accounting is a later feature.

## Risks

- The migration changes several trusted database functions, so disposable migration replay and pgTAP must pass before Production is considered.
- Delivery Note concurrency must be validated in a disposable environment; structural locking tests alone are not sufficient final proof.
- Existing integrations that improperly called legacy browser RPCs will stop working. This is intentional; they must use the current server command boundary.

## Future implications

This pass establishes the invariant that Accounts commands are deterministic, replay-safe and protected at the database boundary. Later passes can focus on document permanence, offline working data/payment workflow, and scale/torture testing without reopening these financial rules.

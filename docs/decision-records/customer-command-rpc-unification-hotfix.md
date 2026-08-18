# Customer command RPC unification hotfix

## Decision
Use one authoritative `public.apply_customer_command` RPC signature, including the optional Customer VAT number, and remove the overlapping legacy overload.

## Reason
The Accounts business-document release added VAT support by overloading the existing Customer command function. The browser Customer workflow then became stuck in `Pending sync` because the server command path was not reliably resolving/confirming the write. A normal online Customer save must have one deterministic server contract.

## Alternatives considered
- Keep both overloads and continue relying on PostgREST argument resolution: rejected because the Customer create path is currently a Production blocker.
- Bypass commands and insert directly into `customers`: rejected because this would break permission, audit, idempotency and offline-command architecture.

## Risks
Dropping the legacy overload requires all application callers to use the VAT-aware signature. The current Customer API already does so. Full migration replay and database contracts must pass before Production.

## Future implications
Customer writes remain one audited, idempotent command path. VAT is part of the same Customer record rather than a separate document-only identity system.

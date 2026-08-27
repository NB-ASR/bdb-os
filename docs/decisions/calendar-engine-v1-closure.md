# Calendar Engine V1 Closure

Status: Closure complete; Production migrations applied and verified
Branch: `codex/vanita-final-stabilisation-2026-08-31`
Base: `6b49fe6a826ba7a3aa874ce7f207d6ad1fa10162`

## Decision

Calendar Engine V1 will close around one trustworthy Appointment schedule. Calendar owns Appointment lifecycle, staff availability, room availability and staff-to-Service booking eligibility. Customer, Service, staff and room identities remain owned by their canonical records; downstream Sales and Inventory records remain owned by those departments.

## Reason

The existing Calendar foundation already contains the core scheduling business model. The remaining closure work should harden reliability, offline behaviour, scale, timezone handling and cross-engine integrity rather than expand Calendar into workforce, communications or document management.

## Agreed four-pass scope

1. Pass 1 — Canonical Integrity & Command Hardening
2. Pass 2 — Offline, Scale & Timezone
3. Pass 3 — Availability UX & Cross-Engine Integrity
4. Pass 4 — Torture, Security & Closure

## Pass 1 — Canonical Integrity & Command Hardening

Goal: ensure every Calendar write has one trustworthy command identity and cannot expose or replay another actor's result through an idempotency key.

Included:
- Keep `bookings` as the canonical Appointment record.
- Keep Calendar working hours, recurring breaks, staff leave and rooms as the canonical availability records.
- Keep `calendar_staff_service_eligibility` as the canonical relationship governing which active staff may perform each Service.
- Bind every Appointment, availability and Service-eligibility idempotency key to one workspace, command domain, actor and canonical request hash.
- Perform authorization before any receipt replay or command-claim lookup.
- Preserve existing tested scheduling business rules behind hardened runtime wrappers rather than rewriting them in parallel.
- Revoke service-role runtime access to the legacy command functions so application traffic cannot bypass the hardened wrappers.
- Preserve richer Appointment reschedule history by recording before/after Customer, Service, staff, date, time, room, status and version snapshots in Activity metadata.
- Preserve existing Customer, Accounts, Sales, Banking and Inventory semantics unchanged.

Exit condition:
- Clean migration replay succeeds.
- Calendar pgTAP and static contracts prove authorization-before-replay, actor/payload-bound idempotency, service-role-only hardened entry points and intact scheduling business rules.
- Full BDB OS validation remains green before Pass 2 begins.

## Passes 2–4 — Soft-launch closure

The remaining passes are deliberately limited to the workflows needed for the
Vanita pilot:

- Offline queues are bound to the authenticated actor and workspace, bounded in
  size, replay the same command identity, and distinguish confirmed rejection
  from an ambiguous failure that must remain retryable.
- Calendar caches fail closed until the current actor and workspace are known;
  stale data cannot be restored across accounts.
- Calendar reads are workspace scoped, date bounded and capped. Rooms and
  Service/staff eligibility are returned by the canonical Appointment API and
  enforced in the booking UI.
- Workspace timezones drive display and availability calculations. The database
  rejects invalid IANA zones and nonexistent DST wall-clock times while retaining
  the canonical UTC value.
- Appointment creation, rescheduling, cancellation, availability, staff/room
  conflicts, leave/break conflicts, archived relationships, cross-workspace
  relationships and optimistic version checks remain enforced by the existing
  command layer and regression suite.
- Sales handoff and Inventory consumption remain explicit downstream actions;
  completing an Appointment does not silently create money or stock movements.

Exit condition:

- TypeScript, ESLint, unit, build, migration-history and Calendar static contracts
  pass on the exact candidate SHA.
- Clean replay and Calendar pgTAP cover command identity, authorization,
  availability, eligibility and timezone integrity.
- Production deployment and smoke tests pass before Calendar V1 is frozen.

## V1 boundary

- Calendar schedules and manages Appointments.
- Customers owns Customer identity and Customer history.
- Services owns Service definitions, duration, buffers, price and VAT source values.
- Workspace membership owns staff identity/access.
- Calendar owns room scheduling and staff availability rules.
- Sales owns Appointment-to-Sale drafts and final Sales records.
- Inventory owns Appointment Product consumption and reversals.
- Calendar completion itself must not create invoices, Payments, Banking activity or Inventory movements.
- Meetings and Timesheets are deferred from Calendar Engine V1. Their current pages are visual drafts only and must not pull invitation, Documents, payroll or workforce scope into this closure.

## Alternatives considered

- Rewrite all three Calendar command functions in one new implementation. Rejected because it duplicates mature scheduling rules and increases regression risk.
- Leave current receipt replay behaviour unchanged. Rejected because an idempotency key is not currently bound to the original actor/request and replay occurs before authorization.
- Build Meetings and Timesheets while Calendar is open. Rejected for V1 because they introduce separate Communications, Documents, attendance and payroll responsibilities.

## Risks

- Renaming existing functions and recreating hardened wrappers must preserve exact function signatures and API compatibility; clean migration replay is mandatory.
- Old receipts cannot prove their original request payload. They are therefore backfilled as legacy claims and cannot be silently reused as new runtime requests.
- Browser timezone support depends on the deployed runtime's IANA timezone data;
  unsupported values fail closed rather than falling back to a different zone.

## Future implications

After Calendar V1 is frozen, reopen it only for a verified Calendar defect or an explicit scope decision. Meetings, Timesheets, advanced reminders, external calendar sync and workforce/payroll features should be evaluated separately rather than quietly expanding the frozen Appointment engine.

## Guardrails

- No Accounts or Customer engine semantic changes.
- No duplicate Appointment/availability/eligibility sources of truth.
- No paint-job work during closure passes unless required to expose correct engine behaviour.
- No Meetings or Timesheets implementation in Calendar V1.
- Do not merge to `main` until all four Calendar passes and the final closure audit are complete.

# Calendar V1 Operational Acceptance Checklist

This checklist revalidates the already-closed Calendar engine against the newer BDB OS V1 closure rule:

`Pass 1 → Pass 2 → Pass 3 → Pass 4 → Customer Operational Acceptance → exact-head green → merge → Production verification → V1 Closed/Live`

Calendar architecture is not reopened by this work. The purpose is to prove the customer-visible V1 workflow on the exact release candidate.

## Calendar V1 boundary

Calendar V1 owns:

- Appointment create, reschedule, confirm, cancel and complete lifecycle
- workspace-scoped working hours
- recurring staff breaks
- staff leave
- rooms/resources
- staff-to-Service eligibility
- offline Appointment queue/replay
- workspace timezone handling and conflict enforcement

Customer, Service, staff, Sales and Inventory remain owned by their canonical departments.

Meetings, Timesheets, advanced reminders and external calendar synchronisation remain deferred and must not appear in the Calendar V1 action hierarchy.

## Exact-candidate browser acceptance

| Visible action / rule | Expected result | Exact-candidate proof |
| --- | --- | --- |
| Configure working hours | Owner can save a staff schedule | `calendar-operational-acceptance.spec.ts` |
| Add/edit/archive recurring break | Lifecycle persists through Calendar commands | `calendar-operational-acceptance.spec.ts` |
| Add/edit/cancel leave | Lifecycle persists through Calendar commands | `calendar-operational-acceptance.spec.ts` |
| Create/edit/archive/restore room | Room lifecycle persists and returns to active use | `calendar-operational-acceptance.spec.ts` |
| Assign/remove staff eligibility | Service assignment is customer-operational | `calendar-operational-acceptance.spec.ts` |
| Create Appointment | Canonical Appointment is persisted | `calendar-operational-acceptance.spec.ts` |
| Working-hours rejection | Invalid slot is rejected with a customer-facing reason | `calendar-operational-acceptance.spec.ts` |
| Break rejection | Break conflict is rejected with a customer-facing reason | `calendar-operational-acceptance.spec.ts` |
| Confirm Appointment | Pending Appointment becomes confirmed | `calendar-operational-acceptance.spec.ts` |
| Reschedule Appointment | Confirmed Appointment moves with optimistic versioning | `calendar-operational-acceptance.spec.ts` |
| Cancel Appointment | Appointment remains in history as cancelled | `calendar-operational-acceptance.spec.ts` |
| Complete Appointment | Appointment reaches completed lifecycle without creating financial/stock effects | `calendar-operational-acceptance.spec.ts` |
| Offline create + reconnect | Appointment command queues locally and replays once | `calendar-operational-acceptance.spec.ts` |
| Deferred Meetings / Timesheets | Not present in Calendar V1 navigation | browser + static acceptance contract |

## Existing four-pass evidence retained

The existing Calendar closure remains authoritative for:

- command identity, authorization-before-replay and idempotency
- RLS and trusted mutation boundaries
- staff and room overlap rules
- availability and staff-to-Service eligibility
- offline actor/workspace isolation and ambiguous retry handling
- bounded Calendar reads
- workspace timezone and DST integrity
- cross-engine ownership with explicit Sales and Inventory handoffs

See `docs/decisions/calendar-engine-v1-closure.md`.

## Merge gate

Do not merge this revalidation PR until all of the following are green on the exact final head:

- BDB OS V1 Validation
- BDB OS V1 Customer Operational Acceptance
- BDB OS V1 Calendar Operational Acceptance
- both Vercel preview checks
- no unexplained customer-visible Calendar dead/deferred controls

After merge, Production verification must confirm:

- the merge commit is the active production deployment
- Calendar production migrations/functions remain present
- no new Appointment / Availability / Eligibility runtime errors appear
- the Calendar engine remains within the frozen V1 boundary

Only then may Calendar be treated as revalidated **V1 Closed / Live** under the newer closure standard.

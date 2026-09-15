# Calendar V1 Operational Acceptance

This document is the visible-action inventory and proof map required by the BDB OS V1 closure standard. It revalidates the already-frozen Calendar engine without reopening Calendar ownership, schema, commands or cross-engine semantics.

The release sequence remains:

`Pass 1 -> Pass 2 -> Pass 3 -> Pass 4 -> Customer Operational Acceptance -> exact-head green -> merge -> Production verification -> V1 Closed/Live`

## Calendar V1 boundary

Calendar V1 operationally owns Appointment lifecycle, working hours, recurring breaks, staff leave, rooms/resources, staff-to-Service eligibility, the bounded offline Appointment queue, workspace-timezone scheduling and conflict enforcement.

Customers, Services, workspace membership, Sales and Inventory remain owned by their canonical departments. Appointment completion does not silently create financial or stock effects.

Meetings, Timesheets, advanced reminders, external calendar synchronisation, payroll/workforce features, multiple shifts, overnight shifts, cross-timezone staff calendars and date-specific working-hour overrides remain Deferred beyond V1.

## Visible-action inventory

| Screen | Visible action | Classification | Exact-head proof |
| --- | --- | --- | --- |
| Calendar navigation | Appointments | Operational V1 | authenticated Calendar journey |
| Calendar navigation | Availability | Operational V1 | authenticated route navigation |
| Calendar navigation | Service eligibility | Operational V1 | authenticated route navigation |
| Calendar navigation | Meetings / Timesheets | Deferred | absent from navigation; static + browser assertions |
| Calendar | Refresh | Operational V1 | authenticated browser interaction |
| Calendar | New appointment | Operational V1 | authenticated Appointment create journeys |
| Calendar | Search appointments | Operational V1 | authenticated search hit + empty result |
| Calendar | Previous day / Today / Next day | Operational V1 | authenticated date-navigation assertions |
| Calendar | All / Pending / Confirmed / Completed / Cancelled filters | Operational V1 | authenticated status-filter assertions |
| Calendar | Open / Close Appointment | Operational V1 | authenticated detail-dialog interaction |
| Calendar | Confirm | Operational V1 | authenticated lifecycle journey |
| Calendar | Reschedule | Operational V1 | authenticated lifecycle journey |
| Calendar | Complete | Operational V1 | authenticated lifecycle journey |
| Calendar | Cancel / Keep appointment / Cancel appointment | Operational V1 | authenticated cancellation and recovery journey |
| Calendar | Customer / Booking source / Service / Staff / Date / Start time / Room / Initial status / notes | Operational V1 | authenticated New appointment form proof |
| Calendar | Save offline | Operational V1 | authenticated offline queue journey |
| Calendar | Retry sync | Operational V1 | authenticated confirmed-rejection recovery + queue unit tests |
| Calendar | Discard rejected change | Operational V1 | authenticated confirmed-rejection recovery + queue unit tests |
| Availability | Back to Calendar / Refresh | Operational V1 | authenticated route and persistence proof |
| Availability | Staff selection | Operational V1 | authenticated combobox interaction |
| Availability | Working toggle / start / end / Save | Operational V1 | authenticated working-hours save |
| Availability | Add / Edit / Cancel edit / Save / Archive recurring break | Operational V1 | authenticated break lifecycle |
| Availability | Record / Edit / Cancel edit / Save / Cancel leave | Operational V1 | authenticated leave lifecycle |
| Availability | Create / Edit / Cancel edit / Save / Archive / Restore room | Operational V1 | authenticated room lifecycle |
| Availability | Offline mutation controls | Operational V1 boundary | browser proves explicit online-required state and disabled mutation |
| Service eligibility | Back to Calendar / Refresh | Operational V1 | authenticated route and persistence proof |
| Service eligibility | Open Services empty-state action | Operational V1 | authenticated no-Service journey |
| Service eligibility | Active Service selection | Operational V1 | authenticated accessible combobox interaction |
| Service eligibility | Assign / Remove staff | Operational V1 | authenticated assignment lifecycle |
| Service eligibility | Removal with dependent Appointment | Operational V1 safety | authenticated rejection with actionable guidance |
| Service eligibility | Offline mutation controls | Operational V1 boundary | browser proves explicit online-required state and disabled mutation |

## Customer Operational Acceptance journeys

1. Prepare staff availability: save working hours; create/edit/cancel-edit/archive a break; create/edit/cancel-edit/cancel leave; create/edit/cancel-edit/archive/restore a room; refresh and verify persistence.
2. Assign Service eligibility: select Service; assign, remove and reassign staff; verify offline refusal and persisted assignment; reject removal while an active Appointment depends on it.
3. Create and validate Appointments: select canonical records; reject outside-hours, break and overlap conflicts; persist valid Appointments.
4. Operate lifecycle: open/close, confirm, reschedule, keep/cancel and complete while preserving history.
5. Offline save and reconnect: queue one eligible Appointment, retain command identity, reconnect, drain once and verify authoritative persistence.
6. Daily operation: search, status filters, previous/today/next, refresh and visible navigation between Calendar, Availability and Service eligibility.

Existing static, unit, migration replay, pgTAP/security, isolation, concurrency and cross-engine suites remain authoritative for the frozen technical guarantees that are not sensibly duplicated in one browser journey.

## Merge gate

PR #73 is technically merge-ready only when BDB OS V1 Validation, Calendar Operational Acceptance, Customer Operational Acceptance and Inventory Diagnostics pass on one exact final head; both Vercel previews are READY at that head; no blocking review/preview feedback exists; the final diff contains no migration or frozen semantic change; and this inventory maps every Operational V1 action to objective proof.

The PR remains draft until Giovanni explicitly approves the exact green candidate. After the authorised merge, canonical Production must deploy the merge SHA and pass health, authenticated Calendar smoke, workspace isolation/permission verification and runtime-error inspection before Calendar Engine V1 may be declared Closed/Live.

# Calendar availability architecture

## Decision

Calendar owns staff working hours, recurring breaks, date-specific leave and workspace rooms/resources.

Appointments remain the authoritative scheduled business record. Customers own Customer identity, Services owns Service defaults, Team Management owns workspace membership, and Calendar references those records without copying their ownership.

## Business problem

A staff-overlap check alone is not sufficient to promise a real appointment slot. BDB OS must also know whether the staff member is working, unavailable for a break or leave, and whether the selected room is already occupied.

The availability layer prevents Calendar from accepting a slot that the business cannot deliver.

## Data ownership

- `calendar_staff_working_hours` stores one recurring working interval per staff member and weekday.
- `calendar_staff_breaks` stores recurring unavailable intervals.
- `calendar_staff_leave` stores date-specific unavailable intervals in the workspace local timezone.
- `calendar_rooms` stores workspace-owned rooms and resources.
- `bookings.room_id` links an Appointment to the canonical room while `room_name` remains its historical display snapshot.
- `calendar_availability_command_receipts` stores service-role-only idempotency receipts.

No separate staff directory is introduced. Staff identities remain active `workspace_memberships` linked to `profiles`.

## Mutation boundary

Availability configuration uses the trusted `apply_calendar_availability_command` function.

The command requires Calendar approval permission:

- Owner: allowed
- Manager: allowed
- Custom profile with Calendar `can_approve`: allowed
- Employee: denied
- Founder support read-only session: denied
- Guarded Founder `test_write` session: allowed for integration acceptance

Browser clients receive RLS-scoped reads only and cannot mutate availability tables directly.

## Appointment enforcement

Every pending or confirmed Appointment insert or reschedule is checked in the database transaction against:

1. The full effective occupied interval: preparation buffer + Service duration + recovery buffer.
2. Configured working hours for the Appointment weekday.
3. Active recurring breaks.
4. Active leave.
5. Existing Appointments for the same staff member.
6. Existing Appointments for the same room.
7. The active configured-room directory.

Cancelled and completed Appointments no longer reserve future availability.

Room and staff conflicts remain distinct errors so the user knows which record must be changed.

## Configuration safety

Availability changes are online-only. They are not queued offline because the server must atomically check existing Appointments before accepting a narrower schedule, new break, new leave period or room archive.

A configuration command is rejected when it would invalidate an existing pending or confirmed Appointment. The business must first reschedule or cancel the affected Appointment.

Appointment commands themselves remain offline-capable. On reconnect, the server applies the same availability checks and stops ordered replay at the first conflict.

## Timezone rule

Working hours, breaks, leave and Appointment date/time values use the workspace timezone from `workspace_settings`.

This slice does not implement cross-timezone staff calendars or overnight shifts. An Appointment and its buffers must remain within one local working day.

## Alternatives considered

### Infer availability from Appointments only

Rejected. An empty Calendar does not prove that a person is working or that a room is available.

### Store working hours on the Service

Rejected. Services define what is delivered, not who is available to deliver it.

### Store schedules on user profiles

Rejected. A profile may participate in multiple workspaces with different schedules. Availability must be workspace-scoped.

### Queue availability configuration offline

Rejected for Version 1. Replaying a schedule change without checking current Appointments could invalidate accepted bookings.

### Support multiple shifts per weekday immediately

Deferred. Version 1 uses one working interval plus multiple breaks, which covers the Vanita pilot without adding a more complex shift engine.

## Risks

- The current model does not support overnight shifts.
- Working-hour changes apply to every matching weekday, including future dates.
- Room assignment on the existing Appointment form must use an active room name or code until the form is promoted to a canonical selector.
- Staff-to-Service eligibility is not part of this slice.

## Future implications

The next Calendar integration is staff-to-Service eligibility. It should reference the existing `services` and workspace staff records and must not duplicate Service definitions or working-hour data.

Later layers may add:

- Multiple shifts per weekday
- Date-specific working-hour overrides
- Resource types beyond rooms
- External calendar synchronisation
- Appointment-to-Sale conversion
- Reminders

These additions must continue to call the same trusted Appointment and availability boundaries rather than bypassing them.

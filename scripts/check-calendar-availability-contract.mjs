import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/migrations/20260729123000_calendar_availability_foundation.sql",
  "utf8",
);
const roomHardening = await readFile(
  "supabase/migrations/20260729123500_appointment_room_conflict_hardening.sql",
  "utf8",
);
const api = await readFile("src/app/api/calendar/availability/route.ts", "utf8");
const page = await readFile("src/app/calendar/availability/page.tsx", "utf8");
const appointmentApi = await readFile("src/app/api/appointments/route.ts", "utf8");
const navigation = await readFile("src/components/app-shell.tsx", "utf8");

for (const statement of [
  "create table public.calendar_rooms",
  "create table public.calendar_staff_working_hours",
  "create table public.calendar_staff_breaks",
  "create table public.calendar_staff_leave",
  "create table public.calendar_availability_command_receipts",
  "add column room_id uuid",
  "bookings_room_effective_time_exclusion",
  "calendar_staff_leave_overlap_exclusion",
  "create or replace function private.enforce_booking_availability",
  "Appointment is outside the staff member working hours",
  "Appointment overlaps a staff break",
  "Appointment overlaps staff leave",
  "Appointment room is not an active configured room",
  "create or replace function public.apply_calendar_availability_command",
  "'calendar',\n    'approve'",
  "Reschedule or cancel existing Appointments",
  "revoke insert, update, delete on public.calendar_rooms",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Calendar availability contract: ${statement}`);
}

assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /before insert or update[\s\S]*on public\.bookings/i);
assert.match(migration, /status <> 'cancelled'::public\.booking_status/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*calendar_(?:rooms|staff_working_hours|staff_breaks|staff_leave)[\s\S]*authenticated/i);
assert.match(migration, /revoke all on function public\.apply_calendar_availability_command[\s\S]*authenticated/i);
assert.doesNotMatch(migration, /service_staff|staff_service_eligibility/i);

assert.match(roomHardening, /Appointment conflicts with another booking for this room/i);
assert.match(roomHardening, /existing\.room_id = room_record\.id/i);
assert.match(roomHardening, /private\.booking_effective_range\(existing\)/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /apply_calendar_availability_command/);
assert.match(api, /can_approve/);
assert.match(api, /support_test_write/);
assert.match(api, /Calendar availability could not be saved/);

assert.match(page, /Weekly working hours/);
assert.match(page, /Recurring breaks/);
assert.match(page, /Leave and time off/);
assert.match(page, /Rooms and resources/);
assert.match(page, /online-only because existing Appointments must be checked atomically/);
assert.match(page, /Staff-to-Service eligibility remains the next Calendar integration/);

assert.match(appointmentApi, /APPOINTMENT_CONFLICT/);
assert.match(appointmentApi, /APPOINTMENT_ROOM_CONFLICT/);
assert.match(appointmentApi, /APPOINTMENT_OUTSIDE_WORKING_HOURS/);
assert.match(appointmentApi, /APPOINTMENT_BREAK_CONFLICT/);
assert.match(appointmentApi, /APPOINTMENT_LEAVE_CONFLICT/);
assert.match(appointmentApi, /calendar_rooms/);
assert.match(appointmentApi, /workspace_settings/);
assert.match(navigation, /Availability[\s\S]*\/calendar\/availability/);

console.log("Calendar availability schema, permissions, Appointment guard and management UI contracts are internally consistent.");

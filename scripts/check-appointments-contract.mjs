import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const statusMigration = await readFile(
  "supabase/migrations/20260729110000_appointment_status_values.sql",
  "utf8",
);
const foundationMigration = await readFile(
  "supabase/migrations/20260729110500_appointment_foundation.sql",
  "utf8",
);
const readHardeningMigration = await readFile(
  "supabase/migrations/20260729111000_appointment_read_hardening.sql",
  "utf8",
);
const indexMigration = await readFile(
  "supabase/migrations/20260729111500_appointment_reference_indexes.sql",
  "utf8",
);
const migration = `${foundationMigration}\n${readHardeningMigration}\n${indexMigration}`;
const api = await readFile("src/app/api/appointments/route.ts", "utf8");
const queue = await readFile("src/lib/modules/appointment-queue.ts", "utf8");
const page = await readFile("src/app/calendar/page.tsx", "utf8");
const databaseTest = await readFile("supabase/tests/appointment_foundation.sql", "utf8");

assert.match(statusMigration, /booking_status add value if not exists 'cancelled'/i);

for (const statement of [
  "add column service_id uuid",
  "add column staff_user_id uuid",
  "preparation_buffer_minutes",
  "recovery_buffer_minutes",
  "price_snapshot",
  "timezone text not null",
  "version integer not null default 1",
  "bookings_staff_effective_time_exclusion",
  "create table public.appointment_command_receipts",
  "create or replace function public.apply_appointment_command",
  "Appointment changed on another device",
  "Appointment conflicts with another booking for this staff member",
  "private.actor_has_workspace_permission",
  "revoke insert, update, delete on table public.bookings from anon, authenticated",
  "revoke all on table public.bookings from anon",
  "drop index if exists public.bookings_workspace_date_time_idx",
  "create index if not exists bookings_staff_user_idx",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Appointment migration contract: ${statement}`);
}

assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /foreign key \(workspace_id, service_id\)/i);
assert.match(migration, /foreign key \(workspace_id, booking_id\)/i);
assert.match(migration, /entity_type, entity_id, command_id, metadata/i);
assert.doesNotMatch(migration, /insert into public\.(sales|sale_lines|invoices|bank_transactions|inventory_movements)/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.bookings\s+to\s+authenticated/i);
assert.match(migration, /revoke all on function public\.apply_appointment_command[\s\S]*authenticated/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_appointment_command/);
assert.match(api, /APPOINTMENT_CONFLICT/);
assert.match(api, /APPOINTMENT_VERSION_CONFLICT/);
assert.match(api, /get_effective_features/);

assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushAppointmentQueue/);
assert.match(queue, /break;/);

assert.match(page, /readCache/);
assert.match(page, /enqueueAppointmentCommand/);
assert.match(page, /Saved offline/);
assert.match(page, /Working hours, leave, rooms and staff-to-Service eligibility remain the next Calendar integration/);
assert.match(page, /No Sale, invoice, Payment or Inventory movement is created/);
assert.doesNotMatch(page, /buildPreviewAppointments/);
assert.doesNotMatch(page, /representative design data only/i);

assert.match(databaseTest, /anonymous users cannot read Appointments/i);
assert.match(databaseTest, /browser clients cannot insert Appointments directly/i);
assert.match(databaseTest, /effective staff time overlap/i);
assert.match(databaseTest, /does not post Sales, invoices, Payments or Inventory/i);

console.log("Appointment schema, permissions, command, offline and Calendar contracts are internally consistent.");

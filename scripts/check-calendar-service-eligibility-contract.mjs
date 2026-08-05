import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/migrations/20260729130000_calendar_staff_service_eligibility.sql",
  "utf8",
);
const api = await readFile("src/app/api/calendar/eligibility/route.ts", "utf8");
const page = await readFile("src/app/calendar/eligibility/page.tsx", "utf8");
const layout = await readFile("src/app/calendar/layout.tsx", "utf8");

for (const statement of [
  "create table public.calendar_staff_service_eligibility",
  "create table public.calendar_service_eligibility_command_receipts",
  "primary key (workspace_id, staff_user_id, service_id)",
  "references public.workspace_memberships(workspace_id, user_id)",
  "references public.services(workspace_id, id)",
  "create or replace function private.enforce_booking_service_eligibility",
  "Appointment staff member is not eligible for this Service",
  "create trigger bookings_enforce_service_eligibility",
  "create or replace function public.apply_calendar_service_eligibility_command",
  "actor_has_workspace_permission",
  "'calendar'",
  "'approve'",
  "Reschedule or cancel existing Appointments before removing this Service eligibility",
  "calendar_service_eligibility_command_receipts",
  "activity_items",
  "revoke all on table public.calendar_staff_service_eligibility",
  "grant select on table public.calendar_staff_service_eligibility to authenticated",
]) {
  assert.ok(
    migration.toLowerCase().includes(statement.toLowerCase()),
    `Missing Calendar Service eligibility contract: ${statement}`,
  );
}

assert.match(migration, /before insert or update of service_id, staff_user_id, status/i);
assert.match(migration, /status::text in \('pending', 'confirmed'\)/i);
assert.doesNotMatch(
  migration,
  /grant\s+(?:insert|update|delete)[\s\S]*calendar_staff_service_eligibility[\s\S]*authenticated/i,
);
assert.doesNotMatch(migration, /certificate|commission|payroll|qualification_level/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /apply_calendar_service_eligibility_command/);
assert.match(api, /can_approve/);
assert.match(api, /support_test_write/);
assert.match(api, /CALENDAR_SERVICE_ELIGIBILITY_IN_USE/);

assert.match(page, /Explicit booking qualification/);
assert.match(page, /pending and confirmed Appointments/);
assert.match(page, /online-only/);
assert.match(page, /Qualifications, certificates, commission rules and payroll are deferred/);
assert.match(layout, /\/calendar\/eligibility/);
assert.match(layout, /Service eligibility/);

console.log("Calendar staff-to-Service eligibility contracts are internally consistent.");

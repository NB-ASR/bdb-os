import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260824130700_calendar_canonical_integrity_pass1.sql",
  "utf8",
);
const appointmentsApi = await readFile("src/app/api/appointments/route.ts", "utf8");
const availabilityApi = await readFile("src/app/api/calendar/availability/route.ts", "utf8");
const eligibilityApi = await readFile("src/app/api/calendar/eligibility/route.ts", "utf8");
const decision = await readFile("docs/decisions/calendar-engine-v1-closure.md", "utf8");

for (const statement of [
  "create table public.calendar_command_claims",
  "primary key (workspace_id, idempotency_key)",
  "request_hash text not null",
  "create or replace function private.claim_calendar_command",
  "Calendar idempotency key was reused with different input",
  "rename to apply_appointment_command_legacy",
  "rename to apply_calendar_availability_command_legacy",
  "rename to apply_calendar_service_eligibility_command_legacy",
  "create or replace function public.apply_appointment_command",
  "create or replace function public.apply_calendar_availability_command",
  "create or replace function public.apply_calendar_service_eligibility_command",
  "schedule_before",
  "schedule_after",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Calendar Pass 1 contract: ${statement}`);
}

assert.match(migration, /alter table public\.calendar_command_claims enable row level security/i);
assert.match(migration, /revoke all on table public\.calendar_command_claims from public, anon, authenticated, service_role/i);
assert.match(migration, /extensions\.digest\(convert_to\(p_request::text, 'UTF8'\), 'sha256'\)/i);
assert.match(migration, /command_domain in \([\s\S]*'appointment'[\s\S]*'availability'[\s\S]*'service_eligibility'/i);

const appointmentWrapper = migration.slice(
  migration.indexOf("create or replace function public.apply_appointment_command("),
  migration.indexOf("create or replace function public.apply_calendar_availability_command("),
);
const availabilityWrapper = migration.slice(
  migration.indexOf("create or replace function public.apply_calendar_availability_command("),
  migration.indexOf("create or replace function public.apply_calendar_service_eligibility_command("),
);
const eligibilityWrapper = migration.slice(
  migration.indexOf("create or replace function public.apply_calendar_service_eligibility_command("),
  migration.indexOf("-- The renamed functions remain"),
);

assert.ok(
  appointmentWrapper.indexOf("private.appointment_actor_can_write") < appointmentWrapper.indexOf("private.claim_calendar_command"),
  "Appointment authorization must precede claim/replay.",
);
assert.ok(
  appointmentWrapper.indexOf("private.claim_calendar_command") < appointmentWrapper.indexOf("appointment_command_receipts"),
  "Appointment claim verification must precede receipt replay.",
);
assert.ok(
  availabilityWrapper.indexOf("private.calendar_availability_actor_can_manage") < availabilityWrapper.indexOf("private.claim_calendar_command"),
  "Availability authorization must precede claim/replay.",
);
assert.ok(
  eligibilityWrapper.indexOf("private.calendar_service_eligibility_actor_can_manage") < eligibilityWrapper.indexOf("private.claim_calendar_command"),
  "Service eligibility authorization must precede claim/replay.",
);

for (const legacy of [
  "apply_appointment_command_legacy",
  "apply_calendar_availability_command_legacy",
  "apply_calendar_service_eligibility_command_legacy",
]) {
  assert.match(
    migration,
    new RegExp(`revoke all on function public\\.${legacy}\\([\\s\\S]*?\\) from public, anon, authenticated, service_role`, "i"),
    `${legacy} must not remain a runtime service-role entry point.`,
  );
}

for (const canonical of [
  "apply_appointment_command",
  "apply_calendar_availability_command",
  "apply_calendar_service_eligibility_command",
]) {
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${canonical}\\([\\s\\S]*?\\) to service_role`, "i"),
    `${canonical} must remain the trusted service-role entry point.`,
  );
}

assert.match(appointmentsApi, /admin\.rpc\("apply_appointment_command"/);
assert.doesNotMatch(appointmentsApi, /apply_appointment_command_legacy/);
assert.match(availabilityApi, /admin\.rpc\("apply_calendar_availability_command"/);
assert.doesNotMatch(availabilityApi, /apply_calendar_availability_command_legacy/);
assert.match(eligibilityApi, /admin\.rpc\("apply_calendar_service_eligibility_command"/);
assert.doesNotMatch(eligibilityApi, /apply_calendar_service_eligibility_command_legacy/);

assert.doesNotMatch(
  migration,
  /(?:insert\s+into|update|delete\s+from)\s+public\.(?:customers|sales|sale_lines|invoices|payments|credit_notes|bank_transactions|inventory_movements)\b/i,
  "Calendar Pass 1 must not mutate Customer, Accounts, Sales, Banking or Inventory records.",
);

assert.match(decision, /Pass 1 — Canonical Integrity & Command Hardening/);
assert.match(decision, /Meetings and Timesheets are deferred/i);
assert.match(decision, /do not merge to `main` until all four Calendar passes/i);

console.log("Calendar Pass 1 command identity, runtime boundaries and V1 scope contracts are intact.");

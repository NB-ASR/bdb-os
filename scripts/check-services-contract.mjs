import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const migration = await readFile(
  "supabase/release-sources/vanita-integration-20260813/20260728090000_service_catalogue_foundation.sql",
  "utf8",
);
const hardening = await readFile("supabase/migrations/20260830190000_catalogue_engine_pass1.sql", "utf8");
const api = await readFile("src/app/api/services/route.ts", "utf8");
const queue = await readFile("src/lib/modules/service-queue.ts", "utf8");
const page = await readFile("src/app/services/page.tsx", "utf8");

for (const statement of [
  "create table public.services",
  "create table public.service_command_receipts",
  "unique (workspace_id, code)",
  "version integer not null default 1",
  "create or replace function public.apply_service_command",
  "Service changed on another device",
  "private.has_workspace_permission(workspace_id, 'services', 'view')",
  "grant select on table public.services to authenticated",
]) {
  assert.ok(migration.toLowerCase().includes(statement.toLowerCase()), `Missing Service contract: ${statement}`);
}

assert.match(migration, /primary key \(workspace_id, idempotency_key\)/i);
assert.match(migration, /booking_mode in \('customer', 'staff'\)/i);
assert.doesNotMatch(migration, /delete from public\.services/i);
assert.doesNotMatch(migration, /platform_support_sessions|support_test_write/i);
assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete)[\s\S]*public\.services\s+to\s+authenticated/i);
assert.match(migration, /revoke all on function public\.apply_service_command[\s\S]*authenticated/i);
assert.doesNotMatch(migration, /\b(appointment_id|payment_status|inventory_quantity|staff_schedule)\b/i);

assert.match(hardening, /receipt\.service_id, receipt\.action, receipt\.result/i);
assert.match(hardening, /previous_service_id <> p_service_id or previous_action <> p_action/i);
assert.match(hardening, /Service idempotency key was already used for another command/i);
assert.match(hardening, /grant execute on function public\.apply_service_command[\s\S]*service_role/i);
assert.doesNotMatch(hardening, /grant execute on function public\.apply_service_command[\s\S]*authenticated/i);

assert.match(api, /requireWorkspaceCommand/);
assert.match(api, /IDEMPOTENCY_REQUIRED/);
assert.match(api, /createAdminClient/);
assert.match(api, /apply_service_command/);
assert.match(api, /SERVICE_CONFLICT/);
assert.match(api, /SERVICE_DUPLICATE/);

assert.match(queue, /localStorage/);
assert.match(queue, /Idempotency-Key/);
assert.match(queue, /flushServiceQueue/);
assert.match(queue, /break;/);

assert.match(page, /readCache/);
assert.match(page, /enqueueServiceCommand/);
assert.match(page, /archive/);
assert.match(page, /restore/);
assert.match(page, /Saving this Service does not create an appointment, Sale, invoice, payment or staff assignment/);
assert.match(page, /Staff rules/);

console.log("Service schema, permissions, command, idempotency, offline and UI contracts are internally consistent.");
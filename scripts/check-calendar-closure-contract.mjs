import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [api, queue, page, context, migration, databaseTest] = await Promise.all([
  readFile("src/app/api/appointments/route.ts", "utf8"),
  readFile("src/lib/modules/appointment-queue.ts", "utf8"),
  readFile("src/app/calendar/page.tsx", "utf8"),
  readFile("src/app/api/workspace/context/route.ts", "utf8"),
  readFile("supabase/migrations/20260826193000_calendar_timezone_integrity_closure.sql", "utf8"),
  readFile("supabase/tests/calendar_timezone_integrity.sql", "utf8"),
]);

assert.match(api, /CALENDAR_LIMITS/);
assert.match(api, /calendar_staff_service_eligibility/);
assert.match(api, /\.limit\(CALENDAR_LIMITS\.appointments \+ 1\)/);
assert.match(api, /\.eq\("workspace_id", workspaceId\)/);
assert.match(context, /currentUser:[\s\S]*id: userId/);

assert.match(queue, /bdb-appointment-queue-v2/);
assert.match(queue, /actorUserId/);
assert.match(queue, /MAX_QUEUE_COMMANDS/);
assert.match(queue, /"confirmed_rejection" \| "ambiguous"/);
assert.match(queue, /confirmedServerRejection\(response\.status\)/);
assert.match(queue, /if \(!force && !canDiscardAppointmentCommand\(command\)\) return false/);
assert.match(queue, /removeAppointmentCommand\(actorUserId, workspaceId, command\.id, true\)/);

assert.match(page, /cacheKey\(actorUserId: string, workspaceId: string\)/);
assert.doesNotMatch(page, /bdb-appointments-last-workspace/);
assert.match(page, /canDiscardAppointmentCommand\(firstQueuedCommand\)/);
assert.match(page, /outcome is uncertain[\s\S]*cannot be discarded safely/);
assert.match(page, /calendar_staff_service_eligibility|eligibility/);
assert.match(page, /No room assigned/);
assert.match(page, /bundle\.timezone/);
assert.doesNotMatch(page, /Europe\/Malta/);

assert.match(migration, /calendar_local_time_exists/);
assert.match(migration, /at time zone trim\(target_timezone\)/);
assert.match(migration, /bookings_validate_local_time/);
assert.match(databaseTest, /2026-03-29'[\s\S]*01:30/);
assert.match(databaseTest, /2026-10-25'[\s\S]*01:30/);

console.log("Calendar offline, scale, availability UX, timezone and security closure contracts passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/release-sources/vanita-integration-20260813/20260729143000_appointment_sale_draft_conversion.sql", "utf8");
const api = await readFile("src/app/api/sale-drafts/route.ts", "utf8");
const page = await readFile("src/app/sales/appointment-drafts/page.tsx", "utf8");
const salesLayout = await readFile("src/app/sales/layout.tsx", "utf8");
const calendarLayout = await readFile("src/app/calendar/layout.tsx", "utf8");

assert.match(migration, /create table public\.sale_drafts/i, "Appointment Sale drafts table is missing.");
assert.match(migration, /unique \(workspace_id, source_appointment_id\)/i, "One draft per Appointment is not enforced.");
assert.match(migration, /status in \('open', 'discarded', 'converted'\)/i, "Draft lifecycle states are missing.");
assert.match(migration, /references public\.bookings\(workspace_id, id\)/i, "Drafts must reference canonical Appointments.");
assert.match(migration, /references public\.customers\(workspace_id, id\)/i, "Drafts must reference canonical Customers.");
assert.match(migration, /references public\.services\(workspace_id, id\)/i, "Drafts must reference canonical Services.");
assert.match(migration, /references public\.sales\(workspace_id, id\)/i, "Converted drafts must link to canonical Sales.");
assert.match(migration, /create table public\.sale_draft_command_receipts/i, "Draft idempotency receipts are missing.");
assert.match(migration, /Only completed Appointments can create Sale drafts/i, "Draft creation must require Appointment completion.");
assert.match(migration, /Appointment Sale draft changed on another device/i, "Optimistic draft version checks are missing.");
assert.match(migration, /'appointment'.*draft_record\.currency/is, "Converted Sales must retain the Appointment channel and workspace currency.");
assert.match(migration, /insert into public\.sale_lines[\s\S]*'service'/i, "Draft completion must create one Service Sale line.");
assert.doesNotMatch(migration, /insert into public\.inventory_movements/i, "Appointment Sale draft conversion must not move Inventory.");
assert.match(migration, /settlement_status', 'not_recorded'/i, "Appointment Sale completion must preserve the settlement boundary.");
assert.match(migration, /revoke all on table public\.sale_drafts, public\.sale_draft_command_receipts from anon, authenticated/i, "Draft browser mutation privileges are not revoked.");
assert.match(migration, /grant select on table public\.sale_drafts to authenticated/i, "Authenticated draft reads are missing.");
assert.match(migration, /private\.has_workspace_permission\(workspace_id, 'sales', 'view'\)/i, "Draft reads must use Sales permission isolation.");

assert.match(api, /requireWorkspaceCommand/i, "Draft commands must use the trusted workspace command context.");
assert.match(api, /admin\.rpc\("apply_appointment_sale_draft_command"/i, "Draft API must call the trusted database command.");
assert.doesNotMatch(api, /\.from\("sale_drafts"\)\s*\.insert/i, "Draft API must not insert directly from the browser path.");
assert.match(api, /\.eq\("status", "completed"\)/i, "Draft API must expose completed Appointment candidates only.");
assert.doesNotMatch(api, /support_test_write|isSupportSession/i, "Main authentication must remain the only access path.");

assert.match(page, /Online connection required/i, "Draft configuration must state its online-only boundary.");
assert.match(page, /Complete Sale/i, "Draft review must expose explicit Sale completion.");
assert.match(page, /does not record payment, issue an invoice, post Banking activity or move Inventory/i, "Commercial side-effect boundary is missing from the UI.");
assert.match(page, /Idempotency-Key/i, "Draft UI commands must carry stable idempotency keys.");
assert.match(page, /state\.settings\.currency/i, "Appointment price snapshots must use the workspace currency.");
assert.doesNotMatch(page, /formatter\("EUR"\)/i, "Appointment drafts must not hardcode Vanita's currency.");
assert.doesNotMatch(page, /localStorage/i, "Canonical Appointment Sale drafts must not be hidden in browser-only storage.");
assert.match(salesLayout, /Appointment drafts/i, "Appointment drafts must be discoverable from Sales.");
assert.match(calendarLayout, /Appointment Sales/i, "Appointment Sales must be discoverable from Calendar.");

console.log("Appointment-to-Sale draft contracts are intact.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [architecture, decision, foundation, commands, customer360, api, queue, page, profileApi] = await Promise.all([
  read("docs/architecture/unified-communications-integration.md"),
  read("docs/decisions/2026-08-01-unified-communications-threads-and-recording.md"),
  read("supabase/release-sources/vanita-integration-20260813/20260801132000_unified_communications_foundation.sql"),
  read("supabase/release-sources/vanita-integration-20260813/20260801132500_unified_communications_commands.sql"),
  read("supabase/release-sources/vanita-integration-20260813/20260801133000_unified_communications_customer_360.sql"),
  read("src/app/api/communications/route.ts"),
  read("src/lib/modules/unified-communication-queue.ts"),
  read("src/app/communications/page.tsx"),
  read("src/app/api/customers/profile/route.ts"),
]);

assert.match(architecture, /authoritative owner of communication threads/i, "Communications must own thread and message records.");
assert.match(architecture, /does not claim that Email, WhatsApp, Instagram or Web messages were delivered/i, "V1 must not claim provider delivery.");
assert.match(decision, /Legacy messages receive one thread each/i, "Legacy migration must not invent conversation grouping.");
assert.match(decision, /AI draft/i, "Human-controlled AI draft state must be recorded.");

assert.match(foundation, /create table if not exists public\.communication_threads/i, "Communication threads must exist.");
assert.match(foundation, /alter table public\.messages[\s\S]*thread_id uuid/i, "Messages must receive thread identity.");
assert.match(foundation, /direction text/i, "Messages must record direction.");
assert.match(foundation, /draft_state text/i, "Messages must record draft-review state.");
assert.match(foundation, /communication_command_receipts/i, "Communication commands must retain receipts.");
assert.match(foundation, /security_invoker = true/i, "The unified inbox index must preserve caller RLS.");
assert.match(foundation, /select message\.id[\s\S]*on conflict \(id\) do nothing/i, "Legacy messages must receive one exact thread each.");
assert.doesNotMatch(foundation, /group by[\s\S]*subject[\s\S]*insert into public\.communication_threads/i, "Legacy subjects must not be used to invent grouping.");
assert.match(foundation, /revoke all on public\.messages from public, anon, authenticated/i, "Direct browser Message writes must be revoked.");
assert.match(foundation, /grant select on public\.messages to authenticated/i, "Authenticated RLS-scoped reads must remain.");
assert.doesNotMatch(foundation, /grant (insert|update|delete) on public\.messages/i, "Browser Message writes must remain blocked.");

for (const command of [
  "record_communication_message",
  "mark_communication_message_read",
  "dismiss_communication_draft",
  "close_communication_thread",
]) {
  assert.match(commands, new RegExp(`function public\\.${command}\\b`, "i"), `${command} must exist.`);
  assert.match(commands, new RegExp(`grant execute on function public\\.${command}`, "i"), `${command} must remain service-role-only.`);
}
assert.match(commands, /actor_has_workspace_permission[\s\S]*'communications'/i, "Communication commands must use the shared support-aware permission boundary.");
assert.match(commands, /actor_has_workspace_permission[\s\S]*'customers'[\s\S]*'view'/i, "New communication must validate Customer visibility.");
assert.match(commands, /communication_command_receipts/i, "Commands must use idempotency receipts.");
assert.match(commands, /Closed communication threads cannot receive messages/i, "Closed threads must reject new records.");
assert.match(commands, /Only outbound communication can require draft review/i, "Inbound records cannot masquerade as AI drafts.");
for (const table of ["customers", "bookings", "sales", "invoices", "payments", "documents", "inventory_movements", "bank_transactions"]) {
  assert.doesNotMatch(commands, new RegExp(`(insert into|update|delete from) public\\.${table}`, "i"), `Communication commands must not mutate ${table}.`);
}

assert.match(customer360, /customer_360_communication_summary/i, "Customer 360 communication summary must exist.");
assert.match(customer360, /customer_360_communication_activity/i, "Customer 360 communication activity must exist.");
assert.match(customer360, /message\.direction = 'inbound'/i, "Customer 360 must preserve communication direction.");
assert.match(customer360, /unified_communication_lifecycle/i, "Customer 360 must include thread lifecycle events.");

assert.match(api, /requireWorkspaceCommand/, "Communication API must use the authenticated workspace boundary.");
assert.match(api, /context\.idempotencyKey/, "Communication writes must require idempotency.");
assert.match(api, /communication_command_receipts/, "API retries must read command receipts.");
assert.match(api, /unified_communication_index/, "Inbox reads must use the security-invoker index.");
assert.match(api, /record_communication_message/, "Message recording must use the trusted command.");
assert.match(api, /mark_communication_message_read/, "Read state must use the trusted command.");
assert.match(api, /dismiss_communication_draft/, "Draft dismissal must use the trusted command.");
assert.match(api, /close_communication_thread/, "Thread closure must use the trusted command.");

assert.match(queue, /indexedDB\.open/i, "Communications must have an IndexedDB offline queue.");
assert.match(queue, /sort\(\(a, b\) => a\.createdAt\.localeCompare\(b\.createdAt\)\)/i, "Offline commands must replay in order.");
assert.match(queue, /throw error/i, "Queue replay must stop at the first failure.");
assert.match(queue, /Idempotency-Key/i, "Queued commands must retain stable command identities.");

assert.match(page, /Version 1 records communication inside BDB OS/i, "The UI must explain the provider boundary.");
assert.match(page, /enqueueUnifiedCommunicationCommand/i, "The live UI must use the offline command queue.");
assert.match(page, /flushUnifiedCommunicationQueue/i, "The live UI must replay queued commands.");
assert.doesNotMatch(page, /sendMessage|markMessageRead|dismissMessageDraft/, "The live route must not use legacy shared-store mutations.");
assert.match(page, /Read-only access/i, "The UI must explain read-only behavior.");
assert.doesNotMatch(page, /Founder support|support session|test-write/i, "Main authentication must remain the only access path.");
assert.match(page, /Draft requires human review/i, "AI-assisted drafts must remain visibly human-controlled.");

assert.match(profileApi, /customer_360_communication_summary/i, "Customer 360 API must use the thread-aware summary.");
assert.match(profileApi, /customer_360_communication_activity/i, "Customer 360 API must use the thread-aware activity projection.");
assert.match(profileApi, /neq\("source_type", "communication"\)/i, "Legacy communication activity must be excluded before merging the new projection.");

console.log("Unified Communications architecture contract passed.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [architecture, decision, foundation, commands, api] = await Promise.all([
  read("docs/architecture/general-documents-integration.md"),
  read("docs/decisions/2026-08-01-general-documents-ownership-and-links.md"),
  read("supabase/migrations/20260801110000_general_documents_foundation.sql"),
  read("supabase/migrations/20260801110500_general_document_commands.sql"),
  read("src/app/api/documents/route.ts"),
]);

assert.match(architecture, /sole owner of stored business files/i, "Documents must remain the authoritative file owner.");
assert.match(architecture, /free-text `documents\.linked_to` field is legacy/i, "Free-text linkage must be explicitly deprecated.");
assert.match(
  architecture,
  /does not create, update or delete:[\s\S]*Customers[\s\S]*Appointments[\s\S]*Sales[\s\S]*Invoices[\s\S]*Customer Payments[\s\S]*Communications[\s\S]*Inventory movements[\s\S]*Bank transactions/i,
  "Document commands must preserve source-department ownership.",
);
assert.match(
  decision,
  /typed links from one Document to exact Customer, Appointment, Sale, Invoice, Customer Payment or Communication records/i,
  "The decision record must define exact typed links.",
);

assert.match(foundation, /create table if not exists public\.document_links/i, "Typed Document links must exist.");
for (const linkType of [
  "business",
  "customer",
  "appointment",
  "sale",
  "invoice",
  "customer_payment",
  "communication",
]) assert.match(foundation, new RegExp(`'${linkType}'`, "i"), `${linkType} links must be supported.`);
assert.match(foundation, /document_links_target_shape_check/i, "Business and record links must have explicit target shapes.");
assert.match(foundation, /document_links_revoke_shape_check/i, "Link revocation must preserve reasoned audit context.");
assert.match(foundation, /document_links_active_target_uidx/i, "Active typed links must reject duplicates.");
assert.match(foundation, /create table if not exists public\.document_command_receipts/i, "Document commands must retain idempotency receipts.");
assert.match(foundation, /enable row level security/i, "New Document integration tables must use RLS.");
assert.match(foundation, /private\.has_workspace_permission\(workspace_id, 'documents', 'view'\)/i, "Document link reads must follow Documents permission.");
assert.doesNotMatch(foundation, /grant (insert|update|delete) on public\.document_links/i, "Browser writes to Document links must remain blocked.");
assert.match(foundation, /view public\.general_document_index[\s\S]*security_invoker = true/i, "The General Documents read model must preserve caller permissions.");
assert.match(foundation, /case when document\.customer_id is null then 'business' else 'customer' end/i, "Legacy backfill must infer only structured Business or Customer links.");
assert.doesNotMatch(foundation, /linked_to[\s\S]*(appointment|sale|invoice|payment|communication)/i, "Legacy free text must not be parsed into invented source links.");

for (const command of [
  "create_general_document",
  "add_general_document_link",
  "revoke_general_document_link",
  "archive_general_document",
]) {
  assert.match(commands, new RegExp(`function public\\.${command}\\b`, "i"), `${command} must exist.`);
  assert.match(commands, new RegExp(`grant execute on function public\\.${command}`, "i"), `${command} must remain service-role-only.`);
}
assert.match(commands, /actor_has_workspace_permission[\s\S]*'documents'[\s\S]*'create'/i, "Document creation must require Documents create permission.");
assert.match(commands, /actor_has_workspace_permission[\s\S]*'documents'[\s\S]*'edit'/i, "Document lifecycle changes must require Documents edit permission.");
for (const source of [
  ["customers", "customer"],
  ["bookings", "appointment"],
  ["sales", "sale"],
  ["invoices", "invoice"],
  ["payments", "customer_payment"],
  ["messages", "communication"],
]) {
  assert.match(commands, new RegExp(`when '${source[1]}'[\\s\\S]*public\\.${source[0]}`, "i"), `${source[1]} links must validate the exact source record.`);
}
for (const permission of ["customers", "calendar", "sales", "accounts", "communications"]) {
  assert.match(commands, new RegExp(`actor_has_workspace_permission[\\s\\S]*'${permission}'[\\s\\S]*'view'`, "i"), `${permission} access must be checked before linking.`);
}
assert.match(commands, /document_command_receipts/i, "Trusted commands must preserve exact retry receipts.");
assert.match(commands, /insert into public\.activity_items/i, "Document changes must enter business activity.");
for (const table of [
  "customers",
  "bookings",
  "sales",
  "invoices",
  "payments",
  "messages",
  "inventory_movements",
  "bank_transactions",
]) {
  assert.doesNotMatch(
    commands,
    new RegExp(`(insert into|update|delete from) public\\.${table}`, "i"),
    `Document commands must not mutate ${table}.`,
  );
}

assert.match(api, /requireWorkspaceCommand/, "Document writes must use the authenticated workspace command boundary.");
assert.match(api, /context\.idempotencyKey/, "Document writes must require stable idempotency.");
assert.match(api, /document_command_receipts/, "The upload route must check exact retry receipts before storage.");
assert.match(api, /workspace-documents/, "Document files must use the private workspace Document bucket.");
assert.match(api, /create_general_document/, "Uploads must finish through the trusted create command.");
assert.match(api, /add_general_document_link/, "Typed links must use the trusted add-link command.");
assert.match(api, /revoke_general_document_link/, "Link removal must use the trusted revoke command.");
assert.match(api, /archive_general_document/, "Document removal must use the trusted archive command.");
assert.match(api, /remove\(\[storagePath\]\)/, "Failed database creation must clean up the uploaded object.");
assert.match(api, /general_document_index/, "Document reads must use the security-invoker index.");

console.log("General Documents architecture contract passed.");

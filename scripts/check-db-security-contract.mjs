import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const securityMigration = await readFile(
  "supabase/migrations/20260718193000_quality_foundation_security.sql",
  "utf8",
);
const invitationMigration = await readFile(
  "supabase/migrations/20260718193500_invitation_expiry_guard.sql",
  "utf8",
);
const supportRpcMigration = await readFile(
  "supabase/migrations/20260727090500_support_session_rpc_invoker.sql",
  "utf8",
);
const founderTestWriteMigration = await readFile(
  "supabase/migrations/20260728170000_founder_test_write_support.sql",
  "utf8",
);
const databaseTest = await readFile(
  "supabase/tests/quality_foundation_security.sql",
  "utf8",
);
const commandHelper = await readFile("src/lib/server/command.ts", "utf8");
const activityWriter = await readFile("src/lib/server/activity.ts", "utf8");

const requiredSecurityStatements = [
  "create or replace function private.is_active_profile()",
  "private.is_active_profile()",
  "revoke update on table public.profiles from authenticated",
  "grant update (full_name, phone, avatar_path, active_workspace_id)",
  "profiles_protect_security_fields",
  "revoke insert, update, delete",
  "drop policy if exists \"Activity feature insert\"",
  "command_id uuid",
];

for (const statement of requiredSecurityStatements) {
  assert.ok(
    securityMigration.toLowerCase().includes(statement.toLowerCase()),
    `Missing security migration contract: ${statement}`,
  );
}

const profileTriggerBody = securityMigration.match(
  /create or replace function private\.enforce_profile_security_fields\(\)[\s\S]*?\$\$;/i,
)?.[0];
assert.ok(profileTriggerBody, "Profile security trigger definition is missing");
assert.doesNotMatch(
  profileTriggerBody,
  /private\.is_platform_admin\(\)/i,
  "Browser Founder sessions must not bypass protected profile fields",
);

assert.match(invitationMigration, /interval '1 hour'/i);
assert.doesNotMatch(invitationMigration, /interval '1 day'/i);
assert.match(invitationMigration, /workspace_memberships_enforce_invitation_expiry/i);
assert.match(databaseTest, /profiles\.is_active/i);
assert.match(databaseTest, /private\.is_active_profile/i);
assert.match(databaseTest, /interval '1 hour'/i);
assert.match(databaseTest, /activity_items/i);
assert.match(databaseTest, /workspace isolation constraint/i);

assert.match(supportRpcMigration, /create or replace function public\.get_my_support_session\(\)/i);
assert.match(supportRpcMigration, /security invoker/i);
assert.match(supportRpcMigration, /support_session\.admin_user_id = \(select auth\.uid\(\)\)/i);

assert.match(founderTestWriteMigration, /access_mode in \('read_only', 'test_write'\)/i);
assert.match(founderTestWriteMigration, /private\.has_test_write_support_session/i);
assert.match(founderTestWriteMigration, /private\.actor_has_workspace_permission/i);
assert.match(founderTestWriteMigration, /when private\.has_test_write_support_session\(target_workspace_id\) then true/i);
assert.match(founderTestWriteMigration, /when private\.has_active_support_session\(target_workspace_id\) then false/i);
assert.match(founderTestWriteMigration, /create or replace function private\.product_actor_can_write/i);
assert.match(founderTestWriteMigration, /create or replace function private\.supplier_document_actor_can_write/i);
assert.match(founderTestWriteMigration, /create or replace function private\.inventory_actor_can_write/i);
assert.match(founderTestWriteMigration, /create or replace function private\.sales_actor_can_write/i);

assert.match(commandHelper, /const supabase = await createClient\(\)/);
assert.doesNotMatch(
  commandHelper,
  /createAdminClient/,
  "Workspace authorization must not use the service role",
);
assert.match(commandHelper, /from\("workspace_memberships"\)/);
assert.match(commandHelper, /rpc\("get_my_support_session"\)/);
assert.match(commandHelper, /supportSession && request\.method !== "GET" && !supportWriteEnabled/);
assert.match(commandHelper, /supportSession\?\.access_mode === "test_write"/);
assert.match(commandHelper, /SUPPORT_READ_ONLY/);
assert.match(commandHelper, /support_read_only/);
assert.match(commandHelper, /support_test_write/);

assert.doesNotMatch(
  activityWriter,
  /"red"/,
  "Activity writer must match the database tone constraint",
);

console.log("Database, authenticated support-session and guarded Founder testing contracts are internally consistent.");

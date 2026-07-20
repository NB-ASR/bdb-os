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

assert.match(commandHelper, /const supabase = await createClient\(\)/);
assert.doesNotMatch(
  commandHelper,
  /createAdminClient/,
  "Workspace authorization must not use the service role",
);
assert.match(commandHelper, /from\("workspace_memberships"\)/);

assert.doesNotMatch(
  activityWriter,
  /"red"/,
  "Activity writer must match the database tone constraint",
);

console.log("Database and server security contracts are internally consistent.");

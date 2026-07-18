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

const requiredSecurityStatements = [
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

assert.match(invitationMigration, /interval '1 day'/i);
assert.match(invitationMigration, /workspace_memberships_enforce_invitation_expiry/i);
assert.match(databaseTest, /profiles\.is_active/i);
assert.match(databaseTest, /activity_items/i);
assert.match(databaseTest, /workspace isolation constraint/i);

console.log("Database security contract files are present and internally consistent.");

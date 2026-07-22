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
const operatorMigration = await readFile(
  "supabase/migrations/20260722000300_operator_execution_foundation.sql",
  "utf8",
);
const commercialMigration = await readFile(
  "supabase/migrations/20260722000400_commercial_intake.sql",
  "utf8",
);
const financeMigration = await readFile(
  "supabase/migrations/20260722003631_atomic_finance_commands.sql",
  "utf8",
);
const plannerMigration = await readFile(
  "supabase/migrations/20260722004107_autonomous_operator_planner.sql",
  "utf8",
);

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

for (const statement of [
  "alter table public.operator_runs enable row level security",
  "revoke all on table public.operator_runs from public, anon, authenticated",
  "private.has_workspace_permission(p_workspace_id, 'operator', 'edit')",
  "private.operator_workflow_is_published",
  "for update skip locked",
  "current_user <> 'service_role'",
  "unique (workspace_id, idempotency_key)",
  "check (not verified or evidence_source <> 'simulation')",
  "p_verified and (p_status <> 'succeeded' or p_provider_mode = 'mock')",
]) {
  assert.ok(
    operatorMigration.toLowerCase().includes(statement.toLowerCase()),
    `Missing operator security contract: ${statement}`,
  );
}

for (const statement of [
  "current_user <> 'service_role'",
  "pg_advisory_xact_lock",
  "join public.bookings booking",
  "join public.invoices invoice",
  "join public.messages message",
  "private.has_feature(policy.workspace_id, 'operator')",
  "not exists (",
  "operator.run_planned_automatically",
  "grant execute on function public.plan_due_operator_runs(integer) to service_role",
]) {
  assert.ok(
    plannerMigration.toLowerCase().includes(statement.toLowerCase()),
    `Missing autonomous planner contract: ${statement}`,
  );
}

for (const statement of [
  "private.has_workspace_permission(p_workspace_id, 'accounts', 'create')",
  "for update",
  "'replayed', true",
  "private.has_workspace_permission(p_workspace_id, 'banking', 'approve')",
  "the transaction amount must equal the invoice amount",
  "update public.bank_transactions",
  "update public.invoices",
  "revoke all on function public.reconcile_bank_transaction",
]) {
  assert.ok(
    financeMigration.toLowerCase().includes(statement.toLowerCase()),
    `Missing atomic finance contract: ${statement}`,
  );
}

for (const statement of [
  "alter table public.sales_enquiries force row level security",
  "revoke all on table public.sales_enquiries from public, anon, authenticated",
  "grant all on table public.sales_enquiries to service_role",
  "grant execute on function public.submit_sales_enquiry",
  "to service_role",
  "char_length(ip_hash) = 64",
  "recent_count >= 5",
]) {
  assert.ok(
    commercialMigration.toLowerCase().includes(statement.toLowerCase()),
    `Missing commercial intake security contract: ${statement}`,
  );
}

console.log("Database and server security contracts are internally consistent.");

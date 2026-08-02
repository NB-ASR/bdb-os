import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [
  architecture,
  decision,
  foundation,
  commands,
  settingsApi,
  backupApi,
  snapshotHelper,
  settingsPage,
  settingsStyles,
  cache,
] = await Promise.all([
  read("docs/architecture/workspace-settings-backup-restore.md"),
  read("docs/decisions/2026-08-02-workspace-configuration-recovery-boundary.md"),
  read("supabase/migrations/20260802150000_workspace_settings_recovery_foundation.sql"),
  read("supabase/migrations/20260802150500_workspace_settings_recovery_commands.sql"),
  read("src/app/api/workspace/settings/route.ts"),
  read("src/app/api/workspace/backup/route.ts"),
  read("src/lib/server/workspace-snapshot.ts"),
  read("src/app/settings/page.tsx"),
  read("src/app/settings/settings.module.css"),
  read("src/lib/modules/workspace-settings-cache.ts"),
]);

assert.match(architecture, /Settings does not own Customers, Appointments, Sales, Invoices, Payments/i, "Settings ownership must not duplicate departments.");
assert.match(architecture, /replacement recovery, not merge/i, "Restore must be replacement recovery.");
assert.match(architecture, /(same-workspace|exact workspace)/i, "Recovery identity boundary must be explicit.");
assert.match(architecture, /does not embed file bytes/i, "Storage byte exclusion must be explicit.");
assert.match(decision, /restore is owner-only/i, "Destructive recovery must remain Owner-only.");
assert.match(decision, /raw database dump is too broad/i, "The infrastructure backup boundary must be recorded.");

assert.match(foundation, /workspace_recovery_receipts/i, "Recovery receipts must exist.");
assert.match(foundation, /actor_has_workspace_admin_access/i, "Settings administration access must be database-owned.");
assert.match(foundation, /workspace_restorable_tables/i, "Restore must use a fixed allowlist.");
assert.match(foundation, /get_workspace_settings_access/i, "Settings access RPC must exist.");
assert.match(foundation, /security invoker/i, "Settings access must preserve caller permissions.");
assert.match(foundation, /revoke insert, update, delete, truncate on public\.workspace_settings from authenticated/i, "Direct Settings mutations must be revoked.");
assert.match(foundation, /revoke insert, update, delete, truncate on public\.workspace_themes from authenticated/i, "Direct Theme mutations must be revoked.");
assert.match(foundation, /revoke update, delete, truncate on public\.workspaces from authenticated/i, "Direct Workspace updates must be revoked.");
assert.match(foundation, /drop policy if exists "Managers can upload workspace assets"/i, "Browser logo upload must be removed.");
assert.doesNotMatch(foundation, /workspace_memberships',/i, "Memberships must not be in the restore allowlist.");
assert.doesNotMatch(foundation, /subscriptions',/i, "Subscriptions must not be in the restore allowlist.");

assert.match(commands, /function public\.update_workspace_configuration/i, "Trusted Settings command must exist.");
assert.match(commands, /function public\.set_workspace_logo/i, "Trusted Logo command must exist.");
assert.match(commands, /function public\.export_workspace_snapshot/i, "Trusted export command must exist.");
assert.match(commands, /function public\.restore_workspace_snapshot/i, "Trusted restore command must exist.");
assert.match(commands, /workspace_recovery_receipts/i, "Commands must retain stable idempotency receipts.");
assert.match(commands, /pg_timezone_names/i, "Timezone must be validated.");
assert.match(commands, /empty operational workspace/i, "Restore must reject live-data merges.");
assert.match(commands, /storage\.objects/i, "Restore must verify private Storage references.");
assert.match(commands, /target_snapshot->>'workspaceId'/i, "Restore must verify workspace identity.");
assert.match(commands, /jsonb_populate_recordset/i, "Restore must populate typed table rows.");
assert.match(commands, /workspace memberships/i, "Snapshot exclusions must name memberships.");
assert.match(commands, /billing and subscriptions/i, "Snapshot exclusions must name billing.");
assert.match(commands, /grant execute on function public\.restore_workspace_snapshot[\s\S]*to service_role/i, "Restore must be service-role-only.");

for (const api of [settingsApi, backupApi]) {
  assert.match(api, /requireWorkspaceCommand/, "Workspace Settings APIs must use the authenticated workspace boundary.");
  assert.match(api, /createAdminClient/, "Trusted mutation APIs must keep the service role server-side.");
}
assert.match(settingsApi, /get_workspace_settings_access/, "Settings API must resolve manage and recover access.");
assert.match(settingsApi, /update_workspace_configuration/, "Settings API must use the trusted configuration command.");
assert.match(settingsApi, /set_workspace_logo/, "Settings API must use the trusted logo command.");
assert.match(settingsApi, /workspace_recovery_receipts/, "Logo upload must check idempotency before writing Storage.");
assert.match(settingsApi, /remove\(\[path\]\)/, "Failed logo commands must clean up the uploaded object.");
assert.match(backupApi, /export_workspace_snapshot/, "Backup API must use the trusted export command.");
assert.match(backupApi, /restore_workspace_snapshot/, "Backup API must use the trusted restore command.");
assert.match(backupApi, /RESTORE \$\{workspaceResult\.data\.name\}/, "Restore must require exact workspace confirmation.");
assert.match(backupApi, /verifySnapshotEnvelope/, "Restore must verify snapshot integrity.");
assert.match(backupApi, /15_000_000/, "Snapshot upload must be bounded.");

assert.match(snapshotHelper, /sha256/i, "Snapshots must use SHA-256.");
assert.match(snapshotHelper, /canonicalJson/i, "Snapshot hashing must be deterministic.");
assert.match(snapshotHelper, /workspaceId !== workspaceId/i, "Snapshot helper must enforce same-workspace restore.");
assert.match(snapshotHelper, /checksum is invalid/i, "Modified snapshots must be rejected.");

assert.doesNotMatch(settingsPage, /useBdb/, "Settings must not mutate through the legacy shared store.");
assert.match(settingsPage, /\/api\/workspace\/settings/, "Settings must use its authenticated API.");
assert.match(settingsPage, /\/api\/workspace\/backup/, "Recovery must use its authenticated API.");
assert.match(settingsPage, /Showing the last trusted Settings snapshot while offline/i, "Offline Settings must label cached data.");
assert.match(settingsPage, /BDB OS will not merge a snapshot into live data/i, "The UI must state the non-merge boundary.");
assert.match(settingsPage, /Owner only/i, "The UI must state recovery ownership.");
assert.match(settingsPage, /Supabase infrastructure backups and point-in-time recovery remain a separate/i, "The UI must distinguish infrastructure recovery.");
assert.match(settingsStyles, /var\(--gold\)/i, "Settings must preserve dark-gold identity.");
assert.match(settingsStyles, /recoveryGrid/i, "Recovery must have a deliberate responsive layout.");
assert.match(cache, /localStorage/i, "Settings must preserve a last trusted offline snapshot.");
assert.match(cache, /workspaceId/i, "Offline Settings cache must remain workspace-scoped.");

console.log("Workspace Settings, backup and restore architecture contract passed.");

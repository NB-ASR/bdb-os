import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [
  architecture,
  decision,
  operationsMigration,
  restoreMigration,
  anonymousRevocation,
  operationsApi,
  exportApi,
  pushApi,
  operationsPanel,
  settingsPage,
] = await Promise.all([
  read("docs/architecture/workspace-settings-control-centre.md"),
  read("docs/decisions/2026-08-05-safe-vanita-settings-integration.md"),
  read("supabase/migrations/20260805130000_workspace_operations_settings.sql"),
  read("supabase/migrations/20260805130500_restore_operational_settings.sql"),
  read("supabase/migrations/20260805131000_revoke_anonymous_operational_settings.sql"),
  read("src/app/api/workspace/operations/route.ts"),
  read("src/app/api/workspace/data-export/route.ts"),
  read("src/app/api/push/subscribe/route.ts"),
  read("src/app/settings/operations-panel.tsx"),
  read("src/app/settings/page.tsx"),
]);

assert.match(architecture, /Settings does not own Customers, Appointments, Products, Services, Suppliers, Sales, Invoices, Payments/i, "Settings must not duplicate department ownership.");
assert.match(architecture, /replacement recovery, not merge/i, "The recovery boundary must remain replacement-only.");
assert.match(architecture, /(reset arbitrary data areas|arbitrary data[- ]area (reset|deletion))/i, "Uncontrolled data reset must be rejected explicitly.");
assert.match(architecture, /pending offline commands/i, "Local maintenance must preserve pending offline work.");
assert.match(decision, /literal port would introduce unsafe duplicate state/i, "The Vanita integration decision must reject literal state copying.");
assert.match(decision, /signed-in RLS client for exports/i, "Data exports must preserve caller permissions.");

assert.match(operationsMigration, /create table if not exists public\.workspace_operational_settings/i, "Operational Settings table must exist.");
assert.match(operationsMigration, /fiscal_year_start_month/i, "Fiscal-year default must exist.");
assert.match(operationsMigration, /default_export_format/i, "Export-format default must exist.");
assert.match(operationsMigration, /archived_records_default/i, "Archive visibility default must exist.");
assert.match(operationsMigration, /appointment_reminders_enabled/i, "Reminder enablement must exist.");
assert.match(operationsMigration, /enable row level security/i, "Operational Settings must use RLS.");
assert.match(operationsMigration, /revoke insert, update, delete, truncate on public\.workspace_operational_settings from authenticated/i, "Browser writes must be revoked.");
assert.match(operationsMigration, /function public\.update_workspace_operational_settings/i, "Trusted operational Settings command must exist.");
assert.match(operationsMigration, /actor_has_workspace_admin_access/i, "Trusted command must verify workspace administration access.");
assert.match(operationsMigration, /workspace_recovery_receipts/i, "Operational Settings changes must be idempotent.");
assert.match(operationsMigration, /Operational settings updated/i, "Operational Settings changes must write Activity.");
assert.match(operationsMigration, /workspace\.operational_settings_updated/i, "Operational Settings changes must write security audit evidence.");
assert.match(operationsMigration, /workspace_operational_settings'/i, "Operational Settings must be included in snapshots.");
assert.match(operationsMigration, /coalesce\(operations\.appointment_reminders_enabled, true\)/i, "Reminder delivery must honour the workspace setting.");
assert.match(restoreMigration, /delete from public\.workspace_operational_settings/i, "Restore must replace the operational Settings row before insertion.");
assert.match(restoreMigration, /empty operational workspace/i, "Restore must continue rejecting live-data merge.");
assert.match(anonymousRevocation, /revoke all on public\.workspace_operational_settings from anon/i, "Anonymous table privileges must be revoked explicitly.");

assert.match(operationsApi, /requireWorkspaceCommand/, "Operations API must use the authenticated workspace boundary.");
assert.match(operationsApi, /get_workspace_settings_access/, "Operations API must resolve Settings access.");
assert.match(operationsApi, /createAdminClient/, "Trusted operational mutation must keep the service role server-side.");
assert.match(operationsApi, /update_workspace_operational_settings/, "Operations API must use the trusted command.");
assert.match(operationsApi, /Idempotency/i, "Operations API must require idempotency.");

assert.match(exportApi, /requireWorkspaceCommand/, "Data export must use the authenticated workspace boundary.");
assert.match(exportApi, /get_workspace_settings_access/, "Data export must resolve workspace administration access.");
assert.match(exportApi, /support_read_only/i, "Read-only Founder support must not export workspace data.");
assert.doesNotMatch(exportApi, /createAdminClient/, "Data export reads must not bypass caller RLS with the service role.");
assert.match(exportApi, /customers.*products.*services.*suppliers.*reports/is, "Data exports must be limited to the approved areas.");
assert.match(exportApi, /text\/csv/i, "CSV export must be implemented.");
assert.match(exportApi, /application\/json/i, "JSON export must be implemented.");
assert.match(exportApi, /Cache-Control.*no-store/is, "Exports must be no-store.");

assert.match(pushApi, /export async function GET/, "Push subscription status must be readable.");
assert.match(pushApi, /export async function POST/, "Push subscription registration must exist.");
assert.match(pushApi, /export async function DELETE/, "Push subscription removal must exist.");
assert.match(pushApi, /workspace_id.*user_id/is, "Push subscription operations must be scoped to workspace and user.");

assert.match(settingsPage, /Operations & security/i, "Settings must expose the operational control centre.");
assert.match(operationsPanel, /\/api\/workspace\/operations/i, "Operations panel must use its authenticated API.");
assert.match(operationsPanel, /\/api\/workspace\/data-export/i, "Operations panel must use authoritative data exports.");
assert.match(operationsPanel, /\/api\/push\/subscribe/i, "Operations panel must manage real device subscriptions.");
assert.match(operationsPanel, /\/mfa/, "Security panel must connect to MFA.");
assert.match(operationsPanel, /\/change-password/, "Security panel must connect to password management.");
assert.match(operationsPanel, /Low-stock attention remains active/i, "Low-stock attention must not be represented as a fake preference.");
assert.match(operationsPanel, /Security events remain platform-controlled/i, "Security events must remain non-disableable.");
assert.match(operationsPanel, /Pending offline queues are deliberately excluded/i, "Cache maintenance must state the offline queue boundary.");
assert.match(operationsPanel, /will not merge a backup into live records/i, "UI must reject backup merging.");
assert.match(operationsPanel, /will not.*arbitrary department deletion/i, "UI must reject arbitrary department deletion.");
assert.doesNotMatch(operationsPanel, /repair workspace|maintenance mode|reset individual/i, "Ordinary Settings must not expose broad repair or reset controls.");

console.log("Workspace operational Settings, exports, notifications and diagnostics contract passed.");

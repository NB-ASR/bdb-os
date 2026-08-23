import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import {
  domainMigrationHeader,
  domainMigrations,
  releaseSourceDirectory,
} from "./release-domain-plan.mjs";

const migrationFiles = (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const releaseSourceFiles = (await readdir("supabase/release-sources/vanita-integration-20260813"))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const canonicalProductionHistory = [
  "20260714021331_saas_foundation.sql",
  "20260714021438_saas_hardening.sql",
  "20260714021941_private_workspace_storage.sql",
  "20260714091849_add_push_notifications.sql",
  "20260714091955_add_appointment_reminder_schedule.sql",
  "20260714092427_index_notification_foreign_keys.sql",
  "20260716220003_v1_foundation.sql",
  "20260716220034_v1_access_hardening.sql",
  "20260716220053_team_access_core.sql",
  "20260716220156_workspace_context_isolation.sql",
  "20260717002647_theme_preset_alignment.sql",
  "20260717002659_production_workspace.sql",
  "20260717171602_add_workspace_membership_profile_fk.sql",
  "20260718193000_quality_foundation_security.sql",
  "20260718193500_invitation_expiry_guard.sql",
  "20260722000100_sector_packs.sql",
  "20260722000200_sector_pack_workspace_defaults.sql",
  "20260722000300_operator_execution_foundation.sql",
  "20260722000400_commercial_intake.sql",
  "20260722002645_operator_advisor_remediation.sql",
  "20260722003631_atomic_finance_commands.sql",
  "20260722004107_autonomous_operator_planner.sql",
  "20260722004208_operator_planner_schema_access.sql",
  "20260722010358_operator_policy_reference_guard.sql",
  "20260722010506_operator_policy_reference_index.sql",
  "20260813124655_bdb_release_backup_before_vanita_integration.sql",
  "20260813125308_vanita_integration_status_values.sql",
  "20260813125602_vanita_integration_feature_release.sql",
  "20260813125723_restore_pre_release_invoice_timestamps.sql",
  "20260813133407_vanita_release_prerequisites_and_features.sql",
  "20260813133410_vanita_release_catalogues_and_suppliers.sql",
  "20260813133415_vanita_release_purchasing_documents_and_inventory.sql",
  "20260813133419_vanita_release_services_sales_and_purchase_creation.sql",
  "20260813133422_vanita_release_customer_foundation.sql",
  "20260813133425_vanita_release_appointments_and_calendar.sql",
  "20260813133429_vanita_release_customer_accounts.sql",
  "20260813133434_vanita_release_purchasing_and_supplier_payables.sql",
  "20260813133442_vanita_release_banking_reconciliation.sql",
  "20260813133446_vanita_release_customer_360.sql",
  "20260813133451_vanita_release_documents_and_communications.sql",
  "20260813133455_vanita_release_business_hub_workspace_and_admin.sql",
  "20260813143945_unify_sales_service_permission_boundaries.sql",
  "20260817221033_custom_business_branding.sql",
  "20260818124113_client_usage_metering.sql",
  "20260818150236_accounts_business_documents_v1.sql",
  "20260818200136_customer_command_unification.sql",
  "20260818220613_accounts_invoice_ux_pricing.sql",
  "20260818221234_accounts_invoice_header_reconcile.sql",
  "20260819110118_accounts_document_lifecycle_v1.sql",
  "20260819110134_accounts_credit_cancellation_status.sql",
  "20260819110205_accounts_credit_vat_and_numbering.sql",
  "20260819111532_accounts_invoice_total_precision_hotfix.sql",
  "20260819122420_accounts_partial_credit_sales_order.sql",
  "20260819132042_accounts_catalogue_credit_rules.sql",
  "20260819145020_business_document_branding_snapshots.sql",
  "20260819221325_accounts_scalable_registers.sql",
  "20260819222047_accounts_invoice_register_cursor.sql",
  "20260821112427_accounts_engine_hardening_pass1.sql",
  "20260821132042_accounts_document_permanence.sql",
  "20260823121552_accounts_supplier_scale_pass4.sql",
  "20260823121617_accounts_customer_register_scale_pass4.sql",
  "20260823204333_service_enquiry_intake.sql",
  "20260823212453_repair_workspace_operator_policy_provisioning.sql",
];

const pendingMigrations = [];
const registeredMigrationFiles = migrationFiles.filter((name) => !pendingMigrations.includes(name));
const actualPendingMigrations = migrationFiles.filter((name) => pendingMigrations.includes(name));

assert.deepEqual(
  registeredMigrationFiles,
  canonicalProductionHistory,
  "The registered repository migration history must exactly match Production before pending release migrations.",
);
assert.deepEqual(
  actualPendingMigrations,
  pendingMigrations,
  "Pending release migrations must be explicitly reviewed and listed.",
);
assert.deepEqual(
  migrationFiles,
  [...canonicalProductionHistory, ...pendingMigrations].sort(),
  "No migration may appear outside the registered Production history or reviewed pending release list.",
);

const versions = migrationFiles.map((name) => name.split("_")[0]);
assert.equal(new Set(versions).size, versions.length, "Every migration version must be unique.");

const obsoleteVersions = new Set([
  "20260714080000", "20260714090000", "20260714093000", "20260714100000",
  "20260714231500", "20260715150000", "20260715160000", "20260715161000",
  "20260715162000", "20260717115900", "20260717120000", "20260717172000",
]);
assert.equal(migrationFiles.some((name) => obsoleteVersions.has(name.split("_")[0])), false, "Obsolete parallel migration versions must not return.");
assert.ok(migrationFiles.includes("20260718193000_quality_foundation_security.sql"), "Quality Foundation security migration is missing.");
assert.ok(migrationFiles.includes("20260718193500_invitation_expiry_guard.sql"), "Invitation expiry migration is missing.");

const featureReleaseMarker = await readFile("supabase/migrations/20260813125602_vanita_integration_feature_release.sql", "utf8");
assert.match(featureReleaseMarker, /Production feature-release marker/);
assert.doesNotMatch(featureReleaseMarker, /\b(create|alter|drop|insert|update|delete|truncate)\s+(table|type|view|function|policy|into|from)\b/i, "The Production feature-release marker must not replay feature SQL.");

const assignedReleaseSources = [];
for (const group of domainMigrations) {
  const firstIndex = releaseSourceFiles.indexOf(group.firstSource);
  const lastIndex = releaseSourceFiles.indexOf(group.lastSource);
  assert.notEqual(firstIndex, -1, `Missing first source ${group.firstSource}.`);
  assert.notEqual(lastIndex, -1, `Missing last source ${group.file}.`);
  assert.ok(lastIndex >= firstIndex, `Invalid source range for ${group.file}.`);
  const groupSources = releaseSourceFiles.slice(firstIndex, lastIndex + 1);
  assignedReleaseSources.push(...groupSources);
  const sourceSql = await Promise.all(groupSources.map((name) => readFile(path.join(releaseSourceDirectory, name), "utf8")));
  const expectedSql = domainMigrationHeader(group, groupSources) + sourceSql.join("\n\n");
  const actualSql = await readFile(path.join("supabase/migrations", group.file), "utf8");
  assert.equal(actualSql, expectedSql, `${group.file} must exactly preserve its ordered source SQL.`);
  assert.ok(Buffer.byteLength(actualSql) < 128 * 1024, `${group.file} must remain smaller than 128 KiB.`);
}
assert.deepEqual(assignedReleaseSources, releaseSourceFiles, "Every preserved release source must be assigned once in chronological order.");

for (const [file, message] of [
  ["20260727152000_product_catalogue_foundation.sql", "Product catalogue foundation migration is missing."],
  ["20260727154000_supplier_directory_foundation.sql", "Supplier directory foundation migration is missing."],
  ["20260727155000_product_supplier_relationship.sql", "Product Supplier relationship migration is missing."],
  ["20260727161000_supplier_document_capture_review.sql", "Supplier document capture and review migration is missing."],
  ["20260727161500_supplier_document_reference_indexes.sql", "Supplier document reference indexes are missing."],
  ["20260727190000_inventory_movement_ledger.sql", "Inventory movement ledger migration is missing."],
  ["20260727190500_inventory_reference_indexes.sql", "Inventory reference indexes are missing."],
]) assert.ok(releaseSourceFiles.includes(file), message);

const releaseEntitlements = await readFile("supabase/release-sources/vanita-integration-20260813/20260805131000_revoke_anonymous_operational_settings.sql", "utf8");
for (const featureKey of ["products", "services", "suppliers", "sales", "inventory", "purchasing", "timesheets", "meetings"]) {
  assert.match(releaseEntitlements, new RegExp(`'${featureKey}'`), `${featureKey} must be enabled for existing Main plans.`);
}
assert.match(releaseEntitlements, /insert into public\.plan_features/i);
assert.match(releaseEntitlements, /where plan\.is_active/i);

console.log("Registered migration history matches Production and reviewed pending migrations are explicit.");

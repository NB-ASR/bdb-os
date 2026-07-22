import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const migrationFiles = (await readdir("supabase/migrations"))
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
];

assert.deepEqual(
  migrationFiles.slice(0, canonicalProductionHistory.length),
  canonicalProductionHistory,
  "The repository migration prefix must match the versions already registered in production.",
);

const versions = migrationFiles.map((name) => name.split("_")[0]);
assert.equal(
  new Set(versions).size,
  versions.length,
  "Every migration version must be unique.",
);

const obsoleteVersions = new Set([
  "20260714080000",
  "20260714090000",
  "20260714093000",
  "20260714100000",
  "20260714231500",
  "20260715150000",
  "20260715160000",
  "20260715161000",
  "20260715162000",
  "20260717115900",
  "20260717120000",
  "20260717172000",
]);

assert.equal(
  migrationFiles.some((name) => obsoleteVersions.has(name.split("_")[0])),
  false,
  "Obsolete parallel migration versions must not return.",
);

assert.ok(
  migrationFiles.includes("20260718193000_quality_foundation_security.sql"),
  "Quality Foundation security migration is missing.",
);
assert.ok(
  migrationFiles.includes("20260718193500_invitation_expiry_guard.sql"),
  "Invitation expiry migration is missing.",
);
assert.ok(
  migrationFiles.includes("20260722103000_inventory_ledger_foundation.sql"),
  "Inventory ledger foundation migration is missing.",
);
assert.ok(
  migrationFiles.includes("20260722103100_inventory_location_retry_guard.sql"),
  "Inventory location retry guard migration is missing.",
);

console.log("Migration history matches the canonical production prefix.");

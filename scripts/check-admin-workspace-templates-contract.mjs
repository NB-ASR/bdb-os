import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [
  architecture,
  decision,
  foundation,
  commands,
  templatesApi,
  adminApi,
  manualApi,
  templatesPage,
  adminPage,
  manualPage,
  teamApi,
  teamPage,
] = await Promise.all([
  read("docs/architecture/admin-workspace-template-integration.md"),
  read("docs/decisions/2026-08-03-versioned-workspace-template-snapshots.md"),
  read("supabase/migrations/20260803090000_admin_workspace_template_foundation.sql"),
  read("supabase/migrations/20260803090500_admin_workspace_template_commands.sql"),
  read("src/app/api/admin/templates/route.ts"),
  read("src/app/api/admin/route.ts"),
  read("src/app/api/admin/manual-workspace/route.ts"),
  read("src/app/admin/templates/page.tsx"),
  read("src/app/admin/page.tsx"),
  read("src/app/admin/manual-provisioning/page.tsx"),
  read("src/app/api/workspace/team/route.ts"),
  read("src/app/team/page.tsx"),
]);

assert.match(architecture, /versioned snapshots, not live inheritance/i, "Template snapshot boundary must be explicit.");
assert.match(architecture, /Existing workspaces do not follow later template changes automatically/i, "Template edits must not propagate silently.");
assert.match(architecture, /old Vanita historical-data migration is removed/i, "Remaining sequence scope change must be recorded.");
assert.match(decision, /do not inherit later template edits automatically/i, "The non-propagation decision must be durable.");
assert.match(decision, /plans describe commercial entitlements/i, "Plans and templates must remain separate concepts.");

for (const table of [
  "workspace_templates",
  "workspace_template_features",
  "workspace_template_permissions",
  "workspace_access_profile_permissions",
]) {
  assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`, "i"), `${table} must exist.`);
  assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} must use RLS.`);
  assert.match(foundation, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"), `${table} must not expose browser table access.`);
}
assert.match(foundation, /workspace_template_version integer/i, "Workspaces must retain template version provenance.");
assert.match(foundation, /workspace_access_profile_permissions[\s\S]*source_template_version/i, "Workspace access presets must retain template provenance.");
assert.match(foundation, /create or replace function private\.actor_has_workspace_permission/i, "Permission resolution must be updated.");
assert.match(foundation, /from public\.workspace_access_profile_permissions/i, "Permission resolution must use workspace presets.");
assert.match(foundation, /Legacy or deliberately custom provisioning/i, "Legacy provenance must not be fabricated.");

assert.match(commands, /function public\.save_workspace_template/i, "Trusted template save command must exist.");
assert.match(commands, /function public\.apply_workspace_template/i, "Trusted template apply command must exist.");
assert.match(commands, /template\.version \+ 1/i, "Template edits must increment the version.");
assert.match(commands, /INCOMPLETE_TEMPLATE_FEATURE_MATRIX/i, "Templates must require complete feature matrices.");
assert.match(commands, /INCOMPLETE_TEMPLATE_PERMISSION_MATRIX/i, "Templates must require complete permission matrices.");
assert.match(commands, /WORKSPACE_ALREADY_CONFIGURED/i, "Templates must not merge into configured workspaces.");
assert.match(commands, /workspace_template_version = selected_template\.version/i, "Provisioning must snapshot the version.");
assert.match(commands, /workspace_feature_overrides/i, "Template modules must be copied to workspace overrides.");
assert.match(commands, /workspace_access_profile_permissions/i, "Template access presets must be copied to the workspace.");
assert.match(commands, /grant execute on function public\.apply_workspace_template[\s\S]*to service_role/i, "Template apply must be service-role-only.");
assert.doesNotMatch(commands, /grant execute on function public\.apply_workspace_template[\s\S]*to authenticated/i, "Authenticated clients must not execute template apply.");

assert.match(templatesApi, /requirePlatformAdmin/, "Template API must require Founder access.");
assert.match(templatesApi, /save_workspace_template/, "Template API must use the trusted save command.");
assert.match(templatesApi, /workspace_count/i, "Template API must expose usage context.");
assert.match(templatesPage, /Workspace templates/i, "Founder template editor must exist.");
assert.match(templatesPage, /Existing clients were not changed/i, "Editor must state version isolation after save.");
assert.match(templatesPage, /type ProfileKey = "manager" \| "employee"/, "Editor must expose typed Manager and Employee matrices.");
assert.match(templatesPage, /templatePermissions/, "Editor must consume the persisted permission matrix contract.");

for (const api of [adminApi, manualApi]) {
  assert.match(api, /apply_workspace_template/, "Every provisioning API must use the trusted template command.");
  assert.match(api, /templateId/i, "Every provisioning API must require a template.");
  assert.doesNotMatch(api, /Selected during client provisioning/i, "Provisioning APIs must not recreate feature overrides independently.");
  assert.doesNotMatch(api, /workspace_themes"\)\.insert/i, "Provisioning APIs must not recreate Theme defaults independently.");
  assert.doesNotMatch(api, /workspace_settings"\)\.insert/i, "Provisioning APIs must not recreate Settings defaults independently.");
}
assert.match(adminPage, /Workspace templates/i, "Founder Admin must navigate to templates.");
assert.match(adminPage, /Provisioning template/i, "Client detail must show template provenance.");
assert.match(adminPage, /templateId/i, "Normal provisioning UI must submit a template.");
assert.match(manualPage, /Workspace template/i, "Manual provisioning UI must select a template.");
assert.match(manualPage, /templateVersion/i, "Manual provisioning must surface copied version evidence.");

assert.match(teamApi, /workspace_access_profile_permissions/i, "Team API must load workspace access presets.");
assert.match(teamApi, /profileDefaults/i, "Team API must return workspace access presets.");
assert.match(teamPage, /profileDefaults/i, "Team UI must display workspace access presets.");
assert.match(teamPage, /copied during provisioning/i, "Team UI must explain preset provenance.");
assert.match(teamPage, /member-specific permissions/i, "Team UI must preserve explicit exception semantics.");

console.log("Admin workspace template architecture contract passed.");

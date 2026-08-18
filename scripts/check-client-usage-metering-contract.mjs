import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, usageApi, adminPage, usageComponent, architecture] = await Promise.all([
  readFile("supabase/migrations/20260818120000_client_usage_metering.sql", "utf8"),
  readFile("src/app/api/admin/usage/route.ts", "utf8"),
  readFile("src/app/admin/page.tsx", "utf8"),
  readFile("src/components/founder-client-usage.tsx", "utf8"),
  readFile("docs/architecture/client-usage-metering-v1.md", "utf8"),
]);

for (const table of [
  "plan_usage_allowances",
  "workspace_usage_periods",
  "workspace_usage_events",
  "workspace_usage_baselines",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}\\b`, "i"), `${table} must exist in the metering migration.`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} must have RLS enabled.`);
}

assert.match(migration, /workspace_usage_events[\s\S]*workspace_id uuid not null/i, "Every usage event must be workspace-owned.");
assert.match(migration, /unique \(workspace_id, metric_key, idempotency_key\)/i, "Usage events must be idempotent per workspace and metric.");
assert.match(migration, /allowances_snapshot jsonb/i, "Each period must freeze its allowance snapshot.");
assert.match(migration, /plan_id_snapshot/i, "Each period must freeze its plan identity.");
assert.match(migration, /private\.is_platform_admin\(\)/i, "Usage table visibility must reuse the Platform Admin boundary.");
assert.match(migration, /grant execute on function public\.record_workspace_usage_event\([^;]+\) to service_role/i, "Usage event writes must be service-role only.");
assert.doesNotMatch(migration, /grant execute on function public\.record_workspace_usage_event\([^;]+\) to authenticated/i, "Workspace browser users must not be able to forge usage events.");
assert.match(migration, /meter_operator_run_usage[\s\S]*exception when others[\s\S]*null/i, "Automation metering must be recoverable and non-blocking.");
assert.match(migration, /meter_outbound_email_usage[\s\S]*exception when others[\s\S]*null/i, "Email metering must be recoverable and non-blocking.");
assert.match(migration, /operator-run:' \|\| new\.id/i, "Operator usage must use a deterministic source idempotency key.");
assert.match(migration, /message:' \|\| new\.id/i, "Email usage must use a deterministic source idempotency key.");
assert.match(migration, /reconcile_workspace_usage_events/i, "Event meters must be repairable from authoritative records.");
assert.match(migration, /storage\.objects/i, "File storage must be reconciled from authoritative private storage objects.");
assert.match(migration, /workspace_memberships/i, "Active user usage must come from authoritative workspace memberships.");
assert.match(migration, /'sms_segments'[\s\S]*'not_connected'/i, "SMS must remain explicitly unconnected until a real transport exists.");

for (const metric of ["storage_bytes", "active_users", "automation_executions", "outbound_emails", "sms_segments"]) {
  assert.match(migration, new RegExp(`'${metric}'`), `${metric} must be an explicit V1 usage metric.`);
}

assert.doesNotMatch(migration, /stripe\./i, "Measurement migration must not charge Stripe.");
assert.doesNotMatch(migration, /insert into public\.invoices/i, "Measurement migration must not create invoices.");
assert.doesNotMatch(migration, /update public\.workspaces[\s\S]*suspend/i, "Measurement migration must not suspend clients.");

assert.match(usageApi, /requirePlatformAdmin\(\)/, "Founder Usage API must require MFA-backed Platform Admin access.");
assert.match(usageApi, /get_founder_workspace_usage_snapshot/, "Founder Usage API must read the authoritative metering summary.");
assert.match(usageApi, /automaticCharging:\s*false/, "Founder Usage API must explicitly keep automatic charging disabled.");
assert.match(usageApi, /measurementOnly:\s*true/, "Founder Usage API must explicitly identify measurement-only mode.");
assert.match(usageApi, /sms_segments:[\s\S]*not connected/i, "Founder Usage API must explain that SMS is not connected.");

assert.match(adminPage, /\{ key: "usage", label: "Usage" \}/, "Usage must live inside each selected client in Founder Admin.");
assert.match(adminPage, /FounderClientUsage/, "Founder Admin must use the shared client Usage component.");
assert.doesNotMatch(adminPage, /href="\/admin\/usage"/, "Usage must not become a duplicate standalone Admin destination.");
assert.match(usageComponent, /Measurement only · no automatic charging/, "Founder UI must make the commercial boundary explicit.");
assert.match(usageComponent, /Package allowance/, "Founder UI must show package allowance state.");
assert.match(usageComponent, /Remaining/, "Founder UI must show remaining allowance state.");
assert.match(usageComponent, /Exceptional-usage indicators/, "Founder UI must expose restrained non-billable review indicators.");
assert.match(usageComponent, /Recent metered evidence/, "Founder UI must retain enough evidence to explain usage changes.");

assert.match(architecture, /measurement -> Founder observation -> validated allowances\/overage calculations -> automated charging later/i, "Architecture must preserve the agreed staged commercial rollout.");
assert.match(architecture, /Baselines are not reconstructed historical billing/i, "Architecture must reject invented historical usage.");

console.log("Client usage metering remains workspace-scoped, idempotent, Founder-only and measurement-only.");

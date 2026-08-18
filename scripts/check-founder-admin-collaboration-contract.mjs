import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [adminRoute, activityRoute, adminPage, brandingRoute, billingRoute] = await Promise.all([
  readFile("src/app/api/admin/route.ts", "utf8"),
  readFile("src/app/api/admin/activity/route.ts", "utf8"),
  readFile("src/app/admin/page.tsx", "utf8"),
  readFile("src/app/api/admin/branding/route.ts", "utf8"),
  readFile("src/app/api/admin/billing-link/route.ts", "utf8"),
]);

assert.match(adminRoute, /platform_admins/, "Shared activity must resolve authoritative platform-admin identities.");
assert.match(adminRoute, /profiles/, "Shared activity must resolve human-readable actor names from existing profiles.");
assert.match(adminRoute, /workspaceActivity/, "Founder Admin must return per-client creator and last-modifier summaries.");
assert.match(adminRoute, /actor_is_platform_admin/, "Audit records must distinguish Founder Admin actors from client activity.");
assert.match(adminRoute, /workspace\.created[\s\S]*workspace\.manually_provisioned/, "Both normal and manual client creation must count as authoritative creation events.");
assert.match(adminRoute, /writeAudit\(admin/, "Founder Admin mutations must use checked audit writes.");

assert.match(activityRoute, /requirePlatformAdmin\(\)/, "Shared activity polling must remain MFA-protected Founder Admin data.");
assert.match(activityRoute, /audit_logs/, "Shared activity polling must use the existing authoritative audit log.");
assert.match(activityRoute, /platform_admins/, "Polling must react only to shared platform-admin activity.");
assert.doesNotMatch(activityRoute, /supabase\.channel|postgres_changes/i, "V1 shared activity must not add a second realtime state subsystem.");

assert.match(adminPage, /Shared control room · auto-updates/, "Founder Admin must visibly identify the shared control-room behaviour.");
assert.match(adminPage, /Creator not recorded/, "Unknown historical creators must not be guessed.");
assert.match(adminPage, /Last modified/, "Each client must expose its latest Founder modification.");
assert.match(adminPage, /Founder Activity/, "Each selected client must expose restrained Founder activity history.");
assert.match(adminPage, /\/api\/admin\/activity/, "Open Founder Admin sessions must check for shared changes automatically.");
assert.match(adminPage, /15_000/, "Shared change polling must stay restrained rather than hammering the full dashboard endpoint.");
assert.doesNotMatch(adminPage, /setInterval\([^\n]*\/api\/admin\"/, "The expensive full Admin dashboard must not be polled continuously.");

assert.match(brandingRoute, /if \(error\) throw error;/, "Branding changes must fail loudly if their audit write fails.");
assert.match(billingRoute, /if \(audit\.error\) throw audit\.error;/, "Billing changes must fail loudly if their audit write fails.");

console.log("Founder Admin shared-control-room, attribution and lightweight auto-refresh contracts are intact.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  migration,
  adminBrandingRoute,
  adminBrandingPage,
  appShell,
  overview,
  refinement,
] = await Promise.all([
  readFile("supabase/migrations/20260817193000_custom_business_branding.sql", "utf8"),
  readFile("src/app/api/admin/branding/route.ts", "utf8"),
  readFile("src/app/admin/branding/page.tsx", "utf8"),
  readFile("src/components/app-shell.tsx", "utf8"),
  readFile("src/app/workspace/page.tsx", "utf8"),
  readFile("src/app/bdb-refinement-v2.css", "utf8"),
]);

assert.match(migration, /'custom_branding'/, "Custom branding entitlement must be explicit.");
assert.match(migration, /platform_admins[\s\S]*active\s*=\s*true/i, "Logo database command must require an active platform administrator.");
assert.match(migration, /plan_features[\s\S]*false/i, "Custom branding must default to disabled for normal plans.");

assert.match(adminBrandingRoute, /requirePlatformAdmin\(\)/, "Branding API must require Founder Admin authentication.");
assert.match(adminBrandingRoute, /image\/png/, "PNG branding upload must be supported.");
assert.match(adminBrandingRoute, /image\/jpeg/, "JPEG branding upload must be supported.");
assert.match(adminBrandingRoute, /image\/webp/, "WebP branding upload must be supported.");
assert.doesNotMatch(adminBrandingRoute, /image\/svg\+xml/, "Founder branding upload must not accept SVG.");
assert.match(adminBrandingRoute, /2_000_000/, "Founder branding upload must retain the 2 MB cap.");
assert.match(adminBrandingRoute, /logo_removed/, "Logo removal must be audited.");

assert.match(adminBrandingPage, /Custom Business Branding/, "Founder Admin must expose a dedicated branding control.");
assert.match(adminBrandingPage, /saved logo was retained/i, "Disable must retain the saved logo.");
assert.match(adminBrandingPage, /Remove deletes the asset/i, "Remove behaviour must be explicit.");

assert.match(appShell, /enabledFeatures\.custom_branding/, "Client logo display must be entitlement-gated.");
assert.match(appShell, /global-create-button/, "One permission-aware global Create control must be present.");
assert.match(appShell, /Search across BDB OS/, "Global search must remain a first-class workspace command.");

assert.match(overview, /Today &amp; Attention/, "Overview must centre on Today & Attention.");
assert.doesNotMatch(overview, /Recent activity/i, "Overview must not recreate the separate Activity surface.");
assert.doesNotMatch(overview, /Financial position/i, "Overview must not expose a universal financial dashboard.");
assert.doesNotMatch(overview, /orbit/i, "Overview must not restore the decorative department wheel.");

assert.match(refinement, /logo-upload-card[\s\S]*display:\s*none/i, "Client Settings must not expose self-service logo upload.");

console.log("Custom branding, role-aware Overview and restrained shell contracts are present.");

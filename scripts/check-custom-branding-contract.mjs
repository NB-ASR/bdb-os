import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  migration,
  brandingSnapshotMigration,
  adminBrandingRoute,
  adminPage,
  legacyBrandingPage,
  appShell,
  overview,
  refinement,
] = await Promise.all([
  readFile("supabase/migrations/20260817221033_custom_business_branding.sql", "utf8"),
  readFile("supabase/migrations/20260819143500_business_document_branding_snapshots.sql", "utf8"),
  readFile("src/app/api/admin/branding/route.ts", "utf8"),
  readFile("src/app/admin/page.tsx", "utf8"),
  readFile("src/app/admin/branding/page.tsx", "utf8"),
  readFile("src/components/app-shell.tsx", "utf8"),
  readFile("src/app/workspace/page.tsx", "utf8"),
  readFile("src/app/bdb-refinement-v2.css", "utf8"),
]);

assert.match(migration, /'custom_branding'/, "Custom branding entitlement must be explicit.");
assert.match(migration, /platform_admins[\s\S]*active\s*=\s*true/i, "Logo database command must require an active platform administrator.");
assert.match(migration, /plan_features[\s\S]*false/i, "Custom branding must default to disabled for normal plans.");

assert.match(brandingSnapshotMigration, /supplier_logo_path_snapshot/, "Issued documents must snapshot their logo path.");
assert.match(brandingSnapshotMigration, /branding_snapshot_at/, "Issued documents must record branding snapshot time.");
assert.match(brandingSnapshotMigration, /current_custom_branding_logo_path/, "Issue-time branding must resolve from authoritative workspace state.");

assert.match(adminBrandingRoute, /requirePlatformAdmin\(\)/, "Branding API must require Founder Admin authentication.");
assert.match(adminBrandingRoute, /image\/png/, "PNG branding upload must be supported.");
assert.match(adminBrandingRoute, /image\/jpeg/, "JPEG branding upload must be supported.");
assert.match(adminBrandingRoute, /image\/webp/, "WebP branding upload must be supported.");
assert.doesNotMatch(adminBrandingRoute, /image\/svg\+xml/, "Founder branding upload must not accept SVG.");
assert.match(adminBrandingRoute, /2_000_000/, "Founder branding upload must retain the 2 MB cap.");
assert.match(adminBrandingRoute, /logo_removed/, "Logo removal must be audited.");
assert.match(adminBrandingRoute, /logoIsReferencedByIssuedDocument/, "Branding cleanup must inspect issued document references.");
assert.match(adminBrandingRoute, /removeLogoIfUnreferenced/, "Historical logo assets must be retained while issued documents reference them.");
assert.match(adminBrandingRoute, /preserved_for_documents/, "Branding audit history must record historical asset preservation.");

assert.match(adminPage, /Branding/, "Founder Admin must expose branding inside the selected client record.");
assert.match(adminPage, /saved logo was retained/i, "Disable must retain the saved logo.");
assert.match(adminPage, /Remove permanently deletes the saved asset/i, "Remove behaviour must be explicit.");
assert.doesNotMatch(adminPage, /href="\/admin\/branding"/, "Founder Admin must not duplicate branding as a sidebar destination.");
assert.match(legacyBrandingPage, /redirect\("\/admin"\)/, "Legacy standalone branding route must return users to the client-centred Founder Admin.");
assert.doesNotMatch(adminPage, /window\.prompt\("Agreed monthly amount/i, "Billing must not use browser prompts.");
assert.match(adminPage, /Monthly amount \(GBP\)/, "Billing terms must be editable through an in-page form.");

assert.match(appShell, /enabledFeatures\.custom_branding/, "Client logo display must be entitlement-gated.");
assert.match(appShell, /global-create-button/, "One permission-aware global Create control must be present.");
assert.match(appShell, /Search across BDB OS/, "Global search must remain a first-class workspace command.");

assert.match(overview, /Today &amp; Attention/, "Overview must centre on Today & Attention.");
assert.doesNotMatch(overview, /Recent activity/i, "Overview must not recreate the separate Activity surface.");
assert.doesNotMatch(overview, /Financial position/i, "Overview must not expose a universal financial dashboard.");
assert.doesNotMatch(overview, /orbit/i, "Overview must not restore the decorative department wheel.");

assert.match(refinement, /logo-upload-card[\s\S]*display:\s*none/i, "Client Settings must not expose self-service logo upload.");

console.log("Custom branding, immutable issued-document logo snapshots and client-centred Founder Admin contracts are present.");

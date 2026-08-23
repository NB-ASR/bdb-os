import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [route, migration, tenantTest, discoveryPage, teamRoute] = await Promise.all([
  readFile("src/app/api/discovery/route.ts", "utf8"),
  readFile("supabase/migrations/20260823120000_service_enquiry_intake.sql", "utf8"),
  readFile("supabase/tests/accounts_tenant_isolation.sql", "utf8"),
  readFile("src/app/discovery/page.tsx", "utf8"),
  readFile("src/app/api/workspace/team/route.ts", "utf8"),
]);

assert.match(route, /createAdminClient/);
assert.match(route, /admin\.rpc\("submit_sales_enquiry"/);
assert.match(route, /createHash\("sha256"\)/);
assert.doesNotMatch(route, /SUPABASE_SECRET_KEY[^\n]*NextResponse/);
assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
assert.match(migration, /grant execute[\s\S]*to service_role/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /create table if not exists public\.sales_enquiries/i);
assert.match(migration, /alter table public\.sales_enquiries enable row level security/i);
assert.match(migration, /revoke all on table public\.sales_enquiries from public, anon, authenticated/i);
assert.match(tenantTest, /set local role authenticated/i);
assert.match(tenantTest, /cannot fetch Tenant B Invoice by ID/i);
assert.match(tenantTest, /cannot fetch Tenant A Credit Note by ID/i);
assert.match(discoveryPage, /fetch\("\/api\/discovery"/);
assert.doesNotMatch(discoveryPage, /keeps enquiries on your device/i);
assert.match(teamRoute, /invitationExpiresAt\(now\)/);
assert.match(teamRoute, /activationRedirectUrl\(request\.url\)/);
assert.doesNotMatch(teamRoute, /7\s*\*\s*24\s*\*\s*60\s*\*\s*60/);

console.log("Launch readiness security and enquiry contracts are internally consistent.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, route, component, decision, adminPage, adminAuth] = await Promise.all([
  readFile("supabase/migrations/20260910120000_founder_development_tools.sql", "utf8"),
  readFile("src/app/api/admin/development-tools/route.ts", "utf8"),
  readFile("src/components/founder-development-tools.tsx", "utf8"),
  readFile("docs/decisions/2026-09-10-founder-development-tools.md", "utf8"),
  readFile("src/app/admin/page.tsx", "utf8"),
  readFile("src/lib/admin-auth.ts", "utf8"),
]);

assert.match(migration, /administrator\.role = 'founder'/, "Database authorization must require the Founder role, not generic support access.");
assert.match(migration, /founder_development_workspaces/, "Development workspaces must use an explicit database allowlist.");
assert.match(migration, /commercially active workspaces cannot/i, "Commercially active client workspaces must be rejected.");
assert.match(migration, /founder_development_snapshot/, "Every reset must create a recovery snapshot.");
assert.match(migration, /founder_development_reset_receipts/, "Reset retries must use durable idempotency receipts.");
assert.match(migration, /pg_advisory_xact_lock/, "Concurrent resets must be serialised per workspace.");
assert.match(migration, /workspace confirmation did not match/i, "The database must repeat exact workspace confirmation.");
assert.match(migration, /revoke all on function public\.founder_reset_development_workspace[\s\S]*grant execute[\s\S]*service_role/i, "Destructive reset RPCs must be service-role-only.");
assert.match(migration, /alter table public\.founder_development_snapshots enable row level security/i, "Stored recovery snapshots must have RLS enabled.");
assert.doesNotMatch(migration, /delete from public\.workspace_memberships/i, "Workspace access must remain outside resets.");
assert.doesNotMatch(migration, /delete from public\.audit_logs/i, "Audit history must remain outside resets.");
assert.doesNotMatch(migration, /delete from public\.subscriptions/i, "Billing must remain outside resets.");

assert.match(route, /requirePlatformAdmin\(\)/, "Every development-tools route must use MFA-protected Founder Admin authentication.");
assert.match(route, /identity\.role/, "The route must enforce Founder role authorization.");
assert.match(route, /signInWithPassword/, "Destructive actions must re-authenticate the signed-in Founder.");
assert.match(route, /enteredEmail[\s\S]*actualEmail/, "Re-authentication must require the exact signed-in email.");
assert.match(route, /hashJson/, "Reset request identity must be deterministic.");
assert.match(route, /founder_reset_development_workspace/, "The API must use the canonical reset command.");
assert.doesNotMatch(route, /\.from\("customers"\).*\.delete|\.from\("products"\).*\.delete|\.from\("sales"\).*\.delete/s, "The route must not bypass the canonical reset command with direct writes.");

assert.match(component, /ENABLE DEVELOPMENT/, "Workspace designation must require exact typed confirmation.");
assert.match(component, /RESET \$\{scope\.toUpperCase\(\)\} IN/, "Reset must require the workspace and scope in typed confirmation.");
assert.match(component, /Current password/, "The UI must clearly request current-password verification.");
assert.match(component, /Recovery snapshots/, "Founders must be able to find reset recovery points.");
assert.match(adminPage, /actorRole === "founder"/, "Support users must not see Founder development tools.");
assert.match(adminAuth, /claims\.aal !== "aal2"/, "Founder Admin must retain AAL2 enforcement.");

assert.match(decision, /sanitised mock/i, "The development-only data boundary must be documented.");
assert.match(decision, /never reset/i, "Protected control-plane data must be documented.");

console.log("Founder-only development reset, re-authentication, snapshot and dependency contracts passed.");

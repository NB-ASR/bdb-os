import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDevAccess,
  extractSupabaseProjectRef,
  matchesDevIdentity,
} from "../../src/lib/dev-access.ts";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "integration/vanita-workspace",
  BDB_DEV_ACCESS_ENABLED: "true",
  BDB_DEV_ACCESS_GIT_REF: "integration/vanita-workspace",
  BDB_DEV_SUPABASE_REF: "personalref123",
  NEXT_PUBLIC_SUPABASE_URL: "https://personalref123.supabase.co",
  BDB_DEV_ADMIN_EMAIL: "developer@example.com",
  BDB_DEV_WORKSPACE_EMAIL: "workspace@example.com",
};

test("extracts Supabase project references from API and database hosts", () => {
  assert.equal(extractSupabaseProjectRef("https://personalref123.supabase.co"), "personalref123");
  assert.equal(extractSupabaseProjectRef("postgresql://postgres@db.personalref123.supabase.co:5432/postgres"), "personalref123");
  assert.equal(extractSupabaseProjectRef("not-a-url"), null);
});

test("enables development access only for the approved preview branch and database", () => {
  assert.equal(evaluateDevAccess(baseEnvironment).enabled, true);
  assert.equal(evaluateDevAccess({ ...baseEnvironment, VERCEL_ENV: "production" }).enabled, false);
  assert.equal(evaluateDevAccess({ ...baseEnvironment, VERCEL_GIT_COMMIT_REF: "main" }).enabled, false);
  assert.equal(evaluateDevAccess({ ...baseEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://productionref.supabase.co" }).enabled, false);
  assert.equal(evaluateDevAccess({ ...baseEnvironment, BDB_DEV_ACCESS_ENABLED: "false" }).enabled, false);
});

test("matches only the configured seeded identity", () => {
  assert.equal(matchesDevIdentity("admin", "Developer@Example.com", baseEnvironment), true);
  assert.equal(matchesDevIdentity("workspace", "workspace@example.com", baseEnvironment), true);
  assert.equal(matchesDevIdentity("admin", "workspace@example.com", baseEnvironment), false);
});

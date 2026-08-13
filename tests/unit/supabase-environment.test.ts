import assert from "node:assert/strict";
import test from "node:test";
import { previewIsQuarantined } from "../../src/lib/supabase/environment.ts";

test("fails closed for every Vercel Preview", () => {
  assert.equal(previewIsQuarantined({
    VERCEL_ENV: "preview",
  }), true);
});

test("permits the Production environment", () => {
  assert.equal(previewIsQuarantined({
    VERCEL_ENV: "production",
  }), false);
});

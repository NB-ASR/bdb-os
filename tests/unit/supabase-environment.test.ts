import assert from "node:assert/strict";
import test from "node:test";
import {
  previewUsesProductionSupabase,
  PRODUCTION_SUPABASE_PROJECT_REF,
  supabaseProjectRef,
} from "../../src/lib/supabase/environment.ts";

const productionUrl = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

test("extracts only exact hosted Supabase project references", () => {
  assert.equal(supabaseProjectRef(productionUrl), PRODUCTION_SUPABASE_PROJECT_REF);
  assert.equal(supabaseProjectRef(`${productionUrl}.example.com`), null);
  assert.equal(supabaseProjectRef("not-a-url"), null);
});

test("fails closed when a Vercel Preview targets Production Supabase", () => {
  assert.equal(previewUsesProductionSupabase({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: productionUrl,
  }), true);
});

test("permits Production and isolated Preview environments", () => {
  assert.equal(previewUsesProductionSupabase({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: productionUrl,
  }), false);
  assert.equal(previewUsesProductionSupabase({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  isFounderBootstrapEnabled,
  matchesFounderBootstrapControl,
} from "../../src/lib/security/bootstrap.ts";

test("founder bootstrap requires exact explicit enablement", () => {
  assert.equal(isFounderBootstrapEnabled("true"), true);
  assert.equal(isFounderBootstrapEnabled("TRUE"), false);
  assert.equal(isFounderBootstrapEnabled(undefined), false);
});

test("founder bootstrap control rejects short values", () => {
  assert.equal(matchesFounderBootstrapControl("too-short", "too-short"), false);
});

test("founder bootstrap control requires an exact match", () => {
  const expected = "a".repeat(32);
  assert.equal(matchesFounderBootstrapControl(expected, expected), true);
  assert.equal(matchesFounderBootstrapControl(expected, "b".repeat(32)), false);
  assert.equal(matchesFounderBootstrapControl(expected, null), false);
});

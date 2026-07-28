import test from "node:test";
import assert from "node:assert/strict";
import {
  manualOwnerEmail,
  normaliseManualLoginId,
  validateTemporaryPassword,
} from "../../src/lib/auth/manual-provisioning";

test("normaliseManualLoginId produces a stable login identifier", () => {
  assert.equal(normaliseManualLoginId("  Giovanni Owner  "), "giovanni-owner");
  assert.equal(normaliseManualLoginId("niki.admin"), "niki.admin");
});

test("manualOwnerEmail creates a non-deliverable internal Supabase login", () => {
  assert.equal(
    manualOwnerEmail("vanita-spa", "Giovanni"),
    "giovanni.vanita-spa@manual.bdb.invalid",
  );
});

test("manualOwnerEmail rejects incomplete identifiers", () => {
  assert.throws(() => manualOwnerEmail("ab", "owner"), /INVALID_MANUAL_LOGIN/);
  assert.throws(() => manualOwnerEmail("workspace", "x"), /INVALID_MANUAL_LOGIN/);
});

test("temporary passwords require length and mixed character classes", () => {
  assert.equal(validateTemporaryPassword("Short1A"), "Temporary password must contain at least 12 characters.");
  assert.equal(
    validateTemporaryPassword("alllowercase123"),
    "Temporary password must include uppercase, lowercase and numeric characters.",
  );
  assert.equal(validateTemporaryPassword("StrongPassword12"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INVITATION_TTL_SECONDS,
  MAX_INVITATION_TTL_SECONDS,
  activationRedirectUrl,
  invitationExpiresAt,
  invitationTtlSeconds,
  publicAppOrigin,
} from "../../src/lib/auth/invitations.ts";

test("invitation lifetime defaults to one hour", () => {
  assert.equal(invitationTtlSeconds(undefined), DEFAULT_INVITATION_TTL_SECONDS);
  assert.equal(DEFAULT_INVITATION_TTL_SECONDS, 3_600);
});

test("invitation lifetime cannot exceed one hour", () => {
  assert.equal(invitationTtlSeconds("604800"), MAX_INVITATION_TTL_SECONDS);
  assert.equal(MAX_INVITATION_TTL_SECONDS, 3_600);
});

test("invitation lifetime cannot be shorter than five minutes", () => {
  assert.equal(invitationTtlSeconds("1"), 300);
});

test("invitation expiry is deterministic", () => {
  const now = new Date("2026-07-18T10:00:00.000Z");
  assert.equal(invitationExpiresAt(now, 3600), "2026-07-18T11:00:00.000Z");
});

test("public origin strips no path and produces activation callback", () => {
  assert.equal(
    publicAppOrigin("https://fallback.example/request", "https://bdb.example"),
    "https://bdb.example",
  );
  assert.equal(
    activationRedirectUrl("https://bdb.example/admin"),
    "https://bdb.example/auth/callback?next=/activate",
  );
});

test("public origin rejects credentials and path configuration", () => {
  assert.throws(
    () => publicAppOrigin("https://fallback.example/request", "https://user:pass@bdb.example"),
    /INVALID_PUBLIC_APP_URL/,
  );
  assert.throws(
    () => publicAppOrigin("https://fallback.example/request", "https://bdb.example/workspace"),
    /INVALID_PUBLIC_APP_URL/,
  );
});

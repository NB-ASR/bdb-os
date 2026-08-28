import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanBusinessSlug,
  classifyFounderAdminError,
  firstAvailableSlug,
  invitationCooldownSeconds,
  invitationDeliveryState,
  slugCandidate,
} from "../../src/lib/founder-admin.ts";

test("business slugs are generated from names and duplicate names receive a deterministic suffix", () => {
  assert.equal(cleanBusinessSlug("  Acme & Sons Ltd.  "), "acme-sons-ltd");
  assert.equal(slugCandidate("acme-sons-ltd", 2), "acme-sons-ltd-2");
  assert.equal(firstAvailableSlug("testing", ["testing", "testing-2"]), "testing-3");
  assert.equal(firstAvailableSlug("new-business", ["another-business"]), "new-business");
});

test("long slug alternatives remain within the database address limit", () => {
  const candidate = slugCandidate("a".repeat(90), 24);
  assert.equal(candidate.length, 63);
  assert.match(candidate, /-24$/);
});

test("invitation state distinguishes sent, pending, expired, failed, active and suspended", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  assert.equal(invitationDeliveryState({ membershipStatus: "active", now }), "active");
  assert.equal(invitationDeliveryState({ membershipStatus: "suspended", now }), "suspended");
  assert.equal(invitationDeliveryState({ membershipStatus: "invited", deliveryStatus: "pending", now }), "pending");
  assert.equal(invitationDeliveryState({ membershipStatus: "invited", deliveryStatus: "failed", now }), "failed");
  assert.equal(invitationDeliveryState({ membershipStatus: "invited", deliveryStatus: "sent", expiresAt: "2026-08-28T11:59:59.000Z", now }), "expired");
  assert.equal(invitationDeliveryState({ membershipStatus: "invited", deliveryStatus: "sent", expiresAt: "2026-08-28T13:00:00.000Z", now }), "sent");
});

test("resend cooldown blocks rapid repeat clicks and then clears", () => {
  const now = new Date("2026-08-28T12:00:30.000Z");
  assert.equal(invitationCooldownSeconds("2026-08-28T12:00:00.000Z", now), 30);
  assert.equal(invitationCooldownSeconds("2026-08-28T11:59:00.000Z", now), 0);
  assert.equal(invitationCooldownSeconds(null, now), 0);
});

test("Supabase email rate limiting is translated to a recoverable product 429", () => {
  assert.deepEqual(classifyFounderAdminError({
    status: 429,
    code: "over_email_send_rate_limit",
    message: "email rate limit exceeded",
  }), {
    code: "EMAIL_RATE_LIMIT",
    status: 429,
    message: "Email sending limit reached. The invitation was not sent. Try again shortly.",
  });
});

test("workspace slug uniqueness violations are translated without database detail", () => {
  assert.deepEqual(classifyFounderAdminError({
    code: "23505",
    message: "duplicate key value violates unique constraint workspaces_slug_key",
    details: "Key (slug)=(testing) already exists.",
  }), {
    code: "DUPLICATE_WORKSPACE_SLUG",
    status: 409,
    message: "That workspace address is already in use.",
  });
});

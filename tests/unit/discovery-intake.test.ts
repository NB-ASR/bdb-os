import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscoveryEnquiry } from "../../src/lib/discovery.ts";

const validEnquiry = {
  name: "Jane Smith",
  businessName: "Example Company",
  email: "JANE@EXAMPLE.COM",
  startingPlan: "growth",
  sector: "general",
  challenge: "We need to remove repeated admin from our customer follow-up process.",
  teamSize: "2-5",
  preferredTerm: "open",
  website: "",
};

test("discovery intake normalises a valid enquiry", () => {
  const parsed = parseDiscoveryEnquiry(validEnquiry);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.email, "jane@example.com");
});

test("discovery intake rejects invalid enum values", () => {
  const parsed = parseDiscoveryEnquiry({ ...validEnquiry, startingPlan: "enterprise" });
  assert.deepEqual(parsed, { ok: false, error: "Please choose the kind of help you need." });
});

test("discovery intake rejects short challenges", () => {
  const parsed = parseDiscoveryEnquiry({ ...validEnquiry, challenge: "Help us." });
  assert.deepEqual(parsed, { ok: false, error: "Please tell us a little more about the outcome you need." });
});


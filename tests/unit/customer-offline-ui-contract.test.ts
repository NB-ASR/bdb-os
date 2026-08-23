import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerPage = await readFile("src/app/customers/page.tsx", "utf8");

test("offline and ambiguous Customer saves close as pending without issuing a second command", () => {
  assert.match(
    customerPage,
    /if \(!navigator\.onLine\)[\s\S]*return \{ ok: true, pending: true \}/,
    "An offline Customer save must be treated as a durable pending save rather than a failed form submission.",
  );
  assert.match(
    customerPage,
    /failCustomerCommand\([\s\S]*"ambiguous"\)[\s\S]*return \{ ok: true, pending: true, code \}/,
    "A lost or ambiguous response must leave the original queued command in control of the form outcome.",
  );
});

test("new Customer navigation happens only after acknowledged server success", () => {
  assert.match(
    customerPage,
    /isNewCustomer && mode === "cloud" && navigator\.onLine && !result\.pending/,
    "A pending Customer create must not navigate to an unconfirmed server profile.",
  );
});

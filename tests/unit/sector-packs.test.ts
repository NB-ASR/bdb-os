import test from "node:test";
import assert from "node:assert/strict";
import {
  generalBusinessBlueprint,
  normaliseWorkspaceBlueprint,
  resolveWorkspaceBlueprint,
} from "../../src/lib/sector-packs.ts";

test("client overrides change vocabulary without mutating the template", () => {
  const template = structuredClone(generalBusinessBlueprint);
  const resolved = resolveWorkspaceBlueprint(template, {
    labels: { customerSingular: "Patient", customerPlural: "Patients" },
  });

  assert.equal(resolved.labels.customerSingular, "Patient");
  assert.equal(resolved.labels.customerPlural, "Patients");
  assert.equal(template.labels.customerSingular, "Customer");
});

test("malformed navigation falls back to the complete general workspace", () => {
  const resolved = normaliseWorkspaceBlueprint({
    navigation: { enabled: ["unknown-module"] },
  });

  assert.deepEqual(resolved.navigation.enabled, generalBusinessBlueprint.navigation.enabled);
});

test("emphasis cannot include a hidden department", () => {
  const resolved = resolveWorkspaceBlueprint(generalBusinessBlueprint, {
    navigation: {
      enabled: ["overview", "customers"],
      emphasis: ["customers", "banking"],
    },
  });

  assert.deepEqual(resolved.navigation.enabled, ["overview", "customers"]);
  assert.deepEqual(resolved.navigation.emphasis, ["customers"]);
});

test("unknown workflow and compliance values are discarded", () => {
  const resolved = normaliseWorkspaceBlueprint({
    workflows: ["appointment-reminders", "invent-tax-advice"],
    compliance: ["document-retention", "guarantee-compliance"],
  });

  assert.deepEqual(resolved.workflows, ["appointment-reminders"]);
  assert.deepEqual(resolved.compliance, ["document-retention"]);
});

test("nested navigation labels merge without replacing other vocabulary", () => {
  const resolved = resolveWorkspaceBlueprint(generalBusinessBlueprint, {
    labels: { navigation: { customers: "Patients" } },
  });

  assert.equal(resolved.labels.navigation.customers, "Patients");
  assert.equal(resolved.labels.invoicePlural, "Invoices");
  assert.equal(resolved.labels.appointmentPlural, "Appointments");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildUsageMetrics, formatUsageValue, usageMetricStatus } from "../../src/lib/usage-metering.ts";

test("usage status remains unconfigured until a package allowance exists", () => {
  assert.equal(usageMetricStatus(42, null), "unconfigured");
});

test("usage thresholds distinguish normal, approaching and exceeded usage", () => {
  assert.equal(usageMetricStatus(79, 100, 80), "within");
  assert.equal(usageMetricStatus(80, 100, 80), "approaching");
  assert.equal(usageMetricStatus(100, 100, 80), "approaching");
  assert.equal(usageMetricStatus(101, 100, 80), "exceeded");
});

test("zero allowance behaves safely", () => {
  assert.equal(usageMetricStatus(0, 0), "within");
  assert.equal(usageMetricStatus(1, 0), "exceeded");
});

test("metric builder keeps every V1 meter and never creates negative remaining usage", () => {
  const metrics = buildUsageMetrics(
    {
      storage_bytes: 1_500_000,
      active_users: 3,
      automation_executions: 1200,
      outbound_emails: 300,
      sms_segments: 0,
    },
    {
      storage_bytes: { unit: "bytes", included_quantity: 2_000_000, warning_threshold_percent: 80 },
      active_users: { unit: "users", included_quantity: 5, warning_threshold_percent: 80 },
      automation_executions: { unit: "executions", included_quantity: 1000, warning_threshold_percent: 80 },
      outbound_emails: { unit: "messages", included_quantity: null, warning_threshold_percent: 80 },
      sms_segments: { unit: "segments", included_quantity: 500, warning_threshold_percent: 80 },
    },
  );

  assert.deepEqual(metrics.map((metric) => metric.key), [
    "storage_bytes",
    "active_users",
    "automation_executions",
    "outbound_emails",
    "sms_segments",
  ]);
  assert.equal(metrics.find((metric) => metric.key === "automation_executions")?.status, "exceeded");
  assert.equal(metrics.find((metric) => metric.key === "automation_executions")?.remaining, 0);
  assert.equal(metrics.find((metric) => metric.key === "outbound_emails")?.status, "unconfigured");
});

test("storage values are formatted for business users", () => {
  assert.equal(formatUsageValue(0, "bytes"), "0 B");
  assert.equal(formatUsageValue(1_500_000, "bytes"), "1.5 MB");
  assert.equal(formatUsageValue(2_000_000_000, "bytes"), "2.0 GB");
});

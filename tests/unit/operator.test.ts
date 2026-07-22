import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOperatorPreviewSnapshot,
  operatorSourceForAction,
  summariseOperatorPerformance,
  workflowForSoloAction,
  type OperatorControlSnapshot,
} from "../../src/lib/operator.ts";
import type { SoloOperatorAction } from "../../src/lib/solo-operator.ts";

function action(kind: SoloOperatorAction["kind"], id: string): SoloOperatorAction {
  return {
    id: `${kind}-${id}`,
    kind,
    priority: "today",
    autonomy: "approval",
    title: `Review ${kind}`,
    detail: `Verified ${kind} context`,
    recordLabel: id,
    destination: kind === "booking" ? "calendar" : kind === "invoice" ? "money" : "inbox",
  };
}

test("source records map to the narrow published operator workflow", () => {
  assert.equal(workflowForSoloAction(action("booking", "b1")), "appointment-reminders");
  assert.equal(workflowForSoloAction(action("invoice", "i1")), "overdue-invoice-follow-up");
  assert.equal(workflowForSoloAction(action("message", "m1")), "new-enquiry-triage");
  assert.equal(operatorSourceForAction(action("booking", "b1")), "booking");
  assert.equal(operatorSourceForAction(action("invoice", "i1")), "invoice");
  assert.equal(operatorSourceForAction(action("message", "m1")), "message");
});

test("simulation is reported separately and never inflates verified value", () => {
  const snapshot = buildOperatorPreviewSnapshot([
    action("invoice", "i1"),
    action("booking", "b1"),
    action("message", "m1"),
  ], "GBP", new Date("2026-07-22T09:00:00.000Z"));
  const performance = summariseOperatorPerformance(snapshot);

  assert.equal(performance.verifiedMinutesSaved, 0);
  assert.equal(performance.verifiedCashProtected, 0);
  assert.equal(performance.simulatedMinutesSaved, 6);
  assert.equal(performance.completedRuns, 0);
  assert.equal(performance.reliabilityPercent, null);
  assert.equal(performance.pendingApprovals, 1);
});

test("reliability uses only real terminal outcomes", () => {
  const snapshot: OperatorControlSnapshot = {
    policies: [],
    approvals: [{ id: "a1", runId: "r4", status: "pending", requestedAt: "2026-07-22T09:00:00Z" }],
    exceptions: [{ id: "e1", runId: "r3", code: "PROVIDER", title: "Provider unavailable", detail: "Timed out", severity: "warning", status: "open", createdAt: "2026-07-22T09:00:00Z" }],
    runs: [
      { id: "r1", workflowKey: "appointment-reminders", sourceType: "booking", sourceId: "b1", status: "succeeded", autonomyMode: "bounded", providerMode: "webhook", riskLevel: "low", plannedAction: {}, evidence: {}, estimatedMinutesSaved: 6, attempts: 1, maxAttempts: 3, revision: 1, scheduledAt: "2026-07-22T09:00:00Z", createdAt: "2026-07-22T09:00:00Z", completedAt: "2026-07-22T09:01:00Z" },
      { id: "r2", workflowKey: "new-enquiry-triage", sourceType: "message", sourceId: "m1", status: "failed", autonomyMode: "approval", providerMode: "webhook", riskLevel: "medium", plannedAction: {}, evidence: {}, estimatedMinutesSaved: 10, attempts: 3, maxAttempts: 3, revision: 1, scheduledAt: "2026-07-22T09:00:00Z", createdAt: "2026-07-22T09:00:00Z", completedAt: "2026-07-22T09:05:00Z" },
      { id: "r3", workflowKey: "overdue-invoice-follow-up", sourceType: "invoice", sourceId: "i1", status: "exception", autonomyMode: "approval", providerMode: "unconfigured", riskLevel: "high", plannedAction: {}, evidence: {}, estimatedMinutesSaved: 12, attempts: 1, maxAttempts: 3, revision: 1, scheduledAt: "2026-07-22T09:00:00Z", createdAt: "2026-07-22T09:00:00Z", completedAt: "2026-07-22T09:02:00Z" },
      { id: "r4", workflowKey: "new-enquiry-triage", sourceType: "message", sourceId: "m2", status: "simulated", autonomyMode: "bounded", providerMode: "mock", riskLevel: "medium", plannedAction: {}, evidence: { simulated: true }, estimatedMinutesSaved: 10, attempts: 1, maxAttempts: 3, revision: 1, scheduledAt: "2026-07-22T09:00:00Z", createdAt: "2026-07-22T09:00:00Z", completedAt: "2026-07-22T09:01:00Z" },
    ],
    valueEvents: [
      { id: "v1", runId: "r1", category: "time_returned", minutesSaved: 6, cashProtected: 0, currency: "GBP", verified: true, evidenceSource: "provider", recordedAt: "2026-07-22T09:01:00Z" },
      { id: "v2", runId: "r4", category: "time_returned", minutesSaved: 10, cashProtected: 0, currency: "GBP", verified: false, evidenceSource: "simulation", recordedAt: "2026-07-22T09:01:00Z" },
    ],
  };

  const performance = summariseOperatorPerformance(snapshot);
  assert.equal(performance.completedRuns, 3);
  assert.equal(performance.successfulRuns, 1);
  assert.equal(performance.reliabilityPercent, 33);
  assert.equal(performance.verifiedMinutesSaved, 6);
  assert.equal(performance.simulatedMinutesSaved, 10);
  assert.equal(performance.openExceptions, 1);
});

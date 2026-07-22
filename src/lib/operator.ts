import type { SectorWorkflowKey } from "./sector-packs";
import type { SoloOperatorAction } from "./solo-operator";

export type OperatorAutonomyMode = "assist" | "approval" | "bounded";
export type OperatorProviderMode = "unconfigured" | "mock" | "webhook" | "internal";
export type OperatorRunStatus =
  | "prepared"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "simulated"
  | "exception"
  | "failed"
  | "cancelled";

export interface OperatorPolicy {
  id: string;
  workflowKey: SectorWorkflowKey;
  enabled: boolean;
  autonomyMode: OperatorAutonomyMode;
  providerMode: OperatorProviderMode;
  config: Record<string, unknown>;
  blueprintKey: string;
  blueprintVersion: number;
  updatedAt: string;
}

export interface OperatorRun {
  id: string;
  workflowKey: SectorWorkflowKey;
  sourceType: "booking" | "invoice" | "message" | "document" | "customer" | "manual";
  sourceId: string;
  status: OperatorRunStatus;
  autonomyMode: OperatorAutonomyMode;
  providerMode: OperatorProviderMode;
  riskLevel: "low" | "medium" | "high";
  plannedAction: {
    title?: string;
    detail?: string;
    recordLabel?: string;
    cashProtected?: number;
    [key: string]: unknown;
  };
  evidence: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  estimatedMinutesSaved: number;
  attempts: number;
  maxAttempts: number;
  revision: number;
  scheduledAt: string;
  createdAt: string;
  completedAt?: string;
}

export interface OperatorApproval {
  id: string;
  runId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface OperatorException {
  id: string;
  runId: string;
  code: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
}

export interface OperatorValueEvent {
  id: string;
  runId: string;
  category: "time_returned" | "cash_protected" | "booking_protected" | "record_completed";
  minutesSaved: number;
  cashProtected: number;
  currency: "GBP" | "EUR" | "USD";
  verified: boolean;
  evidenceSource: "provider" | "internal_record" | "human_confirmed" | "simulation";
  recordedAt: string;
}

export interface OperatorControlSnapshot {
  policies: OperatorPolicy[];
  runs: OperatorRun[];
  approvals: OperatorApproval[];
  exceptions: OperatorException[];
  valueEvents: OperatorValueEvent[];
}

export interface OperatorPerformance {
  verifiedMinutesSaved: number;
  simulatedMinutesSaved: number;
  verifiedCashProtected: number;
  completedRuns: number;
  successfulRuns: number;
  reliabilityPercent: number | null;
  pendingApprovals: number;
  openExceptions: number;
}

export const operatorWorkflowCatalog: Record<SectorWorkflowKey, {
  title: string;
  description: string;
  defaultMinutes: number;
}> = {
  "appointment-reminders": {
    title: "Appointment reminders",
    description: "Check the live booking, customer preference and exact time before preparing delivery.",
    defaultMinutes: 6,
  },
  "missed-appointment-follow-up": {
    title: "Missed appointment follow-up",
    description: "Prepare a proportionate rebooking follow-up after the attendance record is confirmed.",
    defaultMinutes: 8,
  },
  "new-enquiry-triage": {
    title: "New enquiry triage",
    description: "Connect the customer context, classify the enquiry and prepare the next response.",
    defaultMinutes: 10,
  },
  "overdue-invoice-follow-up": {
    title: "Overdue invoice follow-up",
    description: "Verify the payment state and history before preparing a proportionate reminder.",
    defaultMinutes: 12,
  },
  "document-request-follow-up": {
    title: "Document request follow-up",
    description: "Identify missing records and prepare a precise request without inventing document status.",
    defaultMinutes: 8,
  },
  "client-onboarding": {
    title: "Client onboarding",
    description: "Coordinate the published onboarding checklist and return missing or sensitive steps.",
    defaultMinutes: 18,
  },
  "matter-deadline-review": {
    title: "Matter deadline review",
    description: "Surface verified dates and incomplete records for professional review.",
    defaultMinutes: 12,
  },
  "recurring-compliance-check": {
    title: "Recurring compliance check",
    description: "Prepare a dated checklist from verified records; professional judgement stays human-owned.",
    defaultMinutes: 15,
  },
};

export function workflowForSoloAction(action: SoloOperatorAction): SectorWorkflowKey {
  if (action.kind === "booking") return "appointment-reminders";
  if (action.kind === "invoice") return "overdue-invoice-follow-up";
  return "new-enquiry-triage";
}

export function operatorSourceForAction(action: SoloOperatorAction): OperatorRun["sourceType"] {
  if (action.kind === "booking") return "booking";
  if (action.kind === "invoice") return "invoice";
  return "message";
}

export function summariseOperatorPerformance(snapshot: OperatorControlSnapshot): OperatorPerformance {
  const verifiedEvents = snapshot.valueEvents.filter((event) => event.verified);
  const simulatedEvents = snapshot.valueEvents.filter((event) => !event.verified && event.evidenceSource === "simulation");
  const terminalRuns = snapshot.runs.filter((run) => ["succeeded", "failed", "exception"].includes(run.status));
  const successfulRuns = terminalRuns.filter((run) => run.status === "succeeded").length;

  return {
    verifiedMinutesSaved: verifiedEvents.reduce((total, event) => total + event.minutesSaved, 0),
    simulatedMinutesSaved: simulatedEvents.reduce((total, event) => total + event.minutesSaved, 0),
    verifiedCashProtected: verifiedEvents.reduce((total, event) => total + event.cashProtected, 0),
    completedRuns: terminalRuns.length,
    successfulRuns,
    reliabilityPercent: terminalRuns.length ? Math.round((successfulRuns / terminalRuns.length) * 100) : null,
    pendingApprovals: snapshot.approvals.filter((approval) => approval.status === "pending").length,
    openExceptions: snapshot.exceptions.filter((exception) => exception.status === "open").length,
  };
}

export function buildOperatorPreviewSnapshot(
  actions: SoloOperatorAction[],
  currency: "GBP" | "EUR" | "USD",
  now = new Date(),
): OperatorControlSnapshot {
  const policies: OperatorPolicy[] = [
    ["appointment-reminders", "bounded", "mock"],
    ["new-enquiry-triage", "approval", "mock"],
    ["overdue-invoice-follow-up", "approval", "mock"],
    ["document-request-follow-up", "assist", "mock"],
  ].map(([workflowKey, autonomyMode, providerMode], index) => ({
    id: `preview-policy-${index}`,
    workflowKey: workflowKey as SectorWorkflowKey,
    enabled: true,
    autonomyMode: autonomyMode as OperatorAutonomyMode,
    providerMode: providerMode as OperatorProviderMode,
    config: {},
    blueprintKey: "wellness-studio",
    blueprintVersion: 1,
    updatedAt: now.toISOString(),
  }));

  const runs: OperatorRun[] = actions.slice(0, 3).map((action, index) => ({
    id: `preview-run-${index}`,
    workflowKey: workflowForSoloAction(action),
    sourceType: operatorSourceForAction(action),
    sourceId: action.id.replace(/^[^-]+-/, ""),
    status: index === 0 ? "awaiting_approval" : index === 1 ? "simulated" : "prepared",
    autonomyMode: index === 1 ? "bounded" : index === 0 ? "approval" : "assist",
    providerMode: "mock",
    riskLevel: action.kind === "invoice" ? "high" : action.kind === "message" ? "medium" : "low",
    plannedAction: { title: action.title, detail: action.detail, recordLabel: action.recordLabel },
    evidence: index === 1 ? { simulated: true, providerReference: "BDB-DEMO-2048" } : {},
    estimatedMinutesSaved: operatorWorkflowCatalog[workflowForSoloAction(action)].defaultMinutes,
    attempts: index === 1 ? 1 : 0,
    maxAttempts: 3,
    revision: 1,
    scheduledAt: now.toISOString(),
    createdAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
    completedAt: index === 1 ? now.toISOString() : undefined,
  }));

  const approvals: OperatorApproval[] = runs
    .filter((run) => run.status === "awaiting_approval")
    .map((run) => ({
      id: `preview-approval-${run.id}`,
      runId: run.id,
      status: "pending",
      requestedAt: run.createdAt,
    }));

  const simulatedRun = runs.find((run) => run.status === "simulated");
  const valueEvents: OperatorValueEvent[] = simulatedRun ? [{
    id: "preview-value-1",
    runId: simulatedRun.id,
    category: "time_returned",
    minutesSaved: simulatedRun.estimatedMinutesSaved,
    cashProtected: 0,
    currency,
    verified: false,
    evidenceSource: "simulation",
    recordedAt: now.toISOString(),
  }] : [];

  return { policies, runs, approvals, exceptions: [], valueEvents };
}

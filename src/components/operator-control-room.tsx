"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import {
  buildOperatorPreviewSnapshot,
  operatorSourceForAction,
  operatorWorkflowCatalog,
  summariseOperatorPerformance,
  workflowForSoloAction,
  type OperatorAutonomyMode,
  type OperatorControlSnapshot,
  type OperatorPolicy,
  type OperatorProviderMode,
  type OperatorRun,
} from "@/lib/operator";
import type { WorkspaceBlueprint } from "@/lib/sector-packs";
import type { SoloOperatorAction } from "@/lib/solo-operator";
import styles from "@/app/solo-operator/solo-operator.module.css";

const EMPTY_SNAPSHOT: OperatorControlSnapshot = {
  policies: [],
  runs: [],
  approvals: [],
  exceptions: [],
  valueEvents: [],
};

type ApiEnvelope<T> = { ok: boolean; result?: T; error?: string; code?: string };

function sourceId(action: SoloOperatorAction) {
  return action.id.replace(/^(invoice|message|booking)-/, "");
}

function statusLabel(status: OperatorRun["status"]) {
  return status.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function isTerminal(status: OperatorRun["status"]) {
  return ["succeeded", "simulated", "exception", "failed", "cancelled"].includes(status);
}

async function loadOperatorSnapshot(workspaceId: string) {
  const response = await fetch(`/api/operator?workspaceId=${encodeURIComponent(workspaceId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json() as ApiEnvelope<OperatorControlSnapshot>;
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.error || "Operator data could not be loaded.");
  }
  return body.result;
}

export function OperatorControlRoom({
  preview,
  workspaceId,
  actions,
  currency,
  blueprint,
}: {
  preview: boolean;
  workspaceId: string | null;
  actions: SoloOperatorAction[];
  currency: "GBP" | "EUR" | "USD";
  blueprint: WorkspaceBlueprint;
}) {
  const previewSnapshot = useMemo(
    () => buildOperatorPreviewSnapshot(actions, currency),
    [actions, currency],
  );
  const [snapshot, setSnapshot] = useState<OperatorControlSnapshot>(preview ? previewSnapshot : EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(!preview);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (preview) {
      setSnapshot((current) => current.runs.length ? current : previewSnapshot);
      return;
    }
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadOperatorSnapshot(workspaceId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operator data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [preview, previewSnapshot, workspaceId]);

  useEffect(() => {
    if (preview || !workspaceId) return;
    let active = true;
    void loadOperatorSnapshot(workspaceId)
      .then((result) => { if (active) setSnapshot(result); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Operator data could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [preview, workspaceId]);

  const post = useCallback(async (body: Record<string, unknown>, idempotencyKey?: string) => {
    if (!workspaceId) throw new Error("The cloud workspace is unavailable.");
    const response = await fetch("/api/operator", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ ...body, workspaceId }),
    });
    const result = await response.json() as ApiEnvelope<unknown>;
    if (!response.ok || !result.ok) throw new Error(result.error || "The Operator command failed.");
    return result.result;
  }, [workspaceId]);

  const updatePolicy = async (
    policy: OperatorPolicy,
    update: Partial<Pick<OperatorPolicy, "autonomyMode" | "providerMode" | "enabled">>,
  ) => {
    const next = { ...policy, ...update };
    if (next.providerMode === "internal" && next.autonomyMode !== "assist") {
      next.providerMode = "unconfigured";
    }
    setBusyId(`policy-${policy.id}`);
    setError(null);
    try {
      if (preview) {
        setSnapshot((current) => ({
          ...current,
          policies: current.policies.map((item) => item.id === policy.id ? next : item),
        }));
      } else {
        await post({
          action: "save_policy",
          workflowKey: next.workflowKey,
          enabled: next.enabled,
          autonomyMode: next.autonomyMode,
          providerMode: next.providerMode,
          config: next.config,
        });
        await refresh();
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The workflow policy could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const planAction = async (action: SoloOperatorAction) => {
    const workflowKey = workflowForSoloAction(action);
    const policy = snapshot.policies.find((item) => item.workflowKey === workflowKey);
    setBusyId(`action-${action.id}`);
    setError(null);
    try {
      if (preview) {
        if (!policy?.enabled) throw new Error("This workflow is paused.");
        const createdAt = new Date().toISOString();
        const run: OperatorRun = {
          id: `preview-${crypto.randomUUID()}`,
          workflowKey,
          sourceType: operatorSourceForAction(action),
          sourceId: sourceId(action),
          status: policy.autonomyMode === "assist" ? "prepared" : policy.autonomyMode === "approval" ? "awaiting_approval" : "simulated",
          autonomyMode: policy.autonomyMode,
          providerMode: policy.providerMode,
          riskLevel: action.kind === "invoice" ? "high" : action.kind === "message" ? "medium" : "low",
          plannedAction: { title: action.title, detail: action.detail, recordLabel: action.recordLabel },
          evidence: policy.autonomyMode === "bounded" ? { simulated: true } : {},
          estimatedMinutesSaved: operatorWorkflowCatalog[workflowKey].defaultMinutes,
          attempts: policy.autonomyMode === "bounded" ? 1 : 0,
          maxAttempts: 3,
          revision: 1,
          scheduledAt: createdAt,
          createdAt,
          completedAt: policy.autonomyMode === "bounded" ? createdAt : undefined,
        };
        setSnapshot((current) => ({
          ...current,
          runs: [run, ...current.runs],
          approvals: run.status === "awaiting_approval" ? [{
            id: `preview-approval-${run.id}`,
            runId: run.id,
            status: "pending",
            requestedAt: createdAt,
          }, ...current.approvals] : current.approvals,
          valueEvents: run.status === "simulated" ? [{
            id: `preview-value-${run.id}`,
            runId: run.id,
            category: "time_returned",
            minutesSaved: run.estimatedMinutesSaved,
            cashProtected: 0,
            currency,
            verified: false,
            evidenceSource: "simulation",
            recordedAt: createdAt,
          }, ...current.valueEvents] : current.valueEvents,
        }));
      } else {
        const dateBucket = new Date().toISOString().slice(0, 10);
        await post({
          action: "plan",
          workflowKey,
          sourceType: operatorSourceForAction(action),
          sourceId: sourceId(action),
        }, `operator:${workflowKey}:${sourceId(action)}:${dateBucket}`);
        await refresh();
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The workflow could not be prepared.");
    } finally {
      setBusyId(null);
    }
  };

  const decideRun = async (run: OperatorRun, decision: "approved" | "rejected") => {
    setBusyId(`run-${run.id}`);
    setError(null);
    try {
      if (preview) {
        const completedAt = new Date().toISOString();
        const nextStatus = decision === "rejected" ? "cancelled" : run.providerMode === "mock" ? "simulated" : "queued";
        setSnapshot((current) => ({
          ...current,
          runs: current.runs.map((item) => item.id === run.id ? { ...item, status: nextStatus, revision: item.revision + 1, completedAt: isTerminal(nextStatus) ? completedAt : undefined } : item),
          approvals: current.approvals.map((approval) => approval.runId === run.id ? { ...approval, status: decision, decidedAt: completedAt } : approval),
          valueEvents: nextStatus === "simulated" ? [{
            id: `preview-value-${run.id}`,
            runId: run.id,
            category: "time_returned",
            minutesSaved: run.estimatedMinutesSaved,
            cashProtected: 0,
            currency,
            verified: false,
            evidenceSource: "simulation",
            recordedAt: completedAt,
          }, ...current.valueEvents] : current.valueEvents,
        }));
      } else {
        await post({ action: "decision", runId: run.id, revision: run.revision, decision });
        await refresh();
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The approval decision could not be recorded.");
    } finally {
      setBusyId(null);
    }
  };

  const completeManual = async (run: OperatorRun) => {
    setBusyId(`run-${run.id}`);
    setError(null);
    try {
      if (preview) {
        const completedAt = new Date().toISOString();
        setSnapshot((current) => ({
          ...current,
          runs: current.runs.map((item) => item.id === run.id ? { ...item, status: "succeeded", providerMode: "internal", revision: item.revision + 1, completedAt } : item),
          valueEvents: [{
            id: `preview-value-${run.id}`,
            runId: run.id,
            category: "record_completed",
            minutesSaved: 0,
            cashProtected: 0,
            currency,
            verified: true,
            evidenceSource: "human_confirmed",
            recordedAt: completedAt,
          }, ...current.valueEvents],
        }));
      } else {
        await post({ action: "complete_manual", runId: run.id, revision: run.revision });
        await refresh();
      }
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The completion could not be recorded.");
    } finally {
      setBusyId(null);
    }
  };

  const performance = summariseOperatorPerformance(snapshot);
  const plannedSourceIds = new Set(snapshot.runs.filter((run) => !isTerminal(run.status)).map((run) => `${run.sourceType}:${run.sourceId}`));
  const availableActions = actions.filter((action) => !plannedSourceIds.has(`${operatorSourceForAction(action)}:${sourceId(action)}`));
  const activeRuns = snapshot.runs.filter((run) => !["cancelled"].includes(run.status)).slice(0, 12);
  const publishedPolicies = snapshot.policies.filter((policy) => blueprint.workflows.includes(policy.workflowKey));

  if (loading) {
    return <div className={styles.operatorLoading}><Loader2 size={20} /> Loading the governed Operator ledger…</div>;
  }

  return (
    <div className={styles.operatorControl}>
      {error ? <div className={styles.errorBanner} role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><XCircle size={17} /></button></div> : null}

      <div className={styles.operatorSectionHeader}>
        <div><p className={styles.eyebrow}>Governed execution</p><h2>Operator control room</h2><p>Prepare, approve, deliver and evidence routine work without hiding failures or inflating the value case.</p></div>
        <span className={styles.miniBadge}>{preview ? "Simulation only" : "Live evidence ledger"}</span>
      </div>

      <section className={styles.metrics} aria-label="Operator value evidence">
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><Clock3 size={18} /></span>
          <strong className={styles.metricValue}>{(performance.verifiedMinutesSaved / 60).toFixed(1)}h</strong>
          <span className={styles.metricLabel}>Verified time returned</span>
          <small className={styles.metricDetail}>{performance.simulatedMinutesSaved} simulated minutes excluded</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><CircleDollarSign size={18} /></span>
          <strong className={styles.metricValue}>{formatMoney(performance.verifiedCashProtected, currency)}</strong>
          <span className={styles.metricLabel}>Verified cash protected</span>
          <small className={styles.metricDetail}>Evidence-backed outcomes only</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><CheckCircle2 size={18} /></span>
          <strong className={styles.metricValue}>{performance.reliabilityPercent == null ? "—" : `${performance.reliabilityPercent}%`}</strong>
          <span className={styles.metricLabel}>Workflow reliability</span>
          <small className={styles.metricDetail}>{performance.successfulRuns} of {performance.completedRuns} verified terminal runs</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><ShieldCheck size={18} /></span>
          <strong className={styles.metricValue}>{performance.pendingApprovals + performance.openExceptions}</strong>
          <span className={styles.metricLabel}>Needs a human</span>
          <small className={styles.metricDetail}>{performance.pendingApprovals} approvals · {performance.openExceptions} exceptions</small>
        </article>
      </section>

      <div className={styles.policyNotice}>
        <ShieldCheck size={21} />
        <div>
          <strong>{preview ? "Evidence-safe product simulation" : "Verified work is kept separate from simulation"}</strong>
          <p>{preview ? "This preview lets you exercise the complete approval and execution model. Demo outcomes are marked simulated and never inflate the sellable value case." : "Every run keeps its source record, policy, approval, attempts, provider evidence and final outcome. Failed or unconfigured work becomes an exception instead of quietly disappearing."}</p>
        </div>
      </div>

      <section className={styles.gridTwo}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><h2>Work ready to prepare</h2><p>Live records that match a published Sector Pack workflow.</p></div>
            <span className={styles.miniBadge}>{availableActions.length} available</span>
          </header>
          {availableActions.length ? <div className={styles.actionList}>{availableActions.slice(0, 8).map((action) => {
            const workflow = workflowForSoloAction(action);
            const policy = snapshot.policies.find((item) => item.workflowKey === workflow);
            return <div className={styles.actionCard} data-priority={action.priority} key={action.id}>
              <span className={styles.actionMarker} />
              <div className={styles.actionCopy}>
                <div className={styles.actionTitleRow}><strong>{action.title}</strong><span className={styles.autonomyBadge}>{policy?.enabled ? policy.autonomyMode : "paused"}</span></div>
                <p>{action.detail}</p>
                <span className={styles.recordBadge}>{operatorWorkflowCatalog[workflow].title} · ~{operatorWorkflowCatalog[workflow].defaultMinutes} min returned</span>
              </div>
              <button className={styles.textButton} disabled={!policy?.enabled || busyId === `action-${action.id}`} type="button" onClick={() => void planAction(action)}>
                {busyId === `action-${action.id}` ? <Loader2 size={14} /> : <Sparkles size={14} />} Prepare
              </button>
            </div>;
          })}</div> : <div className={styles.panelPad}><p className={styles.operatorMuted}>Nothing new is waiting to be prepared.</p></div>}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><h2>Exception desk</h2><p>Failures and missing configuration return here.</p></div>
            <span className={styles.miniBadge}>{performance.openExceptions} open</span>
          </header>
          {snapshot.exceptions.filter((item) => item.status === "open").length ? <div className={styles.operatorExceptionList}>{snapshot.exceptions.filter((item) => item.status === "open").slice(0, 6).map((item) => <div className={styles.operatorException} key={item.id} data-severity={item.severity}><AlertTriangle size={17} /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.code} · {formatDate(item.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></div>)}</div> : <div className={styles.panelPad}><p className={styles.operatorMuted}><CheckCircle2 size={16} /> No open exceptions.</p></div>}
        </article>
      </section>

      <section className={styles.operatorSection}>
        <div className={styles.operatorSectionHeader}><div><p className={styles.eyebrow}>Published operating policy</p><h2>{blueprint.name} workflows</h2><p>Sector configuration decides what exists; the client chooses how each approved workflow behaves.</p></div><button className={styles.secondaryButton} type="button" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button></div>
        <div className={styles.policyGrid}>
          {publishedPolicies.map((policy) => {
            const definition = operatorWorkflowCatalog[policy.workflowKey];
            const saving = busyId === `policy-${policy.id}`;
            return <article className={styles.policyCard} key={policy.id}>
              <div className={styles.operatorPolicyTop}><div><h3>{definition.title}</h3><p>{definition.description}</p></div><button className={`${styles.operatorSwitch} ${policy.enabled ? styles.operatorSwitchOn : ""}`} aria-label={`${policy.enabled ? "Pause" : "Enable"} ${definition.title}`} aria-pressed={policy.enabled} disabled={saving} type="button" onClick={() => void updatePolicy(policy, { enabled: !policy.enabled })}><span /></button></div>
              <div className={styles.modeRow} aria-label={`${definition.title} autonomy mode`}>
                {(["assist", "approval", "bounded"] as OperatorAutonomyMode[]).map((mode) => <button className={`${styles.modeButton} ${policy.autonomyMode === mode ? styles.modeButtonActive : ""}`} disabled={saving || (mode === "bounded" && policy.workflowKey !== "appointment-reminders")} key={mode} type="button" onClick={() => void updatePolicy(policy, { autonomyMode: mode })}>{mode === "assist" ? "Assist" : mode === "approval" ? "Approve" : "Autopilot"}</button>)}
              </div>
              <label className={styles.operatorProviderLabel}>Execution evidence
                <select value={policy.providerMode} disabled={saving} onChange={(event) => void updatePolicy(policy, { providerMode: event.target.value as OperatorProviderMode })}>
                  <option value="unconfigured">Not connected</option>
                  <option value="mock">Simulation</option>
                  <option value="webhook">Verified webhook</option>
                  <option value="internal" disabled={policy.autonomyMode !== "assist"}>Internal record</option>
                </select>
              </label>
              <small className={styles.operatorPolicyMeta}>Sector Pack {policy.blueprintKey} v{policy.blueprintVersion} · {definition.defaultMinutes} min baseline</small>
            </article>;
          })}
        </div>
      </section>

      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><h2>Run ledger</h2><p>One trace from source record to final evidence.</p></div><span className={styles.miniBadge}>{activeRuns.length} recent</span></header>
        {activeRuns.length ? <div className={styles.operatorRunList}>{activeRuns.map((run) => {
          const approval = snapshot.approvals.find((item) => item.runId === run.id && item.status === "pending");
          return <div className={styles.operatorRun} key={run.id} data-status={run.status}>
            <span className={styles.operatorRunIcon}>{run.status === "failed" || run.status === "exception" ? <AlertTriangle size={17} /> : run.status === "running" || run.status === "queued" ? <TimerReset size={17} /> : run.status === "succeeded" ? <CheckCircle2 size={17} /> : <Play size={17} />}</span>
            <div className={styles.rowCopy}><strong>{String(run.plannedAction.title || operatorWorkflowCatalog[run.workflowKey].title)}</strong><span>{operatorWorkflowCatalog[run.workflowKey].title} · {run.autonomyMode} · {run.providerMode}</span><small>{run.errorMessage || `${run.attempts}/${run.maxAttempts} attempts · ~${run.estimatedMinutesSaved} min value`}</small></div>
            <div className={styles.operatorRunActions}><span className={styles.priorityBadge} data-priority={run.status === "failed" || run.status === "exception" ? "urgent" : run.status === "awaiting_approval" ? "today" : "upcoming"}>{statusLabel(run.status)}</span>{approval ? <><button className={styles.textButton} disabled={busyId === `run-${run.id}`} type="button" onClick={() => void decideRun(run, "approved")}><CheckCircle2 size={13} /> Approve</button><button className={styles.textButton} disabled={busyId === `run-${run.id}`} type="button" onClick={() => void decideRun(run, "rejected")}><XCircle size={13} /> Reject</button></> : null}{run.status === "prepared" ? <button className={styles.textButton} disabled={busyId === `run-${run.id}`} type="button" onClick={() => void completeManual(run)}><CheckCircle2 size={13} /> Confirm done</button> : null}</div>
          </div>;
        })}</div> : <div className={styles.panelPad}><p className={styles.operatorMuted}>No Operator runs have been recorded yet.</p></div>}
      </article>
    </div>
  );
}

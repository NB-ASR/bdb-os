"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Gauge, Loader2 } from "lucide-react";
import { formatUsageValue, type UsageMetric } from "@/lib/usage-metering";

type UsageEvent = {
  id: string;
  metric_key: string;
  quantity: number | string;
  unit: string;
  source_type: string;
  source_id: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

type UsageState = {
  period: {
    id: string;
    start: string;
    end: string;
    planName: string | null;
    measurementStartedAt: string;
  };
  metrics: UsageMetric[];
  context: { invited_users?: number | string | null };
  baselines: Record<string, { quantity?: number | string; unit?: string; captured_at?: string; source?: string }>;
  indicators: Record<string, number | string | null>;
  recentEvents: UsageEvent[];
  sourceNotes: Record<string, string>;
  measurementOnly: boolean;
  automaticCharging: boolean;
};

function moment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function periodDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function statusLabel(status: UsageMetric["status"]) {
  if (status === "unconfigured") return "Not configured";
  if (status === "approaching") return "Approaching";
  if (status === "exceeded") return "Exceeded";
  return "Within allowance";
}

function eventLabel(event: UsageEvent) {
  if (event.metric_key === "automation_executions") return "Automation execution";
  if (event.metric_key === "outbound_emails") return "Outbound email";
  if (event.metric_key === "sms_segments") return "SMS usage";
  return event.metric_key.replaceAll("_", " ");
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function FounderClientUsage({
  workspaceId,
  workspaceName,
  refreshToken,
}: {
  workspaceId: string;
  workspaceName: string;
  refreshToken: number;
}) {
  const router = useRouter();
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadUsage() {
      setLoading(true);
      setError("");
      const response = await fetch(`/api/admin/usage?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }).catch(() => null);
      if (!response || cancelled) return;
      if (response.status === 428) { router.push("/mfa"); return; }
      if (response.status === 401) { router.push("/login?next=/admin"); return; }
      const result = await response.json().catch(() => ({}));
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        setUsage(null);
        setError(result.error ?? "Usage measurement could not be loaded.");
        return;
      }
      setUsage(result as UsageState);
    }

    void loadUsage();
    return () => { cancelled = true; };
  }, [refreshToken, router, workspaceId]);

  if (loading && !usage) {
    return <section><div className="admin-section-heading"><h3>Usage</h3><p><Loader2 className="spin" size={14} /> Measuring current workspace usage…</p></div></section>;
  }

  if (!usage) {
    return <section><div className="settings-note"><strong>Usage measurement unavailable</strong><p>{error || "The Founder usage meter could not be loaded."}</p></div></section>;
  }

  const baselineStorage = usage.baselines?.storage_bytes;
  const baselineUsers = usage.baselines?.active_users;
  const invitedUsers = number(usage.context?.invited_users);

  return (
    <section>
      <div className="admin-usage-heading-row">
        <div className="admin-section-heading">
          <h3>Usage</h3>
          <p>Internal measurement for {workspaceName}. Provider invoices are not passed through to this client.</p>
        </div>
        <span className="admin-usage-measurement-badge"><Gauge size={13} /> Measurement only · no automatic charging</span>
      </div>

      <div className="admin-usage-period">
        <span><strong>Period</strong> {periodDate(usage.period.start)} – {periodDate(new Date(new Date(usage.period.end).getTime() - 1).toISOString())}</span>
        <span><strong>Plan snapshot</strong> {usage.period.planName || "No plan recorded"}</span>
        <span><strong>Metering active</strong> since {moment(usage.period.measurementStartedAt)}</span>
      </div>

      <div className="admin-usage-grid">
        {usage.metrics.map((metric) => {
          const sourceNote = usage.sourceNotes?.[metric.key];
          const disconnected = metric.key === "sms_segments";
          return (
            <article className="admin-usage-card" key={metric.key}>
              <div className="admin-usage-card-head">
                <h4>{metric.label}</h4>
                <span className={`admin-usage-status ${metric.status}`}>{disconnected ? "Not connected" : statusLabel(metric.status)}</span>
              </div>
              <strong className="admin-usage-number">{formatUsageValue(metric.measured, metric.unit)}</strong>
              <dl>
                <div><dt>Package allowance</dt><dd>{metric.allowance === null ? "Not configured" : formatUsageValue(metric.allowance, metric.unit)}</dd></div>
                <div><dt>Remaining</dt><dd>{metric.remaining === null ? "—" : formatUsageValue(metric.remaining, metric.unit)}</dd></div>
              </dl>
              {sourceNote ? <p className="admin-usage-source-note">{sourceNote}</p> : null}
            </article>
          );
        })}
      </div>

      <div className="admin-usage-detail-grid">
        <article className="admin-panel">
          <h4>Measurement baseline</h4>
          <div className="admin-kv-list">
            <div className="admin-kv-row"><span>Storage when meter installed</span><strong>{baselineStorage ? formatUsageValue(number(baselineStorage.quantity), baselineStorage.unit || "bytes") : "Not recorded"}</strong></div>
            <div className="admin-kv-row"><span>Active users when meter installed</span><strong>{baselineUsers ? formatUsageValue(number(baselineUsers.quantity), baselineUsers.unit || "users") : "Not recorded"}</strong></div>
            <div className="admin-kv-row"><span>Invited users now</span><strong>{invitedUsers.toLocaleString()}</strong></div>
          </div>
          <p>Baselines are point-in-time evidence, not reconstructed historical billing.</p>
        </article>

        <article className="admin-panel">
          <h4>Exceptional-usage indicators</h4>
          <div className="admin-kv-list">
            <div className="admin-kv-row"><span>Customers total</span><strong>{number(usage.indicators.customers_total).toLocaleString()}</strong></div>
            <div className="admin-kv-row"><span>Documents total</span><strong>{number(usage.indicators.documents_total).toLocaleString()}</strong></div>
            <div className="admin-kv-row"><span>Sales this period</span><strong>{number(usage.indicators.sales_in_period).toLocaleString()}</strong></div>
            <div className="admin-kv-row"><span>Invoices this period</span><strong>{number(usage.indicators.invoices_in_period).toLocaleString()}</strong></div>
            <div className="admin-kv-row"><span>Appointments this period</span><strong>{number(usage.indicators.appointments_in_period).toLocaleString()}</strong></div>
            <div className="admin-kv-row"><span>Communications this period</span><strong>{number(usage.indicators.communications_in_period).toLocaleString()}</strong></div>
          </div>
          <p>These are internal review indicators only. They are not per-record customer charges.</p>
        </article>
      </div>

      <article className="admin-panel admin-usage-evidence">
        <h4><Activity size={14} /> Recent metered evidence</h4>
        {!usage.recentEvents.length ? <p>No event-style usage has been recorded in this period yet.</p> : usage.recentEvents.slice(0, 10).map((event) => (
          <div className="admin-usage-evidence-row" key={event.id}>
            <span><strong>{eventLabel(event)} · {formatUsageValue(number(event.quantity), event.unit)}</strong><small>{event.source_type}{event.source_id ? ` · ${event.source_id}` : ""}</small></span>
            <time dateTime={event.occurred_at}>{moment(event.occurred_at)}</time>
          </div>
        ))}
      </article>
    </section>
  );
}

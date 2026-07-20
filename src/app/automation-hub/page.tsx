"use client";

import { Bot, CirclePause, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { useBdb } from "@/lib/store";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";

export default function AutomationPage() {
  const { state, toggleAutomation } = useBdb();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const enabled = state.automations.filter((item) => item.enabled).length;
  const approvalRecords = state.messages.filter((item) => item.status === "approval").length;

  async function toggle(id: string) {
    if (updatingId) return;
    setUpdatingId(id);
    await toggleAutomation(id);
    setUpdatingId(null);
  }

  return (
    <>
      <PageHeader eyebrow="Workflow configuration" title="Automation Hub" description="Review workflow settings before the execution engine is enabled. No background automation is currently running from this screen." />
      <div className="stat-grid">
        <StatCard label="Enabled settings" value={String(enabled)} detail="Stored configurations" icon={<Zap size={19} />} />
        <StatCard label="Paused settings" value={String(state.automations.length - enabled)} detail="Not selected" icon={<CirclePause size={19} />} />
        <StatCard label="Draft reviews" value={String(approvalRecords)} detail="Communication records" icon={<Bot size={19} />} />
        <StatCard label="Automatic approvals" value="0" detail="Humans decide" icon={<ShieldCheck size={19} />} />
      </div>

      <div className="review-callout"><ShieldCheck size={19} /><div><strong>Automation execution is not enabled yet</strong><p>These controls store intended workflow settings only. They do not send messages, move money, alter accounting records or run background jobs.</p></div></div>
      <div className="automation-list">
        {state.automations.map((automation) => (
          <Card className="automation-card" key={automation.id}>
            <span className="stat-icon">{automation.enabled ? <Sparkles size={19} /> : <CirclePause size={19} />}</span>
            <div className="automation-copy"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }}>{automation.name}</h2>{automation.enabled ? <Badge tone="gold">Configured</Badge> : <Badge>Paused</Badge>}</div><p>{automation.description}</p><div className="automation-meta"><span>Intended trigger · {automation.trigger}</span><span>Execution · Not enabled</span></div></div>
            <button disabled={Boolean(updatingId)} className={`toggle ${automation.enabled ? "on" : ""}`} aria-label={`${automation.enabled ? "Pause" : "Enable"} ${automation.name} configuration`} aria-pressed={automation.enabled} onClick={() => void toggle(automation.id)} />
          </Card>
        ))}
      </div>
      {state.automations.length === 0 ? <Card className="card-pad"><h2>No workflow configurations</h2><p className="muted">Automation templates will appear here only after they are configured for this workspace.</p></Card> : null}
    </>
  );
}

"use client";

import { Bot, CheckCircle2, CirclePause, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";

export default function AutomationPage() {
  const { state, toggleAutomation } = useBdb();
  const active = state.automations.filter((item) => item.enabled).length;
  return (
    <>
      <PageHeader eyebrow="Assisted workflows" title="Automation Hub" description="Let BDB prepare routine work while you keep control of every important action." />
      <div className="stat-grid">
        <StatCard label="Active" value={String(active)} detail="Running workflows" icon={<Zap size={19} />} />
        <StatCard label="Paused" value={String(state.automations.length - active)} detail="Ready when needed" icon={<CirclePause size={19} />} />
        <StatCard label="Prepared today" value="4" detail="Actions awaiting review" icon={<Bot size={19} />} />
        <StatCard label="Auto-approved" value="0" detail="Humans decide" icon={<ShieldCheck size={19} />} />
      </div>

      <div className="review-callout"><ShieldCheck size={19} /><div><strong>AI assists. Humans decide.</strong><p>Financial changes, external messages and conflicts always wait for explicit approval.</p></div></div>
      <div className="automation-list">
        {state.automations.map((automation) => (
          <Card className="automation-card" key={automation.id}>
            <span className="stat-icon">{automation.enabled ? <Sparkles size={19} /> : <CirclePause size={19} />}</span>
            <div className="automation-copy"><div style={{ display: "flex", gap: 8, alignItems: "center" }}><h2 style={{ margin: 0 }}>{automation.name}</h2>{automation.enabled ? <Badge tone="green">Active</Badge> : <Badge>Paused</Badge>}</div><p>{automation.description}</p><div className="automation-meta"><span>Trigger · {automation.trigger}</span><span>Last run · {automation.lastRun}</span></div></div>
            <button className={`toggle ${automation.enabled ? "on" : ""}`} aria-label={`${automation.enabled ? "Pause" : "Enable"} ${automation.name}`} aria-pressed={automation.enabled} onClick={() => toggleAutomation(automation.id)} />
          </Card>
        ))}
      </div>

      <Card className="card-pad" style={{ marginTop: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="activity-icon green"><CheckCircle2 size={17} /></span><div><h2 style={{ margin: 0 }}>All safeguards are active</h2><p className="muted small" style={{ margin: 2 }}>No automation can send money, change accounting records or contact a customer without the permission rules shown above.</p></div></div></Card>
    </>
  );
}

"use client";

import { Activity, Archive, CheckCircle2 } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate, formatTimeAgo } from "@/lib/format";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";

export default function ActivityPage() {
  const { state } = useBdb();
  return (
    <>
      <PageHeader eyebrow="Audit trail" title="Activity" description="A transparent history of the decisions and changes made across your workspace." />
      <div className="stat-grid">
        <StatCard label="Recorded" value={String(state.activity.length)} detail="Recent events" icon={<Activity size={19} />} />
        <StatCard label="Financial" value={String(state.activity.filter((item) => ["Invoice created", "Payment approved", "Transaction reconciled", "Invoice paid"].includes(item.action)).length)} detail="Money-related actions" icon={<CheckCircle2 size={19} />} />
        <StatCard label="Retention" value="Complete" detail="Local audit history" icon={<Archive size={19} />} />
        <StatCard label="Last change" value={state.activity[0] ? formatTimeAgo(state.activity[0].timestamp) : "—"} detail="Saved automatically" icon={<Activity size={19} />} />
      </div>
      <Card className="card-pad"><div className="activity-timeline">{state.activity.map((item) => <div className="activity-item" key={item.id}><span className={`activity-icon ${item.tone}`}><Activity size={16} /></span><div className="activity-copy"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><h3 style={{ margin: 0 }}>{item.action}</h3><Badge tone={item.tone === "green" ? "green" : item.tone === "blue" ? "blue" : item.tone === "gold" ? "gold" : "neutral"}>Recorded</Badge></div><p>{item.detail}</p></div><span className="activity-time">{formatDate(item.timestamp, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>)}</div></Card>
    </>
  );
}

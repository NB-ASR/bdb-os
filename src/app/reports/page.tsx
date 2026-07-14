"use client";

import { BarChart3, CircleDollarSign, CircleGauge, TrendingUp } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import { Card, PageHeader, SectionHeading, StatCard } from "@/components/ui";

const monthly = [
  { month: "Feb", revenue: 43, expense: 18 },
  { month: "Mar", revenue: 62, expense: 28 },
  { month: "Apr", revenue: 53, expense: 21 },
  { month: "May", revenue: 78, expense: 34 },
  { month: "Jun", revenue: 91, expense: 39 },
  { month: "Jul", revenue: 68, expense: 27 },
];

export default function ReportsPage() {
  const { state } = useBdb();
  const revenue = state.invoices.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const pipeline = state.invoices.filter((item) => item.status !== "paid").reduce((sum, item) => sum + item.amount, 0);
  const paidCount = state.invoices.filter((item) => item.status === "paid").length;
  const collectionRate = Math.round(paidCount / state.invoices.length * 100);

  return (
    <>
      <PageHeader eyebrow="Business intelligence" title="Reports" description="Useful detail only when you ask for it—clear performance, cash and customer signals." />
      <div className="stat-grid">
        <StatCard label="Revenue" value={formatMoney(revenue, state.settings.currency)} detail="Paid invoices" icon={<CircleDollarSign size={19} />} />
        <StatCard label="Pipeline" value={formatMoney(pipeline, state.settings.currency)} detail="Draft and open invoices" icon={<TrendingUp size={19} />} />
        <StatCard label="Collection rate" value={`${collectionRate}%`} detail="Invoices paid" icon={<CircleGauge size={19} />} />
        <StatCard label="Avg. invoice" value={formatMoney(state.invoices.reduce((sum, item) => sum + item.amount, 0) / state.invoices.length, state.settings.currency)} detail="Across all invoices" icon={<BarChart3 size={19} />} />
      </div>

      <div className="two-column">
        <Card className="chart-card"><SectionHeading title="Revenue and costs" description="February–July 2026" /><div className="bar-chart">{monthly.map((item) => <div className="bar-group" key={item.month}><span className="bar" style={{ height: `${item.revenue}%` }} title={`Revenue ${item.revenue}`} /><span className="bar secondary" style={{ height: `${item.expense}%` }} title={`Costs ${item.expense}`} /><span className="bar-label">{item.month}</span></div>)}</div><div className="chart-legend"><span><i className="legend-dot" /> Revenue</span><span><i className="legend-dot secondary" /> Costs</span></div></Card>
        <Card className="donut-wrap"><SectionHeading title="Invoice status" /><div style={{ position: "relative" }}><div className="donut" /><div className="donut-label" style={{ inset: 0, display: "grid", placeContent: "center" }}><strong>{state.invoices.length}</strong><span>invoices</span></div></div><div className="metric-list"><div className="metric-row"><span>Paid</span><strong>{paidCount}</strong></div><div className="metric-row"><span>Sent</span><strong>{state.invoices.filter((item) => item.status === "sent").length}</strong></div><div className="metric-row"><span>Overdue</span><strong>{state.invoices.filter((item) => item.status === "overdue").length}</strong></div><div className="metric-row"><span>Draft</span><strong>{state.invoices.filter((item) => item.status === "draft").length}</strong></div></div></Card>
      </div>

      <div className="three-column" style={{ marginTop: 18 }}>
        <Card className="card-pad"><p className="eyebrow">Largest customer</p><h2>Stone & Co Events</h2><p className="muted small" style={{ margin: 0 }}>{formatMoney(5730, state.settings.currency)} invoiced · 2 projects</p></Card>
        <Card className="card-pad"><p className="eyebrow">Cash insight</p><h2>Healthy short-term position</h2><p className="muted small" style={{ margin: 0 }}>Current cash covers the last six months’ average costs.</p></Card>
        <Card className="card-pad"><p className="eyebrow">Attention</p><h2>One overdue invoice</h2><p className="muted small" style={{ margin: 0 }}>BDB-1041 is four days overdue and has a likely bank match.</p></Card>
      </div>
    </>
  );
}

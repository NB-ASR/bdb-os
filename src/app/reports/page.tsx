"use client";

import { BarChart3, CircleDollarSign, CircleGauge, TrendingUp } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import { Card, PageHeader, SectionHeading, StatCard } from "@/components/ui";

export default function ReportsPage() {
  const { state } = useBdb();
  const paidInvoices = state.invoices.filter((item) => item.status === "paid");
  const revenue = paidInvoices.reduce((sum, item) => sum + item.amount, 0);
  const pipelineInvoices = state.invoices.filter((item) => item.status !== "paid");
  const pipeline = pipelineInvoices.reduce((sum, item) => sum + item.amount, 0);
  const paidCount = paidInvoices.length;
  const collectionRate = state.invoices.length > 0 ? Math.round(paidCount / state.invoices.length * 100) : 0;
  const averageInvoice = state.invoices.length > 0 ? state.invoices.reduce((sum, item) => sum + item.amount, 0) / state.invoices.length : 0;
  const overdue = state.invoices.filter((item) => item.status === "overdue");

  const customerTotals = new Map<string, number>();
  state.invoices.forEach((invoice) => customerTotals.set(invoice.customerId, (customerTotals.get(invoice.customerId) ?? 0) + invoice.amount));
  const largestEntry = [...customerTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const largestCustomer = largestEntry ? state.customers.find((item) => item.id === largestEntry[0]) : undefined;

  const monthlyMap = new Map<string, number>();
  paidInvoices.forEach((invoice) => {
    const month = invoice.issuedAt.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + invoice.amount);
  });
  const monthly = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const monthlyMax = Math.max(...monthly.map(([, value]) => value), 1);

  return (
    <>
      <PageHeader eyebrow="Business intelligence" title="Reports" description="Calculated from the records currently loaded in this workspace. No external bank, accounting or forecasting data is included." />
      <div className="stat-grid">
        <StatCard label="Paid invoice value" value={formatMoney(revenue, state.settings.currency)} detail={`${paidCount} paid invoice${paidCount === 1 ? "" : "s"}`} icon={<CircleDollarSign size={19} />} />
        <StatCard label="Open pipeline" value={formatMoney(pipeline, state.settings.currency)} detail={`${pipelineInvoices.length} draft or unpaid`} icon={<TrendingUp size={19} />} />
        <StatCard label="Collection rate" value={`${collectionRate}%`} detail="By invoice count" icon={<CircleGauge size={19} />} />
        <StatCard label="Average invoice" value={formatMoney(averageInvoice, state.settings.currency)} detail="Across recorded invoices" icon={<BarChart3 size={19} />} />
      </div>

      <div className="two-column">
        <Card className="chart-card">
          <SectionHeading title="Paid invoice value by issue month" description={monthly.length > 0 ? "Up to the latest six recorded months" : "No paid invoice history"} />
          {monthly.length > 0 ? <><div className="bar-chart">{monthly.map(([month, value]) => <div className="bar-group" key={month}><span className="bar" style={{ height: `${Math.max(4, value / monthlyMax * 100)}%` }} title={formatMoney(value, state.settings.currency)} /><span className="bar-label">{new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${month}-01T00:00:00`))}</span></div>)}</div><div className="chart-legend"><span><i className="legend-dot" /> Paid invoice value</span></div></> : <div className="card-pad"><p className="muted">Mark confirmed invoices as paid to build this report.</p></div>}
        </Card>
        <Card className="card-pad"><SectionHeading title="Invoice status" description="Current record counts" /><div className="metric-list"><div className="metric-row"><span>Paid</span><strong>{paidCount}</strong></div><div className="metric-row"><span>Sent</span><strong>{state.invoices.filter((item) => item.status === "sent").length}</strong></div><div className="metric-row"><span>Overdue</span><strong>{overdue.length}</strong></div><div className="metric-row"><span>Draft</span><strong>{state.invoices.filter((item) => item.status === "draft").length}</strong></div><div className="metric-row"><span>Total</span><strong>{state.invoices.length}</strong></div></div></Card>
      </div>

      <div className="three-column" style={{ marginTop: 18 }}>
        <Card className="card-pad"><p className="eyebrow">Largest recorded customer</p><h2>{largestCustomer?.name ?? "No invoice data"}</h2><p className="muted small" style={{ margin: 0 }}>{largestEntry ? `${formatMoney(largestEntry[1], state.settings.currency)} invoiced` : "Create invoices to calculate this insight."}</p></Card>
        <Card className="card-pad"><p className="eyebrow">Data boundary</p><h2>Workspace records only</h2><p className="muted small" style={{ margin: 0 }}>Profit, tax, cash runway and forecasting are not calculated until verified expense and bank data are connected.</p></Card>
        <Card className="card-pad"><p className="eyebrow">Attention</p><h2>{overdue.length > 0 ? `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}` : "No overdue invoices"}</h2><p className="muted small" style={{ margin: 0 }}>{overdue.length > 0 ? `${formatMoney(overdue.reduce((sum, item) => sum + item.amount, 0), state.settings.currency)} requires follow-up.` : "No overdue invoice records are currently loaded."}</p></Card>
      </div>
    </>
  );
}

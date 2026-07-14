"use client";

import { useMemo, useState, type FormEvent } from "react";
import { BadgePoundSterling, CircleCheckBig, Clock3, Plus, ReceiptText } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import type { InvoiceStatus } from "@/lib/types";

const statusTone: Record<InvoiceStatus, "neutral" | "gold" | "green" | "red"> = {
  draft: "neutral",
  sent: "gold",
  paid: "green",
  overdue: "red",
};

export default function AccountsPage() {
  const { state, addInvoice, markInvoicePaid } = useBdb();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | InvoiceStatus>("all");
  const [form, setForm] = useState({ customerId: state.customers[0]?.id ?? "", description: "", amount: "", dueAt: "2026-07-28", status: "sent" as InvoiceStatus });

  const visible = useMemo(() => state.invoices.filter((invoice) => {
    const customer = state.customers.find((item) => item.id === invoice.customerId);
    const matches = [invoice.number, invoice.description, customer?.name, customer?.company].join(" ").toLowerCase().includes(query.toLowerCase());
    return matches && (filter === "all" || invoice.status === filter);
  }), [filter, query, state.customers, state.invoices]);

  const received = state.invoices.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const outstanding = state.invoices.filter((item) => ["sent", "overdue"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.customerId || !form.description || !form.amount) return;
    addInvoice({ ...form, amount: Number(form.amount) });
    setForm({ customerId: state.customers[0]?.id ?? "", description: "", amount: "", dueAt: "2026-07-28", status: "sent" });
    setOpen(false);
  }

  return (
    <>
      <PageHeader eyebrow="Finance workspace" title="Accounts" description="Create invoices, approve payments and keep every financial record connected." action={<Button onClick={() => setOpen(true)}><Plus size={17} /> New invoice</Button>} />
      <div className="stat-grid">
        <StatCard label="Received" value={formatMoney(received, state.settings.currency)} detail="Paid invoices" icon={<CircleCheckBig size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstanding, state.settings.currency)} detail="Awaiting payment" icon={<Clock3 size={19} />} />
        <StatCard label="Overdue" value={String(state.invoices.filter((item) => item.status === "overdue").length)} detail="Needs a decision" icon={<BadgePoundSterling size={19} />} />
        <StatCard label="Invoices" value={String(state.invoices.length)} detail="Across all statuses" icon={<ReceiptText size={19} />} />
      </div>

      <div className="toolbar">
        <input className="filter-input" placeholder="Search invoices or customers…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="filter-tabs" role="group" aria-label="Filter invoices">
          {(["all", "draft", "sent", "overdue", "paid"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      </div>

      <Card className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Invoice</th><th>Customer</th><th>Dates</th><th>Status</th><th className="align-right">Amount</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visible.map((invoice) => {
                const customer = state.customers.find((item) => item.id === invoice.customerId);
                return (
                  <tr key={invoice.id}>
                    <td className="cell-stack"><strong>{invoice.number}</strong><span>{invoice.description}</span></td>
                    <td className="cell-stack"><strong>{customer?.name ?? "Unknown"}</strong><span>{customer?.company}</span></td>
                    <td className="cell-stack"><strong>{formatDate(invoice.issuedAt, { day: "numeric", month: "short" })}</strong><span>Due {formatDate(invoice.dueAt, { day: "numeric", month: "short" })}</span></td>
                    <td><Badge tone={statusTone[invoice.status]}>{invoice.status}</Badge></td>
                    <td className="align-right"><strong>{formatMoney(invoice.amount, state.settings.currency)}</strong></td>
                    <td><div className="table-actions">{["sent", "overdue"].includes(invoice.status) ? <button className="link-button" onClick={() => markInvoicePaid(invoice.id)}>Approve paid</button> : <span className="muted small">—</span>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Create invoice" description="The invoice is saved locally first and remains available offline.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="invoice-customer">Customer</label><select id="invoice-customer" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.company}</option>)}</select></div>
            <div className="field field-full"><label htmlFor="invoice-description">Description</label><input id="invoice-description" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="e.g. July content retainer" /></div>
            <div className="field"><label htmlFor="invoice-amount">Amount</label><input id="invoice-amount" required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></div>
            <div className="field"><label htmlFor="invoice-due">Due date</label><input id="invoice-due" required type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></div>
            <div className="field"><label htmlFor="invoice-status">Initial status</label><select id="invoice-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as InvoiceStatus })}><option value="draft">Draft</option><option value="sent">Ready to send</option></select></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Create invoice</Button></div>
        </form>
      </Dialog>
    </>
  );
}

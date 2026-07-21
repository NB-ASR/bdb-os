"use client";

import { useMemo, useState, type FormEvent } from "react";
import { BadgePoundSterling, CircleCheckBig, Clock3, Plus, ReceiptText } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import type { InvoiceStatus } from "@/lib/types";

const statusTone: Record<InvoiceStatus, "neutral" | "gold" | "green" | "red"> = { draft: "neutral", sent: "gold", paid: "green", overdue: "red" };

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

export default function AccountsPage() {
  const { state, addInvoice, markInvoicePaid } = useBdb();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | InvoiceStatus>("all");
  const [form, setForm] = useState({ customerId: state.customers[0]?.id ?? "", description: "", amount: "", dueAt: defaultDueDate(), status: "sent" as InvoiceStatus });

  const visible = useMemo(() => state.invoices.filter((invoice) => {
    const customer = state.customers.find((item) => item.id === invoice.customerId);
    const matches = [invoice.number, invoice.description, customer?.name, customer?.company].join(" ").toLowerCase().includes(query.toLowerCase());
    return matches && (filter === "all" || invoice.status === filter);
  }), [filter, query, state.customers, state.invoices]);
  const received = state.invoices.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const outstanding = state.invoices.filter((item) => ["sent", "overdue"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.customerId || !form.description || !form.amount || saving) return;
    setSaving(true);
    const confirmed = await addInvoice({ ...form, amount: Number(form.amount) });
    setSaving(false);
    if (!confirmed) return;
    setForm({ customerId: state.customers[0]?.id ?? "", description: "", amount: "", dueAt: defaultDueDate(), status: "sent" });
    setOpen(false);
  }

  async function approvePaid(id: string) {
    if (updatingId) return;
    setUpdatingId(id);
    await markInvoicePaid(id);
    setUpdatingId(null);
  }

  const canCreate = state.customers.length > 0;

  return (
    <>
      <PageHeader eyebrow="Finance workspace" title="Accounts" description="Create invoices, approve payments and keep every financial record connected." action={<Button disabled={!canCreate} onClick={() => setOpen(true)}><Plus size={17} /> New invoice</Button>} />
      {!canCreate ? <div className="review-callout"><ReceiptText size={19} /><div><strong>Add a customer before creating an invoice</strong><p>Invoices must connect to a valid customer record.</p></div></div> : null}
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
                return <tr key={invoice.id}>
                  <td className="cell-stack"><strong>{invoice.number}</strong><span>{invoice.description}</span></td>
                  <td className="cell-stack"><strong>{customer?.name ?? "Unknown customer"}</strong><span>{customer?.company}</span></td>
                  <td className="cell-stack"><strong>{formatDate(invoice.issuedAt, { day: "numeric", month: "short" })}</strong><span>Due {formatDate(invoice.dueAt, { day: "numeric", month: "short" })}</span></td>
                  <td><Badge tone={statusTone[invoice.status]}>{invoice.status}</Badge></td>
                  <td className="align-right"><strong>{formatMoney(invoice.amount, state.settings.currency)}</strong></td>
                  <td><div className="table-actions">{["sent", "overdue"].includes(invoice.status) ? <button disabled={Boolean(updatingId)} className="link-button" onClick={() => void approvePaid(invoice.id)}>{updatingId === invoice.id ? "Saving…" : "Approve paid"}</button> : <span className="muted small">—</span>}</div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? <div className="card-pad"><h2>No invoices found</h2><p className="muted">{query || filter !== "all" ? "Change the search or filter." : "Create the first invoice after adding a customer."}</p></div> : null}
      </Card>

      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title="Create invoice" description="The invoice appears only after the workspace confirms the save.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="invoice-customer">Customer</label><select id="invoice-customer" required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}{item.company ? ` · ${item.company}` : ""}</option>)}</select></div>
            <div className="field field-full"><label htmlFor="invoice-description">Description</label><input id="invoice-description" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Work or service being invoiced" /></div>
            <div className="field"><label htmlFor="invoice-amount">Amount</label><input id="invoice-amount" required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></div>
            <div className="field"><label htmlFor="invoice-due">Due date</label><input id="invoice-due" required type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></div>
            <div className="field"><label htmlFor="invoice-status">Initial status</label><select id="invoice-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as InvoiceStatus })}><option value="draft">Draft</option><option value="sent">Ready to send</option></select></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create invoice"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

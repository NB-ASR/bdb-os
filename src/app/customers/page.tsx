"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Building2, Mail, MapPin, Phone, Plus, UserRound, UsersRound } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import { Badge, Button, Dialog, PageHeader, StatCard } from "@/components/ui";

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function CustomersPage() {
  const { state, addCustomer } = useBdb();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", address: "", notes: "" });

  const selected = state.customers.find((item) => item.id === selectedId);
  const visible = useMemo(() => state.customers.filter((item) => [item.name, item.company, item.code, item.email, item.phone].join(" ").toLowerCase().includes(query.toLowerCase())), [query, state.customers]);
  const customerOutstanding = selected ? state.invoices.filter((item) => item.customerId === selected.id && item.status !== "paid").reduce((sum, item) => sum + item.amount, 0) : 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name || !form.email) return;
    addCustomer(form);
    setForm({ name: "", company: "", email: "", phone: "", address: "", notes: "" });
    setOpen(false);
  }

  return (
    <>
      <PageHeader eyebrow="Relationship workspace" title="Customers" description="One connected record for every customer, conversation, booking, document and balance." action={<Button onClick={() => setOpen(true)}><Plus size={17} /> Add customer</Button>} />
      <div className="stat-grid">
        <StatCard label="Customers" value={String(state.customers.length)} detail="Active records" icon={<UsersRound size={19} />} />
        <StatCard label="Companies" value={String(new Set(state.customers.map((item) => item.company)).size)} detail="Connected organisations" icon={<Building2 size={19} />} />
        <StatCard label="New this month" value="1" detail="Webb Property Group" icon={<UserRound size={19} />} />
        <StatCard label="With balances" value={String(new Set(state.invoices.filter((item) => item.status !== "paid" && item.status !== "draft").map((item) => item.customerId)).size)} detail="Outstanding invoices" icon={<Mail size={19} />} />
      </div>

      <div className="toolbar"><input className="filter-input" placeholder="Search customers, companies or codes…" value={query} onChange={(event) => setQuery(event.target.value)} /><Badge tone="neutral">{visible.length} records</Badge></div>
      <div className="customer-grid">
        {visible.map((customer) => {
          const invoices = state.invoices.filter((item) => item.customerId === customer.id);
          const outstanding = invoices.filter((item) => item.status !== "paid").reduce((sum, item) => sum + item.amount, 0);
          return (
            <button key={customer.id} className="card card-interactive customer-card" onClick={() => setSelectedId(customer.id)}>
              <div className="customer-head">
                <span className="customer-avatar">{initials(customer.name)}</span>
                <span className="cell-stack"><strong>{customer.name}</strong><span>{customer.company}</span></span>
                <span className="customer-code">{customer.code}</span>
              </div>
              <div className="customer-meta">
                <span><Mail size={14} /> {customer.email}</span>
                <span><Phone size={14} /> {customer.phone}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}><Badge tone={outstanding ? "gold" : "green"}>{outstanding ? `${formatMoney(outstanding, state.settings.currency)} open` : "Clear"}</Badge><span className="muted small">{invoices.length} invoices</span></div>
            </button>
          );
        })}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add customer" description="Their record becomes available across every BDB OS workspace.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label htmlFor="customer-name">Contact name</label><input id="customer-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Full name" /></div>
            <div className="field"><label htmlFor="customer-company">Company</label><input id="customer-company" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Business name" /></div>
            <div className="field"><label htmlFor="customer-email">Email</label><input id="customer-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></div>
            <div className="field"><label htmlFor="customer-phone">Phone</label><input id="customer-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+44…" /></div>
            <div className="field field-full"><label htmlFor="customer-address">Address</label><input id="customer-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Business address" /></div>
            <div className="field field-full"><label htmlFor="customer-notes">Notes</label><textarea id="customer-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Useful preferences or context" /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Add customer</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.name ?? "Customer"} description={`${selected?.code ?? ""} · ${selected?.company ?? ""}`}>
        {selected ? <>
          <dl className="detail-grid"><dt>Email</dt><dd>{selected.email}</dd><dt>Phone</dt><dd>{selected.phone}</dd><dt>Address</dt><dd><MapPin size={13} style={{ display: "inline", marginRight: 5 }} />{selected.address}</dd><dt>Notes</dt><dd>{selected.notes || "No notes yet."}</dd><dt>Open balance</dt><dd><strong>{formatMoney(customerOutstanding, state.settings.currency)}</strong></dd></dl>
          <div className="dialog-actions"><Button variant="secondary" onClick={() => setSelectedId(null)}>Close</Button></div>
        </> : null}
      </Dialog>
    </>
  );
}

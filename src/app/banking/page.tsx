"use client";

import { useState } from "react";
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Landmark, Scale } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

export default function BankingPage() {
  const { state, reconcileTransaction } = useBdb();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const selected = state.transactions.find((item) => item.id === selectedId);
  const credits = state.transactions.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0);
  const debits = state.transactions.filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0);
  const balance = 24782.64;

  function openReview(id: string) {
    const transaction = state.transactions.find((item) => item.id === id);
    const likely = transaction?.type === "credit" ? state.invoices.find((item) => item.status !== "paid" && Math.abs(item.amount - (transaction?.amount ?? 0)) < 1) : undefined;
    setInvoiceId(likely?.id ?? "");
    setSelectedId(id);
  }

  function approve() {
    if (!selected) return;
    reconcileTransaction(selected.id, selected.type === "credit" ? invoiceId || undefined : undefined);
    setSelectedId(null);
  }

  return (
    <>
      <PageHeader eyebrow="Cash workspace" title="Banking" description="See the cash position, review matches and approve reconciliations without losing human control." />
      <div className="stat-grid">
        <StatCard label="Current balance" value={formatMoney(balance, state.settings.currency)} detail="BDB Business Current" icon={<Landmark size={19} />} />
        <StatCard label="Money in" value={formatMoney(credits, state.settings.currency)} detail="Recent transactions" icon={<ArrowDownLeft size={19} />} />
        <StatCard label="Money out" value={formatMoney(debits, state.settings.currency)} detail="Recent transactions" icon={<ArrowUpRight size={19} />} />
        <StatCard label="To review" value={String(state.transactions.filter((item) => item.status !== "matched").length)} detail="Needs a decision" icon={<Scale size={19} />} />
      </div>

      <div className="three-column" style={{ marginBottom: 18 }}>
        <Card className="account-card" style={{ gridColumn: "span 2" }}><div className="account-card-head"><div><p className="eyebrow">Connected account</p><h2>BDB Business Current</h2></div><span className="bank-logo"><Landmark size={19} /></span></div><p className="balance">{formatMoney(balance, state.settings.currency)}</p><p className="muted small" style={{ margin: 0 }}>•••• 4821 · Last synced 2 minutes ago</p></Card>
        <Card className="account-card"><p className="eyebrow">Reconciliation</p><p className="balance">{Math.round(state.transactions.filter((item) => item.status === "matched").length / state.transactions.length * 100)}%</p><p className="muted small" style={{ margin: 0 }}>of recent activity matched</p></Card>
      </div>

      {state.transactions.some((item) => item.status !== "matched") ? <div className="review-callout"><AlertCircle size={19} /><div><strong>Two transactions need your review</strong><p>BDB found likely matches but will not alter financial records without your approval.</p></div></div> : null}
      <Card className="table-card"><div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Status</th><th className="align-right">Amount</th><th aria-label="Action" /></tr></thead><tbody>{state.transactions.map((transaction) => <tr key={transaction.id}><td>{formatDate(transaction.date, { day: "numeric", month: "short" })}</td><td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="result-icon">{transaction.type === "credit" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><strong>{transaction.description}</strong></div></td><td><Badge tone={transaction.status === "matched" ? "green" : transaction.status === "review" ? "gold" : "red"}>{transaction.status}</Badge></td><td className="align-right"><strong style={{ color: transaction.type === "credit" ? "var(--green)" : undefined }}>{transaction.type === "credit" ? "+" : "−"}{formatMoney(transaction.amount, state.settings.currency)}</strong></td><td><div className="table-actions">{transaction.status === "matched" ? <CheckCircle2 size={17} color="var(--green)" /> : <button className="link-button" onClick={() => openReview(transaction.id)}>Review</button>}</div></td></tr>)}</tbody></table></div></Card>

      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} title="Approve reconciliation" description="BDB suggests the match. You make the financial decision.">
        {selected ? <><Card className="card-pad" style={{ marginBottom: 16 }}><p className="eyebrow">Bank transaction</p><h2>{selected.description}</h2><p className="balance" style={{ margin: "12px 0 0", fontSize: 26 }}>{selected.type === "credit" ? "+" : "−"}{formatMoney(selected.amount, state.settings.currency)}</p></Card>{selected.type === "credit" ? <div className="field"><label htmlFor="match-invoice">Match to invoice</label><select id="match-invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}><option value="">Choose an invoice</option>{state.invoices.filter((item) => item.status !== "paid").map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {formatMoney(invoice.amount, state.settings.currency)}</option>)}</select></div> : <p className="muted">This expense will be marked as reviewed and matched to the general expense ledger.</p>}<div className="dialog-actions"><Button variant="quiet" onClick={() => setSelectedId(null)}>Cancel</Button><Button disabled={selected.type === "credit" && !invoiceId} onClick={approve}>Approve match</Button></div></> : null}
      </Dialog>
    </>
  );
}

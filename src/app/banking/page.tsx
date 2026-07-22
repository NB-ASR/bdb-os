"use client";

import { useState } from "react";
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Landmark, Scale } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

export default function BankingPage() {
  const { state, reconcileTransaction, mode } = useBdb();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = state.transactions.find((item) => item.id === selectedId);
  const credits = state.transactions.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0);
  const debits = state.transactions.filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0);
  const netMovement = credits - debits;
  const reviewCount = state.transactions.filter((item) => item.status !== "matched").length;
  const matchedCount = state.transactions.filter((item) => item.status === "matched").length;
  const reconciliationRate = state.transactions.length > 0 ? Math.round(matchedCount / state.transactions.length * 100) : 0;

  function openReview(id: string) {
    const transaction = state.transactions.find((item) => item.id === id);
    const likely = transaction?.type === "credit" ? state.invoices.find((item) => item.status !== "paid" && Math.abs(item.amount - (transaction?.amount ?? 0)) < 1) : undefined;
    setInvoiceId(likely?.id ?? "");
    setSelectedId(id);
  }

  async function approve() {
    if (!selected || saving) return;
    setSaving(true);
    const confirmed = await reconcileTransaction(selected.id, selected.type === "credit" ? invoiceId || undefined : undefined);
    setSaving(false);
    if (confirmed) setSelectedId(null);
  }

  return (
    <>
      <PageHeader eyebrow="Cash workspace" title="Banking" description="Review imported transaction records without presenting an unverified live bank balance." />
      <div className="review-callout"><AlertCircle size={19} /><div><strong>{mode === "cloud" ? "Atomic reconciliation" : "Local preview reconciliation"}</strong><p>{mode === "cloud" ? "Credits can be matched only to an invoice with the same verified amount. The transaction and invoice commit together, or neither record changes." : "Preview changes remain local and are not connected to a bank account."}</p></div></div>
      <div className="stat-grid">
        <StatCard label="Net movement" value={formatMoney(netMovement, state.settings.currency)} detail="From imported records" icon={<Landmark size={19} />} />
        <StatCard label="Money in" value={formatMoney(credits, state.settings.currency)} detail="Recorded credits" icon={<ArrowDownLeft size={19} />} />
        <StatCard label="Money out" value={formatMoney(debits, state.settings.currency)} detail="Recorded debits" icon={<ArrowUpRight size={19} />} />
        <StatCard label="To review" value={String(reviewCount)} detail="Unmatched records" icon={<Scale size={19} />} />
      </div>

      <div className="three-column" style={{ marginBottom: 18 }}>
        <Card className="account-card" style={{ gridColumn: "span 2" }}><div className="account-card-head"><div><p className="eyebrow">Bank feed</p><h2>Live account connection not enabled</h2></div><span className="bank-logo"><Landmark size={19} /></span></div><p className="muted" style={{ margin: "18px 0 0" }}>The figures below come only from transaction records already stored in this workspace. They are not a current bank balance.</p></Card>
        <Card className="account-card"><p className="eyebrow">Reconciliation</p><p className="balance">{reconciliationRate}%</p><p className="muted small" style={{ margin: 0 }}>{state.transactions.length > 0 ? `${matchedCount} of ${state.transactions.length} records matched` : "No transactions imported"}</p></Card>
      </div>

      {reviewCount > 0 ? <div className="review-callout"><AlertCircle size={19} /><div><strong>{reviewCount} transaction{reviewCount === 1 ? "" : "s"} need review</strong><p>Suggested matches remain unchanged until a permitted user deliberately approves reconciliation.</p></div></div> : null}
      <Card className="table-card">
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Status</th><th className="align-right">Amount</th><th aria-label="Action" /></tr></thead><tbody>{state.transactions.map((transaction) => <tr key={transaction.id}><td>{formatDate(transaction.date, { day: "numeric", month: "short" })}</td><td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="result-icon">{transaction.type === "credit" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><strong>{transaction.description}</strong></div></td><td><Badge tone={transaction.status === "matched" ? "green" : transaction.status === "review" ? "gold" : "red"}>{transaction.status}</Badge></td><td className="align-right"><strong style={{ color: transaction.type === "credit" ? "var(--green)" : undefined }}>{transaction.type === "credit" ? "+" : "−"}{formatMoney(transaction.amount, state.settings.currency)}</strong></td><td><div className="table-actions">{transaction.status === "matched" ? <CheckCircle2 size={17} color="var(--green)" /> : <button className="link-button" onClick={() => openReview(transaction.id)}>Review</button>}</div></td></tr>)}</tbody></table></div>
        {state.transactions.length === 0 ? <div className="card-pad"><h2>No transaction records</h2><p className="muted">A verified bank import or connection is required before cash activity appears here.</p></div> : null}
      </Card>

      <Dialog open={Boolean(selected)} onClose={() => { if (!saving) setSelectedId(null); }} title="Approve reconciliation" description={mode === "cloud" ? "This approval is permission-checked, atomic and permanently audited." : "This preview changes only local demonstration records."}>
        {selected ? <><Card className="card-pad" style={{ marginBottom: 16 }}><p className="eyebrow">Transaction record</p><h2>{selected.description}</h2><p className="balance" style={{ margin: "12px 0 0", fontSize: 26 }}>{selected.type === "credit" ? "+" : "−"}{formatMoney(selected.amount, state.settings.currency)}</p></Card>{selected.type === "credit" ? <div className="field"><label htmlFor="match-invoice">Match to invoice</label><select id="match-invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}><option value="">Choose an invoice</option>{state.invoices.filter((item) => item.status !== "paid" && Math.abs(item.amount - selected.amount) < 0.01).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {formatMoney(invoice.amount, state.settings.currency)}</option>)}</select></div> : <p className="muted">Approve this expense as reviewed. It will not be linked to a sales invoice.</p>}<div className="dialog-actions"><Button variant="quiet" disabled={saving} onClick={() => setSelectedId(null)}>Cancel</Button><Button disabled={saving || (selected.type === "credit" && !invoiceId)} onClick={() => void approve()}>{saving ? "Saving…" : "Approve reconciliation"}</Button></div></> : null}
      </Dialog>
    </>
  );
}

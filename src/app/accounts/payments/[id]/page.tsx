"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Banknote, Link2, RefreshCw, RotateCcw, Undo2 } from "lucide-react";
import { useAccountsCommandRuntime } from "@/components/accounts/accounts-command-runtime";
import { formatDate, formatMoney } from "@/lib/format";
import {
  cacheAccountsPaymentDetail,
  readAccountsPaymentDetail,
} from "@/lib/modules/accounts-working-cache";
import styles from "../../accounts-workspace.module.css";

type Payment = {
  id: string;
  reference: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  notes: string | null;
  received_at: string;
  status: string;
  allocated_amount: number;
  unallocated_amount: number;
  reversed_at: string | null;
  reversal_reason: string | null;
};

type Customer = { id: string; code: string; name: string; company: string | null; email: string | null; phone: string | null };
type InvoiceOption = { id: string; number: string; issued_at: string; due_at: string | null; display_status: string; outstanding_amount: number; currency: string };
type Allocation = {
  id: string;
  invoice_id: string;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
  reversed: boolean;
  invoice_number: string;
  invoice_status: string;
  invoice_outstanding_amount: number;
};
type DetailBundle = { workspaceId: string; payment: Payment; customer: Customer | null; allocations: Allocation[]; eligibleInvoices: InvoiceOption[] };

function tone(status: string) {
  if (status === "posted") return "good";
  return "neutral";
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const paymentId = String(params.id ?? "");
  const runtime = useAccountsCommandRuntime();
  const [bundle, setBundle] = useState<DetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [allocationToReverse, setAllocationToReverse] = useState<string | null>(null);
  const [allocationReason, setAllocationReason] = useState("");
  const [paymentReason, setPaymentReason] = useState("");

  const load = useCallback(async () => {
    if (!runtime.workspaceId || !paymentId) return;
    setLoading(true);
    setError("");
    const local = readAccountsPaymentDetail(runtime.workspaceId, paymentId);
    if (local?.bundle) {
      setBundle(local.bundle as unknown as DetailBundle);
      setCached(true);
    }
    if (!navigator.onLine) {
      if (!local) setError("This Payment has not been cached on this device yet. Reconnect once to open it.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/accounts/payments/${encodeURIComponent(paymentId)}?workspaceId=${encodeURIComponent(runtime.workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Payment could not be loaded.");
      const next = result.result as DetailBundle;
      setBundle(next);
      setCached(false);
      cacheAccountsPaymentDetail(runtime.workspaceId, paymentId, next as unknown as Record<string, unknown>);
    } catch (loadError) {
      if (!local) setError(loadError instanceof Error ? loadError.message : "Payment could not be loaded.");
      else setError("Live Payment data could not be refreshed. The cached working copy remains visible.");
    } finally {
      setLoading(false);
    }
  }, [paymentId, runtime.workspaceId]);

  useEffect(() => {
    if (!runtime.loading && runtime.workspaceId) void load();
  }, [load, runtime.loading, runtime.workspaceId]);

  const payment = bundle?.payment;
  const selectedInvoice = useMemo(() => bundle?.eligibleInvoices.find((invoice) => invoice.id === invoiceId) ?? null, [bundle?.eligibleInvoices, invoiceId]);
  const activeAllocations = useMemo(() => bundle?.allocations.filter((allocation) => allocation.allocation_type === "allocation" && !allocation.reversed) ?? [], [bundle?.allocations]);
  const canReversePayment = Boolean(payment && payment.status === "posted" && Math.abs(Number(payment.allocated_amount)) < 0.00005);

  async function allocate(event: FormEvent) {
    event.preventDefault();
    if (!payment || !selectedInvoice) return runtime.setError("Choose an outstanding Invoice.");
    const value = Number(amount);
    const limit = Math.min(Number(payment.unallocated_amount), Number(selectedInvoice.outstanding_amount));
    if (!(value > 0) || value > limit) return runtime.setError(`Allocation must be greater than zero and no more than ${formatMoney(limit, payment.currency)}.`);
    const result = await runtime.dispatch("payment-allocate", {
      id: crypto.randomUUID(),
      paymentId: payment.id,
      invoiceId: selectedInvoice.id,
      amount: value,
    });
    if (!result.ok) return;
    setAmount("");
    setInvoiceId("");
    if (!result.pending) await load();
  }

  async function reverseAllocation(event: FormEvent) {
    event.preventDefault();
    const allocation = activeAllocations.find((item) => item.id === allocationToReverse);
    if (!allocation) return runtime.setError("Choose the allocation to reverse.");
    if (allocationReason.trim().length < 5) return runtime.setError("Give a correction reason of at least 5 characters.");
    const result = await runtime.dispatch("allocation-reverse", {
      id: crypto.randomUUID(),
      allocationId: allocation.id,
      reason: allocationReason.trim(),
    });
    if (!result.ok) return;
    setAllocationToReverse(null);
    setAllocationReason("");
    if (!result.pending) await load();
  }

  async function reversePayment(event: FormEvent) {
    event.preventDefault();
    if (!payment || !canReversePayment) return runtime.setError("Reverse all active allocations before reversing this Payment.");
    if (paymentReason.trim().length < 5) return runtime.setError("Give a Payment reversal reason of at least 5 characters.");
    const result = await runtime.dispatch("payment-reverse", {
      paymentId: payment.id,
      reason: paymentReason.trim(),
    });
    if (!result.ok) return;
    setPaymentReason("");
    if (!result.pending) await load();
  }

  if ((loading || runtime.loading) && !payment) return <main className={styles.workspace}><div className={styles.emptyState}>Loading Payment…</div></main>;
  if (!payment || !bundle) return <main className={styles.workspace}><div className={styles.notice}><AlertTriangle size={17} /><div><strong>Payment could not be opened</strong><br />{error || runtime.error || "The requested Payment is unavailable."}</div></div><Link className={styles.secondaryLink} href="/accounts/payments"><ArrowLeft size={15} /> Back to Payments</Link></main>;

  return (
    <main className={styles.workspace}>
      <section className={styles.detailHeader}>
        <div className={styles.detailTitle}>
          <p className={styles.eyebrow}>Accounts · Payments</p>
          <h1>{payment.reference}</h1>
          <div className={styles.detailMeta}>{payment.customer_name_snapshot} · {formatDate(payment.received_at)} · <span className={styles.status} data-tone={tone(payment.status)}>{payment.status}</span></div>
        </div>
        <div className={styles.detailActions}><Link className={styles.secondaryLink} href="/accounts/payments"><ArrowLeft size={15} /> Register</Link><button className={styles.secondaryLink} type="button" onClick={() => void load()} disabled={loading || !runtime.online}><RefreshCw size={15} /> Refresh</button></div>
      </section>

      {cached ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Cached Payment workspace</strong><br />Showing the last verified detail. Any offline action remains Pending sync and will be validated on reconnection.</div></div> : null}
      {error ? <div className={styles.notice}><AlertTriangle size={17} /><div><strong>Refresh warning</strong><br />{error}</div></div> : null}
      {runtime.error ? <div className={styles.notice}><AlertTriangle size={17} /><div><strong>Payment action stopped</strong><br />{runtime.error}</div></div> : null}
      {runtime.notice ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Accounts queue</strong><br />{runtime.notice}</div></div> : null}

      <section className={styles.statGrid}>
        <article className={styles.statCard}><span>Payment amount</span><strong>{formatMoney(Number(payment.amount), payment.currency)}</strong><small>Original recorded money received</small></article>
        <article className={styles.statCard}><span>Allocated</span><strong>{formatMoney(Number(payment.allocated_amount), payment.currency)}</strong><small>Currently linked to Invoices</small></article>
        <article className={styles.statCard}><span>Unallocated</span><strong>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</strong><small>Customer credit still available</small></article>
        <article className={styles.statCard}><span>Status</span><strong>{payment.status}</strong><small>{runtime.pendingCount ? `${runtime.pendingCount} Accounts change${runtime.pendingCount === 1 ? "" : "s"} Pending sync` : "No local Payment changes waiting"}</small></article>
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}><h3>Customer</h3><div className={styles.kv}><div className={styles.kvRow}><span>Name</span><strong>{payment.customer_name_snapshot}</strong></div><div className={styles.kvRow}><span>Code</span><strong>{payment.customer_code_snapshot}</strong></div><div className={styles.kvRow}><span>Email</span><strong>{bundle.customer?.email || "—"}</strong></div><div className={styles.kvRow}><span>Phone</span><strong>{bundle.customer?.phone || "—"}</strong></div></div></article>
        <article className={styles.detailCard}><h3>Payment identity</h3><div className={styles.kv}><div className={styles.kvRow}><span>Received</span><strong>{formatDate(payment.received_at)}</strong></div><div className={styles.kvRow}><span>Method</span><strong>{payment.payment_method.replaceAll("_", " ")}</strong></div><div className={styles.kvRow}><span>External ref.</span><strong>{payment.external_reference || "—"}</strong></div><div className={styles.kvRow}><span>Currency</span><strong>{payment.currency}</strong></div></div>{payment.notes ? <p className={styles.muted}>{payment.notes}</p> : null}{payment.reversal_reason ? <div className={styles.inlineNotice}>Reversal: {payment.reversal_reason}</div> : null}</article>
      </section>

      <section className={styles.detailCard}>
        <h3><Link2 size={16} /> Allocation history</h3>
        <div className={styles.tableScroll}><table className={styles.lineTable}><thead><tr><th>Invoice</th><th>Event</th><th>Date</th><th>Reason</th><th className={styles.money}>Amount</th><th>Action</th></tr></thead><tbody>{bundle.allocations.map((allocation) => <tr key={allocation.id}><td><Link className={styles.quietLink} href={`/accounts/sales/invoices/${allocation.invoice_id}`}>{allocation.invoice_number}</Link></td><td>{allocation.allocation_type === "reversal" ? "Reversal" : allocation.reversed ? "Allocation · reversed" : "Allocation"}</td><td>{formatDate(allocation.occurred_at)}</td><td>{allocation.reason || "—"}</td><td className={styles.money}>{formatMoney(Number(allocation.amount_delta), payment.currency)}</td><td>{allocation.allocation_type === "allocation" && !allocation.reversed && payment.status === "posted" ? <button className={styles.secondaryLink} type="button" onClick={() => { setAllocationToReverse(allocation.id); setAllocationReason(""); }} disabled={runtime.supportReadOnly || Boolean(runtime.busy)}><Undo2 size={14} /> Reverse</button> : "—"}</td></tr>)}</tbody></table></div>
        {!bundle.allocations.length ? <span className={styles.muted}>This Payment has not been allocated yet.</span> : null}
        {allocationToReverse ? <form className={styles.filterPanel} onSubmit={reverseAllocation}><div className={styles.filters}><label><span>Allocation correction reason</span><input minLength={5} maxLength={500} required value={allocationReason} onChange={(event) => setAllocationReason(event.target.value)} placeholder="Why is this allocation being reversed?" /></label></div><div className={styles.filterActions}><button type="button" onClick={() => setAllocationToReverse(null)}>Cancel</button><button type="submit" disabled={Boolean(runtime.busy) || runtime.supportReadOnly}><Undo2 size={14} /> Reverse allocation</button></div></form> : null}
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}>
          <h3><Banknote size={16} /> Allocate Payment</h3>
          {payment.status !== "posted" ? <p className={styles.muted}>Reversed Payments cannot be allocated.</p> : Number(payment.unallocated_amount) <= 0 ? <p className={styles.muted}>This Payment is fully allocated.</p> : bundle.eligibleInvoices.length ? <form className={styles.filterPanel} onSubmit={allocate}><div className={styles.filters}><label><span>Outstanding Invoice</span><select value={invoiceId} required onChange={(event) => setInvoiceId(event.target.value)}><option value="">Choose Invoice…</option>{bundle.eligibleInvoices.map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.number} · {formatMoney(Number(invoice.outstanding_amount), invoice.currency)} outstanding</option>)}</select></label><label><span>Amount</span><input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div>{selectedInvoice ? <p className={styles.muted}>Maximum for this Invoice: {formatMoney(Math.min(Number(payment.unallocated_amount), Number(selectedInvoice.outstanding_amount)), payment.currency)}</p> : null}<div className={styles.filterActions}><button type="submit" disabled={Boolean(runtime.busy) || runtime.supportReadOnly}><Link2 size={14} /> Allocate</button></div></form> : <p className={styles.muted}>No outstanding Invoice for this Customer currently needs this Payment.</p>}
        </article>

        <article className={styles.detailCard}>
          <h3><RotateCcw size={16} /> Reverse Payment</h3>
          {payment.status !== "posted" ? <p className={styles.muted}>This Payment has already been reversed.</p> : !canReversePayment ? <p className={styles.muted}>Reverse every active Invoice allocation first. A Payment cannot disappear while its money is still linked to an Invoice.</p> : <form className={styles.noteForm} onSubmit={reversePayment}><label><span>Reversal reason</span><textarea minLength={5} maxLength={500} required value={paymentReason} onChange={(event) => setPaymentReason(event.target.value)} placeholder="Why is the Payment being reversed?" /></label><button className={styles.secondaryLink} type="submit" disabled={Boolean(runtime.busy) || runtime.supportReadOnly}><RotateCcw size={14} /> Reverse Payment</button></form>}
        </article>
      </section>
    </main>
  );
}

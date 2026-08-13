"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Banknote,
  CircleCheckBig,
  FileCheck2,
  Link2,
  RefreshCw,
  RotateCcw,
  Truck,
  TriangleAlert,
  WalletCards,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import {
  enqueueSupplierPayablesCommand,
  flushSupplierPayablesQueue,
  readSupplierPayablesQueue,
  removeSupplierPayablesCommand,
  type SupplierPayablesCommandAction,
  type SupplierPayablesQueuedCommand,
} from "@/lib/modules/supplier-payables-queue";
import styles from "./supplier-payables.module.css";

type Tab = "documents" | "payables" | "payments" | "suppliers";
type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";

type SupplierOption = {
  id: string;
  code: string;
  name: string;
  supplier_type: string;
  document_currency: string;
  status: string;
};

type SourceDocument = {
  id: string;
  supplier_id: string;
  supplier: { id: string; code: string; name: string } | null;
  document_type: "invoice" | "credit_note";
  document_number: string;
  document_date: string;
  due_date: string | null;
  currency: string;
  gross_amount: number;
  accounts_posting_status: "ready" | "posted" | "reversed";
  approved_at: string;
};

type Payable = {
  id: string;
  supplier_document_id: string;
  supplier_id: string;
  supplier_code_snapshot: string;
  supplier_name_snapshot: string;
  document_type: "invoice" | "credit_note";
  document_number_snapshot: string;
  document_date: string;
  due_date: string | null;
  currency: string;
  amount: number;
  status: "posted" | "reversed";
  posted_at: string;
  reversal_reason: string | null;
  allocated_payment_amount: number;
  allocated_credit_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  unallocated_credit: number;
  settlement_status: "unpaid" | "overdue" | "partially_paid" | "paid" | "credit_available" | "credit_used" | "reversed";
};

type SupplierPayment = {
  id: string;
  reference: string;
  supplier_id: string;
  supplier_code_snapshot: string;
  supplier_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: PaymentMethod;
  external_reference: string | null;
  notes: string | null;
  paid_at: string;
  status: "posted" | "reversed";
  reversal_reason: string | null;
  allocated_amount: number;
  unallocated_amount: number;
};

type PaymentAllocation = {
  id: string;
  supplier_payment_id: string;
  supplier_payable_id: string;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
};

type CreditAllocation = {
  id: string;
  credit_payable_id: string;
  invoice_payable_id: string;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
};

type SupplierBalance = {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  currency: string;
  posted_invoice_amount: number;
  payments_sent: number;
  allocated_payment_amount: number;
  allocated_credit_amount: number;
  outstanding_amount: number;
  unallocated_payment: number;
  supplier_credit_amount: number;
  unallocated_credit: number;
  net_balance: number;
  balance_status: "amount_due" | "supplier_credit" | "clear";
};

type Bundle = {
  workspaceId: string;
  settings: { currency: string; timezone: string };
  documents: SourceDocument[];
  payables: Payable[];
  payments: SupplierPayment[];
  paymentAllocations: PaymentAllocation[];
  creditAllocations: CreditAllocation[];
  supplierBalances: SupplierBalance[];
  suppliers: SupplierOption[];
};

type AllocationTarget =
  | { kind: "payment"; source: SupplierPayment }
  | { kind: "credit"; source: Payable }
  | null;

const emptyBundle: Bundle = {
  workspaceId: "",
  settings: { currency: "EUR", timezone: "UTC" },
  documents: [],
  payables: [],
  payments: [],
  paymentAllocations: [],
  creditAllocations: [],
  supplierBalances: [],
  suppliers: [],
};

const CACHE_PREFIX = "bdb-supplier-payables-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-supplier-payables-last-workspace-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readCache(workspaceId: string): Bundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as Bundle | null;
    return value && Array.isArray(value.payables) && Array.isArray(value.payments) ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeCache(bundle: Bundle) {
  if (typeof window === "undefined" || !bundle.workspaceId) return;
  window.localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}

function settlementTone(status: Payable["settlement_status"]): "neutral" | "gold" | "green" | "red" | "blue" {
  if (status === "paid" || status === "credit_used") return "green";
  if (status === "overdue") return "red";
  if (status === "partially_paid" || status === "credit_available") return "gold";
  if (status === "unpaid") return "blue";
  return "neutral";
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function SupplierPayablesPage() {
  const [bundle, setBundle] = useState<Bundle>(emptyBundle);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("documents");
  const [queue, setQueue] = useState<SupplierPayablesQueuedCommand[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState<AllocationTarget>(null);
  const [supplierId, setSupplierId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("EUR");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [paymentDate, setPaymentDate] = useState(localDateTime());
  const [externalReference, setExternalReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [allocationPayableId, setAllocationPayableId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");

  const refreshQueue = useCallback((workspaceId: string) => {
    setQueue(readSupplierPayablesQueue(workspaceId));
  }, []);

  const load = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const workspaceId = String(context.currentWorkspaceId);
    const response = await fetch(`/api/supplier-payables?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Supplier Payables could not be loaded.");
    const next = result.result as Bundle;
    setBundle(next);
    writeCache(next);
    refreshQueue(workspaceId);
    return next;
  }, [refreshQueue]);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = lastWorkspace ? readCache(lastWorkspace) : null;
      if (cached && active) {
        setBundle(cached);
        refreshQueue(cached.workspaceId);
      }
      try {
        if (!window.navigator.onLine) {
          setNotice(cached ? "Showing the cached Supplier Accounts workspace." : "Supplier Accounts needs one online load before it can reopen offline.");
          return;
        }
        await load();
      } catch (initialError) {
        if (!cached) setError(initialError instanceof Error ? initialError.message : "Supplier Payables could not be loaded.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [load, refreshQueue]);

  useEffect(() => {
    if (!online || !bundle.workspaceId || busy || queue.length === 0) return;
    void syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, bundle.workspaceId]);

  async function syncQueue() {
    if (!bundle.workspaceId || !online || busy) return;
    setBusy(true);
    setError("");
    try {
      const completed = await flushSupplierPayablesQueue(bundle.workspaceId);
      await load();
      if (completed) setNotice(`${completed} Supplier Accounts command${completed === 1 ? "" : "s"} synced.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Supplier Accounts synchronisation stopped on a conflict.");
      refreshQueue(bundle.workspaceId);
    } finally {
      setBusy(false);
    }
  }

  async function command(action: SupplierPayablesCommandAction, payload: Record<string, unknown>, queuedNotice: string) {
    if (!bundle.workspaceId || busy) return;
    enqueueSupplierPayablesCommand(bundle.workspaceId, action, payload);
    refreshQueue(bundle.workspaceId);
    if (!online) {
      setNotice(queuedNotice);
      return;
    }
    await syncQueue();
  }

  async function postDocument(document: SourceDocument) {
    await command("payable-post", {
      id: crypto.randomUUID(),
      supplierDocumentId: document.id,
    }, "Payable posting queued. It will be revalidated when connectivity returns.");
  }

  async function reversePayable(payable: Payable) {
    const reason = window.prompt("Reason for reversing this Supplier payable posting:", "Posted in error");
    if (!reason) return;
    await command("payable-reverse", { payableId: payable.id, reason }, "Payable reversal queued.");
  }

  async function reversePayment(payment: SupplierPayment) {
    const reason = window.prompt("Reason for reversing this Supplier Payment:", "Recorded in error");
    if (!reason) return;
    await command("payment-reverse", { paymentId: payment.id, reason }, "Supplier Payment reversal queued.");
  }

  async function reversePaymentAllocation(allocation: PaymentAllocation) {
    const reason = window.prompt("Reason for reversing this Supplier Payment allocation:", "Allocation corrected");
    if (!reason) return;
    await command("payment-allocation-reverse", {
      id: crypto.randomUUID(),
      allocationId: allocation.id,
      reason,
      occurredAt: new Date().toISOString(),
    }, "Payment allocation reversal queued.");
  }

  async function reverseCreditAllocation(allocation: CreditAllocation) {
    const reason = window.prompt("Reason for reversing this Supplier credit allocation:", "Allocation corrected");
    if (!reason) return;
    await command("credit-allocation-reverse", {
      id: crypto.randomUUID(),
      allocationId: allocation.id,
      reason,
      occurredAt: new Date().toISOString(),
    }, "Credit allocation reversal queued.");
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    await command("payment-record", {
      id: crypto.randomUUID(),
      supplierId,
      amount: Number(paymentAmount),
      currency: paymentCurrency,
      paymentMethod,
      paidAt: new Date(paymentDate).toISOString(),
      externalReference,
      notes: paymentNotes,
    }, "Supplier Payment queued. It will be revalidated when connectivity returns.");
    setPaymentOpen(false);
    setPaymentAmount("");
    setExternalReference("");
    setPaymentNotes("");
  }

  async function allocate(event: FormEvent) {
    event.preventDefault();
    if (!allocationTarget) return;
    if (allocationTarget.kind === "payment") {
      await command("payment-allocate", {
        id: crypto.randomUUID(),
        paymentId: allocationTarget.source.id,
        payableId: allocationPayableId,
        amount: Number(allocationAmount),
        occurredAt: new Date().toISOString(),
      }, "Supplier Payment allocation queued.");
    } else {
      await command("credit-allocate", {
        id: crypto.randomUUID(),
        creditPayableId: allocationTarget.source.id,
        invoicePayableId: allocationPayableId,
        amount: Number(allocationAmount),
        occurredAt: new Date().toISOString(),
      }, "Supplier credit allocation queued.");
    }
    setAllocationTarget(null);
    setAllocationPayableId("");
    setAllocationAmount("");
  }

  function openPayment() {
    const supplier = bundle.suppliers.find((item) => item.supplier_type === "product") ?? bundle.suppliers[0];
    setSupplierId(supplier?.id ?? "");
    setPaymentCurrency(supplier?.document_currency ?? bundle.settings.currency);
    setPaymentDate(localDateTime());
    setPaymentOpen(true);
  }

  function openAllocation(target: AllocationTarget) {
    setAllocationTarget(target);
    setAllocationPayableId("");
    setAllocationAmount("");
  }

  const readyDocuments = bundle.documents.filter((document) => document.accounts_posting_status === "ready" || document.accounts_posting_status === "reversed");
  const invoicePayables = bundle.payables.filter((payable) => payable.document_type === "invoice");
  const credits = bundle.payables.filter((payable) => payable.document_type === "credit_note");
  const outstandingDefaultCurrency = invoicePayables
    .filter((payable) => payable.status === "posted" && payable.currency === bundle.settings.currency)
    .reduce((total, payable) => total + Number(payable.outstanding_amount), 0);
  const supplierCreditDefaultCurrency = bundle.supplierBalances
    .filter((balance) => balance.currency === bundle.settings.currency)
    .reduce((total, balance) => total + Number(balance.unallocated_credit) + Number(balance.unallocated_payment), 0);

  const allocationCandidates = useMemo(() => {
    if (!allocationTarget) return [];
    const source = allocationTarget.source;
    return invoicePayables.filter((payable) => payable.status === "posted"
      && payable.outstanding_amount > 0
      && payable.supplier_id === source.supplier_id
      && payable.currency === source.currency);
  }, [allocationTarget, invoicePayables]);

  const reversedPaymentAllocationIds = new Set(bundle.paymentAllocations.filter((item) => item.reversal_of_id).map((item) => item.reversal_of_id));
  const reversedCreditAllocationIds = new Set(bundle.creditAllocations.filter((item) => item.reversal_of_id).map((item) => item.reversal_of_id));

  if (!loaded) return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Supplier Payables…</main>;

  return (
    <>
      <PageHeader
        eyebrow="Accounts Payable"
        title="Supplier Payables"
        description="Post approved Supplier documents, record immutable outgoing Payments and derive what is owed without turning Banking into the source of truth."
        action={(
          <div className={styles.headerActions}>
            <Link href="/accounts" className={styles.backLink}><ArrowLeft size={16} /> Customer Accounts</Link>
            <Button onClick={openPayment} disabled={busy || bundle.suppliers.length === 0}><Banknote size={16} /> Record Supplier Payment</Button>
          </div>
        )}
      />

      {!online ? <div className={styles.notice}><WifiOff size={18} /><div><strong>Working offline</strong><span>Commands remain in this browser and replay in order after reconnection.</span></div></div> : null}
      {error ? <div className={styles.error}><TriangleAlert size={18} /><div><strong>Supplier Accounts needs attention</strong><span>{error}</span></div></div> : null}
      {notice ? <div className={styles.notice}><CircleCheckBig size={18} /><div><strong>Supplier Accounts updated</strong><span>{notice}</span></div></div> : null}

      {queue.length ? (
        <Card className={styles.queueCard}>
          <div><strong>{queue.length} queued command{queue.length === 1 ? "" : "s"}</strong><p>Replay stops on the first conflict so later financial commands cannot overtake an unresolved command.</p></div>
          <div className={styles.queueActions}>
            <Button variant="secondary" onClick={() => void syncQueue()} disabled={!online || busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Retry sync</Button>
            {queue.map((item) => <Button key={item.id} variant="quiet" onClick={() => { removeSupplierPayablesCommand(bundle.workspaceId, item.id); refreshQueue(bundle.workspaceId); }} disabled={busy}>Discard {statusLabel(item.action)}</Button>)}
          </div>
        </Card>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Ready to post" value={String(readyDocuments.length)} detail="Approved Purchasing documents" icon={<FileCheck2 size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstandingDefaultCurrency, bundle.settings.currency)} detail={`Posted ${bundle.settings.currency} Supplier invoices`} icon={<Truck size={19} />} />
        <StatCard label="Unallocated credit" value={formatMoney(supplierCreditDefaultCurrency, bundle.settings.currency)} detail="Payments and credit notes" icon={<WalletCards size={19} />} />
        <StatCard label="Supplier accounts" value={String(bundle.supplierBalances.length)} detail="Supplier and currency combinations" icon={<Banknote size={19} />} />
      </div>

      <div className={styles.tabs}>
        {(["documents", "payables", "payments", "suppliers"] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? styles.activeTab : ""} onClick={() => setTab(item)}>{statusLabel(item)}</button>
        ))}
      </div>

      {tab === "documents" ? (
        <Card className={styles.panel}>
          <div className={styles.panelHeader}><div><p className="eyebrow">Purchasing boundary</p><h2>Approved documents ready for Accounts</h2></div><Badge tone={readyDocuments.length ? "gold" : "green"}>{readyDocuments.length} ready</Badge></div>
          <div className="table-scroll">
            <table className={styles.table}>
              <thead><tr><th>Supplier document</th><th>Supplier</th><th>Date</th><th>Amount</th><th>Accounts status</th><th /></tr></thead>
              <tbody>
                {bundle.documents.map((document) => (
                  <tr key={document.id}>
                    <td><strong>{document.document_number}</strong><small>{statusLabel(document.document_type)}</small></td>
                    <td><strong>{document.supplier?.name ?? "Supplier unavailable"}</strong><small>{document.supplier?.code ?? ""}</small></td>
                    <td><strong>{formatDate(document.document_date)}</strong><small>{document.due_date ? `Due ${formatDate(document.due_date)}` : "No due date"}</small></td>
                    <td><strong>{formatMoney(Number(document.gross_amount), document.currency)}</strong><small>{document.currency}</small></td>
                    <td><Badge tone={document.accounts_posting_status === "posted" ? "green" : document.accounts_posting_status === "ready" ? "gold" : "neutral"}>{statusLabel(document.accounts_posting_status)}</Badge></td>
                    <td>{document.accounts_posting_status !== "posted" ? <Button onClick={() => void postDocument(document)} disabled={busy || !online}><Link2 size={15} /> Post to Accounts</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!bundle.documents.length ? <div className={styles.empty}><FileCheck2 size={22} /><strong>No approved Supplier documents</strong><span>Approve a Supplier invoice or credit note in Purchasing first.</span></div> : null}
        </Card>
      ) : null}

      {tab === "payables" ? (
        <div className={styles.stack}>
          <Card className={styles.panel}>
            <div className={styles.panelHeader}><div><p className="eyebrow">Invoice ledger</p><h2>Supplier invoices</h2></div><Badge tone="neutral">{invoicePayables.length}</Badge></div>
            <div className="table-scroll"><table className={styles.table}><thead><tr><th>Invoice</th><th>Supplier</th><th>Due</th><th>Total</th><th>Allocated</th><th>Outstanding</th><th>Status</th><th /></tr></thead><tbody>
              {invoicePayables.map((payable) => <tr key={payable.id}><td><strong>{payable.document_number_snapshot}</strong><small>{formatDate(payable.document_date)}</small></td><td><strong>{payable.supplier_name_snapshot}</strong><small>{payable.supplier_code_snapshot}</small></td><td>{payable.due_date ? formatDate(payable.due_date) : "—"}</td><td>{formatMoney(Number(payable.amount), payable.currency)}</td><td>{formatMoney(Number(payable.allocated_amount), payable.currency)}</td><td>{formatMoney(Number(payable.outstanding_amount), payable.currency)}</td><td><Badge tone={settlementTone(payable.settlement_status)}>{statusLabel(payable.settlement_status)}</Badge></td><td>{payable.status === "posted" ? <Button variant="quiet" onClick={() => void reversePayable(payable)} disabled={busy || payable.allocated_amount !== 0}><RotateCcw size={14} /> Reverse</Button> : null}</td></tr>)}
            </tbody></table></div>
          </Card>
          <Card className={styles.panel}>
            <div className={styles.panelHeader}><div><p className="eyebrow">Supplier credit ledger</p><h2>Credit notes</h2></div><Badge tone="neutral">{credits.length}</Badge></div>
            <div className="table-scroll"><table className={styles.table}><thead><tr><th>Credit note</th><th>Supplier</th><th>Amount</th><th>Used</th><th>Available</th><th>Status</th><th /></tr></thead><tbody>
              {credits.map((credit) => <tr key={credit.id}><td><strong>{credit.document_number_snapshot}</strong><small>{formatDate(credit.document_date)}</small></td><td><strong>{credit.supplier_name_snapshot}</strong><small>{credit.supplier_code_snapshot}</small></td><td>{formatMoney(Number(credit.amount), credit.currency)}</td><td>{formatMoney(Number(credit.allocated_amount), credit.currency)}</td><td>{formatMoney(Number(credit.unallocated_credit), credit.currency)}</td><td><Badge tone={settlementTone(credit.settlement_status)}>{statusLabel(credit.settlement_status)}</Badge></td><td><div className={styles.rowActions}>{credit.status === "posted" && credit.unallocated_credit > 0 ? <Button variant="secondary" onClick={() => openAllocation({ kind: "credit", source: credit })}><Link2 size={14} /> Apply credit</Button> : null}{credit.status === "posted" ? <Button variant="quiet" onClick={() => void reversePayable(credit)} disabled={busy || credit.allocated_amount !== 0}><RotateCcw size={14} /> Reverse</Button> : null}</div></td></tr>)}
            </tbody></table></div>
          </Card>
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className={styles.stack}>
          <Card className={styles.panel}>
            <div className={styles.panelHeader}><div><p className="eyebrow">Outgoing money</p><h2>Supplier Payments</h2></div><Button onClick={openPayment}><Banknote size={15} /> Record Payment</Button></div>
            <div className="table-scroll"><table className={styles.table}><thead><tr><th>Payment</th><th>Supplier</th><th>Date</th><th>Amount</th><th>Allocated</th><th>Unallocated</th><th>Status</th><th /></tr></thead><tbody>
              {bundle.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.reference}</strong><small>{payment.external_reference || statusLabel(payment.payment_method)}</small></td><td><strong>{payment.supplier_name_snapshot}</strong><small>{payment.supplier_code_snapshot}</small></td><td>{formatDate(payment.paid_at)}</td><td>{formatMoney(Number(payment.amount), payment.currency)}</td><td>{formatMoney(Number(payment.allocated_amount), payment.currency)}</td><td>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</td><td><Badge tone={payment.status === "posted" ? "green" : "neutral"}>{payment.status}</Badge></td><td><div className={styles.rowActions}>{payment.status === "posted" && payment.unallocated_amount > 0 ? <Button variant="secondary" onClick={() => openAllocation({ kind: "payment", source: payment })}><Link2 size={14} /> Allocate</Button> : null}{payment.status === "posted" ? <Button variant="quiet" onClick={() => void reversePayment(payment)} disabled={busy || payment.allocated_amount !== 0}><RotateCcw size={14} /> Reverse</Button> : null}</div></td></tr>)}
            </tbody></table></div>
          </Card>
          <Card className={styles.panel}>
            <div className={styles.panelHeader}><div><p className="eyebrow">Append-only evidence</p><h2>Allocation history</h2></div></div>
            <div className="table-scroll"><table className={styles.table}><thead><tr><th>Type</th><th>Source</th><th>Target invoice</th><th>Amount</th><th>Date</th><th /></tr></thead><tbody>
              {bundle.paymentAllocations.map((allocation) => <tr key={allocation.id}><td><Badge tone={allocation.allocation_type === "allocation" ? "blue" : "gold"}>{statusLabel(allocation.allocation_type)}</Badge></td><td>{bundle.payments.find((item) => item.id === allocation.supplier_payment_id)?.reference ?? allocation.supplier_payment_id.slice(0, 8)}</td><td>{bundle.payables.find((item) => item.id === allocation.supplier_payable_id)?.document_number_snapshot ?? allocation.supplier_payable_id.slice(0, 8)}</td><td>{formatMoney(Number(allocation.amount_delta), bundle.payables.find((item) => item.id === allocation.supplier_payable_id)?.currency ?? bundle.settings.currency)}</td><td>{formatDate(allocation.occurred_at)}</td><td>{allocation.allocation_type === "allocation" && !reversedPaymentAllocationIds.has(allocation.id) ? <Button variant="quiet" onClick={() => void reversePaymentAllocation(allocation)}><RotateCcw size={14} /> Reverse</Button> : null}</td></tr>)}
              {bundle.creditAllocations.map((allocation) => <tr key={allocation.id}><td><Badge tone={allocation.allocation_type === "allocation" ? "blue" : "gold"}>credit {statusLabel(allocation.allocation_type)}</Badge></td><td>{bundle.payables.find((item) => item.id === allocation.credit_payable_id)?.document_number_snapshot ?? allocation.credit_payable_id.slice(0, 8)}</td><td>{bundle.payables.find((item) => item.id === allocation.invoice_payable_id)?.document_number_snapshot ?? allocation.invoice_payable_id.slice(0, 8)}</td><td>{formatMoney(Number(allocation.amount_delta), bundle.payables.find((item) => item.id === allocation.invoice_payable_id)?.currency ?? bundle.settings.currency)}</td><td>{formatDate(allocation.occurred_at)}</td><td>{allocation.allocation_type === "allocation" && !reversedCreditAllocationIds.has(allocation.id) ? <Button variant="quiet" onClick={() => void reverseCreditAllocation(allocation)}><RotateCcw size={14} /> Reverse</Button> : null}</td></tr>)}
            </tbody></table></div>
          </Card>
        </div>
      ) : null}

      {tab === "suppliers" ? (
        <Card className={styles.panel}>
          <div className={styles.panelHeader}><div><p className="eyebrow">Derived balance</p><h2>Supplier balances by currency</h2></div></div>
          <div className="table-scroll"><table className={styles.table}><thead><tr><th>Supplier</th><th>Currency</th><th>Invoices</th><th>Payments</th><th>Credits</th><th>Outstanding</th><th>Unallocated</th><th>Net balance</th><th>Status</th></tr></thead><tbody>
            {bundle.supplierBalances.map((balance) => <tr key={`${balance.supplier_id}:${balance.currency}`}><td><strong>{balance.supplier_name}</strong><small>{balance.supplier_code}</small></td><td>{balance.currency}</td><td>{formatMoney(Number(balance.posted_invoice_amount), balance.currency)}</td><td>{formatMoney(Number(balance.payments_sent), balance.currency)}</td><td>{formatMoney(Number(balance.supplier_credit_amount), balance.currency)}</td><td>{formatMoney(Number(balance.outstanding_amount), balance.currency)}</td><td>{formatMoney(Number(balance.unallocated_payment) + Number(balance.unallocated_credit), balance.currency)}</td><td><strong>{formatMoney(Number(balance.net_balance), balance.currency)}</strong></td><td><Badge tone={balance.balance_status === "amount_due" ? "gold" : balance.balance_status === "supplier_credit" ? "blue" : "green"}>{statusLabel(balance.balance_status)}</Badge></td></tr>)}
          </tbody></table></div>
        </Card>
      ) : null}

      <div className={styles.boundary}><WalletCards size={18} /><div><strong>Banking remains separate</strong><span>Recording a Supplier Payment does not create or reconcile a Bank transaction. Inventory receipt is also independent from Accounts posting.</span></div></div>

      <Dialog open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false); }} title="Record Supplier Payment" description="Record money paid. Allocation and Banking reconciliation remain separate.">
        <form onSubmit={recordPayment}>
          <div className={styles.formGrid}>
            <label>Supplier<select required value={supplierId} onChange={(event) => { const id = event.target.value; setSupplierId(id); const supplier = bundle.suppliers.find((item) => item.id === id); if (supplier) setPaymentCurrency(supplier.document_currency); }}>{bundle.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code}</option>)}</select></label>
            <label>Amount<input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
            <label>Currency<input required maxLength={3} value={paymentCurrency} onChange={(event) => setPaymentCurrency(event.target.value.toUpperCase())} /></label>
            <label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
            <label>Paid at<input required type="datetime-local" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
            <label>External reference<input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} /></label>
            <label className={styles.fullField}>Notes<textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></label>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !supplierId || !(Number(paymentAmount) > 0)}><Banknote size={15} /> Record Payment</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(allocationTarget)} onClose={() => { if (!busy) setAllocationTarget(null); }} title={allocationTarget?.kind === "credit" ? "Apply Supplier credit" : "Allocate Supplier Payment"} description="Allocation is append-only. Corrections create a linked reversal.">
        <form onSubmit={allocate}>
          <div className={styles.formGrid}>
            <label className={styles.fullField}>Target Supplier invoice<select required value={allocationPayableId} onChange={(event) => setAllocationPayableId(event.target.value)}><option value="">Select invoice</option>{allocationCandidates.map((payable) => <option key={payable.id} value={payable.id}>{payable.document_number_snapshot} · {formatMoney(Number(payable.outstanding_amount), payable.currency)}</option>)}</select></label>
            <label>Amount<input required type="number" min="0.01" step="0.01" value={allocationAmount} onChange={(event) => setAllocationAmount(event.target.value)} /></label>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setAllocationTarget(null)}>Cancel</Button><Button type="submit" disabled={busy || !allocationPayableId || !(Number(allocationAmount) > 0)}><Link2 size={15} /> Allocate</Button></div>
        </form>
      </Dialog>
    </>
  );
}

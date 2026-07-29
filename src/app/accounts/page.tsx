"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BadgePoundSterling,
  Banknote,
  CircleCheckBig,
  Clock3,
  FilePlus2,
  Link2,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading, StatCard } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import {
  enqueueAccountsCommand,
  flushAccountsQueue,
  readAccountsQueue,
  removeAccountsCommand,
  type AccountsCommandAction,
  type AccountsQueuedCommand,
} from "@/lib/modules/accounts-queue";
import styles from "./accounts.module.css";

type InvoiceDisplayStatus = "draft" | "sent" | "overdue" | "paid" | "void";
type InvoicePaymentStatus = "draft" | "unpaid" | "partially_paid" | "paid" | "void";
type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";
type Tab = "overview" | "invoices" | "payments" | "customers";

type CustomerOption = {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
};

type InvoiceLineRow = {
  id: string;
  line_number: number;
  line_type: "product" | "service" | "manual";
  source_sale_line_id: string | null;
  code_snapshot: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
};

type InvoiceRow = {
  id: string;
  number: string;
  customer_id: string;
  source_sale_id: string | null;
  issued_at: string;
  due_at: string;
  description: string;
  currency: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  notes: string | null;
  status: InvoiceDisplayStatus;
  version: number;
  sent_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  allocated_amount: number;
  outstanding_amount: number;
  payment_status: InvoicePaymentStatus;
  display_status: InvoiceDisplayStatus;
  invoice_lines: InvoiceLineRow[];
};

type PaymentRow = {
  id: string;
  reference: string;
  customer_id: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: PaymentMethod;
  external_reference: string | null;
  notes: string | null;
  received_at: string;
  status: "posted" | "reversed";
  version: number;
  reversal_reason: string | null;
  allocated_amount: number;
  unallocated_amount: number;
};

type AllocationRow = {
  id: string;
  payment_id: string;
  invoice_id: string;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
};

type CustomerBalance = {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  company: string | null;
  issued_amount: number;
  received_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  unallocated_credit: number;
  net_balance: number;
  balance_status: "amount_due" | "customer_credit" | "clear";
};

type SaleAccountRow = {
  sale_id: string;
  sale_reference: string;
  customer_id: string | null;
  currency: string;
  sale_total_amount: number;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  allocated_amount: number | null;
  outstanding_amount: number | null;
  account_status: "not_invoiced" | "invoiced" | "partially_paid" | "paid" | "invoice_void" | "reversed";
};

type AccountsBundle = {
  workspaceId: string;
  settings: {
    currency: string;
    invoice_prefix: string;
    vat_rate: number;
    timezone: string;
  };
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  allocations: AllocationRow[];
  customerBalances: CustomerBalance[];
  customers: CustomerOption[];
  sales: SaleAccountRow[];
};

type ManualLineDraft = {
  id: string;
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatRate: string;
};

type ReversalTarget = {
  kind: "invoice" | "payment" | "allocation";
  id: string;
  label: string;
} | null;

const emptyBundle: AccountsBundle = {
  workspaceId: "",
  settings: { currency: "EUR", invoice_prefix: "INV", vat_rate: 0, timezone: "UTC" },
  invoices: [],
  payments: [],
  allocations: [],
  customerBalances: [],
  customers: [],
  sales: [],
};

const CACHE_PREFIX = "bdb-accounts-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-accounts-last-workspace-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function readCachedBundle(workspaceId: string): AccountsBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as AccountsBundle | null;
    return value && Array.isArray(value.invoices) && Array.isArray(value.payments) ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeCachedBundle(bundle: AccountsBundle) {
  if (typeof window === "undefined" || !bundle.workspaceId) return;
  window.localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}

function blankLine(vatRate: number): ManualLineDraft {
  return {
    id: crypto.randomUUID(),
    code: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    discountAmount: "0",
    vatRate: String(vatRate),
  };
}

function lineTotal(line: ManualLineDraft) {
  const quantity = Number(line.quantity) || 0;
  const price = Number(line.unitPrice) || 0;
  const discount = Number(line.discountAmount) || 0;
  return Math.max(quantity * price - discount, 0);
}

function invoiceTone(status: InvoiceDisplayStatus): "neutral" | "gold" | "green" | "red" {
  if (status === "paid") return "green";
  if (status === "overdue") return "red";
  if (status === "sent") return "gold";
  return "neutral";
}

function methodLabel(method: PaymentMethod) {
  return method.replaceAll("_", " ");
}

export default function AccountsPage() {
  const [bundle, setBundle] = useState<AccountsBundle>(emptyBundle);
  const bundleRef = useRef(bundle);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<AccountsQueuedCommand[]>([]);
  const [query, setQuery] = useState("");

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRow | null>(null);
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [invoiceDueAt, setInvoiceDueAt] = useState(defaultDueDate());
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<ManualLineDraft[]>([]);

  const [saleInvoiceOpen, setSaleInvoiceOpen] = useState(false);
  const [saleId, setSaleId] = useState("");
  const [saleInvoiceDueAt, setSaleInvoiceDueAt] = useState(defaultDueDate());
  const [saleInvoiceNotes, setSaleInvoiceNotes] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [paymentReceivedAt, setPaymentReceivedAt] = useState(localDateTime());
  const [paymentExternalReference, setPaymentExternalReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentAllocationAmount, setPaymentAllocationAmount] = useState("");

  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationPaymentId, setAllocationPaymentId] = useState("");
  const [allocationInvoiceId, setAllocationInvoiceId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");

  const [reversal, setReversal] = useState<ReversalTarget>(null);
  const [reversalReason, setReversalReason] = useState("");

  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        throw new Error(context.error ?? "The current workspace could not be resolved.");
      }
      const workspaceId = String(context.currentWorkspaceId);
      const response = await fetch(`/api/accounts?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Accounts could not be loaded.");
      }
      const next = result.result as AccountsBundle;
      setBundle(next);
      bundleRef.current = next;
      writeCachedBundle(next);
      setQueue(readAccountsQueue(workspaceId));
      setSupportReadOnly(Boolean(context.supportAccess && context.supportAccessMode !== "test_write"));
      setNotice("");
    } catch (loadError) {
      const lastWorkspace = typeof window === "undefined"
        ? null
        : window.localStorage.getItem(LAST_WORKSPACE_KEY);
      const cached = lastWorkspace ? readCachedBundle(lastWorkspace) : null;
      if (cached) {
        setBundle(cached);
        bundleRef.current = cached;
        setQueue(readAccountsQueue(cached.workspaceId));
        setNotice("Showing the last verified Accounts snapshot. Financial commands remain queued until the server accepts them.");
      } else {
        setError(loadError instanceof Error ? loadError.message : "Accounts could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const currency = bundle.settings.currency || "EUR";
  const canWrite = Boolean(bundle.workspaceId) && !supportReadOnly;

  const outstandingTotal = useMemo(
    () => bundle.invoices.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount || 0), 0),
    [bundle.invoices],
  );
  const receivedTotal = useMemo(
    () => bundle.payments.filter((payment) => payment.status === "posted").reduce((sum, payment) => sum + Number(payment.amount), 0),
    [bundle.payments],
  );
  const unallocatedTotal = useMemo(
    () => bundle.payments.reduce((sum, payment) => sum + Number(payment.unallocated_amount || 0), 0),
    [bundle.payments],
  );
  const overdueCount = useMemo(
    () => bundle.invoices.filter((invoice) => invoice.display_status === "overdue").length,
    [bundle.invoices],
  );

  const activeAllocations = useMemo(() => {
    const reversed = new Set(
      bundle.allocations.filter((allocation) => allocation.reversal_of_id).map((allocation) => allocation.reversal_of_id as string),
    );
    return bundle.allocations.filter(
      (allocation) => allocation.allocation_type === "allocation" && !reversed.has(allocation.id),
    );
  }, [bundle.allocations]);

  const availableSales = useMemo(
    () => bundle.sales.filter((sale) => sale.customer_id && ["not_invoiced", "invoice_void"].includes(sale.account_status)),
    [bundle.sales],
  );

  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bundle.invoices;
    return bundle.invoices.filter((invoice) => [
      invoice.number,
      invoice.customer_name_snapshot,
      invoice.customer_code_snapshot,
      invoice.description,
      invoice.display_status,
    ].join(" ").toLowerCase().includes(needle));
  }, [bundle.invoices, query]);

  const filteredPayments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bundle.payments;
    return bundle.payments.filter((payment) => [
      payment.reference,
      payment.customer_name_snapshot,
      payment.payment_method,
      payment.external_reference,
      payment.status,
    ].join(" ").toLowerCase().includes(needle));
  }, [bundle.payments, query]);

  const paymentCustomerInvoices = useMemo(
    () => bundle.invoices.filter(
      (invoice) => invoice.customer_id === paymentCustomerId
        && !["draft", "void", "paid"].includes(invoice.display_status)
        && Number(invoice.outstanding_amount) > 0,
    ),
    [bundle.invoices, paymentCustomerId],
  );

  const selectedPayment = bundle.payments.find((payment) => payment.id === allocationPaymentId) ?? null;
  const allocationInvoices = useMemo(
    () => bundle.invoices.filter(
      (invoice) => invoice.customer_id === selectedPayment?.customer_id
        && invoice.currency === selectedPayment?.currency
        && !["draft", "void", "paid"].includes(invoice.display_status)
        && Number(invoice.outstanding_amount) > 0,
    ),
    [bundle.invoices, selectedPayment],
  );

  function refreshQueue(workspaceId = bundleRef.current.workspaceId) {
    if (workspaceId) setQueue(readAccountsQueue(workspaceId));
  }

  async function syncCommands(workspaceId = bundleRef.current.workspaceId) {
    if (!workspaceId || !navigator.onLine) return;
    setBusy("sync");
    const result = await flushAccountsQueue(workspaceId, () => refreshQueue(workspaceId));
    refreshQueue(workspaceId);
    setBusy("");
    if (result.remaining === 0) {
      setNotice(`${result.completed} financial command${result.completed === 1 ? "" : "s"} synchronised.`);
      await load();
    } else {
      const failed = readAccountsQueue(workspaceId)[0];
      setError(failed?.lastError ?? "Financial synchronisation stopped for review.");
    }
  }

  async function dispatch(action: AccountsCommandAction, payload: Record<string, unknown>) {
    if (!canWrite) {
      setError("This Accounts workspace is read-only for the current access mode.");
      return false;
    }
    const workspaceId = bundleRef.current.workspaceId;
    if (!workspaceId) return false;
    enqueueAccountsCommand(workspaceId, action, payload);
    refreshQueue(workspaceId);
    setNotice(navigator.onLine
      ? "Financial command queued for authoritative server validation."
      : "Financial command stored offline and will be revalidated after reconnection.");
    if (navigator.onLine) await syncCommands(workspaceId);
    return true;
  }

  function resetInvoiceForm() {
    setEditingInvoice(null);
    setInvoiceCustomerId(bundle.customers[0]?.id ?? "");
    setInvoiceDueAt(defaultDueDate());
    setInvoiceDescription("");
    setInvoiceNotes("");
    setInvoiceLines([blankLine(bundle.settings.vat_rate)]);
  }

  function openNewInvoice() {
    resetInvoiceForm();
    setInvoiceOpen(true);
  }

  function openEditInvoice(invoice: InvoiceRow) {
    setEditingInvoice(invoice);
    setInvoiceCustomerId(invoice.customer_id);
    setInvoiceDueAt(invoice.due_at);
    setInvoiceDescription(invoice.description);
    setInvoiceNotes(invoice.notes ?? "");
    setInvoiceLines(invoice.invoice_lines.map((line) => ({
      id: line.id,
      code: line.code_snapshot,
      description: line.description_snapshot,
      quantity: String(line.quantity),
      unitPrice: String(line.unit_price),
      discountAmount: String(line.discount_amount),
      vatRate: String(line.vat_rate),
    })));
    setInvoiceOpen(true);
  }

  async function saveInvoice(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("invoice");
    const payloadLines = invoiceLines.map((line) => ({
      id: line.id,
      code: line.code || null,
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountAmount: Number(line.discountAmount || 0),
      vatRate: Number(line.vatRate || 0),
    }));
    const accepted = await dispatch(
      editingInvoice ? "invoice-update" : "invoice-create-manual",
      editingInvoice
        ? {
            id: editingInvoice.id,
            expectedVersion: editingInvoice.version,
            dueAt: invoiceDueAt,
            description: invoiceDescription,
            notes: invoiceNotes,
            lines: editingInvoice.source_sale_id ? undefined : payloadLines,
          }
        : {
            id: crypto.randomUUID(),
            customerId: invoiceCustomerId,
            dueAt: invoiceDueAt,
            description: invoiceDescription,
            notes: invoiceNotes,
            lines: payloadLines,
          },
    );
    setBusy("");
    if (accepted) setInvoiceOpen(false);
  }

  async function createSaleInvoice(event: FormEvent) {
    event.preventDefault();
    if (busy || !saleId) return;
    setBusy("sale-invoice");
    const accepted = await dispatch("invoice-create-sale", {
      id: crypto.randomUUID(),
      saleId,
      dueAt: saleInvoiceDueAt,
      notes: saleInvoiceNotes,
    });
    setBusy("");
    if (accepted) setSaleInvoiceOpen(false);
  }

  async function issueInvoice(invoice: InvoiceRow) {
    if (busy) return;
    setBusy(invoice.id);
    await dispatch("invoice-issue", { id: invoice.id, expectedVersion: invoice.version });
    setBusy("");
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amount = Number(paymentAmount);
    const allocation = paymentInvoiceId && Number(paymentAllocationAmount) > 0
      ? [{ id: crypto.randomUUID(), invoiceId: paymentInvoiceId, amount: Number(paymentAllocationAmount) }]
      : [];
    setBusy("payment");
    const accepted = await dispatch("payment-record", {
      id: crypto.randomUUID(),
      customerId: paymentCustomerId,
      amount,
      paymentMethod,
      receivedAt: new Date(paymentReceivedAt).toISOString(),
      externalReference: paymentExternalReference,
      notes: paymentNotes,
      allocations: allocation,
    });
    setBusy("");
    if (accepted) setPaymentOpen(false);
  }

  function openAllocation(payment: PaymentRow) {
    setAllocationPaymentId(payment.id);
    const firstInvoice = bundle.invoices.find(
      (invoice) => invoice.customer_id === payment.customer_id
        && invoice.currency === payment.currency
        && Number(invoice.outstanding_amount) > 0
        && !["draft", "void", "paid"].includes(invoice.display_status),
    );
    setAllocationInvoiceId(firstInvoice?.id ?? "");
    setAllocationAmount(String(Math.min(Number(payment.unallocated_amount), Number(firstInvoice?.outstanding_amount ?? 0)) || ""));
    setAllocationOpen(true);
  }

  async function allocatePayment(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("allocation");
    const accepted = await dispatch("payment-allocate", {
      id: crypto.randomUUID(),
      paymentId: allocationPaymentId,
      invoiceId: allocationInvoiceId,
      amount: Number(allocationAmount),
      occurredAt: new Date().toISOString(),
    });
    setBusy("");
    if (accepted) setAllocationOpen(false);
  }

  async function submitReversal(event: FormEvent) {
    event.preventDefault();
    if (!reversal || busy) return;
    setBusy("reversal");
    const action: AccountsCommandAction = reversal.kind === "invoice"
      ? "invoice-void"
      : reversal.kind === "payment"
        ? "payment-reverse"
        : "allocation-reverse";
    const invoice = reversal.kind === "invoice"
      ? bundle.invoices.find((item) => item.id === reversal.id)
      : null;
    const payload = reversal.kind === "invoice"
      ? { id: reversal.id, expectedVersion: invoice?.version, reason: reversalReason }
      : reversal.kind === "payment"
        ? { paymentId: reversal.id, reason: reversalReason }
        : { id: crypto.randomUUID(), allocationId: reversal.id, reason: reversalReason, occurredAt: new Date().toISOString() };
    const accepted = await dispatch(action, payload);
    setBusy("");
    if (accepted) {
      setReversal(null);
      setReversalReason("");
    }
  }

  function discardCommand(commandId: string) {
    if (!bundle.workspaceId) return;
    removeAccountsCommand(bundle.workspaceId, commandId);
    refreshQueue();
  }

  const paymentInvoice = bundle.invoices.find((invoice) => invoice.id === paymentInvoiceId) ?? null;
  const allocationInvoice = bundle.invoices.find((invoice) => invoice.id === allocationInvoiceId) ?? null;
  const manualInvoiceTotal = invoiceLines.reduce((sum, line) => sum + lineTotal(line), 0);

  return (
    <>
      <PageHeader
        eyebrow="Finance workspace"
        title="Accounts"
        description="Issue invoices, record money received, allocate Payments and derive every customer balance from the ledger."
        action={(
          <div className={styles.toolbarActions}>
            <Button
              variant="secondary"
              disabled={!canWrite || bundle.customers.length === 0}
              onClick={() => {
                setPaymentCustomerId(bundle.customers[0]?.id ?? "");
                setPaymentAmount("");
                setPaymentMethod("card");
                setPaymentReceivedAt(localDateTime());
                setPaymentExternalReference("");
                setPaymentNotes("");
                setPaymentInvoiceId("");
                setPaymentAllocationAmount("");
                setPaymentOpen(true);
              }}
            >
              <Banknote size={17} /> Record Payment
            </Button>
            <Button disabled={!canWrite || bundle.customers.length === 0} onClick={openNewInvoice}>
              <Plus size={17} /> New invoice
            </Button>
          </div>
        )}
      />

      <div className={styles.tabs} role="tablist" aria-label="Accounts workspace sections">
        {(["overview", "invoices", "payments", "customers"] as const).map((item) => (
          <button key={item} role="tab" data-active={tab === item} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <StatCard label="Outstanding" value={formatMoney(outstandingTotal, currency)} detail="Issued invoices still due" icon={<Clock3 size={19} />} />
        <StatCard label="Received" value={formatMoney(receivedTotal, currency)} detail="Posted Payments, before Banking" icon={<CircleCheckBig size={19} />} />
        <StatCard label="Unallocated credit" value={formatMoney(unallocatedTotal, currency)} detail="Money received not yet assigned" icon={<Banknote size={19} />} />
        <StatCard label="Overdue" value={String(overdueCount)} detail="Derived from due dates and allocations" icon={<TriangleAlert size={19} />} />
      </div>

      <div className={styles.callout}>
        <strong>Finance boundary</strong>
        <span className={styles.muted}>Recording a Payment does not create or match a bank transaction. Banking reconciliation remains a separate controlled integration.</span>
      </div>

      {supportReadOnly ? (
        <div className={styles.callout}>
          <strong>Founder support is read-only</strong>
          <span className={styles.muted}>Use a guarded test-write support session for acceptance work. No financial command will be queued in this mode.</span>
        </div>
      ) : null}
      {notice ? <div className={styles.callout}><strong>Accounts status</strong><span className={styles.muted}>{notice}</span></div> : null}
      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Accounts needs attention</strong><p>{error}</p></div></div> : null}

      {queue.length > 0 ? (
        <div className={styles.queue}>
          <SectionHeading
            title={`${queue.length} queued financial command${queue.length === 1 ? "" : "s"}`}
            description="Commands replay in order and stop at the first server conflict."
            action={<Button variant="secondary" disabled={!online || busy === "sync"} onClick={() => void syncCommands()}><RefreshCw size={16} /> Synchronise</Button>}
          />
          {queue.map((command) => (
            <div className={styles.queueRow} key={command.id}>
              <div className={styles.queueMeta}>
                <strong>{command.action.replaceAll("-", " ")}</strong>
                <span className={styles.muted}>{formatDate(command.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{command.lastError ? ` · ${command.lastError}` : ""}</span>
              </div>
              <Button variant="quiet" onClick={() => discardCommand(command.id)}><X size={15} /> Discard</Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <input
          className="filter-input"
          placeholder="Search invoices, Payments or customers…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.toolbarActions}>
          <Badge tone={online ? "green" : "gold"}>{online ? "Online" : "Offline"}</Badge>
          <Button variant="quiet" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /> Refresh</Button>
        </div>
      </div>

      {loading && !bundle.workspaceId ? <Card><div className={styles.empty}>Loading Accounts…</div></Card> : null}

      {tab === "overview" ? (
        <div className={styles.stack}>
          <Card className="table-card">
            <SectionHeading
              title="Sales awaiting an invoice"
              description="A completed Sale remains commercially separate until Accounts creates and issues its invoice."
              action={availableSales.length > 0 && canWrite ? (
                <Button variant="secondary" onClick={() => {
                  setSaleId(availableSales[0]?.sale_id ?? "");
                  setSaleInvoiceDueAt(defaultDueDate());
                  setSaleInvoiceNotes("");
                  setSaleInvoiceOpen(true);
                }}><FilePlus2 size={16} /> Invoice a Sale</Button>
              ) : undefined}
            />
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Sale</th><th>Customer</th><th>Status</th><th className={styles.money}>Value</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {availableSales.slice(0, 12).map((sale) => {
                    const customer = bundle.customers.find((item) => item.id === sale.customer_id);
                    return (
                      <tr key={sale.sale_id}>
                        <td className={styles.referenceCell}><strong>{sale.sale_reference}</strong><span>{sale.account_status.replaceAll("_", " ")}</span></td>
                        <td>{customer?.name ?? "Customer unavailable"}</td>
                        <td><Badge tone="gold">Not invoiced</Badge></td>
                        <td className={styles.money}>{formatMoney(Number(sale.sale_total_amount), sale.currency)}</td>
                        <td><Button variant="quiet" disabled={!canWrite} onClick={() => {
                          setSaleId(sale.sale_id);
                          setSaleInvoiceDueAt(defaultDueDate());
                          setSaleInvoiceNotes("");
                          setSaleInvoiceOpen(true);
                        }}><Link2 size={15} /> Create draft</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {availableSales.length === 0 ? <div className={styles.empty}>No completed Sales are waiting for an active invoice.</div> : null}
          </Card>

          <Card className="table-card">
            <SectionHeading title="Customer balances" description="Outstanding invoices minus unallocated customer credit." />
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Customer</th><th className={styles.money}>Issued</th><th className={styles.money}>Received</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Credit</th><th className={styles.money}>Net balance</th></tr></thead>
                <tbody>
                  {bundle.customerBalances.slice(0, 12).map((customer) => (
                    <tr key={customer.customer_id}>
                      <td className={styles.customerCell}><strong>{customer.customer_name}</strong><span>{customer.customer_code}{customer.company ? ` · ${customer.company}` : ""}</span></td>
                      <td className={styles.money}>{formatMoney(Number(customer.issued_amount), currency)}</td>
                      <td className={styles.money}>{formatMoney(Number(customer.received_amount), currency)}</td>
                      <td className={styles.money}>{formatMoney(Number(customer.outstanding_amount), currency)}</td>
                      <td className={styles.money}>{formatMoney(Number(customer.unallocated_credit), currency)}</td>
                      <td className={`${styles.money} ${Number(customer.net_balance) > 0 ? styles.balancePositive : Number(customer.net_balance) < 0 ? styles.balanceCredit : ""}`}><strong>{formatMoney(Number(customer.net_balance), currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "invoices" ? (
        <Card className="table-card">
          <SectionHeading
            title="Invoices"
            description="Drafts are editable. Issued invoices are immutable and corrected through allocation reversals or voiding."
            action={<Button disabled={!canWrite || bundle.customers.length === 0} onClick={openNewInvoice}><Plus size={16} /> Manual invoice</Button>}
          />
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Status</th><th className={styles.money}>Total</th><th className={styles.money}>Allocated</th><th className={styles.money}>Outstanding</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className={styles.referenceCell}><strong>{invoice.number}</strong><span>{invoice.source_sale_id ? "From completed Sale" : invoice.description}</span></td>
                    <td className={styles.customerCell}><strong>{invoice.customer_name_snapshot}</strong><span>{invoice.customer_code_snapshot}</span></td>
                    <td>{formatDate(`${invoice.due_at}T00:00:00Z`)}</td>
                    <td><Badge tone={invoiceTone(invoice.display_status)}>{invoice.payment_status.replaceAll("_", " ")}</Badge></td>
                    <td className={styles.money}>{formatMoney(Number(invoice.total_amount), invoice.currency)}</td>
                    <td className={styles.money}>{formatMoney(Number(invoice.allocated_amount), invoice.currency)}</td>
                    <td className={styles.money}><strong>{formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</strong></td>
                    <td>
                      <div className={styles.rowActions}>
                        {invoice.display_status === "draft" ? <Button variant="quiet" disabled={!canWrite || Boolean(busy)} onClick={() => openEditInvoice(invoice)}>Edit</Button> : null}
                        {invoice.display_status === "draft" ? <Button variant="secondary" disabled={!canWrite || Boolean(busy)} onClick={() => void issueInvoice(invoice)}>Issue</Button> : null}
                        {["draft", "sent", "overdue"].includes(invoice.display_status) ? <Button variant="quiet" disabled={!canWrite || Boolean(busy)} onClick={() => { setReversal({ kind: "invoice", id: invoice.id, label: invoice.number }); setReversalReason(""); }}>Void</Button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredInvoices.length === 0 ? <div className={styles.empty}>No invoices match the current search.</div> : null}
        </Card>
      ) : null}

      {tab === "payments" ? (
        <div className={styles.stack}>
          <Card className="table-card">
            <SectionHeading
              title="Payments received"
              description="A Payment is money received. It only reduces an invoice after allocation."
              action={<Button disabled={!canWrite || bundle.customers.length === 0} onClick={() => {
                setPaymentCustomerId(bundle.customers[0]?.id ?? "");
                setPaymentAmount("");
                setPaymentMethod("card");
                setPaymentReceivedAt(localDateTime());
                setPaymentExternalReference("");
                setPaymentNotes("");
                setPaymentInvoiceId("");
                setPaymentAllocationAmount("");
                setPaymentOpen(true);
              }}><Plus size={16} /> Record Payment</Button>}
            />
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Payment</th><th>Customer</th><th>Method</th><th>Status</th><th className={styles.money}>Amount</th><th className={styles.money}>Allocated</th><th className={styles.money}>Unallocated</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {filteredPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td className={styles.referenceCell}><strong>{payment.reference}</strong><span>{formatDate(payment.received_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></td>
                      <td>{payment.customer_name_snapshot}</td>
                      <td>{methodLabel(payment.payment_method)}</td>
                      <td><Badge tone={payment.status === "posted" ? "green" : "neutral"}>{payment.status}</Badge></td>
                      <td className={styles.money}>{formatMoney(Number(payment.amount), payment.currency)}</td>
                      <td className={styles.money}>{formatMoney(Number(payment.allocated_amount), payment.currency)}</td>
                      <td className={styles.money}><strong>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</strong></td>
                      <td><div className={styles.rowActions}>
                        {payment.status === "posted" && Number(payment.unallocated_amount) > 0 ? <Button variant="quiet" disabled={!canWrite || Boolean(busy)} onClick={() => openAllocation(payment)}>Allocate</Button> : null}
                        {payment.status === "posted" && Number(payment.allocated_amount) === 0 ? <Button variant="quiet" disabled={!canWrite || Boolean(busy)} onClick={() => { setReversal({ kind: "payment", id: payment.id, label: payment.reference }); setReversalReason(""); }}><RotateCcw size={15} /> Reverse</Button> : null}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredPayments.length === 0 ? <div className={styles.empty}>No Payments match the current search.</div> : null}
          </Card>

          <Card className="table-card">
            <SectionHeading title="Active allocations" description="Allocations are append-only. Corrections create a linked negative reversal." />
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Payment</th><th>Invoice</th><th>Date</th><th className={styles.money}>Amount</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {activeAllocations.map((allocation) => {
                    const payment = bundle.payments.find((item) => item.id === allocation.payment_id);
                    const invoice = bundle.invoices.find((item) => item.id === allocation.invoice_id);
                    return (
                      <tr key={allocation.id}>
                        <td>{payment?.reference ?? allocation.payment_id}</td>
                        <td>{invoice?.number ?? allocation.invoice_id}</td>
                        <td>{formatDate(allocation.occurred_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                        <td className={styles.money}>{formatMoney(Number(allocation.amount_delta), payment?.currency ?? currency)}</td>
                        <td><Button variant="quiet" disabled={!canWrite || Boolean(busy) || payment?.status !== "posted"} onClick={() => { setReversal({ kind: "allocation", id: allocation.id, label: `${payment?.reference ?? "Payment"} → ${invoice?.number ?? "Invoice"}` }); setReversalReason(""); }}><RotateCcw size={15} /> Reverse</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {activeAllocations.length === 0 ? <div className={styles.empty}>No active Payment allocations.</div> : null}
          </Card>
        </div>
      ) : null}

      {tab === "customers" ? (
        <Card className="table-card">
          <SectionHeading title="Customer account balances" description="Balances are calculated from issued invoices and posted Payment allocations." />
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th>Customer</th><th>Status</th><th className={styles.money}>Issued</th><th className={styles.money}>Payments</th><th className={styles.money}>Allocated</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Unallocated credit</th><th className={styles.money}>Net balance</th></tr></thead>
              <tbody>
                {bundle.customerBalances.map((customer) => (
                  <tr key={customer.customer_id}>
                    <td className={styles.customerCell}><strong>{customer.customer_name}</strong><span>{customer.customer_code}{customer.company ? ` · ${customer.company}` : ""}</span></td>
                    <td><Badge tone={customer.balance_status === "amount_due" ? "gold" : customer.balance_status === "customer_credit" ? "green" : "neutral"}>{customer.balance_status.replaceAll("_", " ")}</Badge></td>
                    <td className={styles.money}>{formatMoney(Number(customer.issued_amount), currency)}</td>
                    <td className={styles.money}>{formatMoney(Number(customer.received_amount), currency)}</td>
                    <td className={styles.money}>{formatMoney(Number(customer.allocated_amount), currency)}</td>
                    <td className={styles.money}>{formatMoney(Number(customer.outstanding_amount), currency)}</td>
                    <td className={styles.money}>{formatMoney(Number(customer.unallocated_credit), currency)}</td>
                    <td className={`${styles.money} ${Number(customer.net_balance) > 0 ? styles.balancePositive : Number(customer.net_balance) < 0 ? styles.balanceCredit : ""}`}><strong>{formatMoney(Number(customer.net_balance), currency)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bundle.customerBalances.length === 0 ? <div className={styles.empty}>No Customer account balances are available.</div> : null}
        </Card>
      ) : null}

      <Dialog
        open={invoiceOpen}
        onClose={() => { if (!busy) setInvoiceOpen(false); }}
        title={editingInvoice ? `Edit ${editingInvoice.number}` : "Create manual invoice"}
        description={editingInvoice?.source_sale_id ? "Sale-derived lines are fixed. Only the due date, description and notes can be reviewed." : "Build the draft from explicit VAT-inclusive lines, then issue it separately."}
      >
        <form onSubmit={saveInvoice}>
          <div className={styles.formGrid}>
            <div className="field"><label htmlFor="invoice-customer">Customer</label><select id="invoice-customer" required disabled={Boolean(editingInvoice)} value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.code}</option>)}</select></div>
            <div className="field"><label htmlFor="invoice-due">Due date</label><input id="invoice-due" required type="date" value={invoiceDueAt} onChange={(event) => setInvoiceDueAt(event.target.value)} /></div>
            <div className={`field ${styles.full}`}><label htmlFor="invoice-description">Description</label><input id="invoice-description" required value={invoiceDescription} onChange={(event) => setInvoiceDescription(event.target.value)} /></div>
            <div className={`field ${styles.full}`}><label htmlFor="invoice-notes">Notes</label><textarea id="invoice-notes" value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} /></div>
          </div>

          {!editingInvoice?.source_sale_id ? (
            <div className={styles.lineEditor}>
              <SectionHeading title="Invoice lines" description={`Draft total: ${formatMoney(manualInvoiceTotal, currency)}`} action={<Button type="button" variant="secondary" onClick={() => setInvoiceLines((lines) => [...lines, blankLine(bundle.settings.vat_rate)])}><Plus size={15} /> Add line</Button>} />
              {invoiceLines.map((line, index) => (
                <div className={styles.lineRow} key={line.id}>
                  <label>Description<input required value={line.description} onChange={(event) => setInvoiceLines((lines) => lines.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item))} /></label>
                  <label>Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => setInvoiceLines((lines) => lines.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item))} /></label>
                  <label>Unit price<input required min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => setInvoiceLines((lines) => lines.map((item) => item.id === line.id ? { ...item, unitPrice: event.target.value } : item))} /></label>
                  <label>Discount<input required min="0" step="0.01" type="number" value={line.discountAmount} onChange={(event) => setInvoiceLines((lines) => lines.map((item) => item.id === line.id ? { ...item, discountAmount: event.target.value } : item))} /></label>
                  <label>VAT %<input required min="0" max="100" step="0.01" type="number" value={line.vatRate} onChange={(event) => setInvoiceLines((lines) => lines.map((item) => item.id === line.id ? { ...item, vatRate: event.target.value } : item))} /></label>
                  <Button type="button" variant="quiet" disabled={invoiceLines.length === 1} onClick={() => setInvoiceLines((lines) => lines.filter((item) => item.id !== line.id))}><X size={15} /> {index + 1}</Button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.callout}><strong>{editingInvoice.invoice_lines.length} Sale line{editingInvoice.invoice_lines.length === 1 ? "" : "s"}</strong><span className={styles.muted}>The commercial snapshots are fixed and cannot be edited from Accounts.</span></div>
          )}
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => setInvoiceOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>{busy === "invoice" ? "Saving…" : "Save draft"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={saleInvoiceOpen} onClose={() => { if (!busy) setSaleInvoiceOpen(false); }} title="Create invoice from Sale" description="The Sale lines and values are copied into a reviewable invoice draft. No Payment is implied.">
        <form onSubmit={createSaleInvoice}>
          <div className={styles.formGrid}>
            <div className={`field ${styles.full}`}><label htmlFor="sale-invoice-sale">Completed Sale</label><select id="sale-invoice-sale" required value={saleId} onChange={(event) => setSaleId(event.target.value)}>{availableSales.map((sale) => <option key={sale.sale_id} value={sale.sale_id}>{sale.sale_reference} · {formatMoney(Number(sale.sale_total_amount), sale.currency)}</option>)}</select></div>
            <div className="field"><label htmlFor="sale-invoice-due">Due date</label><input id="sale-invoice-due" required type="date" value={saleInvoiceDueAt} onChange={(event) => setSaleInvoiceDueAt(event.target.value)} /></div>
            <div className={`field ${styles.full}`}><label htmlFor="sale-invoice-notes">Notes</label><textarea id="sale-invoice-notes" value={saleInvoiceNotes} onChange={(event) => setSaleInvoiceNotes(event.target.value)} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => setSaleInvoiceOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || !saleId}>{busy === "sale-invoice" ? "Creating…" : "Create draft"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false); }} title="Record Payment" description="Record the money received first. Allocation to an issued invoice is optional and may be partial.">
        <form onSubmit={recordPayment}>
          <div className={styles.formGrid}>
            <div className={`field ${styles.full}`}><label htmlFor="payment-customer">Customer</label><select id="payment-customer" required value={paymentCustomerId} onChange={(event) => { setPaymentCustomerId(event.target.value); setPaymentInvoiceId(""); setPaymentAllocationAmount(""); }}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.code}</option>)}</select></div>
            <div className="field"><label htmlFor="payment-amount">Amount</label><input id="payment-amount" required min="0.01" step="0.01" type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div>
            <div className="field"><label htmlFor="payment-method">Method</label><select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div>
            <div className="field"><label htmlFor="payment-date">Received at</label><input id="payment-date" required type="datetime-local" value={paymentReceivedAt} onChange={(event) => setPaymentReceivedAt(event.target.value)} /></div>
            <div className="field"><label htmlFor="payment-reference">External reference</label><input id="payment-reference" value={paymentExternalReference} onChange={(event) => setPaymentExternalReference(event.target.value)} /></div>
            <div className={`field ${styles.full}`}><label htmlFor="payment-notes">Notes</label><textarea id="payment-notes" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></div>
            <div className={`field ${styles.full}`}><label htmlFor="payment-invoice">Allocate immediately (optional)</label><select id="payment-invoice" value={paymentInvoiceId} onChange={(event) => { const nextId = event.target.value; const invoice = paymentCustomerInvoices.find((item) => item.id === nextId); setPaymentInvoiceId(nextId); setPaymentAllocationAmount(nextId ? String(Math.min(Number(paymentAmount) || 0, Number(invoice?.outstanding_amount ?? 0))) : ""); }}><option value="">Leave unallocated</option>{paymentCustomerInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · due {formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</option>)}</select></div>
            {paymentInvoiceId ? <div className="field"><label htmlFor="payment-allocation">Allocation amount</label><input id="payment-allocation" required min="0.01" max={Math.min(Number(paymentAmount) || 0, Number(paymentInvoice?.outstanding_amount ?? 0))} step="0.01" type="number" value={paymentAllocationAmount} onChange={(event) => setPaymentAllocationAmount(event.target.value)} /></div> : null}
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => setPaymentOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>{busy === "payment" ? "Recording…" : "Record Payment"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={allocationOpen} onClose={() => { if (!busy) setAllocationOpen(false); }} title="Allocate Payment" description={selectedPayment ? `${selectedPayment.reference} has ${formatMoney(Number(selectedPayment.unallocated_amount), selectedPayment.currency)} unallocated.` : undefined}>
        <form onSubmit={allocatePayment}>
          <div className={styles.formGrid}>
            <div className={`field ${styles.full}`}><label htmlFor="allocation-invoice">Issued invoice</label><select id="allocation-invoice" required value={allocationInvoiceId} onChange={(event) => { const nextId = event.target.value; const invoice = allocationInvoices.find((item) => item.id === nextId); setAllocationInvoiceId(nextId); setAllocationAmount(String(Math.min(Number(selectedPayment?.unallocated_amount ?? 0), Number(invoice?.outstanding_amount ?? 0)))); }}>{allocationInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · due {formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</option>)}</select></div>
            <div className="field"><label htmlFor="allocation-amount">Amount</label><input id="allocation-amount" required min="0.01" max={Math.min(Number(selectedPayment?.unallocated_amount ?? 0), Number(allocationInvoice?.outstanding_amount ?? 0))} step="0.01" type="number" value={allocationAmount} onChange={(event) => setAllocationAmount(event.target.value)} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => setAllocationOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || !allocationInvoiceId}>{busy === "allocation" ? "Allocating…" : "Allocate"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(reversal)} onClose={() => { if (!busy) setReversal(null); }} title={reversal?.kind === "invoice" ? "Void invoice" : reversal?.kind === "payment" ? "Reverse Payment" : "Reverse allocation"} description={reversal ? `${reversal.label} will remain visible in the immutable history.` : undefined}>
        <form onSubmit={submitReversal}>
          <div className="field"><label htmlFor="reversal-reason">Reason</label><textarea id="reversal-reason" required minLength={5} maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => setReversal(null)}>Cancel</Button><Button type="submit" variant="danger" disabled={Boolean(busy)}>{busy === "reversal" ? "Saving…" : "Confirm correction"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

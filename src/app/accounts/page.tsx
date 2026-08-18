"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Banknote,
  Download,
  FileMinus2,
  FileText,
  Mail,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Settings2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-pricing";
import {
  enqueueAccountsCommand,
  flushAccountsQueue,
  readAccountsQueue,
  type AccountsCommandAction,
  type AccountsQueuedCommand,
} from "@/lib/modules/accounts-queue";
import styles from "./accounts.module.css";

type Tab = "documents" | "payments" | "customers";
type DocumentType = "invoice" | "credit_note" | "delivery_note";
type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";
type LineType = "product" | "service" | "manual";

type Customer = { id: string; code: string; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; vat_number: string | null };
type Product = { id: string; sku: string; name: string; selling_price: number | null; vat_rate: number; purpose: string };
type Service = { id: string; code: string; name: string; price: number | null; vat_rate: number };
type InvoiceLine = { id: string; line_number: number; line_type: LineType; product_id: string | null; service_id: string | null; code_snapshot: string; description_snapshot: string; quantity: number; unit_price: number; discount_amount: number; vat_rate: number; total_amount: number };
type Invoice = { id: string; number: string; customer_id: string; source_sale_id: string | null; issued_at: string; due_at: string | null; description: string; notes: string | null; currency: string; status: string; display_status: string; payment_status: string; total_amount: number; adjusted_total_amount: number; credited_amount: number; allocated_amount: number; outstanding_amount: number; version: number; invoice_lines: InvoiceLine[] };
type CreditNoteLine = { id: string; source_invoice_line_id: string | null; line_number: number; code_snapshot: string; description_snapshot: string; quantity: number; total_amount: number };
type CreditNote = { id: string; number: string; invoice_id: string; customer_id: string; currency: string; reason: string; status: "draft" | "issued"; total_amount: number; version: number; issued_at: string | null; created_at: string; credit_note_lines: CreditNoteLine[] };
type DeliveryNoteLine = { id: string; source_invoice_line_id: string | null; source_sale_line_id: string | null; code_snapshot: string; description_snapshot: string; quantity: number };
type DeliveryNote = { id: string; number: string; source_invoice_id: string | null; source_sale_id: string | null; customer_id: string; customer_name_snapshot: string; delivery_address: string | null; delivery_date: string; status: "draft" | "issued"; version: number; created_at: string; delivery_note_lines: DeliveryNoteLine[] };
type Payment = { id: string; reference: string; customer_id: string; customer_name_snapshot: string; currency: string; amount: number; payment_method: PaymentMethod; external_reference: string | null; received_at: string; status: "posted" | "reversed"; version: number; allocated_amount: number; unallocated_amount: number };
type CustomerBalance = { customer_id: string; customer_code: string; customer_name: string; company: string | null; outstanding_amount: number; unallocated_credit: number; net_balance: number; balance_status: "amount_due" | "customer_credit" | "clear" };
type DocumentIndex = { workspace_id: string; document_type: DocumentType; id: string; number: string; customer_id: string; customer_name: string; document_date: string; status: string; currency: string | null; total_amount: number | null; balance_amount: number | null; source_invoice_id: string | null; source_sale_id: string | null; reason: string | null };
type SaleSource = { id: string; reference: string; customer_id: string; total_amount: number; sale_lines: Array<{ id: string; code_snapshot: string; description_snapshot: string; quantity: number }> };

type AccountsBundle = {
  workspaceId: string;
  settings: { currency: string; invoice_prefix: string; vat_rate: number; timezone: string; business_address: string | null; vat_number: string | null; company_registration_number: string | null; credit_note_prefix: string; delivery_note_prefix: string; payment_terms_days: number; document_footer: string | null };
  invoices: Invoice[];
  payments: Payment[];
  customerBalances: CustomerBalance[];
  customers: Customer[];
  products: Product[];
  services: Service[];
  creditNotes: CreditNote[];
  deliveryNotes: DeliveryNote[];
  documents: DocumentIndex[];
};

type DraftLine = { id: string; lineType: LineType; sourceId: string; description: string; quantity: string; unitPrice: string; discountAmount: string; vatRate: string };
type CreditDraftLine = { id: string; sourceInvoiceLineId: string; description: string; selected: boolean; quantity: string };
type DeliveryDraftLine = { id: string; sourceLineId: string; description: string; selected: boolean; quantity: string };

const emptyBundle: AccountsBundle = {
  workspaceId: "",
  settings: { currency: "EUR", invoice_prefix: "INV", vat_rate: 0, timezone: "Europe/Malta", business_address: null, vat_number: null, company_registration_number: null, credit_note_prefix: "CN", delivery_note_prefix: "DN", payment_terms_days: 14, document_footer: null },
  invoices: [], payments: [], customerBalances: [], customers: [], products: [], services: [], creditNotes: [], deliveryNotes: [], documents: [],
};
const CACHE_PREFIX = "bdb-accounts-cache-v2";
const LAST_WORKSPACE_KEY = "bdb-accounts-last-workspace-v2";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function draftLine(vat = 0): DraftLine {
  return { id: crypto.randomUUID(), lineType: "manual", sourceId: "", description: "", quantity: "1", unitPrice: "", discountAmount: "0", vatRate: String(vat) };
}
function documentLabel(type: DocumentType) {
  return type === "invoice" ? "Invoice" : type === "credit_note" ? "Credit Note" : "Delivery Note";
}
function readCache(workspaceId: string): AccountsBundle | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(workspaceId)) ?? "null") as AccountsBundle | null;
    return parsed?.workspaceId === workspaceId ? parsed : null;
  } catch { return null; }
}
function writeCache(bundle: AccountsBundle) {
  localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle));
  localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}
function businessDocumentUrl(workspaceId: string, type: DocumentType, id: string, format: "html" | "pdf", print = false) {
  const params = new URLSearchParams({ workspaceId, type, id, format });
  if (print) params.set("print", "1");
  return `/api/business-documents/render?${params.toString()}`;
}

export default function AccountsPage() {
  const [bundle, setBundle] = useState<AccountsBundle>(emptyBundle);
  const bundleRef = useRef(bundle);
  const [tab, setTab] = useState<Tab>("documents");
  const [filter, setFilter] = useState<"all" | DocumentType>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<AccountsQueuedCommand[]>([]);

  const [newMenu, setNewMenu] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<DraftLine[]>([]);

  const [creditOpen, setCreditOpen] = useState(false);
  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditLines, setCreditLines] = useState<CreditDraftLine[]>([]);
  const [legacyCreditAmount, setLegacyCreditAmount] = useState("");

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliverySourceType, setDeliverySourceType] = useState<"invoice" | "sale">("invoice");
  const [deliverySourceId, setDeliverySourceId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(isoDate());
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryLines, setDeliveryLines] = useState<DeliveryDraftLine[]>([]);
  const [saleSources, setSaleSources] = useState<SaleSource[]>([]);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [paymentReceivedAt, setPaymentReceivedAt] = useState(localDateTime());
  const [paymentReference, setPaymentReference] = useState("");

  const [identityOpen, setIdentityOpen] = useState(false);
  const [identity, setIdentity] = useState({ businessAddress: "", vatNumber: "", companyRegistrationNumber: "", creditNotePrefix: "CN", deliveryNotePrefix: "DN", paymentTermsDays: "14", documentFooter: "" });

  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const refreshQueue = useCallback((workspaceId = bundleRef.current.workspaceId) => {
    if (workspaceId) setQueue(readAccountsQueue(workspaceId));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
      const workspaceId = String(context.currentWorkspaceId);
      const response = await fetch(`/api/accounts?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error ?? "Accounts could not be loaded.");
      const next = json.result as AccountsBundle;
      setBundle(next); bundleRef.current = next; writeCache(next); refreshQueue(workspaceId);
      setSupportReadOnly(Boolean(context.supportAccess && context.supportAccessMode !== "test_write"));
    } catch (loadError) {
      const last = localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = last ? readCache(last) : null;
      if (cached) {
        setBundle(cached); bundleRef.current = cached; refreshQueue(cached.workspaceId);
        setNotice("Showing the last verified Accounts snapshot. Draft changes can remain queued until reconnection.");
      } else setError(loadError instanceof Error ? loadError.message : "Accounts could not be loaded.");
    } finally { setLoading(false); }
  }, [refreshQueue]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!online || !bundle.workspaceId || queue.length === 0) return;
    const timer = window.setTimeout(async () => {
      const result = await flushAccountsQueue(bundle.workspaceId, () => refreshQueue(bundle.workspaceId));
      refreshQueue(bundle.workspaceId);
      if (result.completed) { setNotice(`${result.completed} queued Accounts change${result.completed === 1 ? "" : "s"} synchronised.`); await load(); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [bundle.workspaceId, load, online, queue.length, refreshQueue]);

  async function dispatch(action: AccountsCommandAction, payload: Record<string, unknown>, requiresOnline = false) {
    if (supportReadOnly || !bundle.workspaceId) return setError("This Accounts workspace is read-only for the current session."), false;
    if (requiresOnline && !online) return setError("Reconnect before issuing a numbered business document."), false;
    const command = enqueueAccountsCommand(bundle.workspaceId, action, payload);
    refreshQueue();
    if (!online) { setNotice("Draft saved locally and queued for safe synchronisation."); return true; }
    setBusy(action);
    const result = await flushAccountsQueue(bundle.workspaceId, () => refreshQueue());
    setBusy(""); refreshQueue();
    if (result.remaining) {
      const failed = readAccountsQueue(bundle.workspaceId).find((item) => item.id === command.id);
      setError(failed?.lastError ?? "Accounts synchronisation stopped for review."); return false;
    }
    await load(); return true;
  }

  const documents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bundle.documents.filter((document) => (filter === "all" || document.document_type === filter)
      && (!needle || [document.number, document.customer_name, document.status, documentLabel(document.document_type)].join(" ").toLowerCase().includes(needle)));
  }, [bundle.documents, filter, query]);

  const invoicePreview = useMemo(() => calculateInvoiceTotals(invoiceLines.map((line) => ({
    quantity: Number(line.quantity || 0),
    unitPrice: Number(line.unitPrice || 0),
    discountAmount: Number(line.discountAmount || 0),
    vatRate: Number(line.vatRate || 0),
  }))), [invoiceLines]);

  const selectedCreditInvoice = bundle.invoices.find((invoice) => invoice.id === creditInvoiceId) ?? null;
  const currency = bundle.settings.currency || "EUR";

  function openInvoice() {
    setNewMenu(false);
    if (!bundle.customers.length) {
      setError("Add a Customer before creating an Invoice. Every Invoice must belong to a real Customer record.");
      return;
    }
    setInvoiceCustomerId(bundle.customers[0]?.id ?? "");
    setInvoiceDescription(""); setInvoiceNotes(""); setInvoiceLines([draftLine(bundle.settings.vat_rate)]); setInvoiceOpen(true);
  }

  function catalogueChange(index: number, sourceId: string) {
    setInvoiceLines((current) => current.map((line, itemIndex) => {
      if (itemIndex !== index) return line;
      if (line.lineType === "product") {
        const product = bundle.products.find((item) => item.id === sourceId);
        return { ...line, sourceId, description: product?.name ?? "", unitPrice: product?.selling_price == null ? "" : String(product.selling_price), vatRate: String(product?.vat_rate ?? 0) };
      }
      if (line.lineType === "service") {
        const service = bundle.services.find((item) => item.id === sourceId);
        return { ...line, sourceId, description: service?.name ?? "", unitPrice: service?.price == null ? "" : String(service.price), vatRate: String(service?.vat_rate ?? 0) };
      }
      return { ...line, sourceId: "" };
    }));
  }

  async function saveInvoice(event: FormEvent) {
    event.preventDefault();
    const lines = invoiceLines.map((line) => ({
      id: line.id, lineType: line.lineType,
      productId: line.lineType === "product" ? line.sourceId : null,
      serviceId: line.lineType === "service" ? line.sourceId : null,
      description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice === "" ? null : Number(line.unitPrice),
      discountAmount: Number(line.discountAmount || 0), vatRate: line.vatRate === "" ? null : Number(line.vatRate),
    }));
    const ok = await dispatch("invoice-create-manual", { id: crypto.randomUUID(), customerId: invoiceCustomerId, description: invoiceDescription || "Invoice", notes: invoiceNotes, lines });
    if (ok) setInvoiceOpen(false);
  }

  function setCreditInvoice(invoice: Invoice) {
    setCreditInvoiceId(invoice.id); setCreditReason(""); setLegacyCreditAmount("");
    setCreditLines(invoice.invoice_lines.map((line) => ({ id: crypto.randomUUID(), sourceInvoiceLineId: line.id, description: line.description_snapshot, selected: true, quantity: String(line.quantity) })));
  }
  function openCredit(invoice?: Invoice) {
    setNewMenu(false);
    const target = invoice ?? bundle.invoices.find((item) => !["draft", "void"].includes(item.display_status));
    if (!target) return setError("Create and issue an Invoice before creating a Credit Note.");
    setCreditInvoice(target); setCreditOpen(true);
  }
  async function saveCredit(event: FormEvent) {
    event.preventDefault();
    if (!selectedCreditInvoice) return;
    const lines = selectedCreditInvoice.invoice_lines.length
      ? creditLines.filter((line) => line.selected).map((line) => ({ id: line.id, sourceInvoiceLineId: line.sourceInvoiceLineId, quantity: Number(line.quantity) }))
      : [{ id: crypto.randomUUID(), amount: Number(legacyCreditAmount) }];
    const ok = await dispatch("credit-note-create", { id: crypto.randomUUID(), invoiceId: selectedCreditInvoice.id, reason: creditReason, lines });
    if (ok) setCreditOpen(false);
  }

  async function loadSaleSources() {
    if (!bundle.workspaceId || !online) return;
    const response = await fetch(`/api/accounts/delivery-sources?workspaceId=${encodeURIComponent(bundle.workspaceId)}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.ok) setSaleSources(json.result?.sales ?? []);
  }
  function populateDelivery(type: "invoice" | "sale", sourceId: string) {
    setDeliverySourceType(type); setDeliverySourceId(sourceId);
    if (type === "invoice") {
      const invoice = bundle.invoices.find((item) => item.id === sourceId);
      const customer = bundle.customers.find((item) => item.id === invoice?.customer_id);
      setDeliveryAddress(customer?.address ?? "");
      setDeliveryLines((invoice?.invoice_lines ?? []).map((line) => ({ id: crypto.randomUUID(), sourceLineId: line.id, description: line.description_snapshot, selected: true, quantity: String(line.quantity) })));
    } else {
      const sale = saleSources.find((item) => item.id === sourceId);
      const customer = bundle.customers.find((item) => item.id === sale?.customer_id);
      setDeliveryAddress(customer?.address ?? "");
      setDeliveryLines((sale?.sale_lines ?? []).map((line) => ({ id: crypto.randomUUID(), sourceLineId: line.id, description: line.description_snapshot, selected: true, quantity: String(line.quantity) })));
    }
  }
  async function openDelivery(invoice?: Invoice) {
    setNewMenu(false);
    await loadSaleSources();
    const target = invoice ?? bundle.invoices.find((item) => !["draft", "void"].includes(item.display_status) && item.invoice_lines.length > 0);
    if (target) populateDelivery("invoice", target.id);
    else { setDeliverySourceType("sale"); setDeliverySourceId(""); setDeliveryLines([]); setDeliveryAddress(""); }
    setDeliveryDate(isoDate()); setDeliveryNotes(""); setDeliveryOpen(true);
  }
  async function saveDelivery(event: FormEvent) {
    event.preventDefault();
    const lines = deliveryLines.filter((line) => line.selected).map((line) => ({ id: line.id, sourceLineId: line.sourceLineId, quantity: Number(line.quantity) }));
    const ok = await dispatch("delivery-note-create", { id: crypto.randomUUID(), sourceType: deliverySourceType, sourceId: deliverySourceId, deliveryDate, deliveryAddress, notes: deliveryNotes, lines });
    if (ok) setDeliveryOpen(false);
  }

  function openPayment(invoice?: Invoice) {
    const customerId = invoice?.customer_id ?? bundle.customers[0]?.id ?? "";
    setPaymentCustomerId(customerId); setPaymentInvoiceId(invoice?.id ?? "");
    setPaymentAmount(invoice ? String(invoice.outstanding_amount) : ""); setPaymentMethod("bank_transfer"); setPaymentReceivedAt(localDateTime()); setPaymentReference(""); setPaymentOpen(true);
  }
  async function savePayment(event: FormEvent) {
    event.preventDefault();
    const amount = Number(paymentAmount);
    const allocations = paymentInvoiceId ? [{ id: crypto.randomUUID(), invoiceId: paymentInvoiceId, amount }] : [];
    const ok = await dispatch("payment-record", { id: crypto.randomUUID(), customerId: paymentCustomerId, amount, paymentMethod, receivedAt: new Date(paymentReceivedAt).toISOString(), externalReference: paymentReference, notes: "", allocations });
    if (ok) setPaymentOpen(false);
  }

  async function openIdentity() {
    if (!bundle.workspaceId || !online) return setError("Reconnect before changing business document identity.");
    setBusy("identity-load");
    const response = await fetch(`/api/workspace/document-identity?workspaceId=${encodeURIComponent(bundle.workspaceId)}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({})); setBusy("");
    if (!response.ok || !json.ok) return setError(json.error ?? "Document identity could not be loaded.");
    const value = json.result;
    setIdentity({ businessAddress: value.businessAddress ?? "", vatNumber: value.vatNumber ?? "", companyRegistrationNumber: value.companyRegistrationNumber ?? "", creditNotePrefix: value.creditNotePrefix ?? "CN", deliveryNotePrefix: value.deliveryNotePrefix ?? "DN", paymentTermsDays: String(value.paymentTermsDays ?? 14), documentFooter: value.documentFooter ?? "" });
    setIdentityOpen(true);
  }
  async function saveIdentity(event: FormEvent) {
    event.preventDefault(); if (!bundle.workspaceId) return;
    setBusy("identity");
    const response = await fetch("/api/workspace/document-identity", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ workspaceId: bundle.workspaceId, ...identity, paymentTermsDays: Number(identity.paymentTermsDays) }) });
    const json = await response.json().catch(() => ({})); setBusy("");
    if (!response.ok || !json.ok) return setError(json.error ?? "Document identity could not be saved.");
    setIdentityOpen(false); setNotice("Business document identity updated."); await load();
  }

  async function issueDocument(document: DocumentIndex) {
    if (document.document_type === "invoice") {
      const invoice = bundle.invoices.find((item) => item.id === document.id); if (!invoice) return;
      await dispatch("invoice-issue", { id: invoice.id, expectedVersion: invoice.version }, true);
    } else if (document.document_type === "credit_note") {
      const note = bundle.creditNotes.find((item) => item.id === document.id); if (!note) return;
      await dispatch("credit-note-issue", { id: note.id, expectedVersion: note.version }, true);
    } else {
      const note = bundle.deliveryNotes.find((item) => item.id === document.id); if (!note) return;
      await dispatch("delivery-note-issue", { id: note.id, expectedVersion: note.version }, true);
    }
  }

  function emailDocument(document: DocumentIndex) {
    const customer = bundle.customers.find((item) => item.id === document.customer_id);
    if (!customer?.email) return setError("This Customer does not have an email address recorded.");
    const subject = `${documentLabel(document.document_type)} ${document.status === "draft" ? "Draft" : document.number}`;
    const body = `Hello ${customer.name},\n\nPlease find your ${documentLabel(document.document_type).toLowerCase()} attached.\n\nBDB OS does not yet send external email automatically, so download the PDF and attach it in your email application.`;
    window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setNotice("Email composer opened. Attach the downloaded PDF before sending; BDB OS has not recorded external delivery.");
  }

  const canWrite = Boolean(bundle.workspaceId) && !supportReadOnly;
  const identityIncomplete = !bundle.settings.business_address;

  return (
    <>
      <PageHeader
        eyebrow="Business documents & balances"
        title="Accounts"
        description="Create professional business documents, then keep Payments and balances connected underneath."
        action={<div className={styles.headerActions}><Button variant="quiet" onClick={() => void openIdentity()}><Settings2 size={16} /> Document setup</Button><div className={styles.newWrap}><Button disabled={!canWrite} onClick={() => setNewMenu((value) => !value)}><Plus size={17} /> New Document</Button>{newMenu ? <div className={styles.newMenu}><button onClick={openInvoice}><FileText size={18} /><span><strong>Invoice</strong><small>Bill a Customer</small></span></button><button onClick={() => openCredit()}><FileMinus2 size={18} /><span><strong>Credit Note</strong><small>Credit an issued Invoice</small></span></button><button onClick={() => void openDelivery()}><PackageCheck size={18} /><span><strong>Delivery Note</strong><small>Record goods delivered</small></span></button></div> : null}</div></div>}
      />

      <nav className={styles.tabs} aria-label="Accounts sections">
        {(["documents", "payments", "customers"] as const).map((item) => <button key={item} data-active={tab === item} onClick={() => setTab(item)}>{item}</button>)}
      </nav>

      {!online ? <div className={styles.attention}><TriangleAlert size={17} /><div><strong>Offline</strong><span>Drafts can be queued. Issuing final numbered documents waits for reconnection.</span></div></div> : null}
      {queue.length > 0 ? <div className={styles.attention}><RefreshCw size={17} /><div><strong>{queue.length} change{queue.length === 1 ? "" : "s"} waiting to synchronise</strong><span>Commands replay in order and stop safely at the first conflict.</span></div></div> : null}
      {identityIncomplete ? <div className={styles.quietNotice}><span>Before real client use, complete the business address and any VAT/company details that apply under <button onClick={() => void openIdentity()}>Document setup</button>.</span></div> : null}
      {error ? <div className="review-callout"><TriangleAlert size={18} /><div><strong>Accounts needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className={styles.quietNotice}><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div> : null}

      {tab === "documents" ? <section className={styles.section}>
        <div className={styles.documentToolbar}>
          <div className={styles.filters}>{(["all", "invoice", "credit_note", "delivery_note"] as const).map((item) => <button key={item} data-active={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All" : `${documentLabel(item)}s`}</button>)}</div>
          <input className="filter-input" placeholder="Search documents or Customers…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Card className="table-card">
          <div className={styles.tableScroll}><table><thead><tr><th>Document</th><th>Customer</th><th>Date</th><th>Status</th><th className={styles.money}>Total</th><th className={styles.money}>Balance</th><th aria-label="Actions" /></tr></thead><tbody>
            {documents.map((document) => {
              const isDraft = document.status === "draft";
              const invoice = document.document_type === "invoice" ? bundle.invoices.find((item) => item.id === document.id) : null;
              return <tr key={`${document.document_type}-${document.id}`}>
                <td><div className={styles.documentCell}><span className={styles.documentIcon}>{document.document_type === "credit_note" ? <FileMinus2 size={16} /> : document.document_type === "delivery_note" ? <PackageCheck size={16} /> : <FileText size={16} />}</span><span><strong>{documentLabel(document.document_type)}</strong><small>{isDraft ? "Draft" : document.number}</small></span></div></td>
                <td>{document.customer_name}</td><td>{formatDate(document.document_date)}</td><td><Badge tone={isDraft ? "neutral" : document.status === "paid" ? "green" : document.status === "overdue" ? "red" : "gold"}>{document.status.replaceAll("_", " ")}</Badge></td>
                <td className={styles.money}>{document.document_type === "delivery_note" ? "—" : formatMoney(Number(document.total_amount ?? 0), document.currency ?? currency)}</td>
                <td className={styles.money}>{document.document_type === "invoice" ? formatMoney(Number(document.balance_amount ?? 0), document.currency ?? currency) : "—"}</td>
                <td><div className={styles.rowActions}>
                  <Button variant="quiet" onClick={() => window.open(businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "html"), "_blank")}><MoreHorizontal size={15} /> View</Button>
                  <Button variant="quiet" onClick={() => window.open(businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "html", true), "_blank")}><Printer size={15} /> Print</Button>
                  <a className={styles.actionLink} href={businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "pdf")}><Download size={15} /> PDF</a>
                  {!isDraft ? <Button variant="quiet" onClick={() => emailDocument(document)}><Mail size={15} /> Email</Button> : null}
                  {isDraft ? <Button variant="secondary" disabled={!online || Boolean(busy)} onClick={() => void issueDocument(document)}>Issue</Button> : null}
                  {invoice && !isDraft && !["void"].includes(invoice.display_status) ? <><Button variant="quiet" onClick={() => openCredit(invoice)}>Credit</Button>{invoice.invoice_lines.length ? <Button variant="quiet" onClick={() => void openDelivery(invoice)}>Deliver</Button> : null}{invoice.outstanding_amount > 0 ? <Button variant="quiet" onClick={() => openPayment(invoice)}>Payment</Button> : null}</> : null}
                </div></td>
              </tr>;
            })}
          </tbody></table></div>
          {!documents.length ? <div className={styles.empty}><FileText size={26} /><strong>No business documents yet</strong><span>Create an Invoice, Credit Note or Delivery Note from one place.</span></div> : null}
        </Card>
      </section> : null}

      {tab === "payments" ? <section className={styles.section}>
        <SectionHeading title="Payments" description="Money received stays simple here; allocations and ledger safeguards remain underneath." action={<Button disabled={!canWrite || bundle.customers.length === 0} onClick={() => openPayment()}><Banknote size={16} /> Record Payment</Button>} />
        <Card className="table-card"><div className={styles.tableScroll}><table><thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th>Method</th><th>Status</th><th className={styles.money}>Amount</th><th className={styles.money}>Unallocated</th></tr></thead><tbody>{bundle.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.reference}</strong>{payment.external_reference ? <small className={styles.subtle}>{payment.external_reference}</small> : null}</td><td>{payment.customer_name_snapshot}</td><td>{formatDate(payment.received_at)}</td><td>{payment.payment_method.replaceAll("_", " ")}</td><td><Badge tone={payment.status === "posted" ? "green" : "neutral"}>{payment.status}</Badge></td><td className={styles.money}>{formatMoney(Number(payment.amount), payment.currency)}</td><td className={styles.money}>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</td></tr>)}</tbody></table></div>{!bundle.payments.length ? <div className={styles.empty}><Banknote size={24} /><strong>No Payments recorded</strong></div> : null}</Card>
      </section> : null}

      {tab === "customers" ? <section className={styles.section}>
        <SectionHeading title="Customer balances" description="What each Customer owes or holds as credit, derived from issued documents and Payments." />
        <Card className="table-card"><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Code</th><th>Status</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Credit</th><th className={styles.money}>Net balance</th></tr></thead><tbody>{bundle.customerBalances.map((balance) => <tr key={balance.customer_id}><td><strong>{balance.customer_name}</strong>{balance.company ? <small className={styles.subtle}>{balance.company}</small> : null}</td><td>{balance.customer_code}</td><td><Badge tone={balance.balance_status === "amount_due" ? "gold" : balance.balance_status === "customer_credit" ? "green" : "neutral"}>{balance.balance_status.replaceAll("_", " ")}</Badge></td><td className={styles.money}>{formatMoney(Number(balance.outstanding_amount), currency)}</td><td className={styles.money}>{formatMoney(Number(balance.unallocated_credit), currency)}</td><td className={styles.money}><strong>{formatMoney(Number(balance.net_balance), currency)}</strong></td></tr>)}</tbody></table></div></Card>
      </section> : null}

      {loading && !bundle.workspaceId ? <Card><div className={styles.empty}>Opening Accounts…</div></Card> : null}

      <Dialog className={styles.documentComposer} open={invoiceOpen} onClose={() => { if (!busy) setInvoiceOpen(false); }} title="New Invoice" description="Create a clear customer Invoice. Prices entered here are exclusive of VAT; VAT is added on top.">
        <form onSubmit={saveInvoice} className={`${styles.formStack} ${styles.composerForm}`}>
          <section className={styles.composerSection}>
            <div className={styles.sectionLabel}>Customer</div>
            <div className={styles.customerChooser}><div className="field"><label>Bill to</label><select required value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select><small className={styles.helperText}>The selected Customer&apos;s saved billing details will appear on the Invoice.</small></div></div>
          </section>

          <section className={styles.composerSection}>
            <div className={styles.sectionHeadingRow}><div><div className={styles.sectionLabel}>Invoice items</div><p>Use a Product, Service or manual line. Catalogue SKU / codes are carried onto the final Invoice.</p></div><Button type="button" variant="quiet" onClick={() => setInvoiceLines((current) => [...current, draftLine(bundle.settings.vat_rate)])}><Plus size={15} /> Add line</Button></div>
            <div className={styles.lineList}>{invoiceLines.map((line, index) => <div className={styles.lineRow} key={line.id}>
              <div className="field"><label>Type</label><select value={line.lineType} onChange={(event) => { const lineType = event.target.value as LineType; setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...draftLine(bundle.settings.vat_rate), id: item.id, lineType } : item)); }}><option value="product">Product</option><option value="service">Service</option><option value="manual">Manual</option></select></div>
              {line.lineType !== "manual" ? <div className={`field ${styles.lineDescription}`}><label>{line.lineType === "product" ? "Product / SKU" : "Service / Code"}</label><select required value={line.sourceId} onChange={(event) => catalogueChange(index, event.target.value)}><option value="">Choose…</option>{line.lineType === "product" ? bundle.products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>) : bundle.services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div> : <div className={`field ${styles.lineDescription}`}><label>Line description</label><input required value={line.description} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Item or service" /></div>}
              <div className="field"><label>Qty</label><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></div>
              <div className="field"><label>Unit price <span className={styles.exVat}>(excl. VAT)</span></label><input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} /><small className={styles.helperText}>VAT is added on top.</small></div>
              <div className="field"><label>VAT %</label><input type="number" min="0" max="100" step="0.01" value={line.vatRate} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, vatRate: event.target.value } : item))} /></div>
              <button type="button" className={styles.removeLine} aria-label="Remove line" disabled={invoiceLines.length === 1} onClick={() => setInvoiceLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
            </div>)}</div>
            <div className={styles.invoiceSummary} aria-label="Invoice totals preview"><div><span>Subtotal / Net</span><strong>{formatMoney(invoicePreview.netAmount, currency)}</strong></div><div><span>VAT</span><strong>{formatMoney(invoicePreview.vatAmount, currency)}</strong></div><div className={styles.invoiceGrand}><span>Total</span><strong>{formatMoney(invoicePreview.totalAmount, currency)}</strong></div></div>
          </section>

          <section className={styles.composerSection}>
            <div className={styles.sectionLabel}>Message & internal context</div>
            <div className={styles.copyGrid}>
              <div className="field"><label>Description <span className={styles.customerFacing}>Visible to customer</span></label><textarea required rows={5} value={invoiceDescription} onChange={(event) => setInvoiceDescription(event.target.value)} placeholder="What is this Invoice for? Add any wording the receiver should see." /><small className={styles.helperText}><strong>Printed on the Invoice.</strong> The receiver will see this text.</small></div>
              <div className="field"><label>Notes <span className={styles.internalOnly}>Internal only</span></label><textarea rows={5} value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} placeholder="Private context for your team" /><small className={styles.helperText}><strong>Never printed on the Invoice.</strong> Use this only for internal context.</small></div>
            </div>
          </section>

          <div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>Drafts can be saved offline. Final numbering happens when issued online.</span><div><Button type="button" variant="quiet" onClick={() => setInvoiceOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>Save Draft</Button></div></div>
        </form>
      </Dialog>

      <Dialog className={styles.documentComposer} open={creditOpen} onClose={() => { if (!busy) setCreditOpen(false); }} title="New Credit Note" description="Credit an issued Invoice without deleting or rewriting its history. Choose exactly what is being credited.">
        <form onSubmit={saveCredit} className={`${styles.formStack} ${styles.composerForm}`}>
          <section className={styles.composerSection}><div className={styles.formGrid}><div className={`field ${styles.full}`}><label>Invoice to credit</label><select value={creditInvoiceId} onChange={(event) => { const invoice = bundle.invoices.find((item) => item.id === event.target.value); if (invoice) setCreditInvoice(invoice); }}>{bundle.invoices.filter((invoice) => !["draft", "void"].includes(invoice.display_status)).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {formatMoney(Number(invoice.adjusted_total_amount ?? invoice.total_amount), invoice.currency)}</option>)}</select></div><div className={`field ${styles.full}`}><label>Reason <span className={styles.customerFacing}>Printed on Credit Note</span></label><textarea required minLength={5} rows={3} value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Why is this amount being credited?" /></div></div></section>
          <section className={styles.composerSection}><div className={styles.sectionLabel}>Items being credited</div>{selectedCreditInvoice?.invoice_lines.length ? <div className={styles.selectionList}>{creditLines.map((line, index) => <label key={line.id} className={styles.selectionRow}><input type="checkbox" checked={line.selected} onChange={(event) => setCreditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.description}</strong><small>Quantity to credit</small></span><input type="number" min="0.001" step="0.001" value={line.quantity} disabled={!line.selected} onChange={(event) => setCreditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div> : <div className="field"><label>Credit amount</label><input required type="number" min="0.01" step="0.01" max={selectedCreditInvoice?.adjusted_total_amount ?? selectedCreditInvoice?.total_amount} value={legacyCreditAmount} onChange={(event) => setLegacyCreditAmount(event.target.value)} /><small className={styles.helperText}>This historical Invoice has no stored line detail, so BDB OS preserves it and records the Credit Note as an explicit adjustment.</small></div>}</section>
          <div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>The Credit Note receives its final number when issued online.</span><div><Button type="button" variant="quiet" onClick={() => setCreditOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>Save Draft</Button></div></div>
        </form>
      </Dialog>

      <Dialog className={styles.documentComposer} open={deliveryOpen} onClose={() => { if (!busy) setDeliveryOpen(false); }} title="New Delivery Note" description="Record fulfilment from an issued Invoice or completed Sale. Delivery Notes never change the customer balance.">
        <form onSubmit={saveDelivery} className={`${styles.formStack} ${styles.composerForm}`}>
          <section className={styles.composerSection}><div className={styles.formGrid}><div className="field"><label>Source</label><select value={deliverySourceType} onChange={(event) => { const type = event.target.value as "invoice" | "sale"; setDeliverySourceType(type); setDeliverySourceId(""); setDeliveryLines([]); }}><option value="invoice">Issued Invoice</option><option value="sale">Completed Sale</option></select></div><div className="field"><label>{deliverySourceType === "invoice" ? "Invoice" : "Sale"}</label><select required value={deliverySourceId} onChange={(event) => populateDelivery(deliverySourceType, event.target.value)}><option value="">Choose…</option>{deliverySourceType === "invoice" ? bundle.invoices.filter((invoice) => !["draft", "void"].includes(invoice.display_status) && invoice.invoice_lines.length).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number}</option>) : saleSources.filter((sale) => sale.sale_lines.length).map((sale) => <option key={sale.id} value={sale.id}>{sale.reference}</option>)}</select></div><div className="field"><label>Delivery date</label><input type="date" required value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></div><div className="field"><label>Delivery address</label><input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></div></div></section>
          <section className={styles.composerSection}><div className={styles.sectionLabel}>Items delivered</div><div className={styles.selectionList}>{deliveryLines.map((line, index) => <label key={line.id} className={styles.selectionRow}><input type="checkbox" checked={line.selected} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.description}</strong><small>Quantity delivered</small></span><input type="number" min="0.001" step="0.001" value={line.quantity} disabled={!line.selected} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div></section>
          <section className={styles.composerSection}><div className="field"><label>Internal notes <span className={styles.internalOnly}>Internal only</span></label><textarea rows={4} value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /><small className={styles.helperText}>These notes stay inside BDB OS and are not used as pricing or accounting instructions.</small></div></section>
          <div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>Delivery Notes record fulfilment only.</span><div><Button type="button" variant="quiet" onClick={() => setDeliveryOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || deliveryLines.every((line) => !line.selected)}>Save Draft</Button></div></div>
        </form>
      </Dialog>

      <Dialog open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false); }} title="Record Payment" description="Record money received. When opened from an Invoice, the Payment is allocated to it automatically.">
        <form onSubmit={savePayment} className={styles.formStack}><div className={styles.formGrid}><div className="field"><label>Customer</label><select required value={paymentCustomerId} disabled={Boolean(paymentInvoiceId)} onChange={(event) => setPaymentCustomerId(event.target.value)}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className="field"><label>Amount</label><input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div><div className="field"><label>Method</label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div><div className="field"><label>Received</label><input type="datetime-local" required value={paymentReceivedAt} onChange={(event) => setPaymentReceivedAt(event.target.value)} /></div><div className={`field ${styles.full}`}><label>Reference</label><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Bank / card / cheque reference" /></div></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>Record Payment</Button></div></form>
      </Dialog>

      <Dialog open={identityOpen} onClose={() => { if (!busy) setIdentityOpen(false); }} title="Business Document Setup" description="Set the business identity printed on issued documents. Payment wording belongs in the customer-facing Invoice description, not in a permanent payment-instructions block.">
        <form onSubmit={saveIdentity} className={styles.formStack}><div className={styles.formGrid}><div className={`field ${styles.full}`}><label>Business address</label><textarea rows={3} value={identity.businessAddress} onChange={(event) => setIdentity({ ...identity, businessAddress: event.target.value })} /></div><div className="field"><label>VAT number</label><input value={identity.vatNumber} onChange={(event) => setIdentity({ ...identity, vatNumber: event.target.value })} /></div><div className="field"><label>Company registration number</label><input value={identity.companyRegistrationNumber} onChange={(event) => setIdentity({ ...identity, companyRegistrationNumber: event.target.value })} /></div><div className="field"><label>Credit Note prefix</label><input value={identity.creditNotePrefix} onChange={(event) => setIdentity({ ...identity, creditNotePrefix: event.target.value.toUpperCase() })} /></div><div className="field"><label>Delivery Note prefix</label><input value={identity.deliveryNotePrefix} onChange={(event) => setIdentity({ ...identity, deliveryNotePrefix: event.target.value.toUpperCase() })} /></div></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setIdentityOpen(false)}>Cancel</Button><Button type="submit" disabled={busy === "identity"}>Save Setup</Button></div></form>
      </Dialog>
    </>
  );
}

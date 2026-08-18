"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Banknote,
  Download,
  FileMinus2,
  FileText,
  Mail,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Settings2,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Dialog, PageHeader } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import {
  enqueueAccountsCommand,
  flushAccountsQueue,
  readAccountsQueue,
  type AccountsCommandAction,
  type AccountsQueuedCommand,
} from "@/lib/modules/accounts-queue";
import styles from "./accounts.module.css";

type Tab = "documents" | "payments" | "customers";
type DocumentKind = "invoice" | "credit_note" | "delivery_note";
type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";
type InvoiceStatus = "draft" | "sent" | "overdue" | "paid" | "void";

type InvoiceLine = {
  id: string;
  line_number: number;
  line_type: "product" | "service" | "manual";
  product_id: string | null;
  service_id: string | null;
  code_snapshot: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
};

type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_code_snapshot: string;
  source_sale_id: string | null;
  issued_at: string;
  supply_date?: string | null;
  due_at: string;
  description: string;
  currency: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  adjusted_total_amount?: number;
  outstanding_amount: number;
  display_status: InvoiceStatus;
  status: InvoiceStatus;
  version: number;
  notes: string | null;
  vat_note?: string | null;
  invoice_lines: InvoiceLine[];
};

type Customer = {
  id: string;
  code: string;
  name: string;
  company?: string | null;
  email: string | null;
  phone?: string | null;
  address?: string | null;
  vat_number?: string | null;
  version?: number;
};

type Payment = {
  id: string;
  reference: string;
  customer_id: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: PaymentMethod;
  received_at: string;
  status: "posted" | "reversed";
  unallocated_amount: number;
};

type CustomerBalance = {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  company: string | null;
  issued_amount: number;
  received_amount: number;
  outstanding_amount: number;
  unallocated_credit: number;
  net_balance: number;
  balance_status: "amount_due" | "customer_credit" | "clear";
};

type AccountsBundle = {
  workspaceId: string;
  settings: { currency: string; vat_rate: number; invoice_prefix: string; timezone: string };
  invoices: Invoice[];
  payments: Payment[];
  customerBalances: CustomerBalance[];
};

type BusinessDocumentRow = {
  workspace_id: string;
  id: string;
  document_type: DocumentKind;
  number: string;
  customer_id: string;
  customer_name: string;
  created_at: string;
  issued_at: string | null;
  status: string;
  currency: string | null;
  total_amount: number | null;
  source_sale_id: string | null;
  source_invoice_id: string | null;
  outstanding_amount: number | null;
};

type CreditNote = {
  id: string;
  invoice_id: string;
  number: string;
  status: "draft" | "issued" | "void";
  version: number;
  customer_id: string;
  reason: string;
  total_amount: number;
  currency: string;
};

type DeliveryNote = {
  id: string;
  number: string;
  status: "draft" | "issued" | "void";
  version: number;
  customer_id: string;
  source_invoice_id: string | null;
  source_sale_id: string | null;
  delivery_date: string;
};

type CatalogueProduct = { id: string; sku: string; name: string; selling_price: number; vat_rate: number };
type CatalogueService = { id: string; code: string; name: string; price: number; vat_rate: number };

type DocumentSettings = {
  business_address?: string | null;
  vat_number?: string | null;
  invoice_prefix?: string;
  credit_note_prefix?: string;
  delivery_note_prefix?: string;
  default_payment_terms_days?: number;
  currency?: string;
  vat_rate?: number;
};

type BusinessBundle = {
  workspaceId: string;
  documents: BusinessDocumentRow[];
  creditNotes: CreditNote[];
  deliveryNotes: DeliveryNote[];
  products: CatalogueProduct[];
  services: CatalogueService[];
  settings: DocumentSettings;
  workspace: { id: string; name: string; legal_name: string | null } | null;
};

type SourceLine = { id: string; line_number: number; product_id: string | null; code_snapshot: string; description_snapshot: string; quantity: number };
type DeliverySource = {
  id: string;
  customer_id: string;
  reference?: string;
  number?: string;
  customer_name_snapshot?: string;
  invoice_lines?: SourceLine[];
  sale_lines?: SourceLine[];
};

type SourcesBundle = { invoices: DeliverySource[]; sales: DeliverySource[]; customers: Customer[] };

type DraftLine = {
  id: string;
  kind: "product" | "service" | "manual";
  sourceId: string;
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  vatRate: string;
};

const EMPTY_ACCOUNTS: AccountsBundle = {
  workspaceId: "",
  settings: { currency: "EUR", vat_rate: 0, invoice_prefix: "INV", timezone: "Europe/Malta" },
  invoices: [], payments: [], customerBalances: [],
};

const EMPTY_BUSINESS: BusinessBundle = {
  workspaceId: "", documents: [], creditNotes: [], deliveryNotes: [], products: [], services: [], settings: {}, workspace: null,
};

const today = () => new Date().toISOString().slice(0, 10);
function dueDate(days = 14) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function blankLine(vat = 0): DraftLine { return { id: crypto.randomUUID(), kind: "manual", sourceId: "", code: "", description: "", quantity: "1", unitPrice: "", discountAmount: "0", vatRate: String(vat) }; }
function documentLabel(kind: DocumentKind) { return kind === "credit_note" ? "Credit Note" : kind === "delivery_note" ? "Delivery Note" : "Invoice"; }
function statusTone(status: string): "neutral" | "gold" | "green" | "red" { return status === "paid" || status === "issued" ? "green" : status === "overdue" || status === "void" ? "red" : status === "draft" ? "neutral" : "gold"; }

export default function AccountsPage() {
  const [tab, setTab] = useState<Tab>("documents");
  const [accounts, setAccounts] = useState<AccountsBundle>(EMPTY_ACCOUNTS);
  const [business, setBusiness] = useState<BusinessBundle>(EMPTY_BUSINESS);
  const [sources, setSources] = useState<SourcesBundle>({ invoices: [], sales: [], customers: [] });
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<AccountsQueuedCommand[]>([]);
  const [busy, setBusy] = useState(false);
  const [newMenu, setNewMenu] = useState(false);

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [invoiceSupplyDate, setInvoiceSupplyDate] = useState(today());
  const [invoiceDueDate, setInvoiceDueDate] = useState(dueDate());
  const [invoiceDescription, setInvoiceDescription] = useState("Goods / services supplied");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [invoiceVatNote, setInvoiceVatNote] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<DraftLine[]>([]);

  const [creditOpen, setCreditOpen] = useState(false);
  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditNotes, setCreditNotes] = useState("");
  const [creditQuantities, setCreditQuantities] = useState<Record<string, string>>({});

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliverySourceType, setDeliverySourceType] = useState<"invoice" | "sale">("invoice");
  const [deliverySourceId, setDeliverySourceId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<string, string>>({});

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ businessAddress: "", vatNumber: "", creditNotePrefix: "CN", deliveryNotePrefix: "DN", defaultPaymentTermsDays: "14" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current business could not be resolved.");
      const workspaceId = String(context.currentWorkspaceId);
      setSupportReadOnly(Boolean(context.supportAccess) && context.supportAccessMode !== "test_write");
      const [accountsResponse, docsResponse, sourcesResponse] = await Promise.all([
        fetch(`/api/accounts?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/accounts/business-documents?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
        fetch(`/api/accounts/delivery-sources?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }),
      ]);
      const [accountsJson, docsJson, sourcesJson] = await Promise.all([accountsResponse.json().catch(() => ({})), docsResponse.json().catch(() => ({})), sourcesResponse.json().catch(() => ({}))]);
      if (!accountsResponse.ok || !accountsJson.ok) throw new Error(accountsJson.error ?? "Accounts could not be loaded.");
      if (!docsResponse.ok || !docsJson.ok) throw new Error(docsJson.error ?? "Business documents could not be loaded.");
      if (!sourcesResponse.ok || !sourcesJson.ok) throw new Error(sourcesJson.error ?? "Document sources could not be loaded.");
      setAccounts(accountsJson.result as AccountsBundle);
      setBusiness(docsJson.result as BusinessBundle);
      setSources(sourcesJson.result as SourcesBundle);
      setQueue(readAccountsQueue(workspaceId));
      setNotice("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Accounts could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const customers: Customer[] = sources.customers.length ? sources.customers : accounts.customerBalances.map((balance) => ({ id: balance.customer_id, code: balance.customer_code, name: balance.customer_name, company: balance.company, email: null }));
  const setupComplete = Boolean(business.settings.business_address && business.settings.vat_number);
  const currency = accounts.settings.currency || business.settings.currency || "EUR";

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return business.documents.filter((document) => !needle || [document.number, document.customer_name, document.document_type, document.status].join(" ").toLowerCase().includes(needle));
  }, [business.documents, query]);

  const selectedCreditInvoice = accounts.invoices.find((invoice) => invoice.id === creditInvoiceId) ?? null;
  const deliverySource = (deliverySourceType === "invoice" ? sources.invoices : sources.sales).find((source) => source.id === deliverySourceId) ?? null;
  const deliverySourceLines = deliverySourceType === "invoice" ? deliverySource?.invoice_lines ?? [] : deliverySource?.sale_lines ?? [];

  async function syncQueue() {
    if (!accounts.workspaceId || !navigator.onLine || busy) return;
    setBusy(true);
    const result = await flushAccountsQueue(accounts.workspaceId, () => setQueue(readAccountsQueue(accounts.workspaceId)));
    setQueue(readAccountsQueue(accounts.workspaceId));
    setBusy(false);
    if (result.remaining === 0) { if (result.completed) setNotice(`${result.completed} queued Accounts change${result.completed === 1 ? "" : "s"} synchronised.`); await load(); }
    else setError(readAccountsQueue(accounts.workspaceId)[0]?.lastError ?? "Accounts synchronisation stopped for review.");
  }

  async function dispatch(action: AccountsCommandAction, payload: Record<string, unknown>) {
    if (!accounts.workspaceId || supportReadOnly) return false;
    enqueueAccountsCommand(accounts.workspaceId, action, payload);
    setQueue(readAccountsQueue(accounts.workspaceId));
    if (navigator.onLine) await syncQueue();
    else setNotice("Draft change saved offline. Final issue/numbering will happen after reconnection.");
    return true;
  }

  function openInvoice() {
    const customer = customers[0];
    const terms = Number(business.settings.default_payment_terms_days ?? 14);
    setInvoiceCustomerId(customer?.id ?? ""); setInvoiceSupplyDate(today()); setInvoiceDueDate(dueDate(terms)); setInvoiceDescription("Goods / services supplied"); setInvoiceNotes(""); setInvoiceVatNote(""); setInvoiceLines([blankLine(Number(business.settings.vat_rate ?? accounts.settings.vat_rate ?? 0))]); setInvoiceOpen(true); setNewMenu(false);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) { setInvoiceLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }
  function chooseCatalogue(index: number, kind: DraftLine["kind"], sourceId: string) {
    if (kind === "product") { const item = business.products.find((product) => product.id === sourceId); updateLine(index, { kind, sourceId, code: item?.sku ?? "", description: item?.name ?? "", unitPrice: item ? String(item.selling_price) : "", vatRate: item ? String(item.vat_rate) : "" }); }
    else if (kind === "service") { const item = business.services.find((service) => service.id === sourceId); updateLine(index, { kind, sourceId, code: item?.code ?? "", description: item?.name ?? "", unitPrice: item ? String(item.price) : "", vatRate: item ? String(item.vat_rate) : "" }); }
    else updateLine(index, { kind, sourceId: "", code: "", description: "", unitPrice: "", vatRate: String(business.settings.vat_rate ?? accounts.settings.vat_rate ?? 0) });
  }

  async function saveInvoice(event: FormEvent) {
    event.preventDefault();
    if (!invoiceLines.length) return;
    const accepted = await dispatch("invoice-create", {
      id: crypto.randomUUID(), customerId: invoiceCustomerId, supplyDate: invoiceSupplyDate, dueAt: invoiceDueDate, description: invoiceDescription, notes: invoiceNotes, vatNote: invoiceVatNote,
      lines: invoiceLines.map((line) => ({ id: line.id, productId: line.kind === "product" ? line.sourceId : null, serviceId: line.kind === "service" ? line.sourceId : null, code: line.code || null, description: line.description || null, quantity: Number(line.quantity), unitPrice: line.unitPrice === "" ? null : Number(line.unitPrice), discountAmount: Number(line.discountAmount || 0), vatRate: line.vatRate === "" ? null : Number(line.vatRate) })),
    });
    if (accepted) setInvoiceOpen(false);
  }

  function openCredit(invoiceId?: string) {
    const eligible = accounts.invoices.filter((invoice) => !["draft", "void"].includes(invoice.display_status) && invoice.invoice_lines.length > 0);
    const id = invoiceId ?? eligible[0]?.id ?? "";
    const invoice = eligible.find((item) => item.id === id);
    setCreditInvoiceId(id); setCreditReason(""); setCreditNotes(""); setCreditQuantities(Object.fromEntries((invoice?.invoice_lines ?? []).map((line) => [line.id, "0"]))); setCreditOpen(true); setNewMenu(false);
  }

  async function saveCredit(event: FormEvent) {
    event.preventDefault();
    if (!selectedCreditInvoice) return;
    const lines = selectedCreditInvoice.invoice_lines.flatMap((line) => Number(creditQuantities[line.id] ?? 0) > 0 ? [{ id: crypto.randomUUID(), sourceInvoiceLineId: line.id, quantity: Number(creditQuantities[line.id]) }] : []);
    if (!lines.length) return setError("Enter a quantity on at least one Invoice line to credit.");
    const accepted = await dispatch("credit-note-create", { id: crypto.randomUUID(), invoiceId: selectedCreditInvoice.id, reason: creditReason, notes: creditNotes, lines });
    if (accepted) setCreditOpen(false);
  }

  function openDelivery(sourceType: "invoice" | "sale" = "invoice", sourceId?: string) {
    const list = sourceType === "invoice" ? sources.invoices : sources.sales;
    const id = sourceId ?? list[0]?.id ?? "";
    const source = list.find((item) => item.id === id);
    const customer = customers.find((item) => item.id === source?.customer_id);
    const lines = sourceType === "invoice" ? source?.invoice_lines ?? [] : source?.sale_lines ?? [];
    setDeliverySourceType(sourceType); setDeliverySourceId(id); setDeliveryDate(today()); setDeliveryAddress(customer?.address ?? ""); setDeliveryNotes(""); setDeliveryQuantities(Object.fromEntries(lines.map((line) => [line.id, String(line.quantity)]))); setDeliveryOpen(true); setNewMenu(false);
  }

  function changeDeliverySource(type: "invoice" | "sale", id: string) {
    const source = (type === "invoice" ? sources.invoices : sources.sales).find((item) => item.id === id);
    const customer = customers.find((item) => item.id === source?.customer_id);
    const lines = type === "invoice" ? source?.invoice_lines ?? [] : source?.sale_lines ?? [];
    setDeliverySourceType(type); setDeliverySourceId(id); setDeliveryAddress(customer?.address ?? ""); setDeliveryQuantities(Object.fromEntries(lines.map((line) => [line.id, String(line.quantity)])));
  }

  async function saveDelivery(event: FormEvent) {
    event.preventDefault();
    if (!deliverySource) return;
    const lines = deliverySourceLines.flatMap((line) => Number(deliveryQuantities[line.id] ?? 0) > 0 ? [{ id: crypto.randomUUID(), sourceLineId: line.id, quantity: Number(deliveryQuantities[line.id]) }] : []);
    if (!lines.length) return setError("A Delivery Note needs at least one quantity.");
    const accepted = await dispatch("delivery-note-create", { id: crypto.randomUUID(), sourceInvoiceId: deliverySourceType === "invoice" ? deliverySource.id : null, sourceSaleId: deliverySourceType === "sale" ? deliverySource.id : null, deliveryDate, deliveryAddress, notes: deliveryNotes, lines });
    if (accepted) setDeliveryOpen(false);
  }

  function openPayment(customerId?: string, invoiceId?: string) {
    const customer = customerId ?? customers[0]?.id ?? "";
    const invoice = accounts.invoices.find((item) => item.id === invoiceId);
    setPaymentCustomerId(customer); setPaymentInvoiceId(invoiceId ?? ""); setPaymentAmount(invoice ? String(invoice.outstanding_amount) : ""); setPaymentMethod("bank_transfer"); setPaymentOpen(true);
  }

  async function savePayment(event: FormEvent) {
    event.preventDefault();
    const amount = Number(paymentAmount);
    const invoice = accounts.invoices.find((item) => item.id === paymentInvoiceId);
    const accepted = await dispatch("payment-record", { id: crypto.randomUUID(), customerId: paymentCustomerId, amount, paymentMethod, receivedAt: new Date().toISOString(), externalReference: null, notes: null, allocations: invoice ? [{ id: crypto.randomUUID(), invoiceId: invoice.id, amount: Math.min(amount, Number(invoice.outstanding_amount)) }] : [] });
    if (accepted) setPaymentOpen(false);
  }

  async function issue(document: BusinessDocumentRow) {
    if (!online) return setError("Reconnect before issuing a final business document. Drafts can still be prepared offline.");
    const source = document.document_type === "invoice" ? accounts.invoices.find((invoice) => invoice.id === document.id) : document.document_type === "credit_note" ? business.creditNotes.find((note) => note.id === document.id) : business.deliveryNotes.find((note) => note.id === document.id);
    if (!source) return;
    await dispatch(`${document.document_type.replaceAll("_", "-")}-issue` as AccountsCommandAction, { id: document.id, expectedVersion: source.version });
  }

  async function voidDocument(document: BusinessDocumentRow) {
    const reason = window.prompt(`Reason for voiding ${documentLabel(document.document_type)} ${document.number}?`);
    if (!reason || reason.trim().length < 5) return;
    const source = document.document_type === "invoice" ? accounts.invoices.find((invoice) => invoice.id === document.id) : document.document_type === "credit_note" ? business.creditNotes.find((note) => note.id === document.id) : business.deliveryNotes.find((note) => note.id === document.id);
    if (!source) return;
    await dispatch(`${document.document_type.replaceAll("_", "-")}-void` as AccountsCommandAction, document.document_type === "invoice" ? { id: document.id, expectedVersion: source.version, reason } : { id: document.id, expectedVersion: source.version, voidReason: reason });
  }

  function output(document: BusinessDocumentRow, format: "html" | "pdf") {
    const params = new URLSearchParams({ workspaceId: accounts.workspaceId, type: document.document_type, id: document.id, format });
    if (format === "html") params.set("print", "1");
    window.open(`/api/accounts/document-output?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  function emailDocument(document: BusinessDocumentRow) {
    const customer = customers.find((item) => item.id === document.customer_id);
    if (!customer?.email) return setError("This Customer does not have an email address. Add it in Customers first.");
    const subject = encodeURIComponent(`${documentLabel(document.document_type)} ${document.number}`);
    const body = encodeURIComponent(`Dear ${customer.name},\n\nPlease find ${documentLabel(document.document_type).toLowerCase()} ${document.number}.\n\nBDB OS has opened your email application; attach the downloaded PDF before sending.\n\nRegards`);
    window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${subject}&body=${body}`;
  }

  function openSettings() {
    setSettingsDraft({ businessAddress: String(business.settings.business_address ?? ""), vatNumber: String(business.settings.vat_number ?? ""), creditNotePrefix: String(business.settings.credit_note_prefix ?? "CN"), deliveryNotePrefix: String(business.settings.delivery_note_prefix ?? "DN"), defaultPaymentTermsDays: String(business.settings.default_payment_terms_days ?? 14) });
    setSettingsOpen(true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!online || !accounts.workspaceId) return;
    setBusy(true); setError("");
    const response = await fetch("/api/accounts/business-documents", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ workspaceId: accounts.workspaceId, action: "document-settings-update", ...settingsDraft, defaultPaymentTermsDays: Number(settingsDraft.defaultPaymentTermsDays) }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok || !result.ok) return setError(result.error ?? "Document settings could not be saved.");
    setSettingsOpen(false); await load();
  }

  return (
    <>
      <PageHeader
        eyebrow="Business documents & balances"
        title="Accounts"
        description="Create the documents customers receive, record payments and keep balances accurate."
        action={<div className={styles.headerActions}><Button variant="secondary" disabled={supportReadOnly || customers.length === 0} onClick={() => openPayment()}><Banknote size={16} /> Record Payment</Button><div className={styles.newWrap}><Button disabled={supportReadOnly} onClick={() => setNewMenu((value) => !value)}><Plus size={16} /> New Document</Button>{newMenu ? <div className={styles.newMenu}><button onClick={openInvoice}><FileText size={16} /> Invoice</button><button disabled={!accounts.invoices.some((invoice) => !["draft", "void"].includes(invoice.display_status) && invoice.invoice_lines.length)} onClick={() => openCredit()}><FileMinus2 size={16} /> Credit Note</button><button disabled={!sources.invoices.length && !sources.sales.length} onClick={() => openDelivery(sources.invoices.length ? "invoice" : "sale")}><PackageCheck size={16} /> Delivery Note</button></div> : null}</div></div>}
      />

      <div className={styles.tabs}>{(["documents", "payments", "customers"] as const).map((item) => <button key={item} data-active={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>

      {!online ? <div className={styles.notice}><WifiOff size={17} /><div><strong>Offline</strong><span>Draft commands stay queued locally. Final document issue and legal numbering wait for reconnection.</span></div></div> : null}
      {!setupComplete ? <div className={styles.notice}><TriangleAlert size={17} /><div><strong>Business document identity needs completing</strong><span>Add the business address and VAT number before issuing Tax Invoices or Credit Notes.</span></div><Button variant="quiet" disabled={!online} onClick={openSettings}><Settings2 size={15} /> Configure</Button></div> : null}
      {queue.length ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>{queue.length} Accounts change{queue.length === 1 ? "" : "s"} waiting</strong><span>{queue[0]?.lastError || "They replay in order after reconnection."}</span></div><Button variant="quiet" disabled={!online || busy} onClick={() => void syncQueue()}>Sync</Button></div> : null}
      {error ? <div className="review-callout"><TriangleAlert size={18} /><div><strong>Accounts needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className={styles.quietNotice}>{notice}</div> : null}

      {tab === "documents" ? <section>
        <div className={styles.toolbar}><input className="filter-input" placeholder="Search documents or customers…" value={query} onChange={(event) => setQuery(event.target.value)} /><Button variant="quiet" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button></div>
        <div className={styles.documentTable}>
          <table><thead><tr><th>Document</th><th>Customer</th><th>Date</th><th>Status</th><th className={styles.money}>Total</th><th className={styles.money}>Balance</th><th /></tr></thead><tbody>
            {filteredDocuments.map((document) => <tr key={`${document.document_type}:${document.id}`}><td><div className={styles.reference}><strong>{document.number}</strong><span>{documentLabel(document.document_type)}</span></div></td><td>{document.customer_name}</td><td>{formatDate(document.issued_at ?? document.created_at, { day: "2-digit", month: "short", year: "numeric" })}</td><td><Badge tone={statusTone(document.status)}>{document.status}</Badge></td><td className={styles.money}>{document.total_amount === null ? "—" : formatMoney(Number(document.total_amount), document.currency ?? currency)}</td><td className={styles.money}>{document.outstanding_amount === null ? "—" : formatMoney(Number(document.outstanding_amount), document.currency ?? currency)}</td><td><div className={styles.rowActions}>{document.status === "draft" ? <Button variant="quiet" disabled={!online || supportReadOnly} onClick={() => void issue(document)}>Issue</Button> : null}<Button variant="quiet" onClick={() => output(document, "html")}><Printer size={14} /> Print</Button><Button variant="quiet" onClick={() => output(document, "pdf")}><Download size={14} /> PDF</Button>{document.status !== "draft" && document.status !== "void" ? <Button variant="quiet" onClick={() => emailDocument(document)}><Mail size={14} /> Email</Button> : null}{document.document_type === "invoice" && !["draft", "void", "paid"].includes(document.status) ? <Button variant="quiet" onClick={() => openPayment(document.customer_id, document.id)}>Payment</Button> : null}{document.document_type === "invoice" && document.status !== "draft" && document.status !== "void" ? <Button variant="quiet" onClick={() => openCredit(document.id)}>Credit</Button> : null}{document.document_type === "invoice" && document.status !== "draft" && document.status !== "void" ? <Button variant="quiet" onClick={() => openDelivery("invoice", document.id)}>Delivery</Button> : null}{document.status !== "draft" && document.status !== "void" ? <Button variant="quiet" disabled={supportReadOnly || !online} onClick={() => void voidDocument(document)}>Void</Button> : null}</div></td></tr>)}
          </tbody></table>
          {!filteredDocuments.length ? <div className={styles.empty}>No business documents yet. Create an Invoice, Credit Note or Delivery Note from the button above.</div> : null}
        </div>
      </section> : null}

      {tab === "payments" ? <section className={styles.documentTable}><table><thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th>Method</th><th>Status</th><th className={styles.money}>Amount</th><th className={styles.money}>Unallocated</th></tr></thead><tbody>{accounts.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.reference}</strong></td><td>{payment.customer_name_snapshot}</td><td>{formatDate(payment.received_at, { day: "2-digit", month: "short", year: "numeric" })}</td><td>{payment.payment_method.replaceAll("_", " ")}</td><td><Badge tone={payment.status === "posted" ? "green" : "red"}>{payment.status}</Badge></td><td className={styles.money}>{formatMoney(payment.amount, payment.currency)}</td><td className={styles.money}>{formatMoney(payment.unallocated_amount, payment.currency)}</td></tr>)}</tbody></table>{!accounts.payments.length ? <div className={styles.empty}>No payments recorded.</div> : null}</section> : null}

      {tab === "customers" ? <section className={styles.documentTable}><table><thead><tr><th>Customer</th><th className={styles.money}>Issued</th><th className={styles.money}>Received</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Credit</th><th className={styles.money}>Net balance</th></tr></thead><tbody>{accounts.customerBalances.map((balance) => <tr key={balance.customer_id}><td><div className={styles.reference}><strong>{balance.customer_name}</strong><span>{balance.customer_code}{balance.company ? ` · ${balance.company}` : ""}</span></div></td><td className={styles.money}>{formatMoney(balance.issued_amount, currency)}</td><td className={styles.money}>{formatMoney(balance.received_amount, currency)}</td><td className={styles.money}>{formatMoney(balance.outstanding_amount, currency)}</td><td className={styles.money}>{formatMoney(balance.unallocated_credit, currency)}</td><td className={styles.money}><strong>{formatMoney(balance.net_balance, currency)}</strong></td></tr>)}</tbody></table>{!accounts.customerBalances.length ? <div className={styles.empty}>No customer balances yet.</div> : null}</section> : null}

      <Dialog open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title="New Invoice" description="Prepare the draft now. Final numbering happens when the Invoice is issued."><form onSubmit={saveInvoice}><div className={styles.formGrid}><label>Customer<select required value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select></label><label>Supply date<input type="date" required value={invoiceSupplyDate} onChange={(event) => setInvoiceSupplyDate(event.target.value)} /></label><label>Due date<input type="date" required value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label><label>Description<input required value={invoiceDescription} onChange={(event) => setInvoiceDescription(event.target.value)} /></label><label className={styles.full}>VAT / legal treatment note<input placeholder="Only when needed, e.g. Reverse charge" value={invoiceVatNote} onChange={(event) => setInvoiceVatNote(event.target.value)} /></label></div><div className={styles.lineEditor}>{invoiceLines.map((line, index) => <div className={styles.lineRow} key={line.id}><label>Type<select value={line.kind} onChange={(event) => chooseCatalogue(index, event.target.value as DraftLine["kind"], "")}><option value="product">Product</option><option value="service">Service</option><option value="manual">Manual</option></select></label>{line.kind !== "manual" ? <label>Item<select required value={line.sourceId} onChange={(event) => chooseCatalogue(index, line.kind, event.target.value)}><option value="">Choose…</option>{line.kind === "product" ? business.products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>) : business.services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label> : <><label>Code<input value={line.code} onChange={(event) => updateLine(index, { code: event.target.value })} /></label><label>Description<input required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></label></>}<label>Qty<input type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label><label>Unit price<input type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label><label>VAT %<input type="number" min="0" max="100" step="0.01" required value={line.vatRate} onChange={(event) => updateLine(index, { vatRate: event.target.value })} /></label><Button type="button" variant="quiet" disabled={invoiceLines.length === 1} onClick={() => setInvoiceLines((current) => current.filter((_, i) => i !== index))}>Remove</Button></div>)}</div><Button type="button" variant="secondary" onClick={() => setInvoiceLines((current) => [...current, blankLine(Number(business.settings.vat_rate ?? 0))])}><Plus size={14} /> Add line</Button><div className={styles.formGrid} style={{ marginTop: 14 }}><label className={styles.full}>Notes<textarea rows={3} value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} /></label></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setInvoiceOpen(false)}>Cancel</Button><Button type="submit">Save Draft</Button></div></form></Dialog>

      <Dialog open={creditOpen} onClose={() => setCreditOpen(false)} title="New Credit Note" description="Credit specific quantities from an issued Invoice. The original Invoice remains in history."><form onSubmit={saveCredit}><div className={styles.formGrid}><label className={styles.full}>Invoice<select required value={creditInvoiceId} onChange={(event) => { const id = event.target.value; const invoice = accounts.invoices.find((item) => item.id === id); setCreditInvoiceId(id); setCreditQuantities(Object.fromEntries((invoice?.invoice_lines ?? []).map((line) => [line.id, "0"]))); }}>{accounts.invoices.filter((invoice) => !["draft", "void"].includes(invoice.display_status) && invoice.invoice_lines.length).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {invoice.customer_name_snapshot}</option>)}</select></label><label className={styles.full}>Reason<input required minLength={5} value={creditReason} onChange={(event) => setCreditReason(event.target.value)} /></label></div>{selectedCreditInvoice ? <div className={styles.creditLines}>{selectedCreditInvoice.invoice_lines.map((line) => <label key={line.id}><span><strong>{line.code_snapshot}</strong> {line.description_snapshot}<small>Original qty {line.quantity} · {formatMoney(line.total_amount, selectedCreditInvoice.currency)}</small></span><input type="number" min="0" max={line.quantity} step="0.001" value={creditQuantities[line.id] ?? "0"} onChange={(event) => setCreditQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>)}</div> : null}<label className={styles.longField}>Notes<textarea rows={3} value={creditNotes} onChange={(event) => setCreditNotes(event.target.value)} /></label><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setCreditOpen(false)}>Cancel</Button><Button type="submit">Save Credit Note Draft</Button></div></form></Dialog>

      <Dialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} title="New Delivery Note" description="Delivery Notes carry quantities and delivery details only. They do not change the customer balance."><form onSubmit={saveDelivery}><div className={styles.formGrid}><label>Source<select value={deliverySourceType} onChange={(event) => changeDeliverySource(event.target.value as "invoice" | "sale", (event.target.value === "invoice" ? sources.invoices : sources.sales)[0]?.id ?? "")}><option value="invoice">Invoice</option><option value="sale">Sale</option></select></label><label>{deliverySourceType === "invoice" ? "Invoice" : "Sale"}<select required value={deliverySourceId} onChange={(event) => changeDeliverySource(deliverySourceType, event.target.value)}>{(deliverySourceType === "invoice" ? sources.invoices : sources.sales).map((source) => <option key={source.id} value={source.id}>{source.number ?? source.reference} · {customers.find((customer) => customer.id === source.customer_id)?.name ?? "Customer"}</option>)}</select></label><label>Delivery date<input type="date" required value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label><label className={styles.full}>Delivery address<input required value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></label></div><div className={styles.creditLines}>{deliverySourceLines.map((line) => <label key={line.id}><span><strong>{line.code_snapshot}</strong> {line.description_snapshot}<small>Available qty {line.quantity}</small></span><input type="number" min="0" max={line.quantity} step="0.001" value={deliveryQuantities[line.id] ?? String(line.quantity)} onChange={(event) => setDeliveryQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>)}</div><label className={styles.longField}>Notes<textarea rows={3} value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></label><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setDeliveryOpen(false)}>Cancel</Button><Button type="submit">Save Delivery Note Draft</Button></div></form></Dialog>

      <Dialog open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" description="Record money received. Banking reconciliation remains separate."><form onSubmit={savePayment}><div className={styles.formGrid}><label>Customer<select required value={paymentCustomerId} onChange={(event) => { setPaymentCustomerId(event.target.value); setPaymentInvoiceId(""); }}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Amount<input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label><label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label><label>Allocate to Invoice<select value={paymentInvoiceId} onChange={(event) => { const id = event.target.value; setPaymentInvoiceId(id); const invoice = accounts.invoices.find((item) => item.id === id); if (invoice) setPaymentAmount(String(invoice.outstanding_amount)); }}><option value="">Leave unallocated</option>{accounts.invoices.filter((invoice) => invoice.customer_id === paymentCustomerId && Number(invoice.outstanding_amount) > 0 && !["draft", "void", "paid"].includes(invoice.display_status)).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {formatMoney(invoice.outstanding_amount, invoice.currency)}</option>)}</select></label></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button type="submit">Record Payment</Button></div></form></Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Business document setup" description="These details appear on issued Tax Invoices and Credit Notes."><form onSubmit={saveSettings}><div className={styles.formGrid}><label className={styles.full}>Business address<input required value={settingsDraft.businessAddress} onChange={(event) => setSettingsDraft({ ...settingsDraft, businessAddress: event.target.value })} /></label><label>VAT number<input required value={settingsDraft.vatNumber} onChange={(event) => setSettingsDraft({ ...settingsDraft, vatNumber: event.target.value })} /></label><label>Default payment terms (days)<input type="number" min="0" max="365" required value={settingsDraft.defaultPaymentTermsDays} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultPaymentTermsDays: event.target.value })} /></label><label>Credit Note prefix<input maxLength={8} required value={settingsDraft.creditNotePrefix} onChange={(event) => setSettingsDraft({ ...settingsDraft, creditNotePrefix: event.target.value.toUpperCase() })} /></label><label>Delivery Note prefix<input maxLength={8} required value={settingsDraft.deliveryNotePrefix} onChange={(event) => setSettingsDraft({ ...settingsDraft, deliveryNotePrefix: event.target.value.toUpperCase() })} /></label></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button type="submit" disabled={!online || busy}>Save Setup</Button></div></form></Dialog>
    </>
  );
}

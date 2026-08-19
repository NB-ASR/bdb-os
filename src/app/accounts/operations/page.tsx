"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Banknote,
  Download,
  FileMinus2,
  FileText,
  Mail,
  MessageSquareText,
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
type LineType = "product" | "service";
type DeliverySourceType = "manual" | "invoice" | "sale";
type CreditMode = "full" | "quantity";

type Customer = { id: string; code: string; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; vat_number: string | null };
type Product = { id: string; sku: string; name: string; selling_price: number | null; vat_rate: number; purpose: string };
type Service = { id: string; code: string; name: string; price: number | null; vat_rate: number };
type InvoiceLine = { id: string; line_number: number; line_type: "product" | "service" | "manual"; product_id: string | null; service_id: string | null; code_snapshot: string; description_snapshot: string; quantity: number; unit_price: number; gross_amount?: number; discount_amount: number; net_amount?: number; vat_rate: number; vat_amount?: number; total_amount: number };
type Invoice = { id: string; number: string; customer_id: string; source_sale_id: string | null; issued_at: string; due_at: string | null; description: string; notes: string | null; currency: string; status: string; display_status: string; payment_status: string; total_amount: number; adjusted_total_amount: number; credited_amount: number; allocated_amount: number; outstanding_amount: number; version: number; sales_order_reference: string | null; invoice_lines: InvoiceLine[] };
type CreditNoteLine = { id: string; source_invoice_line_id: string | null; line_number: number; code_snapshot: string; description_snapshot: string; quantity: number; total_amount: number };
type CreditNote = { id: string; number: string; invoice_id: string; customer_id: string; currency: string; reason: string; status: "draft" | "issued"; total_amount: number; version: number; issued_at: string | null; created_at: string; sales_order_reference: string | null; credit_note_lines: CreditNoteLine[] };
type DeliveryNoteLine = { id: string; source_invoice_line_id: string | null; source_sale_line_id: string | null; code_snapshot: string; description_snapshot: string; quantity: number };
type DeliveryNote = { id: string; number: string; source_invoice_id: string | null; source_sale_id: string | null; customer_id: string; customer_name_snapshot: string; delivery_address: string | null; delivery_date: string; status: "draft" | "issued"; notes: string | null; version: number; created_at: string; delivery_note_lines: DeliveryNoteLine[] };
type Payment = { id: string; reference: string; customer_id: string; customer_name_snapshot: string; currency: string; amount: number; payment_method: PaymentMethod; external_reference: string | null; received_at: string; status: "posted" | "reversed"; version: number; allocated_amount: number; unallocated_amount: number };
type CustomerBalance = { customer_id: string; customer_code: string; customer_name: string; company: string | null; outstanding_amount: number; unallocated_credit: number; net_balance: number; balance_status: "amount_due" | "customer_credit" | "clear" };
type DocumentIndex = { workspace_id: string; document_type: DocumentType; id: string; number: string; customer_id: string; customer_name: string; document_date: string; status: string; currency: string | null; total_amount: number | null; balance_amount: number | null; source_invoice_id: string | null; source_sale_id: string | null; reason: string | null };
type SaleSource = { id: string; reference: string; customer_id: string; total_amount: number; sale_lines: Array<{ id: string; code_snapshot: string; description_snapshot: string; quantity: number }> };
type DocumentNote = { id: string; note: string; created_at: string; created_by: string };
type DraftLine = { id: string; lineType: LineType; sourceId: string; description: string; quantity: string; unitPrice: string; discountPercent: string; vatRate: string };
type DeliveryDraftLine = { id: string; sourceLineId: string; code: string; description: string; selected: boolean; quantity: string };
type CreditDraftLine = { id: string; sourceLineId: string; code: string; description: string; originalQuantity: number; remainingQuantity: number; totalAmount: number; selected: boolean; quantity: string };

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
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function draftLine(type: LineType = "product"): DraftLine {
  return { id: crypto.randomUUID(), lineType: type, sourceId: "", description: "", quantity: "1", unitPrice: "", discountPercent: "0", vatRate: "0" };
}
function manualDeliveryLine(): DeliveryDraftLine {
  return { id: crypto.randomUUID(), sourceLineId: "", code: "", description: "", selected: true, quantity: "1" };
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
function round4(value: number) { return Math.round((value + Number.EPSILON) * 10000) / 10000; }

export default function AccountsPage() {
  const [bundle, setBundle] = useState<AccountsBundle>(emptyBundle);
  const bundleRef = useRef(bundle);
  const [tab, setTab] = useState<Tab>("documents");
  const [filter, setFilter] = useState<DocumentType>("invoice");
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
  const [invoiceSalesOrderReference, setInvoiceSalesOrderReference] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<DraftLine[]>([]);

  const [creditOpen, setCreditOpen] = useState(false);
  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditInvoiceNumber, setCreditInvoiceNumber] = useState("");
  const [creditMode, setCreditMode] = useState<CreditMode>("full");
  const [creditLines, setCreditLines] = useState<CreditDraftLine[]>([]);
  const [creditReason, setCreditReason] = useState("");

  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliverySourceType, setDeliverySourceType] = useState<DeliverySourceType>("manual");
  const [deliverySourceId, setDeliverySourceId] = useState("");
  const [deliveryCustomerId, setDeliveryCustomerId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(isoDate());
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryLines, setDeliveryLines] = useState<DeliveryDraftLine[]>([]);
  const [saleSources, setSaleSources] = useState<SaleSource[]>([]);

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDocument, setNotesDocument] = useState<DocumentIndex | null>(null);
  const [documentNotes, setDocumentNotes] = useState<DocumentNote[]>([]);
  const [newDocumentNote, setNewDocumentNote] = useState("");

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
        setNotice("Showing the last verified Accounts snapshot. New changes can remain Pending sync until reconnection.");
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
    if (requiresOnline && !online) return setError("Reconnect before issuing this legacy draft."), false;
    const command = enqueueAccountsCommand(bundle.workspaceId, action, payload);
    refreshQueue();
    if (!online) { setNotice("Change queued as Pending sync. Final document numbers are assigned safely after reconnection."); return true; }
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
    const createdAt = (document: DocumentIndex) => {
      if (document.document_type === "credit_note") {
        return bundle.creditNotes.find((note) => note.id === document.id)?.created_at ?? document.document_date;
      }
      if (document.document_type === "delivery_note") {
        return bundle.deliveryNotes.find((note) => note.id === document.id)?.created_at ?? document.document_date;
      }
      return bundle.invoices.find((invoice) => invoice.id === document.id)?.issued_at ?? document.document_date;
    };
    return bundle.documents
      .filter((document) => document.document_type === filter
        && (!needle || [document.number, document.customer_name, document.status, documentLabel(document.document_type)].join(" ").toLowerCase().includes(needle)))
      .sort((left, right) => new Date(createdAt(right)).getTime() - new Date(createdAt(left)).getTime());
  }, [bundle.creditNotes, bundle.deliveryNotes, bundle.documents, bundle.invoices, filter, query]);

  const invoicePreview = useMemo(() => calculateInvoiceTotals(invoiceLines.map((line) => {
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);
    const discountPercent = Math.min(Math.max(Number(line.discountPercent || 0), 0), 100);
    return { quantity, unitPrice, discountAmount: round4(quantity * unitPrice * discountPercent / 100), vatRate: Number(line.vatRate || 0) };
  })), [invoiceLines]);
  const invoiceNeedsSalesOrder = invoiceLines.some((line) => line.lineType === "product");
  const eligibleCreditInvoices = bundle.invoices.filter((invoice) => !["draft", "void", "cancelled"].includes(invoice.display_status) && Number(invoice.adjusted_total_amount) > 0);
  const selectedCreditInvoice = eligibleCreditInvoices.find((invoice) => invoice.id === creditInvoiceId) ?? null;
  const currency = bundle.settings.currency || "EUR";

  function preferredLineType(): LineType { return bundle.products.length ? "product" : "service"; }
  function openInvoice() {
    setNewMenu(false);
    if (!bundle.customers.length) return setError("Add a Customer before creating an Invoice. Every Invoice must belong to a real Customer record.");
    if (!bundle.products.length && !bundle.services.length) return setError("Add a Product or Service before creating an Invoice. Invoice lines must come from the catalogue.");
    setInvoiceCustomerId(bundle.customers[0]?.id ?? "");
    setInvoiceDescription(""); setInvoiceNotes(""); setInvoiceSalesOrderReference(""); setInvoiceLines([draftLine(preferredLineType())]); setInvoiceOpen(true);
  }
  function catalogueChange(index: number, sourceId: string) {
    setInvoiceLines((current) => current.map((line, itemIndex) => {
      if (itemIndex !== index) return line;
      if (line.lineType === "product") {
        const product = bundle.products.find((item) => item.id === sourceId);
        return { ...line, sourceId, description: product?.name ?? "", unitPrice: product?.selling_price == null ? "" : String(product.selling_price), vatRate: String(product?.vat_rate ?? 0) };
      }
      const service = bundle.services.find((item) => item.id === sourceId);
      return { ...line, sourceId, description: service?.name ?? "", unitPrice: service?.price == null ? "" : String(service.price), vatRate: String(service?.vat_rate ?? 0) };
    }));
  }
  async function saveInvoice(event: FormEvent) {
    event.preventDefault();
    if (invoiceNeedsSalesOrder && !invoiceSalesOrderReference.trim()) return setError("A Sales Order (SO) number is required because this Invoice contains Products.");
    if (invoiceLines.some((line) => !line.sourceId)) return setError("Choose a catalogue Product or Service for every Invoice line.");
    const lines = invoiceLines.map((line) => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const discountPercent = Math.min(Math.max(Number(line.discountPercent || 0), 0), 100);
      return {
        id: line.id, lineType: line.lineType,
        productId: line.lineType === "product" ? line.sourceId : null,
        serviceId: line.lineType === "service" ? line.sourceId : null,
        description: line.description, quantity, unitPrice,
        discountPercent, discountAmount: round4(quantity * unitPrice * discountPercent / 100), vatRate: Number(line.vatRate),
      };
    });
    const ok = await dispatch("invoice-create-manual", {
      id: crypto.randomUUID(), customerId: invoiceCustomerId, description: invoiceDescription || "Invoice", notes: invoiceNotes,
      salesOrderReference: invoiceNeedsSalesOrder ? invoiceSalesOrderReference.trim() : null, lines,
    });
    if (ok) setInvoiceOpen(false);
  }

  function creditedQuantity(invoiceId: string, sourceLineId: string) {
    return bundle.creditNotes.filter((note) => note.invoice_id === invoiceId && note.status === "issued")
      .flatMap((note) => note.credit_note_lines)
      .filter((line) => line.source_invoice_line_id === sourceLineId)
      .reduce((sum, line) => sum + Number(line.quantity), 0);
  }
  function prepareCreditLines(invoice: Invoice): CreditDraftLine[] {
    return invoice.invoice_lines.map((line) => {
      const remainingQuantity = Math.max(Number(line.quantity) - creditedQuantity(invoice.id, line.id), 0);
      return {
        id: crypto.randomUUID(), sourceLineId: line.id, code: line.code_snapshot, description: line.description_snapshot,
        originalQuantity: Number(line.quantity), remainingQuantity, totalAmount: Number(line.total_amount), selected: remainingQuantity > 0, quantity: String(remainingQuantity),
      };
    }).filter((line) => line.remainingQuantity > 0);
  }
  function resolveCreditInvoiceNumber(value: string) {
    setCreditInvoiceNumber(value);
    const target = eligibleCreditInvoices.find((invoice) => invoice.number.toLowerCase() === value.trim().toLowerCase());
    setCreditInvoiceId(target?.id ?? ""); setCreditLines(target ? prepareCreditLines(target) : []); setCreditMode("full");
  }
  function openCredit() {
    setNewMenu(false);
    if (!eligibleCreditInvoices.length) return setError("There is no issued Invoice with value remaining to credit.");
    setCreditReason(""); setCreditMode("full"); setCreditInvoiceId(""); setCreditInvoiceNumber(""); setCreditLines([]);
    setCreditOpen(true);
  }
  const creditPreview = useMemo(() => {
    if (!selectedCreditInvoice) return 0;
    return round4(creditLines.filter((line) => creditMode === "full" || line.selected).reduce((sum, line) => {
      const source = selectedCreditInvoice.invoice_lines.find((item) => item.id === line.sourceLineId);
      const requested = creditMode === "full" ? line.remainingQuantity : Number(line.quantity || 0);
      if (!source || requested <= 0) return sum;
      return sum + Number(source.total_amount) * requested / Math.max(Number(source.quantity), 0.000001);
    }, 0));
  }, [creditLines, creditMode, selectedCreditInvoice]);
  async function saveCredit(event: FormEvent) {
    event.preventDefault();
    const invoice = eligibleCreditInvoices.find((item) => item.number.toLowerCase() === creditInvoiceNumber.trim().toLowerCase());
    if (!invoice || invoice.id !== creditInvoiceId) return setError("Enter the exact issued Invoice number before creating the Credit Note.");
    const chosen = creditLines.filter((line) => creditMode === "full" || line.selected).map((line) => ({
      id: line.id,
      sourceInvoiceLineId: line.sourceLineId,
      quantity: creditMode === "full" ? line.remainingQuantity : Number(line.quantity),
    })).filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (!chosen.length) return setError("Choose at least one Product or Service quantity to credit.");
    const invalid = chosen.find((line) => {
      const source = creditLines.find((item) => item.sourceLineId === line.sourceInvoiceLineId);
      return !source || line.quantity > source.remainingQuantity;
    });
    if (invalid) return setError("A Credit Note quantity cannot exceed the remaining quantity from the original Invoice.");
    const ok = await dispatch("credit-note-create", { id: crypto.randomUUID(), invoiceId: invoice.id, reason: creditReason, lines: chosen });
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
      setDeliveryCustomerId(invoice?.customer_id ?? ""); setDeliveryAddress(customer?.address ?? "");
      setDeliveryLines((invoice?.invoice_lines ?? []).map((line) => ({ id: crypto.randomUUID(), sourceLineId: line.id, code: line.code_snapshot, description: line.description_snapshot, selected: true, quantity: String(line.quantity) })));
    } else {
      const sale = saleSources.find((item) => item.id === sourceId);
      const customer = bundle.customers.find((item) => item.id === sale?.customer_id);
      setDeliveryCustomerId(sale?.customer_id ?? ""); setDeliveryAddress(customer?.address ?? "");
      setDeliveryLines((sale?.sale_lines ?? []).map((line) => ({ id: crypto.randomUUID(), sourceLineId: line.id, code: line.code_snapshot, description: line.description_snapshot, selected: true, quantity: String(line.quantity) })));
    }
  }
  async function openDelivery() {
    setNewMenu(false); await loadSaleSources(); setDeliveryDate(isoDate()); setDeliveryNotes("");
    const firstCustomer = bundle.customers[0]; setDeliverySourceType("manual"); setDeliverySourceId(""); setDeliveryCustomerId(firstCustomer?.id ?? "");
    setDeliveryAddress(firstCustomer?.address ?? ""); setDeliveryLines([manualDeliveryLine()]);
    setDeliveryOpen(true);
  }
  function changeDeliverySource(type: DeliverySourceType) {
    setDeliverySourceType(type); setDeliverySourceId("");
    if (type === "manual") {
      const customer = bundle.customers.find((item) => item.id === deliveryCustomerId) ?? bundle.customers[0];
      setDeliveryCustomerId(customer?.id ?? ""); setDeliveryAddress(customer?.address ?? ""); setDeliveryLines([manualDeliveryLine()]);
    } else setDeliveryLines([]);
  }
  async function saveDelivery(event: FormEvent) {
    event.preventDefault();
    const selected = deliveryLines.filter((line) => line.selected);
    const lines = deliverySourceType === "manual"
      ? selected.map((line) => ({ id: line.id, code: line.code, description: line.description, quantity: Number(line.quantity) }))
      : selected.map((line) => ({ id: line.id, sourceLineId: line.sourceLineId, quantity: Number(line.quantity) }));
    if (!lines.length) return setError("Add at least one Delivery Note line.");
    const ok = await dispatch("delivery-note-create", {
      id: crypto.randomUUID(), sourceType: deliverySourceType, sourceId: deliverySourceType === "manual" ? null : deliverySourceId,
      customerId: deliverySourceType === "manual" ? deliveryCustomerId : null, deliveryDate, deliveryAddress, notes: deliveryNotes, lines,
    });
    if (ok) setDeliveryOpen(false);
  }

  async function openDocumentNotes(document: DocumentIndex) {
    setNotesDocument(document); setNewDocumentNote("");
    const initial: DocumentNote[] = [];
    if (document.document_type === "delivery_note") {
      const delivery = bundle.deliveryNotes.find((item) => item.id === document.id);
      if (delivery?.notes) initial.push({ id: `initial-${delivery.id}`, note: delivery.notes, created_at: delivery.created_at, created_by: "Created with document" });
    }
    setDocumentNotes(initial); setNotesOpen(true);
    if (!online || !bundle.workspaceId) return;
    const params = new URLSearchParams({ workspaceId: bundle.workspaceId, documentType: document.document_type, documentId: document.id });
    const response = await fetch(`/api/accounts/final-documents?${params.toString()}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.ok) setDocumentNotes([...initial, ...(json.result?.notes ?? [])]);
  }
  async function addDocumentNote(event: FormEvent) {
    event.preventDefault(); if (!notesDocument || !newDocumentNote.trim()) return;
    const noteText = newDocumentNote.trim();
    const ok = await dispatch("document-note-add", { id: crypto.randomUUID(), documentType: notesDocument.document_type, documentId: notesDocument.id, note: noteText });
    if (!ok) return; setNewDocumentNote(""); if (online) await openDocumentNotes(notesDocument); else setNotesOpen(false);
  }
  function openPayment() {
    const customerId = bundle.customers[0]?.id ?? "";
    setPaymentCustomerId(customerId); setPaymentInvoiceId(""); setPaymentAmount("");
    setPaymentMethod("bank_transfer"); setPaymentReceivedAt(localDateTime()); setPaymentReference(""); setPaymentOpen(true);
  }
  async function savePayment(event: FormEvent) {
    event.preventDefault(); const amount = Number(paymentAmount);
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
  function emailDocument(document: DocumentIndex) {
    const customer = bundle.customers.find((item) => item.id === document.customer_id);
    if (!customer?.email) return setError("This Customer does not have an email address recorded.");
    const subject = `${documentLabel(document.document_type)} ${document.status === "draft" ? "Draft" : document.number}`;
    const body = `Hello ${customer.name},\n\nPlease find your ${documentLabel(document.document_type).toLowerCase()} attached.\n\nBDB OS does not yet send external email automatically, so download the PDF and attach it in your email application.`;
    window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setNotice("Email composer opened. Attach the downloaded PDF before sending; BDB OS has not recorded external delivery.");
  }

  function linkedCreditNotes(invoiceId: string) {
    return bundle.creditNotes
      .filter((note) => note.invoice_id === invoiceId && note.status === "issued")
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }
  function documentActions(document: DocumentIndex) {
    return <div className={styles.rowActions}>
      <Button variant="quiet" onClick={() => window.open(businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "html"), "_blank")}><MoreHorizontal size={15} /> View</Button>
      <Button variant="quiet" onClick={() => window.open(businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "html", true), "_blank")}><Printer size={15} /> Print</Button>
      <a className={styles.actionLink} href={businessDocumentUrl(bundle.workspaceId, document.document_type, document.id, "pdf")}><Download size={15} /> PDF</a>
      <Button variant="quiet" onClick={() => void openDocumentNotes(document)}><MessageSquareText size={15} /> Notes</Button>
      <Button variant="quiet" onClick={() => emailDocument(document)}><Mail size={15} /> Email</Button>
    </div>;
  }
  function documentStatusTone(document: DocumentIndex): "neutral" | "green" | "red" | "gold" {
    if (document.status === "draft") return "neutral";
    if (document.status === "paid" || document.status === "cancelled") return "green";
    if (document.status === "overdue") return "red";
    return "gold";
  }

  const canWrite = Boolean(bundle.workspaceId) && !supportReadOnly;
  const identityIncomplete = !bundle.settings.business_address;

  return <>
    <PageHeader eyebrow="Business documents & balances" title="Accounts" description="Issued documents stay permanent. Credits, Payments and balances remain connected underneath without rewriting the original Invoice." action={<div className={styles.headerActions}><Button variant="quiet" onClick={() => void openIdentity()}><Settings2 size={16} /> Document setup</Button><div className={styles.newWrap}><Button disabled={!canWrite} onClick={() => setNewMenu((value) => !value)}><Plus size={17} /> New Document</Button>{newMenu ? <div className={styles.newMenu}><button onClick={openInvoice}><FileText size={18} /><span><strong>Invoice</strong><small>Catalogue Products & Services</small></span></button><button onClick={() => openCredit()}><FileMinus2 size={18} /><span><strong>Credit Note</strong><small>Cancel or return quantities</small></span></button><button onClick={() => void openDelivery()}><PackageCheck size={18} /><span><strong>Delivery Note</strong><small>Standalone or linked delivery</small></span></button></div> : null}</div></div>} />

    <nav className={styles.tabs} aria-label="Accounts sections">{(["documents", "payments", "customers"] as const).map((item) => <button key={item} data-active={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {!online ? <div className={styles.attention}><TriangleAlert size={17} /><div><strong>Offline</strong><span>New documents can be queued as Pending sync. Their permanent numbers are assigned only after safe synchronisation.</span></div></div> : null}
    {queue.length > 0 ? <div className={styles.attention}><RefreshCw size={17} /><div><strong>{queue.length} change{queue.length === 1 ? "" : "s"} Pending sync</strong><span>Commands replay in order and stop safely at the first conflict.</span></div></div> : null}
    {identityIncomplete ? <div className={styles.quietNotice}><span>Before real client use, complete the business address and any VAT/company details that apply under <button onClick={() => void openIdentity()}>Document setup</button>.</span></div> : null}
    {error ? <div className="review-callout"><TriangleAlert size={18} /><div><strong>Accounts needs attention</strong><p>{error}</p></div></div> : null}
    {notice ? <div className={styles.quietNotice}><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div> : null}

    {tab === "documents" ? <section className={styles.section}>
      <div className={styles.documentToolbar}>
        <div className={styles.filters}>{(["invoice", "credit_note", "delivery_note"] as const).map((item) => <button key={item} data-active={filter === item} onClick={() => setFilter(item)}>{documentLabel(item)}s</button>)}</div>
        <input className="filter-input" placeholder={`Search ${documentLabel(filter)}s or Customers…`} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {filter === "invoice" ? <Card className="table-card">
        <div className={styles.tableScroll}><table><thead><tr>
          <th>Document</th><th>Customer</th><th>Date</th><th>Status</th>
          <th className={styles.money}>Original total</th><th>Credit Note</th><th className={styles.money}>Remaining balance</th><th aria-label="Actions" />
        </tr></thead><tbody>{documents.map((document) => {
          const invoice = bundle.invoices.find((item) => item.id === document.id);
          if (!invoice) return null;
          const creditNotes = linkedCreditNotes(invoice.id);
          const creditedTotal = creditNotes.reduce((sum, note) => sum + Number(note.total_amount), 0);
          return <tr key={document.id}>
            <td><div className={styles.documentCell}><span className={styles.documentIcon}><FileText size={16} /></span><span><strong>Invoice</strong><small>{document.status === "draft" ? "Legacy draft" : document.number}{invoice.sales_order_reference ? ` · SO ${invoice.sales_order_reference}` : ""}</small></span></div></td>
            <td>{document.customer_name}</td>
            <td>{formatDate(document.document_date)}</td>
            <td><Badge tone={documentStatusTone(document)}>{document.status.replaceAll("_", " ")}</Badge></td>
            <td className={styles.money}>{formatMoney(Number(document.total_amount ?? invoice.total_amount), invoice.currency)}</td>
            <td>{creditNotes.length ? <span><strong>{creditNotes.map((note) => note.number).join(", ")}</strong><small className={styles.subtle}>{formatMoney(creditedTotal, invoice.currency)} credited</small></span> : "—"}</td>
            <td className={styles.money}><strong>{formatMoney(Number(invoice.outstanding_amount ?? 0), invoice.currency)}</strong></td>
            <td>{documentActions(document)}</td>
          </tr>;
        })}</tbody></table></div>
        {!documents.length ? <div className={styles.empty}><FileText size={26} /><strong>No Invoices yet</strong><span>Create an Invoice from New Document.</span></div> : null}
      </Card> : null}

      {filter === "credit_note" ? <Card className="table-card">
        <div className={styles.tableScroll}><table><thead><tr>
          <th>Document</th><th>Customer</th><th>Date</th><th>Status</th><th className={styles.money}>Total</th><th aria-label="Actions" />
        </tr></thead><tbody>{documents.map((document) => <tr key={document.id}>
          <td><div className={styles.documentCell}><span className={styles.documentIcon}><FileMinus2 size={16} /></span><span><strong>Credit Note</strong><small>{document.status === "draft" ? "Legacy draft" : document.number}</small></span></div></td>
          <td>{document.customer_name}</td>
          <td>{formatDate(document.document_date)}</td>
          <td><Badge tone={documentStatusTone(document)}>{document.status.replaceAll("_", " ")}</Badge></td>
          <td className={styles.money}>{formatMoney(Number(document.total_amount ?? 0), document.currency ?? currency)}</td>
          <td>{documentActions(document)}</td>
        </tr>)}</tbody></table></div>
        {!documents.length ? <div className={styles.empty}><FileMinus2 size={26} /><strong>No Credit Notes yet</strong><span>Credit Notes appear here in creation order.</span></div> : null}
      </Card> : null}

      {filter === "delivery_note" ? <Card className="table-card">
        <div className={styles.tableScroll}><table><thead><tr>
          <th>Document</th><th>Customer</th><th>Date</th><th>Status</th><th aria-label="Actions" />
        </tr></thead><tbody>{documents.map((document) => <tr key={document.id}>
          <td><div className={styles.documentCell}><span className={styles.documentIcon}><PackageCheck size={16} /></span><span><strong>Delivery Note</strong><small>{document.status === "draft" ? "Legacy draft" : document.number}</small></span></div></td>
          <td>{document.customer_name}</td>
          <td>{formatDate(document.document_date)}</td>
          <td><Badge tone={documentStatusTone(document)}>{document.status.replaceAll("_", " ")}</Badge></td>
          <td>{documentActions(document)}</td>
        </tr>)}</tbody></table></div>
        {!documents.length ? <div className={styles.empty}><PackageCheck size={26} /><strong>No Delivery Notes yet</strong><span>Delivery Notes appear here in creation order.</span></div> : null}
      </Card> : null}
    </section> : null}

    {tab === "payments" ? <section className={styles.section}><SectionHeading title="Payments" description="Money received stays separate from the permanent Invoice document." action={<Button disabled={!canWrite || bundle.customers.length === 0} onClick={() => openPayment()}><Banknote size={16} /> Record Payment</Button>} /><Card className="table-card"><div className={styles.tableScroll}><table><thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th>Method</th><th>Status</th><th className={styles.money}>Amount</th><th className={styles.money}>Unallocated</th></tr></thead><tbody>{bundle.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.reference}</strong>{payment.external_reference ? <small className={styles.subtle}>{payment.external_reference}</small> : null}</td><td>{payment.customer_name_snapshot}</td><td>{formatDate(payment.received_at)}</td><td>{payment.payment_method.replaceAll("_", " ")}</td><td><Badge tone={payment.status === "posted" ? "green" : "neutral"}>{payment.status}</Badge></td><td className={styles.money}>{formatMoney(Number(payment.amount), payment.currency)}</td><td className={styles.money}>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</td></tr>)}</tbody></table></div>{!bundle.payments.length ? <div className={styles.empty}><Banknote size={24} /><strong>No Payments recorded</strong></div> : null}</Card></section> : null}
    {tab === "customers" ? <section className={styles.section}><SectionHeading title="Customer balances" description="Running balance = issued Invoices minus Credit Notes and Payments. The documents themselves do not change." /><Card className="table-card"><div className={styles.tableScroll}><table><thead><tr><th>Customer</th><th>Code</th><th>Status</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Credit</th><th className={styles.money}>Net balance</th></tr></thead><tbody>{bundle.customerBalances.map((balance) => <tr key={balance.customer_id}><td><strong>{balance.customer_name}</strong>{balance.company ? <small className={styles.subtle}>{balance.company}</small> : null}</td><td>{balance.customer_code}</td><td><Badge tone={balance.balance_status === "amount_due" ? "gold" : balance.balance_status === "customer_credit" ? "green" : "neutral"}>{balance.balance_status.replaceAll("_", " ")}</Badge></td><td className={styles.money}>{formatMoney(Number(balance.outstanding_amount), currency)}</td><td className={styles.money}>{formatMoney(Number(balance.unallocated_credit), currency)}</td><td className={styles.money}><strong>{formatMoney(Number(balance.net_balance), currency)}</strong></td></tr>)}</tbody></table></div></Card></section> : null}
    {loading && !bundle.workspaceId ? <Card><div className={styles.empty}>Opening Accounts…</div></Card> : null}

    <Dialog className={styles.documentComposer} open={invoiceOpen} onClose={() => { if (!busy) setInvoiceOpen(false); }} title="New Invoice" description="Invoice only catalogue Products and Services. Catalogue price and VAT stay authoritative; use Discount % to agree a lower selling price.">
      <form onSubmit={saveInvoice} className={`${styles.formStack} ${styles.composerForm}`}>
        <section className={styles.composerSection}><div className={styles.sectionLabel}>Customer</div><div className={styles.customerChooser}><div className="field"><label>Bill to</label><select required value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select></div></div></section>
        <section className={styles.composerSection}><div className={styles.sectionHeadingRow}><div><div className={styles.sectionLabel}>Invoice items</div><p>Every line must come from Products or Services. Free-form financial lines are not allowed.</p></div><Button type="button" variant="quiet" onClick={() => setInvoiceLines((current) => [...current, draftLine(preferredLineType())])}><Plus size={15} /> Add line</Button></div><div className={styles.lineList}>{invoiceLines.map((line, index) => <div className={styles.lineRow} key={line.id}>
          <div className="field"><label>Type</label><select value={line.lineType} onChange={(event) => { const lineType = event.target.value as LineType; setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...draftLine(lineType), id: item.id } : item)); }}><option value="product" disabled={!bundle.products.length}>Product</option><option value="service" disabled={!bundle.services.length}>Service</option></select></div>
          <div className={`field ${styles.lineDescription}`}><label>{line.lineType === "product" ? "Product / SKU" : "Service / Code"}</label><select required value={line.sourceId} onChange={(event) => catalogueChange(index, event.target.value)}><option value="">Choose…</option>{line.lineType === "product" ? bundle.products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>) : bundle.services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
          <div className="field"><label>Qty</label><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></div>
          <div className="field"><label>Catalogue price <span className={styles.exVat}>(excl. VAT)</span></label><input readOnly value={line.unitPrice} /></div>
          <div className="field"><label>Discount %</label><input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(event) => setInvoiceLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountPercent: event.target.value } : item))} /></div>
          <div className="field"><label>VAT %</label><input readOnly value={line.vatRate} /></div>
          <button type="button" className={styles.removeLine} aria-label="Remove line" disabled={invoiceLines.length === 1} onClick={() => setInvoiceLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
        </div>)}</div><div className={styles.invoiceSummary} aria-label="Invoice totals preview"><div><span>Subtotal after discounts</span><strong>{formatMoney(invoicePreview.netAmount, currency)}</strong></div><div><span>VAT</span><strong>{formatMoney(invoicePreview.vatAmount, currency)}</strong></div><div className={styles.invoiceGrand}><span>Total</span><strong>{formatMoney(invoicePreview.totalAmount, currency)}</strong></div></div></section>
        {invoiceNeedsSalesOrder ? <section className={styles.composerSection}><div className={styles.sectionLabel}>Sales Order reference</div><div className={styles.formGrid}><div className={`field ${styles.full}`}><label>SO number <span className={styles.customerFacing}>Required for Products</span></label><input required maxLength={64} value={invoiceSalesOrderReference} onChange={(event) => setInvoiceSalesOrderReference(event.target.value)} placeholder="SO123" /></div></div></section> : null}
        <section className={styles.composerSection}><div className={styles.sectionLabel}>Message & internal context</div><div className={styles.copyGrid}><div className="field"><label>Description <span className={styles.customerFacing}>Visible to customer</span></label><textarea required rows={5} value={invoiceDescription} onChange={(event) => setInvoiceDescription(event.target.value)} placeholder="What is this Invoice for?" /></div><div className="field"><label>Notes <span className={styles.internalOnly}>Internal only</span></label><textarea rows={5} value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} placeholder="Private context for your team" /></div></div></section>
        <div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>Discount reduces the catalogue price before VAT. Once issued, the Invoice document never changes.</span><div><Button type="button" variant="quiet" onClick={() => setInvoiceOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>Create Invoice</Button></div></div>
      </form>
    </Dialog>

    <Dialog className={styles.documentComposer} open={creditOpen} onClose={() => { if (!busy) setCreditOpen(false); }} title="New Credit Note" description="Type the exact Invoice number manually. Credit Notes cancel the Invoice or reverse genuine Product / Service quantities — never an arbitrary amount.">
      <form onSubmit={saveCredit} className={`${styles.formStack} ${styles.composerForm}`}>
        <section className={styles.composerSection}><div className={styles.formGrid}><div className={`field ${styles.full}`}><label>Invoice number</label><input required value={creditInvoiceNumber} onChange={(event) => resolveCreditInvoiceNumber(event.target.value)} placeholder="INV001" autoComplete="off" /><small className={styles.helperText}>No suggestions are shown. BDB OS unlocks the Credit Note only after an exact Invoice number match.</small></div>{selectedCreditInvoice?.sales_order_reference ? <div className={`field ${styles.full}`}><label>SO number <span className={styles.internalOnly}>Inherited from Invoice</span></label><input readOnly value={selectedCreditInvoice.sales_order_reference} /></div> : null}</div></section>
        {selectedCreditInvoice ? <><section className={styles.composerSection}><div className={styles.sectionLabel}>What is being corrected?</div><div className={styles.formGrid}><div className="field"><label>Credit type</label><select value={creditMode} onChange={(event) => setCreditMode(event.target.value as CreditMode)}><option value="full">Full Invoice cancellation</option><option value="quantity">Product / Service quantity returned or cancelled</option></select><small className={styles.helperText}>If the selling price was wrong, fully credit the Invoice and issue a new Invoice using the correct Discount %.</small></div><div className="field"><label>Current Invoice balance</label><input readOnly value={formatMoney(Number(selectedCreditInvoice.outstanding_amount), selectedCreditInvoice.currency)} /></div></div></section>
        <section className={styles.composerSection}><div className={styles.sectionHeadingRow}><div><div className={styles.sectionLabel}>{creditMode === "full" ? "Full reversal" : "Quantities to reverse"}</div><p>{creditMode === "full" ? "All remaining uncredited quantities will be reversed using their original price, discount and VAT." : "Only select real quantities being returned or cancelled. Prices cannot be changed here."}</p></div></div><div className={styles.selectionList}>{creditLines.map((line, index) => <label key={line.id} className={styles.selectionRow}><input type="checkbox" checked={creditMode === "full" || line.selected} disabled={creditMode === "full"} onChange={(event) => setCreditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.code} · {line.description}</strong><small>Remaining quantity: {line.remainingQuantity}</small></span><input type="number" min="0.001" step="0.001" max={line.remainingQuantity} readOnly={creditMode === "full"} disabled={creditMode === "quantity" && !line.selected} value={creditMode === "full" ? String(line.remainingQuantity) : line.quantity} onChange={(event) => setCreditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div><div className={styles.invoiceSummary}><div><span>Original Invoice total</span><strong>{formatMoney(Number(selectedCreditInvoice.total_amount), selectedCreditInvoice.currency)}</strong></div><div><span>Already credited</span><strong>{formatMoney(Number(selectedCreditInvoice.credited_amount), selectedCreditInvoice.currency)}</strong></div><div className={styles.invoiceGrand}><span>Estimated Credit Note</span><strong>{formatMoney(creditPreview, selectedCreditInvoice.currency)}</strong></div></div></section></> : null}
        <section className={styles.composerSection}><div className="field"><label>Reason <span className={styles.customerFacing}>Printed on Credit Note</span></label><textarea required minLength={5} rows={3} value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Why is this Invoice or quantity being credited?" /></div></section>
        <div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>Credit Note values are derived from the original Invoice line. The original Invoice remains unchanged.</span><div><Button type="button" variant="quiet" onClick={() => setCreditOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || !selectedCreditInvoice}>Create Credit Note</Button></div></div>
      </form>
    </Dialog>

    <Dialog className={styles.documentComposer} open={deliveryOpen} onClose={() => { if (!busy) setDeliveryOpen(false); }} title="New Delivery Note" description="Create a standalone Delivery Note, or link it to an issued Invoice or completed Sale. Delivery Notes never change the customer balance."><form onSubmit={saveDelivery} className={`${styles.formStack} ${styles.composerForm}`}><section className={styles.composerSection}><div className={styles.formGrid}><div className="field"><label>Source</label><select value={deliverySourceType} onChange={(event) => changeDeliverySource(event.target.value as DeliverySourceType)}><option value="manual">Standalone Delivery Note</option><option value="invoice">Issued Invoice</option><option value="sale">Completed Sale</option></select></div>{deliverySourceType === "manual" ? <div className="field"><label>Customer</label><select required value={deliveryCustomerId} onChange={(event) => { const id = event.target.value; const customer = bundle.customers.find((item) => item.id === id); setDeliveryCustomerId(id); setDeliveryAddress(customer?.address ?? ""); }}><option value="">Choose…</option>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div> : <div className="field"><label>{deliverySourceType === "invoice" ? "Invoice" : "Sale"}</label><select required value={deliverySourceId} onChange={(event) => populateDelivery(deliverySourceType, event.target.value)}><option value="">Choose…</option>{deliverySourceType === "invoice" ? bundle.invoices.filter((invoice) => !["draft", "void", "cancelled"].includes(invoice.display_status) && invoice.invoice_lines.length).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number}</option>) : saleSources.filter((sale) => sale.sale_lines.length).map((sale) => <option key={sale.id} value={sale.id}>{sale.reference}</option>)}</select></div>}<div className="field"><label>Delivery date</label><input type="date" required value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></div><div className="field"><label>Delivery address</label><input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></div></div></section><section className={styles.composerSection}><div className={styles.sectionHeadingRow}><div><div className={styles.sectionLabel}>Items delivered</div><p>{deliverySourceType === "manual" ? "Add the goods or items exactly as they should appear on this Delivery Note." : "Choose the quantities being delivered from the linked record."}</p></div>{deliverySourceType === "manual" ? <Button type="button" variant="quiet" onClick={() => setDeliveryLines((current) => [...current, manualDeliveryLine()])}><Plus size={15} /> Add line</Button> : null}</div>{deliverySourceType === "manual" ? <div className={styles.lineList}>{deliveryLines.map((line, index) => <div className={styles.lineRow} key={line.id}><div className="field"><label>Code</label><input value={line.code} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} placeholder="Optional" /></div><div className={`field ${styles.lineDescription}`}><label>Description</label><input required value={line.description} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></div><div className="field"><label>Qty</label><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></div><button type="button" className={styles.removeLine} aria-label="Remove line" disabled={deliveryLines.length === 1} onClick={() => setDeliveryLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}</div> : <div className={styles.selectionList}>{deliveryLines.map((line, index) => <label key={line.id} className={styles.selectionRow}><input type="checkbox" checked={line.selected} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.description}</strong><small>Quantity delivered</small></span><input type="number" min="0.001" step="0.001" value={line.quantity} disabled={!line.selected} onChange={(event) => setDeliveryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div>}</section><section className={styles.composerSection}><div className="field"><label>Creation note <span className={styles.internalOnly}>Internal only</span></label><textarea rows={4} value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></div></section><div className={`${styles.dialogActions} ${styles.stickyActions}`}><span className={styles.saveHint}>Once issued, the Delivery Note itself cannot be altered.</span><div><Button type="button" variant="quiet" onClick={() => setDeliveryOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || deliveryLines.every((line) => !line.selected)}>Create Delivery Note</Button></div></div></form></Dialog>

    <Dialog open={notesOpen} onClose={() => { if (!busy) setNotesOpen(false); }} title={notesDocument ? `${documentLabel(notesDocument.document_type)} ${notesDocument.number} Notes` : "Document Notes"} description="Append internal operational context without changing the issued document."><div className={styles.formStack}><div className={styles.selectionList}>{documentNotes.length ? documentNotes.map((item) => <div className={styles.selectionRow} key={item.id}><span><strong>{item.note}</strong><small>{formatDate(item.created_at)} · {item.created_by}</small></span></div>) : <div className={styles.empty}><MessageSquareText size={22} /><strong>No notes yet</strong></div>}</div><form onSubmit={addDocumentNote} className={styles.formStack}><div className="field"><label>Add note <span className={styles.internalOnly}>Internal only</span></label><textarea required maxLength={2000} rows={4} value={newDocumentNote} onChange={(event) => setNewDocumentNote(event.target.value)} /></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setNotesOpen(false)}>Close</Button><Button type="submit" disabled={Boolean(busy) || !newDocumentNote.trim()}>Add Note</Button></div></form></div></Dialog>
    <Dialog open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false); }} title="Record Payment" description="Record money received. Payments change the running balance, never the issued Invoice document."><form onSubmit={savePayment} className={styles.formStack}><div className={styles.formGrid}><div className="field"><label>Customer</label><select required value={paymentCustomerId} disabled={Boolean(paymentInvoiceId)} onChange={(event) => setPaymentCustomerId(event.target.value)}>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div><div className="field"><label>Amount</label><input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div><div className="field"><label>Method</label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div><div className="field"><label>Received</label><input type="datetime-local" required value={paymentReceivedAt} onChange={(event) => setPaymentReceivedAt(event.target.value)} /></div><div className={`field ${styles.full}`}><label>Reference</label><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button type="submit" disabled={Boolean(busy)}>Record Payment</Button></div></form></Dialog>
    <Dialog open={identityOpen} onClose={() => { if (!busy) setIdentityOpen(false); }} title="Business Document Setup" description="Set the business identity printed on issued documents."><form onSubmit={saveIdentity} className={styles.formStack}><div className={styles.formGrid}><div className={`field ${styles.full}`}><label>Business address</label><textarea rows={3} value={identity.businessAddress} onChange={(event) => setIdentity({ ...identity, businessAddress: event.target.value })} /></div><div className="field"><label>VAT number</label><input value={identity.vatNumber} onChange={(event) => setIdentity({ ...identity, vatNumber: event.target.value })} /></div><div className="field"><label>Company registration number</label><input value={identity.companyRegistrationNumber} onChange={(event) => setIdentity({ ...identity, companyRegistrationNumber: event.target.value })} /></div><div className="field"><label>Credit Note prefix</label><input value={identity.creditNotePrefix} onChange={(event) => setIdentity({ ...identity, creditNotePrefix: event.target.value.toUpperCase() })} /></div><div className="field"><label>Delivery Note prefix</label><input value={identity.deliveryNotePrefix} onChange={(event) => setIdentity({ ...identity, deliveryNotePrefix: event.target.value.toUpperCase() })} /></div></div><div className={styles.dialogActions}><Button type="button" variant="quiet" onClick={() => setIdentityOpen(false)}>Cancel</Button><Button type="submit" disabled={busy === "identity"}>Save Setup</Button></div></form></Dialog>
  </>;
}

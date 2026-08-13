"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BadgePercent,
  CalendarClock,
  CircleDollarSign,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  TriangleAlert,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  enqueueSaleCommand,
  failSaleCommand,
  flushSaleQueue,
  readSaleQueue,
  removeSaleCommand,
  submitSaleCommand,
  writeSaleQueue,
  type SaleCommandAction,
  type SaleQueuedCommand,
} from "@/lib/modules/sale-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./sales.module.css";

type SaleFilter = "all" | "completed" | "reversed";
type LineType = "product" | "service";
type CatalogueItem = {
  id: string;
  code: string;
  name: string;
  price: number | null;
  vatRate: number;
  lineType: LineType;
};
type CustomerOption = { id: string; code: string; name: string; company: string | null; email: string | null; phone: string | null };
type LocationOption = { id: string; code: string; name: string; is_default: boolean };
type SaleLineRow = {
  id: string;
  line_number: number;
  line_type: LineType;
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
type SaleRow = {
  id: string;
  reference: string;
  customer_id: string | null;
  channel: "in_store" | "manual" | "appointment";
  currency: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  settlement_status: "not_recorded";
  inventory_location_id: string | null;
  notes: string | null;
  status: "completed" | "reversed";
  version: number;
  occurred_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  sale_lines: SaleLineRow[];
  pending?: boolean;
};
type BasketLine = {
  id: string;
  lineType: LineType;
  itemId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  vatRate: number;
};
type SalesBundle = {
  sales: SaleRow[];
  products: Array<{ id: string; sku: string; name: string; selling_price: number | null; vat_rate: number }>;
  services: Array<{ id: string; code: string; name: string; price: number | null; vat_rate: number }>;
  customers: CustomerOption[];
  locations: LocationOption[];
};
type SaleDraft = {
  customerId: string;
  inventoryLocationId: string;
  channel: "in_store" | "manual" | "appointment";
  occurredAt: string;
  saleDiscount: number;
  notes: string;
  lines: BasketLine[];
};

const CACHE_PREFIX = "bdb-sales-cache-v1";
const DRAFT_PREFIX = "bdb-sales-draft-v1";
const LAST_WORKSPACE_KEY = "bdb-sales-last-workspace-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;
const draftKey = (workspaceId: string) => `${DRAFT_PREFIX}:${workspaceId}`;
const localDateTime = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const emptyDraft = (): SaleDraft => ({ customerId: "", inventoryLocationId: "", channel: "in_store", occurredAt: localDateTime(), saleDiscount: 0, notes: "", lines: [] });

function readLastWorkspace() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(LAST_WORKSPACE_KEY);
}
function rememberWorkspace(workspaceId: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}
function readBundle(workspaceId: string): SalesBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as SalesBundle | null;
    return value && Array.isArray(value.sales) ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}
function writeBundle(workspaceId: string, bundle: SalesBundle) {
  if (typeof window !== "undefined") window.localStorage.setItem(cacheKey(workspaceId), JSON.stringify(bundle));
}
function readDraft(workspaceId: string): SaleDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const value = JSON.parse(window.localStorage.getItem(draftKey(workspaceId)) ?? "null") as Partial<SaleDraft> | null;
    return value && Array.isArray(value.lines)
      ? { ...emptyDraft(), ...value, lines: value.lines as BasketLine[] }
      : emptyDraft();
  } catch {
    window.localStorage.removeItem(draftKey(workspaceId));
    return emptyDraft();
  }
}
function writeDraft(workspaceId: string, draft: SaleDraft) {
  if (typeof window !== "undefined") window.localStorage.setItem(draftKey(workspaceId), JSON.stringify(draft));
}
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
function totals(lines: readonly BasketLine[], saleDiscount: number) {
  const source = lines.map((line) => {
    const gross = roundMoney(line.quantity * line.unitPrice);
    const explicitDiscount = Math.min(Math.max(line.discountAmount, 0), gross);
    return { ...line, gross, explicitDiscount, afterLineDiscount: gross - explicitDiscount };
  });
  const gross = roundMoney(source.reduce((sum, line) => sum + line.gross, 0));
  const explicitDiscount = roundMoney(source.reduce((sum, line) => sum + line.explicitDiscount, 0));
  const base = roundMoney(source.reduce((sum, line) => sum + line.afterLineDiscount, 0));
  const appliedSaleDiscount = Math.min(Math.max(saleDiscount, 0), base);
  let remainingDiscount = appliedSaleDiscount;
  let vat = 0;
  let net = 0;
  source.forEach((line, index) => {
    const allocation = index === source.length - 1
      ? remainingDiscount
      : base === 0 ? 0 : Math.min(remainingDiscount, roundMoney(appliedSaleDiscount * line.afterLineDiscount / base));
    remainingDiscount = roundMoney(remainingDiscount - allocation);
    const total = roundMoney(line.afterLineDiscount - allocation);
    const lineVat = line.vatRate === 0 ? 0 : roundMoney(total * line.vatRate / (100 + line.vatRate));
    vat += lineVat;
    net += total - lineVat;
  });
  return {
    gross,
    discount: roundMoney(explicitDiscount + appliedSaleDiscount),
    net: roundMoney(net),
    vat: roundMoney(vat),
    total: roundMoney(gross - explicitDiscount - appliedSaleDiscount),
  };
}
function pendingSale(command: SaleQueuedCommand, currency: string): SaleRow | null {
  if (command.action !== "complete") return null;
  const lines = (command.payload.lines ?? []) as Array<Record<string, unknown>>;
  const basketLines = lines.map((line, index): BasketLine => ({
    id: String(line.id),
    lineType: line.lineType as LineType,
    itemId: String(line.itemId),
    code: String(line.code ?? "PENDING"),
    name: String(line.name ?? "Pending Sale line"),
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    discountAmount: Number(line.discountAmount ?? 0),
    vatRate: Number(line.vatRate ?? 0),
  }));
  const calculated = totals(basketLines, Number(command.payload.saleDiscount ?? 0));
  return {
    id: String(command.payload.id), reference: "Pending synchronisation", customer_id: command.payload.customerId ? String(command.payload.customerId) : null,
    channel: (command.payload.channel ?? "in_store") as SaleRow["channel"], currency,
    gross_amount: calculated.gross, discount_amount: calculated.discount, net_amount: calculated.net,
    vat_amount: calculated.vat, total_amount: calculated.total, settlement_status: "not_recorded",
    inventory_location_id: command.payload.inventoryLocationId ? String(command.payload.inventoryLocationId) : null,
    notes: command.payload.notes ? String(command.payload.notes) : null, status: "completed", version: 1,
    occurred_at: String(command.payload.occurredAt), reversed_at: null, reversal_reason: null,
    sale_lines: basketLines.map((line, index) => ({ id: line.id, line_number: index + 1, line_type: line.lineType, code_snapshot: line.code, description_snapshot: line.name, quantity: line.quantity, unit_price: line.unitPrice, gross_amount: roundMoney(line.quantity * line.unitPrice), discount_amount: line.discountAmount, net_amount: 0, vat_rate: line.vatRate, vat_amount: 0, total_amount: roundMoney(line.quantity * line.unitPrice - line.discountAmount) })),
    pending: true,
  };
}
function applyQueuedSales(sales: readonly SaleRow[], commands: readonly SaleQueuedCommand[], currency: string) {
  let result = [...sales];
  for (const command of commands) {
    if (command.action === "complete") {
      const pending = pendingSale(command, currency);
      if (pending && !result.some((sale) => sale.id === pending.id)) result = [pending, ...result];
    } else {
      const id = String(command.payload.id);
      result = result.map((sale) => sale.id === id ? { ...sale, status: "reversed", reversal_reason: String(command.payload.reason ?? "Pending reversal"), pending: true } : sale);
    }
  }
  return result;
}

export default function SalesPage() {
  const { state, mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<SalesBundle>({ sales: [], products: [], services: [], customers: [], locations: [] });
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [draft, setDraft] = useState<SaleDraft>(emptyDraft());
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [saleOpen, setSaleOpen] = useState(false);
  const [reverseSale, setReverseSale] = useState<SaleRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SaleFilter>("all");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const syncInFlight = useRef(false);
  const supportMode = false;
  const currency = useMemo(() => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }), [state.settings.currency]);

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);
    const response = await fetch(`/api/sales?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Sales could not be loaded.");
    const cloudBundle = result.result as SalesBundle;
    writeBundle(currentWorkspaceId, cloudBundle);
    setBundle(cloudBundle);
    const queue = readSaleQueue(currentWorkspaceId);
    setSales(applyQueuedSales(cloudBundle.sales, queue, state.settings.currency));
    setPendingCount(queue.length);
    const savedDraft = readDraft(currentWorkspaceId);
    if (!savedDraft.inventoryLocationId) savedDraft.inventoryLocationId = cloudBundle.locations.find((location) => location.is_default)?.id ?? cloudBundle.locations[0]?.id ?? "";
    setDraft(savedDraft);
  }, [state.settings.currency]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readBundle(fallbackWorkspace) : null;
      const queued = fallbackWorkspace ? readSaleQueue(fallbackWorkspace) : [];
      if (active && fallbackWorkspace && cached) {
        setWorkspaceId(fallbackWorkspace);
        setBundle(cached);
        setSales(applyQueuedSales(cached.sales, queued, state.settings.currency));
        setPendingCount(queued.length);
        setDraft(readDraft(fallbackWorkspace));
      }
      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached) setNotice("Showing the last cached Sales register. Completed Sales remain queued until the connection returns.");
          else setError("Sales need one successful online load before this workspace can open from a cold offline start.");
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Sales could not be loaded.";
        if (cached) setNotice("Showing the last cached Sales register while cloud access is unavailable.");
        else if (active) setError(message);
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode, state.settings.currency]);

  useEffect(() => {
    if (workspaceId) writeDraft(workspaceId, draft);
  }, [draft, workspaceId]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await flushSaleQueue(workspaceId, setPendingCount);
      setPendingCount(result.remaining);
      if (result.completed) setNotice(`${result.completed} queued Sale command${result.completed === 1 ? "" : "s"} synced.`);
      await loadCloud();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sales could not be refreshed.");
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [loadCloud, workspaceId]);

  useEffect(() => {
    if (mode === "cloud" && online && pendingCount > 0 && !syncInFlight.current) void syncPending();
  }, [mode, online, pendingCount, syncPending]);

  const submitCommand = useCallback(async (action: SaleCommandAction, payload: Record<string, unknown>) => {
    setError(""); setNotice("");
    if (mode === "demo") { setNotice("Saved in this browser's local BDB OS preview."); return true; }
    if (!workspaceId) { setError("The current workspace is unavailable."); return false; }
    const command = enqueueSaleCommand(workspaceId, action, payload);
    const queue = readSaleQueue(workspaceId);
    setPendingCount(queue.length);
    setSales(applyQueuedSales(bundle.sales, queue, state.settings.currency));
    if (!navigator.onLine) { setNotice("Saved offline. BDB OS will retry this Sale command when the connection returns."); return true; }
    try {
      await submitSaleCommand(command);
      removeSaleCommand(workspaceId, command.id);
      setPendingCount(readSaleQueue(workspaceId).length);
      await loadCloud();
      setNotice(action === "complete" ? "Sale completed." : "Sale reversed.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Sale command could not be saved.";
      failSaleCommand(workspaceId, command.id, message);
      setPendingCount(readSaleQueue(workspaceId).length);
      setError(`${message} The command remains in the local retry queue.`);
      return false;
    }
  }, [bundle.sales, loadCloud, mode, state.settings.currency, workspaceId]);

  const catalogue = useMemo<CatalogueItem[]>(() => [
    ...bundle.products.map((product) => ({ id: product.id, code: product.sku, name: product.name, price: product.selling_price, vatRate: product.vat_rate, lineType: "product" as const })),
    ...bundle.services.map((service) => ({ id: service.id, code: service.code, name: service.name, price: service.price, vatRate: service.vat_rate, lineType: "service" as const })),
  ], [bundle.products, bundle.services]);
  const customerMap = useMemo(() => new Map(bundle.customers.map((customer) => [customer.id, customer])), [bundle.customers]);
  const calculated = useMemo(() => totals(draft.lines, draft.saleDiscount), [draft.lines, draft.saleDiscount]);
  const hasProductLines = draft.lines.some((line) => line.lineType === "product");

  function addItem(itemId: string, lineType: LineType) {
    const item = catalogue.find((candidate) => candidate.id === itemId && candidate.lineType === lineType);
    if (!item) return;
    if (item.price === null) { setError(`${item.name} needs a catalogue price before it can be sold.`); return; }
    setDraft((current) => ({ ...current, lines: [...current.lines, { id: crypto.randomUUID(), lineType, itemId: item.id, code: item.code, name: item.name, quantity: 1, unitPrice: item.price ?? 0, discountAmount: 0, vatRate: item.vatRate }] }));
    if (lineType === "product") setSelectedProduct(""); else setSelectedService("");
  }
  function updateLine(id: string, patch: Partial<BasketLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line) }));
  }
  function removeLine(id: string) {
    setDraft((current) => ({ ...current, lines: current.lines.filter((line) => line.id !== id) }));
  }
  function openSale() {
    setError("");
    setSaleOpen(true);
  }
  function clearDraft() {
    const next = emptyDraft();
    next.inventoryLocationId = bundle.locations.find((location) => location.is_default)?.id ?? bundle.locations[0]?.id ?? "";
    setDraft(next);
  }
  async function completeSale(event: FormEvent) {
    event.preventDefault();
    if (supportMode || draft.lines.length === 0) return;
    if (hasProductLines && !draft.inventoryLocationId) { setError("Choose an Inventory location for Product lines."); return; }
    if (draft.saleDiscount > draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice - line.discountAmount, 0)) { setError("Sale discount exceeds the remaining basket value."); return; }
    setSaving(true);
    const id = crypto.randomUUID();
    const payload = {
      id,
      customerId: draft.customerId || null,
      inventoryLocationId: hasProductLines ? draft.inventoryLocationId : null,
      channel: draft.channel,
      currency: state.settings.currency,
      saleDiscount: draft.saleDiscount,
      occurredAt: new Date(draft.occurredAt).toISOString(),
      notes: draft.notes,
      lines: draft.lines.map((line) => ({ id: line.id, lineType: line.lineType, itemId: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, code: line.code, name: line.name, vatRate: line.vatRate })),
    };
    const saved = await submitCommand("complete", payload);
    setSaving(false);
    if (saved) { clearDraft(); setSaleOpen(false); }
  }
  async function confirmReversal(event: FormEvent) {
    event.preventDefault();
    if (!reverseSale || reverseReason.trim().length < 5) return;
    setSaving(true);
    const saved = await submitCommand("reverse", { id: reverseSale.id, reason: reverseReason.trim() });
    setSaving(false);
    if (saved) { setReverseSale(null); setReverseReason(""); }
  }
  async function discardPending() {
    if (!workspaceId || workspaceId === "demo") return;
    writeSaleQueue(workspaceId, []);
    setPendingCount(0);
    try { await loadCloud(); } catch (discardError) { setError(discardError instanceof Error ? discardError.message : "Sales could not be refreshed."); }
  }

  const visibleSales = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sales.filter((sale) => {
      const customer = sale.customer_id ? customerMap.get(sale.customer_id) : null;
      const matchesSearch = !term || [sale.reference, customer?.name, customer?.company, sale.channel, sale.status, ...sale.sale_lines.map((line) => `${line.code_snapshot} ${line.description_snapshot}`)].join(" ").toLowerCase().includes(term);
      return matchesSearch && (filter === "all" || sale.status === filter);
    });
  }, [customerMap, filter, query, sales]);
  const completedSales = sales.filter((sale) => sale.status === "completed" && !sale.pending);
  const revenue = completedSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  const productLines = completedSales.flatMap((sale) => sale.sale_lines).filter((line) => line.line_type === "product").length;
  const serviceLines = completedSales.flatMap((sale) => sale.sale_lines).filter((line) => line.line_type === "service").length;

  return <>
    <PageHeader eyebrow="Commercial transactions" title="Sales" description="Complete Product and Service Sales as immutable commercial records, with Product quantities posted atomically to Inventory." action={<div className={styles.headerActions}><Button variant="secondary" onClick={() => void syncPending()} disabled={mode !== "cloud" || !online || syncing || pendingCount === 0}><RefreshCw size={17} /> {syncing ? "Syncing…" : `Sync pending${pendingCount ? ` (${pendingCount})` : ""}`}</Button><Button onClick={openSale} disabled={supportMode}><Plus size={17} /> Record Sale</Button></div>} />
    {supportMode ? <div className={styles.supportNotice}><ShoppingBag size={18} /><div><strong>Read-only access</strong><span>Sale completion and reversal remain blocked during this session.</span></div></div> : null}
    {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Sale action needs attention</strong><p>{error}</p></div></div> : null}
    {notice ? <div className="review-callout"><RefreshCw size={19} /><div><strong>Sales workflow</strong><p>{notice}</p></div></div> : null}
    {pendingCount > 0 && workspaceId && workspaceId !== "demo" ? <div className="review-callout"><RefreshCw size={19} /><div><strong>{pendingCount} pending Sale command{pendingCount === 1 ? "" : "s"}</strong><p>Commands retry in order and stop at the first validation or conflict error.</p></div><Button variant="quiet" onClick={() => void discardPending()}>Discard pending</Button></div> : null}

    <div className="stat-grid"><StatCard label="Completed Sales" value={String(completedSales.length)} detail={`${sales.filter((sale) => sale.status === "reversed").length} reversed`} icon={<ReceiptText size={19} />} /><StatCard label="Recorded value" value={currency.format(revenue)} detail="Settlement not yet recorded" icon={<CircleDollarSign size={19} />} /><StatCard label="Product lines" value={String(productLines)} detail="Posted to Inventory" icon={<Package size={19} />} /><StatCard label="Service lines" value={String(serviceLines)} detail="No stock movement" icon={<Wrench size={19} />} /></div>

    <Card className={styles.salesCard}><div className={styles.toolbar}><label className={styles.searchField}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, Customer or item…" /></label><div className={styles.filters}>{(["all", "completed", "reversed"] as SaleFilter[]).map((item) => <button key={item} type="button" className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>{item === "all" ? "All" : item === "completed" ? "Completed" : "Reversed"}</button>)}</div><Badge tone="neutral">{visibleSales.length} Sale{visibleSales.length === 1 ? "" : "s"}</Badge></div>
      <div className="table-scroll"><table className={styles.salesTable}><thead><tr><th>Sale</th><th>Customer</th><th>Items</th><th>Gross</th><th>Discount</th><th>VAT</th><th>Total</th><th>Settlement</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{visibleSales.map((sale) => { const customer = sale.customer_id ? customerMap.get(sale.customer_id) : null; return <tr key={sale.id}><td><div className={styles.saleIdentity}><span><ReceiptText size={17} /></span><div><strong>{sale.reference}</strong><small>{new Date(sale.occurred_at).toLocaleString("en-GB")}</small></div></div></td><td><div className={styles.customerCell}><UserRound size={15} />{customer?.name ?? "Walk-in"}</div></td><td><div className={styles.itemsCell}><strong>{sale.sale_lines.length} line{sale.sale_lines.length === 1 ? "" : "s"}</strong><small>{sale.sale_lines.map((line) => line.description_snapshot).slice(0, 2).join(", ")}{sale.sale_lines.length > 2 ? "…" : ""}</small></div></td><td>{currency.format(sale.gross_amount)}</td><td>{currency.format(sale.discount_amount)}</td><td>{currency.format(sale.vat_amount)}</td><td><strong>{currency.format(sale.total_amount)}</strong></td><td><div className={styles.paymentCell}><Badge tone="neutral">Not recorded</Badge><small>Payment ledger pending</small></div></td><td><Badge tone={sale.status === "completed" ? "green" : "neutral"}>{sale.pending ? "Pending" : sale.status === "completed" ? "Completed" : "Reversed"}</Badge></td><td><Button variant="quiet" disabled={supportMode || sale.status !== "completed" || sale.pending} onClick={() => { setReverseSale(sale); setReverseReason(""); }}><RotateCcw size={15} /> Reverse</Button></td></tr>; })}</tbody></table></div>
      {loaded && visibleSales.length === 0 ? <div className={styles.emptyState}><ShoppingBag size={23} /><h3>No Sales found</h3><p>Complete the first Sale or change the current filter.</p></div> : null}
    </Card>

    <div className={styles.lowerGrid}><Card className={styles.guidanceCard}><div className={styles.cardIcon}><Package size={20} /></div><p className="eyebrow">Inventory connection</p><h2>Product quantities post atomically</h2><p className="muted">A completed Product Sale and its stock-out movements succeed or fail together. Service lines never change Inventory.</p></Card><Card className={styles.guidanceCard}><div className={styles.cardIcon}><CircleDollarSign size={20} /></div><p className="eyebrow">Settlement boundary</p><h2>Completed does not mean paid</h2><p className="muted">Sales records what was sold. Payments, allocations, receivables and Banking reconciliation remain separate downstream records.</p></Card></div>

    <Dialog open={saleOpen} onClose={() => setSaleOpen(false)} title="Record Sale" description="Build a mixed Product and Service basket, then complete it as one immutable transaction." className={styles.saleDialog}><form onSubmit={completeSale}><div className={styles.formBody}><div className={styles.contextGrid}><label>Customer<select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}><option value="">Walk-in</option>{bundle.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select></label><label>Channel<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as SaleDraft["channel"] })}><option value="in_store">In store</option><option value="manual">Manual</option><option value="appointment">Appointment</option></select></label><label>Date and time<input type="datetime-local" required value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label><label>Inventory location<select value={draft.inventoryLocationId} onChange={(event) => setDraft({ ...draft, inventoryLocationId: event.target.value })} disabled={!hasProductLines}><option value="">{hasProductLines ? "Choose location" : "Not required"}</option>{bundle.locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.code}</option>)}</select></label></div>
        <div className={styles.saleBuilder}><section className={styles.linesPanel}><div className={styles.panelHeader}><div><p className="eyebrow">Basket</p><h3>Products and Services</h3></div><div className={styles.lineActions}><select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Choose Product</option>{bundle.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select><Button type="button" variant="secondary" disabled={!selectedProduct} onClick={() => addItem(selectedProduct, "product")}><Package size={15} /> Add</Button><select value={selectedService} onChange={(event) => setSelectedService(event.target.value)}><option value="">Choose Service</option>{bundle.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.code}</option>)}</select><Button type="button" variant="secondary" disabled={!selectedService} onClick={() => addItem(selectedService, "service")}><Wrench size={15} /> Add</Button></div></div>
          {draft.lines.map((line) => <div className={styles.previewLine} key={line.id}><span className={styles.lineIcon}>{line.lineType === "product" ? <Package size={17} /> : <Wrench size={17} />}</span><div className={styles.lineDescription}><strong>{line.name}</strong><small>{line.code} · VAT {line.vatRate}%</small></div><label>Qty<input min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Math.max(Number(event.target.value), 0) })} /></label><label>Unit price<input min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Math.max(Number(event.target.value), 0) })} /></label><label>Discount<input min="0" step="0.01" type="number" value={line.discountAmount} onChange={(event) => updateLine(line.id, { discountAmount: Math.max(Number(event.target.value), 0) })} /></label><strong className={styles.lineTotal}>{currency.format(Math.max(line.quantity * line.unitPrice - line.discountAmount, 0))}</strong><Button type="button" variant="quiet" onClick={() => removeLine(line.id)} aria-label={`Remove ${line.name}`}><X size={15} /></Button></div>)}
          {draft.lines.length === 0 ? <div className={styles.emptyState}><ShoppingBag size={22} /><h3>Basket is empty</h3><p>Add a Product or Service to begin.</p></div> : null}<p className={styles.lineHint}><BadgePercent size={15} /> Line discounts and the basket discount reduce VAT-inclusive prices. The VAT portion is calculated from the final discounted total.</p></section>
          <aside className={styles.summaryPanel}><p className="eyebrow">Summary</p><label>Basket discount ({state.settings.currency})<input min="0" step="0.01" type="number" value={draft.saleDiscount} onChange={(event) => setDraft({ ...draft, saleDiscount: Math.max(Number(event.target.value), 0) })} /></label><label>Notes<input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional Sale note" /></label><div className={styles.summaryRows}><div><span>Gross</span><strong>{currency.format(calculated.gross)}</strong></div><div><span>Discount</span><strong>{currency.format(calculated.discount)}</strong></div><div><span>Net</span><strong>{currency.format(calculated.net)}</strong></div><div><span>VAT</span><strong>{currency.format(calculated.vat)}</strong></div><div className={styles.totalRow}><span>Total</span><strong>{currency.format(calculated.total)}</strong></div></div><Badge tone="neutral">Settlement not recorded</Badge></aside></div>
        <div className={styles.boundaryNote}><CalendarClock size={18} /><div><strong>Appointment conversion is not active yet</strong><span>The Appointment channel is recorded for future linkage, but this Sale does not alter any appointment until Calendar becomes functional.</span></div></div></div><div className="dialog-actions"><Button type="button" variant="quiet" onClick={clearDraft}>Clear basket</Button><Button type="button" variant="quiet" onClick={() => setSaleOpen(false)}>Close</Button><Button type="submit" disabled={saving || supportMode || draft.lines.length === 0}>{saving ? "Completing…" : "Complete Sale"}</Button></div></form></Dialog>

    <Dialog open={Boolean(reverseSale)} onClose={() => setReverseSale(null)} title="Reverse Sale" description="This creates Inventory reversal movements for Product lines and preserves the original commercial record."><form onSubmit={confirmReversal}><label className={styles.summaryPanel}>Reason<input required minLength={5} value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Explain why this Sale is being reversed" /></label><div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setReverseSale(null)}>Cancel</Button><Button type="submit" disabled={saving || reverseReason.trim().length < 5}>{saving ? "Reversing…" : "Reverse Sale"}</Button></div></form></Dialog>
  </>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, CalendarDays, CircleDollarSign, Clock3, Plus, RefreshCw, Search, TriangleAlert, Undo2, Wrench } from "lucide-react";
import { CataloguePendingChanges } from "@/components/catalogue-pending-changes";
import { StandardDataImport } from "@/components/standard-data-import";
import { useBdb } from "@/lib/store";
import {
  discardServiceCommand,
  enqueueServiceCommand,
  failServiceCommand,
  flushServiceQueue,
  readServiceQueue,
  removeServiceCommand,
  submitServiceCommand,
  type ServiceCommandAction,
  type ServiceQueuedCommand,
} from "@/lib/modules/service-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./services.module.css";

type ServiceFilter = "all" | "bookable" | "staff" | "archived";
type BookingMode = "customer" | "staff";
type RegisterCursor = { name: string; id: string };
type ServiceSummary = {
  totalCount: number;
  activeCount: number;
  archivedCount: number;
  customerBookableCount: number;
  staffOnlyCount: number;
  pricedCount: number;
  activeDurationMinutes: number;
};
type ServiceRow = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  duration_minutes: number;
  preparation_buffer_minutes: number;
  recovery_buffer_minutes: number;
  price: number | null;
  vat_rate: number;
  booking_mode: BookingMode;
  description: string | null;
  notes: string | null;
  status: "active" | "archived";
  version: number;
  pending?: boolean;
};
type ServiceForm = {
  code: string;
  name: string;
  category: string;
  durationMinutes: string;
  preparationBufferMinutes: string;
  recoveryBufferMinutes: string;
  price: string;
  vatRate: string;
  bookingMode: BookingMode;
  description: string;
  notes: string;
};

const emptyForm: ServiceForm = {
  code: "", name: "", category: "", durationMinutes: "60",
  preparationBufferMinutes: "0", recoveryBufferMinutes: "0",
  price: "", vatRate: "18", bookingMode: "customer", description: "", notes: "",
};
const CACHE_PREFIX = "bdb-services-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-services-last-workspace-v1";
const CACHE_LIMIT = 500;
const PAGE_SIZE = 100;
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readLastWorkspace() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(LAST_WORKSPACE_KEY);
}
function rememberWorkspace(workspaceId: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}
function readCache(workspaceId: string): ServiceRow[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as ServiceRow[]).slice(0, CACHE_LIMIT) : [];
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return [];
  }
}
function writeCache(workspaceId: string, services: readonly ServiceRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId),
    JSON.stringify(services.slice(0, CACHE_LIMIT).map(({ pending: _pending, ...service }) => service)),
  );
}
function mergeCache(workspaceId: string, services: readonly ServiceRow[]) {
  const merged = new Map<string, ServiceRow>();
  for (const service of services) merged.set(service.id, service);
  for (const service of readCache(workspaceId)) {
    if (!merged.has(service.id)) merged.set(service.id, service);
  }
  writeCache(workspaceId, [...merged.values()]);
}
function formValues(service: ServiceRow): ServiceForm {
  return {
    code: service.code,
    name: service.name,
    category: service.category ?? "",
    durationMinutes: String(service.duration_minutes),
    preparationBufferMinutes: String(service.preparation_buffer_minutes),
    recoveryBufferMinutes: String(service.recovery_buffer_minutes),
    price: service.price === null ? "" : String(service.price),
    vatRate: String(service.vat_rate),
    bookingMode: service.booking_mode,
    description: service.description ?? "",
    notes: service.notes ?? "",
  };
}
function serviceFromPayload(payload: Record<string, unknown>): ServiceRow {
  return {
    id: String(payload.id), code: String(payload.code), name: String(payload.name),
    category: payload.category ? String(payload.category) : null,
    duration_minutes: Number(payload.durationMinutes ?? 60),
    preparation_buffer_minutes: Number(payload.preparationBufferMinutes ?? 0),
    recovery_buffer_minutes: Number(payload.recoveryBufferMinutes ?? 0),
    price: payload.price === null || payload.price === "" ? null : Number(payload.price),
    vat_rate: Number(payload.vatRate ?? 0), booking_mode: payload.bookingMode as BookingMode,
    description: payload.description ? String(payload.description) : null,
    notes: payload.notes ? String(payload.notes) : null,
    status: "active", version: 1, pending: true,
  };
}
function applyCommand(services: readonly ServiceRow[], command: ServiceQueuedCommand): ServiceRow[] {
  const id = String(command.payload.id);
  if (command.action === "create") return services.some((service) => service.id === id) ? [...services] : [...services, serviceFromPayload(command.payload)];
  return services.map((service) => {
    if (service.id !== id) return service;
    if (command.action === "update") {
      return { ...service, ...serviceFromPayload(command.payload), id, status: service.status, version: Number(command.payload.expectedVersion ?? service.version) + 1, pending: true };
    }
    return { ...service, status: command.action === "archive" ? "archived" : "active", version: Number(command.payload.expectedVersion ?? service.version) + 1, pending: true };
  });
}
function mergeRows(current: readonly ServiceRow[], incoming: readonly ServiceRow[]) {
  const merged = new Map(current.map((service) => [service.id, service]));
  for (const service of incoming) merged.set(service.id, service);
  return [...merged.values()];
}
function summaryFromRows(services: readonly ServiceRow[]): ServiceSummary {
  const active = services.filter((service) => service.status === "active");
  return {
    totalCount: services.length,
    activeCount: active.length,
    archivedCount: services.length - active.length,
    customerBookableCount: active.filter((service) => service.booking_mode === "customer").length,
    staffOnlyCount: active.filter((service) => service.booking_mode === "staff").length,
    pricedCount: active.filter((service) => service.price !== null).length,
    activeDurationMinutes: active.reduce((total, service) => total + service.duration_minutes, 0),
  };
}
function parseSummary(value: Record<string, unknown> | null | undefined): ServiceSummary | null {
  if (!value) return null;
  return {
    totalCount: Number(value.total_count ?? 0),
    activeCount: Number(value.active_count ?? 0),
    archivedCount: Number(value.archived_count ?? 0),
    customerBookableCount: Number(value.customer_bookable_count ?? 0),
    staffOnlyCount: Number(value.staff_only_count ?? 0),
    pricedCount: Number(value.priced_count ?? 0),
    activeDurationMinutes: Number(value.active_duration_minutes ?? 0),
  };
}
function registerFilter(filter: ServiceFilter) {
  return {
    status: filter === "archived" ? "archived" : "active",
    bookingMode: filter === "bookable" ? "customer" : filter === "staff" ? "staff" : null,
  };
}

export default function ServicesPage() {
  const { state, mode } = useBdb();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ServiceSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<RegisterCursor | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<ServiceQueuedCommand[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const syncInFlight = useRef(false);
  const initialRegisterLoaded = useRef(false);
  const supportMode = false;
  const pendingCount = pendingCommands.length;
  const currency = useMemo(() => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }), [state.settings.currency]);

  const fetchRegister = useCallback(async (
    currentWorkspaceId: string,
    options: { query: string; filter: ServiceFilter; append?: boolean; cursor?: RegisterCursor | null },
  ) => {
    setPageLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId, pageSize: String(PAGE_SIZE) });
      const register = registerFilter(options.filter);
      params.set("status", register.status);
      if (register.bookingMode) params.set("bookingMode", register.bookingMode);
      if (options.query.trim()) params.set("query", options.query.trim());
      if (options.cursor) {
        params.set("afterName", options.cursor.name);
        params.set("afterId", options.cursor.id);
      }
      const response = await fetch(`/api/services?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Services could not be loaded.");
      const cloudServices = (result.result?.services ?? []) as ServiceRow[];
      const queue = readServiceQueue(currentWorkspaceId);
      mergeCache(currentWorkspaceId, cloudServices);
      setServices((current) => queue.reduce(
        applyCommand,
        options.append ? mergeRows(current, cloudServices) : cloudServices,
      ));
      setPendingCommands(queue);
      setSummary(parseSummary(result.result?.summary));
      setHasMore(Boolean(result.result?.hasMore));
      setNextCursor(result.result?.nextCursor ?? null);
    } finally {
      setPageLoading(false);
    }
  }, []);

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
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : [];
      const queued = fallbackWorkspace ? readServiceQueue(fallbackWorkspace) : [];
      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        const optimistic = queued.reduce(applyCommand, cached);
        setServices(optimistic);
        setSummary(summaryFromRows(optimistic));
        setPendingCommands(queued);
      }
      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.length || queued.length) setNotice("Showing the last cached Service catalogue. Changes remain queued until the connection returns.");
          else setError("Services need one successful online load before this workspace can open from a cold offline start.");
          return;
        }
        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
        const currentWorkspaceId = String(context.currentWorkspaceId);
        if (!active) return;
        setWorkspaceId(currentWorkspaceId);
        rememberWorkspace(currentWorkspaceId);
        await fetchRegister(currentWorkspaceId, { query: "", filter: "all" });
        initialRegisterLoaded.current = true;
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Services could not be loaded.";
        if (cached.length || queued.length) setNotice("Showing the last cached Service catalogue while cloud access is unavailable.");
        else if (active) setError(message);
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [fetchRegister, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) writeCache("demo", services);
  }, [loaded, mode, services]);

  useEffect(() => {
    if (!loaded || mode !== "cloud" || !workspaceId || !online || !initialRegisterLoaded.current) return;
    const timer = window.setTimeout(() => {
      setError("");
      void fetchRegister(workspaceId, { query, filter }).catch((registerError) => {
        setError(registerError instanceof Error ? registerError.message : "Services could not be loaded.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchRegister, filter, loaded, mode, online, query, workspaceId]);

  const refreshCurrent = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo") return;
    await fetchRegister(workspaceId, { query, filter });
  }, [fetchRegister, filter, query, workspaceId]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await flushServiceQueue(workspaceId, () => setPendingCommands(readServiceQueue(workspaceId)));
      setPendingCommands(readServiceQueue(workspaceId));
      if (result.completed) setNotice(`${result.completed} queued Service change${result.completed === 1 ? "" : "s"} synced.`);
      await refreshCurrent();
    } catch (syncError) {
      setPendingCommands(readServiceQueue(workspaceId));
      setError(syncError instanceof Error ? syncError.message : "Services could not be refreshed.");
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [refreshCurrent, workspaceId]);

  useEffect(() => {
    if (mode === "cloud" && online && pendingCount > 0 && !syncInFlight.current) void syncPending();
  }, [mode, online, pendingCount, syncPending]);

  const submitCommand = useCallback(async (action: ServiceCommandAction, payload: Record<string, unknown>) => {
    setError(""); setNotice("");
    const command: ServiceQueuedCommand = { id: crypto.randomUUID(), workspaceId: workspaceId ?? "demo", action, payload, createdAt: new Date().toISOString(), attempts: 0 };
    if (mode === "demo") {
      setServices((current) => applyCommand(current, command));
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) { setError("The current workspace is unavailable."); return false; }
    try {
      enqueueServiceCommand(workspaceId, action, payload, command.id);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "This Service change could not be stored safely offline.");
      return false;
    }
    setServices((current) => applyCommand(current, command));
    setPendingCommands(readServiceQueue(workspaceId));
    if (!navigator.onLine) { setNotice("Saved offline. BDB OS will retry this Service change when the connection returns."); return true; }
    try {
      await submitServiceCommand(command);
      removeServiceCommand(workspaceId, command.id);
      setPendingCommands(readServiceQueue(workspaceId));
      await refreshCurrent();
      setNotice(action === "create" ? "Service created." : action === "update" ? "Service updated." : action === "archive" ? "Service archived." : "Service restored.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Service change could not be saved.";
      failServiceCommand(workspaceId, command.id, commandError);
      setPendingCommands(readServiceQueue(workspaceId));
      setError(`${message} The change remains in the local retry queue.`);
      return false;
    }
  }, [mode, refreshCurrent, workspaceId]);

  const visibleServices = useMemo(() => services.filter((service) => {
    const term = query.trim().toLowerCase();
    const matchesSearch = !term || [service.name, service.code, service.category, service.booking_mode].join(" ").toLowerCase().includes(term);
    const matchesFilter = filter === "archived" ? service.status === "archived" : service.status === "active" && (filter === "all" || (filter === "bookable" && service.booking_mode === "customer") || (filter === "staff" && service.booking_mode === "staff"));
    return matchesSearch && matchesFilter;
  }).sort((a, b) => a.name.localeCompare(b.name)), [filter, query, services]);

  function openCreate() { setEditing(null); setForm(emptyForm); setFormOpen(true); }
  function openEdit(service: ServiceRow) { setEditing(service); setForm(formValues(service)); setFormOpen(true); }
  async function saveService(event: FormEvent) {
    event.preventDefault();
    if (supportMode) return;
    setSaving(true);
    const payload = {
      id: editing?.id ?? crypto.randomUUID(), expectedVersion: editing?.version,
      code: form.code, name: form.name, category: form.category,
      durationMinutes: Number(form.durationMinutes), preparationBufferMinutes: Number(form.preparationBufferMinutes), recoveryBufferMinutes: Number(form.recoveryBufferMinutes),
      price: form.price === "" ? null : Number(form.price), vatRate: Number(form.vatRate), bookingMode: form.bookingMode,
      description: form.description, notes: form.notes,
    };
    const saved = await submitCommand(editing ? "update" : "create", payload);
    setSaving(false);
    if (saved) setFormOpen(false);
  }
  async function changeStatus(service: ServiceRow) {
    if (!supportMode && !service.pending) await submitCommand(service.status === "active" ? "archive" : "restore", { id: service.id, expectedVersion: service.version });
  }
  async function discardPending(commandId: string) {
    if (!workspaceId || workspaceId === "demo") return;
    try {
      discardServiceCommand(workspaceId, commandId);
      setPendingCommands(readServiceQueue(workspaceId));
      await refreshCurrent();
      setNotice("That pending Service change was discarded. Other queued changes were preserved.");
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "That pending Service change cannot be discarded safely.");
    }
  }

  if (!loaded) return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Services…</main>;

  const metrics = summary ?? summaryFromRows(services);

  return <>
    <PageHeader eyebrow="Service catalogue" title="Services" description="Define reusable work that Calendar, Sales, customer history and future invoice lines can reference without duplicating Service data." action={<div className={styles.headerActions}><StandardDataImport entity="services" workspaceId={workspaceId} disabled={supportMode || mode !== "cloud" || !online} /><Button variant="secondary" onClick={() => void syncPending()} disabled={mode !== "cloud" || !online || syncing || pendingCount === 0}><RefreshCw size={17} /> {syncing ? "Syncing…" : `Sync pending${pendingCount ? ` (${pendingCount})` : ""}`}</Button><Button onClick={openCreate} disabled={supportMode}><Plus size={17} /> Add Service</Button></div>} />
    {supportMode ? <div className={styles.supportNotice}><Wrench size={18} /><div><strong>Read-only access</strong><span>Service catalogue changes remain blocked during this session.</span></div></div> : null}
    {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Service action needs attention</strong><p>{error}</p></div></div> : null}
    {notice ? <div className="review-callout"><RefreshCw size={19} /><div><strong>Service catalogue</strong><p>{notice}</p></div></div> : null}
    {pendingCount > 0 && workspaceId && workspaceId !== "demo" ? (
      <CataloguePendingChanges
        label="Service"
        commands={pendingCommands}
        syncing={syncing}
        onRetry={() => void syncPending()}
        onDiscard={(commandId) => void discardPending(commandId)}
        describe={(command) => String(command.payload.name ?? command.payload.code ?? "Service change")}
      />
    ) : null}

    <div className="stat-grid"><StatCard label="Active Services" value={String(metrics.activeCount)} detail={`${metrics.archivedCount} archived`} icon={<Wrench size={19} />} /><StatCard label="Customer bookable" value={String(metrics.customerBookableCount)} detail="Available to future booking flows" icon={<CalendarDays size={19} />} /><StatCard label="Priced Services" value={String(metrics.pricedCount)} detail="Ready for Sales line selection" icon={<CircleDollarSign size={19} />} /><StatCard label="Catalogue duration" value={`${metrics.activeDurationMinutes} min`} detail="Combined active Service duration" icon={<Clock3 size={19} />} /></div>

    <Card className={styles.servicesCard}><div className={styles.toolbar}><label className={styles.searchField}><Search size={17} /><input value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} placeholder="Search Service, code, category or booking mode…" aria-label="Search Services" /></label><div className={styles.filters}>{(["all", "bookable", "staff", "archived"] as ServiceFilter[]).map((item) => <button key={item} type="button" className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>{item === "all" ? "All" : item === "bookable" ? "Bookable" : item === "staff" ? "Staff only" : "Archived"}</button>)}</div><Badge tone="neutral">{visibleServices.length}{hasMore ? "+" : ""} loaded</Badge></div>
      <div className="table-scroll"><table className={styles.serviceTable}><thead><tr><th>Service</th><th>Code</th><th>Category</th><th>Duration</th><th>Price</th><th>VAT</th><th>Staff rules</th><th>Booking</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{visibleServices.map((service) => <tr key={service.id}><td><div className={styles.serviceIdentity}><span><Wrench size={17} /></span><div><strong>{service.name}</strong><small>{service.description || "Reusable Service definition"}</small></div></div></td><td><code>{service.code}</code></td><td>{service.category || <span className="muted">—</span>}</td><td><div className={styles.durationCell}><Clock3 size={15} /><span>{service.duration_minutes} min</span></div></td><td>{service.price === null ? <span className="muted">No charge</span> : currency.format(service.price)}</td><td>{service.vat_rate}%</td><td><span className="muted">Not linked</span></td><td><Badge tone={service.booking_mode === "customer" ? "gold" : "blue"}>{service.booking_mode === "customer" ? "Customer bookable" : "Staff only"}</Badge></td><td><Badge tone={service.status === "active" ? "green" : "neutral"}>{service.pending ? "Pending" : service.status === "active" ? "Active" : "Archived"}</Badge></td><td><div className={styles.headerActions}><Button type="button" variant="quiet" onClick={() => openEdit(service)} disabled={supportMode || service.pending || service.status === "archived"}>Edit</Button><Button type="button" variant="quiet" onClick={() => void changeStatus(service)} disabled={supportMode || service.pending}>{service.status === "active" ? <Archive size={15} /> : <Undo2 size={15} />}{service.status === "active" ? "Archive" : "Restore"}</Button></div></td></tr>)}</tbody></table></div>
      {hasMore && nextCursor && mode === "cloud" ? <div style={{ display: "flex", justifyContent: "center", padding: 16 }}><Button type="button" variant="secondary" disabled={pageLoading} onClick={() => workspaceId && void fetchRegister(workspaceId, { query, filter, append: true, cursor: nextCursor }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "More Services could not be loaded."))}>{pageLoading ? <><RefreshCw className="spin" size={16} /> Loading…</> : "Load more"}</Button></div> : null}
      {visibleServices.length === 0 && !pageLoading ? <div className={styles.emptyState}><Wrench size={23} /><h3>No Services found</h3><p>Create the first reusable Service or change the current filter.</p></div> : null}
    </Card>

    <div className={styles.lowerGrid}><Card className={styles.guidanceCard}><div className={styles.cardIcon}><CalendarDays size={20} /></div><p className="eyebrow">Calendar boundary</p><h2>Definition here, availability in Calendar</h2><p className="muted">Duration and buffers belong to the Service. Working hours, leave, staff eligibility and appointment availability remain Calendar responsibilities.</p></Card><Card className={styles.guidanceCard}><div className={styles.cardIcon}><Archive size={20} /></div><p className="eyebrow">Historical integrity</p><h2>Archive instead of deleting</h2><p className="muted">Services used by Sales, appointments or customer history remain available to historical records after they are no longer offered.</p></Card></div>

    <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Edit Service" : "Add Service"} description="Create the reusable Service definition used by Calendar and Sales." className={styles.serviceDialog}><form onSubmit={saveService}><div className={styles.formBody}><div className={styles.formGrid}><label className={styles.wide}>Service name<input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Service code<input required maxLength={64} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><label>Category<input maxLength={120} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>Duration (minutes)<input required min="5" max="1440" type="number" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label><label>Preparation buffer<input required min="0" max="240" type="number" value={form.preparationBufferMinutes} onChange={(event) => setForm({ ...form, preparationBufferMinutes: event.target.value })} /></label><label>Recovery buffer<input required min="0" max="240" type="number" value={form.recoveryBufferMinutes} onChange={(event) => setForm({ ...form, recoveryBufferMinutes: event.target.value })} /></label><label>Price ({state.settings.currency})<input min="0" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label>VAT rate (%)<input required min="0" max="100" step="0.01" type="number" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} /></label><label>Booking visibility<select value={form.bookingMode} onChange={(event) => setForm({ ...form, bookingMode: event.target.value as BookingMode })}><option value="customer">Customer bookable</option><option value="staff">Staff only</option></select></label><label className={styles.wide}>Description<textarea maxLength={2000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label className={styles.wide}>Internal notes<textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div><div className={styles.calendarNote}><CircleDollarSign size={18} /><div><strong>Commercial definition only</strong><span>Saving this Service does not create an appointment, Sale, invoice, payment or staff assignment.</span></div></div></div><div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || supportMode}>{saving ? "Saving…" : editing ? "Save changes" : "Create Service"}</Button></div></form></Dialog>
  </>;
}
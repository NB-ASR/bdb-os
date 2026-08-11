"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  BadgePercent,
  Building2,
  FileText,
  Mail,
  Package,
  Phone,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Truck,
  Undo2,
  WalletCards,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  enqueueSupplierCommand,
  failSupplierCommand,
  flushSupplierQueue,
  readSupplierQueue,
  removeSupplierCommand,
  submitSupplierCommand,
  writeSupplierQueue,
  type SupplierCommandAction,
  type SupplierQueuedCommand,
} from "@/lib/modules/supplier-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./suppliers.module.css";

type SupplierFilter = "all" | "products" | "services" | "expenses" | "archived";
type SupplierType = "product" | "service" | "expense";
type SupplierStatus = "active" | "archived";

type SupplierRow = {
  id: string;
  workspace_id?: string;
  code: string;
  name: string;
  supplier_type: SupplierType;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vat_registration_number: string | null;
  payment_terms_days: number;
  default_discount: number;
  document_currency: string;
  categories: string[];
  address_line1: string | null;
  postcode: string | null;
  country: string | null;
  notes: string | null;
  status: SupplierStatus;
  version: number;
  created_at?: string;
  updated_at?: string;
  pending?: boolean;
};

type SupplierForm = {
  code: string;
  name: string;
  supplierType: SupplierType;
  contactName: string;
  email: string;
  phone: string;
  vatRegistrationNumber: string;
  paymentTermsDays: string;
  defaultDiscount: string;
  documentCurrency: string;
  categories: string;
  addressLine1: string;
  postcode: string;
  country: string;
  notes: string;
};

const CACHE_PREFIX = "bdb-suppliers-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-suppliers-last-workspace-v1";

function createEmptyForm(currency: string): SupplierForm {
  return {
    code: "",
    name: "",
    supplierType: "product",
    contactName: "",
    email: "",
    phone: "",
    vatRegistrationNumber: "",
    paymentTermsDays: "30",
    defaultDiscount: "0",
    documentCurrency: currency,
    categories: "",
    addressLine1: "",
    postcode: "",
    country: "Malta",
    notes: "",
  };
}

function cacheKey(workspaceId: string) {
  return `${CACHE_PREFIX}:${workspaceId}`;
}

function readLastWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function rememberWorkspace(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function readCache(workspaceId: string): SupplierRow[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as SupplierRow[] : [];
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return [];
  }
}

function writeCache(workspaceId: string, suppliers: readonly SupplierRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId),
    JSON.stringify(suppliers.map((supplier) => {
      const persisted = { ...supplier };
      delete persisted.pending;
      return persisted;
    })),
  );
}

function normalizeCategories(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formValues(supplier: SupplierRow): SupplierForm {
  return {
    code: supplier.code,
    name: supplier.name,
    supplierType: supplier.supplier_type,
    contactName: supplier.contact_name ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    vatRegistrationNumber: supplier.vat_registration_number ?? "",
    paymentTermsDays: String(supplier.payment_terms_days),
    defaultDiscount: String(supplier.default_discount),
    documentCurrency: supplier.document_currency,
    categories: supplier.categories.join(", "),
    addressLine1: supplier.address_line1 ?? "",
    postcode: supplier.postcode ?? "",
    country: supplier.country ?? "",
    notes: supplier.notes ?? "",
  };
}

function supplierFromPayload(payload: Record<string, unknown>): SupplierRow {
  return {
    id: String(payload.id),
    code: String(payload.code),
    name: String(payload.name),
    supplier_type: payload.supplierType as SupplierType,
    contact_name: payload.contactName ? String(payload.contactName) : null,
    email: payload.email ? String(payload.email).toLowerCase() : null,
    phone: payload.phone ? String(payload.phone) : null,
    vat_registration_number: payload.vatRegistrationNumber ? String(payload.vatRegistrationNumber) : null,
    payment_terms_days: Number(payload.paymentTermsDays ?? 0),
    default_discount: Number(payload.defaultDiscount ?? 0),
    document_currency: String(payload.documentCurrency ?? "EUR").toUpperCase(),
    categories: normalizeCategories(payload.categories),
    address_line1: payload.addressLine1 ? String(payload.addressLine1) : null,
    postcode: payload.postcode ? String(payload.postcode) : null,
    country: payload.country ? String(payload.country) : null,
    notes: payload.notes ? String(payload.notes) : null,
    status: "active",
    version: 1,
    pending: true,
  };
}

function applyCommand(suppliers: readonly SupplierRow[], command: SupplierQueuedCommand): SupplierRow[] {
  const payload = command.payload;
  const supplierId = String(payload.id);

  if (command.action === "create") {
    if (suppliers.some((supplier) => supplier.id === supplierId)) return [...suppliers];
    return [...suppliers, supplierFromPayload(payload)];
  }

  return suppliers.map((supplier) => {
    if (supplier.id !== supplierId) return supplier;
    if (command.action === "update") {
      return {
        ...supplier,
        ...supplierFromPayload(payload),
        id: supplier.id,
        status: supplier.status,
        version: Number(payload.expectedVersion ?? supplier.version) + 1,
        pending: true,
      };
    }
    return {
      ...supplier,
      status: command.action === "archive" ? "archived" : "active",
      version: Number(payload.expectedVersion ?? supplier.version) + 1,
      pending: true,
    };
  });
}

function supplierTypeLabel(type: SupplierType) {
  if (type === "product") return "Product supplier";
  if (type === "service") return "Service provider";
  return "General expense";
}

function paymentTermsLabel(days: number) {
  return days === 0 ? "Due on receipt" : `${days} day${days === 1 ? "" : "s"}`;
}

export default function SuppliersPage() {
  const { state, mode } = useBdb();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState<SupplierForm>(() => createEmptyForm(state.settings.currency));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SupplierFilter>("all");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);
    const response = await fetch(`/api/suppliers?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Suppliers could not be loaded.");

    const cloudSuppliers = (result.result?.suppliers ?? []) as SupplierRow[];
    writeCache(currentWorkspaceId, cloudSuppliers);
    const queue = readSupplierQueue(currentWorkspaceId);
    setSuppliers(queue.reduce(applyCommand, cloudSuppliers));
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : [];
      const queued = fallbackWorkspace ? readSupplierQueue(fallbackWorkspace) : [];

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setSuppliers(queued.reduce(applyCommand, cached));
        setPendingCount(queued.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.length || queued.length) {
            setNotice("Showing the last cached supplier directory. Changes will stay queued until the connection returns.");
          } else {
            setError("Suppliers need one successful online load before this workspace can open from a cold offline start.");
          }
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Suppliers could not be loaded.";
        if (cached.length || queued.length) {
          if (active) setNotice("Showing the last cached supplier directory while cloud access is unavailable.");
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) writeCache("demo", suppliers);
  }, [loaded, mode, suppliers]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncing) return;
    setSyncing(true);
    setError("");
    const result = await flushSupplierQueue(workspaceId, setPendingCount);
    setPendingCount(result.remaining);
    if (result.completed) {
      setNotice(`${result.completed} queued supplier change${result.completed === 1 ? "" : "s"} synced.`);
    }
    await loadCloud().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : "Suppliers could not be refreshed.");
    });
    setSyncing(false);
  }, [loadCloud, syncing, workspaceId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    const handleOnline = () => void syncPending();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [mode, syncPending]);

  const submitCommand = useCallback(async (
    action: SupplierCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const commandId = crypto.randomUUID();
    const command: SupplierQueuedCommand = {
      id: commandId,
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setSuppliers((current) => applyCommand(current, command));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    enqueueSupplierCommand(workspaceId, action, payload, commandId);
    setPendingCount(readSupplierQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this supplier change when the connection returns.");
      return true;
    }

    try {
      await submitSupplierCommand(command);
      removeSupplierCommand(workspaceId, command.id);
      setPendingCount(readSupplierQueue(workspaceId).length);
      await loadCloud();
      setNotice(action === "create" ? "Supplier created." : action === "update" ? "Supplier updated." : action === "archive" ? "Supplier archived." : "Supplier restored.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Supplier change could not be saved.";
      failSupplierCommand(workspaceId, command.id, message);
      setPendingCount(readSupplierQueue(workspaceId).length);
      setError(`${message} The change remains in the local retry queue.`);
      return false;
    }
  }, [loadCloud, mode, workspaceId]);

  const visibleSuppliers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return suppliers
      .filter((supplier) => {
        const matchesQuery = !term || [
          supplier.name,
          supplier.code,
          supplier.supplier_type,
          supplier.contact_name,
          supplier.email,
          supplier.phone,
          supplier.vat_registration_number,
          supplier.categories.join(" "),
          supplier.document_currency,
          supplier.country,
        ].join(" ").toLowerCase().includes(term);
        const matchesFilter = filter === "archived"
          ? supplier.status === "archived"
          : supplier.status === "active" && (
            filter === "all"
            || (filter === "products" && supplier.supplier_type === "product")
            || (filter === "services" && supplier.supplier_type === "service")
            || (filter === "expenses" && supplier.supplier_type === "expense")
          );
        return matchesQuery && matchesFilter;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [filter, query, suppliers]);

  function openCreate() {
    setEditing(null);
    setForm(createEmptyForm(state.settings.currency));
    setFormOpen(true);
  }

  function openEdit(supplier: SupplierRow) {
    setEditing(supplier);
    setForm(formValues(supplier));
    setFormOpen(true);
  }

  async function saveSupplier(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const id = editing?.id ?? crypto.randomUUID();
    const saved = await submitCommand(editing ? "update" : "create", {
      id,
      expectedVersion: editing?.version,
      code: form.code,
      name: form.name,
      supplierType: form.supplierType,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      vatRegistrationNumber: form.vatRegistrationNumber,
      paymentTermsDays: Number(form.paymentTermsDays),
      defaultDiscount: Number(form.defaultDiscount),
      documentCurrency: form.documentCurrency.toUpperCase(),
      categories: normalizeCategories(form.categories),
      addressLine1: form.addressLine1,
      postcode: form.postcode,
      country: form.country,
      notes: form.notes,
    });
    setSaving(false);
    if (!saved) return;
    setFormOpen(false);
    setEditing(null);
    setForm(createEmptyForm(state.settings.currency));
  }

  async function changeStatus(supplier: SupplierRow) {
    if (saving || supplier.pending) return;
    setSaving(true);
    await submitCommand(supplier.status === "active" ? "archive" : "restore", {
      id: supplier.id,
      expectedVersion: supplier.version,
    });
    setSaving(false);
  }

  function discardQueue() {
    if (!workspaceId || workspaceId === "demo") return;
    writeSupplierQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local supplier changes were discarded.");
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Suppliers…</main>;
  }

  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active");
  const archivedSuppliers = suppliers.filter((supplier) => supplier.status === "archived");
  const withTerms = activeSuppliers.filter((supplier) => Number(supplier.payment_terms_days) > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Purchasing directory"
        title="Suppliers"
        description="Maintain the supplier identities and default terms referenced by Purchasing, Products, Inventory and Accounts."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Bulk supplier import follows the controlled single-record workflow">
              <FileText size={17} /> Import suppliers
            </Button>
            <Button onClick={openCreate}>
              <Plus size={17} /> Add supplier
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Truck size={19} />
        <div>
          <strong>Functional supplier foundation</strong>
          <p>Supplier records now use workspace isolation, audited commands, offline retry and archive-based lifecycle control. Product-specific terms remain a separate relationship.</p>
        </div>
      </div>

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Suppliers need attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Suppliers updated</strong><p>{notice}</p></div> : null}

      {pendingCount > 0 ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingCount} supplier change{pendingCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Commands remain local with stable retry keys. Conflicting edits will be stopped rather than silently overwritten.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button variant="secondary" disabled={syncing} onClick={() => void syncPending()}><RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry</Button>
            <Button variant="quiet" onClick={discardQueue}>Discard local changes</Button>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Active suppliers" value={String(activeSuppliers.length)} detail="Available purchasing records" icon={<Building2 size={19} />} />
        <StatCard label="Product suppliers" value={String(activeSuppliers.filter((item) => item.supplier_type === "product").length)} detail="Ready for product relationships" icon={<Package size={19} />} />
        <StatCard label="Terms recorded" value={String(withTerms)} detail="Active suppliers with credit terms" icon={<WalletCards size={19} />} />
        <StatCard label="Archived" value={String(archivedSuppliers.length)} detail="Retained for document history" icon={<Archive size={19} />} />
      </div>

      <Card className={styles.suppliersCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search supplier, code, contact, category or country…"
              aria-label="Search suppliers"
            />
          </label>
          <div className={styles.filters} aria-label="Supplier filters">
            {(["all", "products", "services", "expenses", "archived"] as SupplierFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All active" : item === "products" ? "Product" : item === "services" ? "Services" : item === "expenses" ? "Expenses" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleSuppliers.length} suppliers</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.supplierTable}>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Code</th>
                <th>Type</th>
                <th>Contact</th>
                <th>Supplies</th>
                <th>Payment terms</th>
                <th>Default discount</th>
                <th>Currency</th>
                <th>Linked products</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleSuppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <div className={styles.supplierIdentity}>
                      <span><Truck size={17} /></span>
                      <div><strong>{supplier.name}</strong>{supplier.pending ? <small style={{ color: "var(--gold-light)" }}>Pending sync</small> : <small>{supplier.country || "Supplier record"}</small>}</div>
                    </div>
                  </td>
                  <td><code>{supplier.code}</code></td>
                  <td><Badge tone={supplier.supplier_type === "product" ? "gold" : supplier.supplier_type === "service" ? "blue" : "neutral"}>{supplierTypeLabel(supplier.supplier_type)}</Badge></td>
                  <td>
                    <div className={styles.contactCell}>
                      <strong>{supplier.contact_name || "No contact"}</strong>
                      <span><Mail size={13} /> {supplier.email || "—"}</span>
                      <small><Phone size={13} /> {supplier.phone || "—"}</small>
                    </div>
                  </td>
                  <td><div className={styles.categoriesCell}>{supplier.categories.length ? supplier.categories.map((category) => <span className={styles.categoryTag} key={category}>{category}</span>) : <span className="muted">—</span>}</div></td>
                  <td>{paymentTermsLabel(Number(supplier.payment_terms_days))}</td>
                  <td><div className={styles.discountCell}><BadgePercent size={15} /><span>{Number(supplier.default_discount)}%</span></div></td>
                  <td><code>{supplier.document_currency}</code></td>
                  <td><div className={styles.linkedCell}><Package size={15} /><span className="muted">Not linked</span></div></td>
                  <td><Badge tone={supplier.status === "active" ? "green" : "neutral"}>{supplier.status === "active" ? "Active" : "Archived"}</Badge></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                      <Button type="button" variant="quiet" disabled={supplier.pending} onClick={() => openEdit(supplier)}>Edit</Button>
                      <Button type="button" variant="quiet" disabled={supplier.pending || saving} onClick={() => void changeStatus(supplier)}>
                        {supplier.status === "active" ? <><Archive size={15} /> Archive</> : <><Undo2 size={15} /> Restore</>}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleSuppliers.length === 0 ? (
          <div className={styles.emptyState}>
            <Truck size={23} />
            <h3>{query ? "No matching suppliers" : filter === "archived" ? "No archived suppliers" : "No suppliers yet"}</h3>
            <p>{query ? "Change the search term or filter." : "Add the first supplier to establish the shared purchasing directory."}</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><FileText size={20} /></div>
          <p className="eyebrow">Document connection</p>
          <h2>One supplier across purchasing workflows</h2>
          <p className="muted">Supplier invoices and credit notes will reference this identity before their lines create Inventory movements or their totals enter Accounts.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><BadgePercent size={20} /></div>
          <p className="eyebrow">Terms boundary</p>
          <h2>Defaults do not overwrite history</h2>
          <p className="muted">Default terms initialise future documents. Each document must preserve its actual costs, discounts, currency and due date.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => { if (!saving) setFormOpen(false); }}
        title={editing ? "Edit supplier" : "Add supplier"}
        description="Supplier identities are shared by Products, Purchasing, Inventory and Accounts."
        className={styles.supplierDialog}
      >
        <form onSubmit={saveSupplier}>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <label className={styles.wide}>Supplier name<input required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Collis Williams" /></label>
              <label>Supplier code<input required maxLength={64} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="e.g. SUP-CW" /></label>
              <label>Supplier type<select value={form.supplierType} onChange={(event) => setForm({ ...form, supplierType: event.target.value as SupplierType })}><option value="product">Product supplier</option><option value="service">Service provider</option><option value="expense">General expense</option></select></label>
              <label>Contact name<input maxLength={160} value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} placeholder="Primary contact" /></label>
              <label>Email<input maxLength={254} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="orders@supplier.com" /></label>
              <label>Phone<input maxLength={64} type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+356 …" /></label>
              <label>VAT / registration number<input maxLength={80} value={form.vatRegistrationNumber} onChange={(event) => setForm({ ...form, vatRegistrationNumber: event.target.value })} placeholder="Supplier tax identifier" /></label>
              <label>Payment terms<input required min="0" max="365" step="1" type="number" value={form.paymentTermsDays} onChange={(event) => setForm({ ...form, paymentTermsDays: event.target.value })} /><small className="muted">Use 0 for due on receipt.</small></label>
              <label>Default discount (%)<input required min="0" max="100" step="0.01" type="number" value={form.defaultDiscount} onChange={(event) => setForm({ ...form, defaultDiscount: event.target.value })} /></label>
              <label>Document currency<input required minLength={3} maxLength={3} value={form.documentCurrency} onChange={(event) => setForm({ ...form, documentCurrency: event.target.value.toUpperCase() })} placeholder="EUR" /></label>
              <label className={styles.wide}>Supplied categories<input value={form.categories} onChange={(event) => setForm({ ...form, categories: event.target.value })} placeholder="Skincare, consumables, equipment" /><small className="muted">Separate categories with commas.</small></label>
              <label className={styles.wide}>Address<input maxLength={240} value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} placeholder="Street and locality" /></label>
              <label>Postcode<input maxLength={32} value={form.postcode} onChange={(event) => setForm({ ...form, postcode: event.target.value })} /></label>
              <label>Country<input maxLength={120} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
              <label className={styles.wide}>Notes<textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ordering instructions, account references or delivery notes" /></label>
            </div>
            <div className={styles.boundaryNote}>
              <WalletCards size={18} />
              <div><strong>Supplier terms, not payment execution</strong><span>Bank details, payment approval and settlement remain controlled by Accounts and Banking. Product-specific prices follow in the relationship slice.</span></div>
            </div>
          </div>
          <div className="dialog-actions">
            <Button type="button" variant="quiet" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create supplier"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

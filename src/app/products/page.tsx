"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  Barcode,
  Boxes,
  CircleDollarSign,
  Package,
  PackagePlus,
  RefreshCw,
  Search,
  Tags,
  TriangleAlert,
  Truck,
  Undo2,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  enqueueProductCommand,
  failProductCommand,
  flushProductQueue,
  readProductQueue,
  removeProductCommand,
  submitProductCommand,
  writeProductQueue,
  type ProductCommandAction,
  type ProductQueuedCommand,
} from "@/lib/modules/product-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./products.module.css";

type ProductFilter = "all" | "resale" | "supplies" | "archived";
type ProductPurpose = "resale" | "supply";
type ProductStatus = "active" | "archived";

type ProductRow = {
  id: string;
  workspace_id?: string;
  sku: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  purpose: ProductPurpose;
  unit_label: string;
  unit_cost: number;
  selling_price: number | null;
  vat_rate: number;
  reorder_level: number;
  notes: string | null;
  status: ProductStatus;
  version: number;
  created_at?: string;
  updated_at?: string;
  pending?: boolean;
};

type ProductForm = {
  sku: string;
  name: string;
  barcode: string;
  brand: string;
  category: string;
  purpose: ProductPurpose;
  unitLabel: string;
  unitCost: string;
  sellingPrice: string;
  vatRate: string;
  reorderLevel: string;
  notes: string;
};

const emptyForm: ProductForm = {
  sku: "",
  name: "",
  barcode: "",
  brand: "",
  category: "",
  purpose: "resale",
  unitLabel: "unit",
  unitCost: "0",
  sellingPrice: "",
  vatRate: "18",
  reorderLevel: "0",
  notes: "",
};

const CACHE_PREFIX = "bdb-products-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-products-last-workspace-v1";

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

function readCache(workspaceId: string): ProductRow[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as ProductRow[] : [];
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return [];
  }
}

function writeCache(workspaceId: string, products: readonly ProductRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId),
    JSON.stringify(products.map((product) => {
      const cachedProduct = { ...product };
      delete cachedProduct.pending;
      return cachedProduct;
    })),
  );
}

function formValues(product: ProductRow): ProductForm {
  return {
    sku: product.sku,
    name: product.name,
    barcode: product.barcode ?? "",
    brand: product.brand ?? "",
    category: product.category ?? "",
    purpose: product.purpose,
    unitLabel: product.unit_label,
    unitCost: String(product.unit_cost),
    sellingPrice: product.selling_price === null ? "" : String(product.selling_price),
    vatRate: String(product.vat_rate),
    reorderLevel: String(product.reorder_level),
    notes: product.notes ?? "",
  };
}

function productFromPayload(payload: Record<string, unknown>): ProductRow {
  return {
    id: String(payload.id),
    sku: String(payload.sku),
    name: String(payload.name),
    barcode: payload.barcode ? String(payload.barcode) : null,
    brand: payload.brand ? String(payload.brand) : null,
    category: payload.category ? String(payload.category) : null,
    purpose: payload.purpose as ProductPurpose,
    unit_label: String(payload.unitLabel ?? "unit"),
    unit_cost: Number(payload.unitCost ?? 0),
    selling_price: payload.sellingPrice === null || payload.sellingPrice === "" ? null : Number(payload.sellingPrice),
    vat_rate: Number(payload.vatRate ?? 0),
    reorder_level: Number(payload.reorderLevel ?? 0),
    notes: payload.notes ? String(payload.notes) : null,
    status: "active",
    version: 1,
    pending: true,
  };
}

function applyCommand(products: readonly ProductRow[], command: ProductQueuedCommand): ProductRow[] {
  const payload = command.payload;
  const productId = String(payload.id);

  if (command.action === "create") {
    if (products.some((product) => product.id === productId)) return [...products];
    return [...products, productFromPayload(payload)];
  }

  return products.map((product) => {
    if (product.id !== productId) return product;
    if (command.action === "update") {
      return {
        ...product,
        ...productFromPayload(payload),
        id: product.id,
        status: product.status,
        version: Number(payload.expectedVersion ?? product.version) + 1,
        pending: true,
      };
    }
    return {
      ...product,
      status: command.action === "archive" ? "archived" : "active",
      version: Number(payload.expectedVersion ?? product.version) + 1,
      pending: true,
    };
  });
}

export default function ProductsPage() {
  const { state, mode } = useBdb();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supportMode = false;

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);
    const response = await fetch(`/api/products?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Products could not be loaded.");

    const cloudProducts = (result.result?.products ?? []) as ProductRow[];
    writeCache(currentWorkspaceId, cloudProducts);
    const queue = readProductQueue(currentWorkspaceId);
    setProducts(queue.reduce(applyCommand, cloudProducts));
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : [];
      const queued = fallbackWorkspace ? readProductQueue(fallbackWorkspace) : [];

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setProducts(queued.reduce(applyCommand, cached));
        setPendingCount(queued.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.length || queued.length) {
            setNotice("Showing the last cached catalogue. Product changes will stay queued until the connection returns.");
          } else {
            setError("Products need one successful online load before this workspace can open from a cold offline start.");
          }
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Products could not be loaded.";
        if (cached.length || queued.length) {
          if (active) setNotice("Showing the last cached catalogue. Product changes can remain queued while cloud access is unavailable.");
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
    if (mode === "demo" && loaded) writeCache("demo", products);
  }, [loaded, mode, products]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncing) return;
    setSyncing(true);
    setError("");
    const result = await flushProductQueue(workspaceId, setPendingCount);
    setPendingCount(result.remaining);
    if (result.completed) {
      setNotice(`${result.completed} queued product change${result.completed === 1 ? "" : "s"} synced.`);
    }
    await loadCloud().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : "Products could not be refreshed.");
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
    action: ProductCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const commandId = crypto.randomUUID();
    const command: ProductQueuedCommand = {
      id: commandId,
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setProducts((current) => applyCommand(current, command));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    enqueueProductCommand(workspaceId, action, payload, commandId);
    setPendingCount(readProductQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this product change when the connection returns.");
      return true;
    }

    try {
      await submitProductCommand(command);
      removeProductCommand(workspaceId, command.id);
      setPendingCount(readProductQueue(workspaceId).length);
      await loadCloud();
      setNotice(action === "create" ? "Product created." : action === "update" ? "Product updated." : action === "archive" ? "Product archived." : "Product restored.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Product change could not be saved.";
      failProductCommand(workspaceId, command.id, message);
      setPendingCount(readProductQueue(workspaceId).length);
      setError(`${message} The change remains in the local retry queue.`);
      return false;
    }
  }, [loadCloud, mode, workspaceId]);

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products
      .filter((product) => {
        const matchesQuery = !term || [
          product.name,
          product.sku,
          product.purpose,
          product.brand,
          product.category,
          product.barcode,
        ].join(" ").toLowerCase().includes(term);
        const matchesFilter = filter === "archived"
          ? product.status === "archived"
          : product.status === "active" && (
            filter === "all"
            || (filter === "resale" && product.purpose === "resale")
            || (filter === "supplies" && product.purpose === "supply")
          );
        return matchesQuery && matchesFilter;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [filter, products, query]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, vatRate: String(state.settings.vatRate) });
    setFormOpen(true);
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setForm(formValues(product));
    setFormOpen(true);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (saving || supportMode) return;
    setSaving(true);
    const id = editing?.id ?? crypto.randomUUID();
    const saved = await submitCommand(editing ? "update" : "create", {
      id,
      expectedVersion: editing?.version,
      sku: form.sku,
      name: form.name,
      barcode: form.barcode,
      brand: form.brand,
      category: form.category,
      purpose: form.purpose,
      unitLabel: form.unitLabel,
      unitCost: Number(form.unitCost),
      sellingPrice: form.sellingPrice === "" ? null : Number(form.sellingPrice),
      vatRate: Number(form.vatRate),
      reorderLevel: Number(form.reorderLevel),
      notes: form.notes,
    });
    setSaving(false);
    if (!saved) return;
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function changeStatus(product: ProductRow) {
    if (saving || supportMode || product.pending) return;
    setSaving(true);
    await submitCommand(product.status === "active" ? "archive" : "restore", {
      id: product.id,
      expectedVersion: product.version,
    });
    setSaving(false);
  }

  function discardQueue() {
    if (!workspaceId || workspaceId === "demo") return;
    writeProductQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local product changes were discarded.");
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Products…</main>;
  }

  const activeProducts = products.filter((product) => product.status === "active");
  const archivedProducts = products.filter((product) => product.status === "archived");

  return (
    <>
      <PageHeader
        eyebrow="Product catalogue"
        title="Products"
        description="Define the reusable catalogue that Inventory, Purchasing, Sales and invoice lines reference."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" disabled title="Bulk catalogue import follows the controlled single-record workflow">
              <Boxes size={17} /> Import catalogue
            </Button>
            <Button onClick={openCreate} disabled={supportMode}>
              <PackagePlus size={17} /> Add product
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Package size={19} />
        <div>
          <strong>Functional catalogue foundation</strong>
          <p>Product records now use workspace isolation, audited commands, offline retry and archive-based lifecycle control. Stock quantity remains owned by Inventory.</p>
        </div>
      </div>

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Products need attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Products updated</strong><p>{notice}</p></div> : null}

      {pendingCount > 0 ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingCount} product change{pendingCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Commands remain local with stable retry keys. Conflicting edits will be stopped rather than silently overwritten.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button variant="secondary" disabled={syncing} onClick={() => void syncPending()}><RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry</Button>
            <Button variant="quiet" onClick={discardQueue}>Discard local changes</Button>
          </div>
        </div>
      ) : null}

      {supportMode ? (
        <div className={styles.supportNotice}>
          <Package size={18} />
          <div><strong>Read-only access</strong><span>Product catalogue changes are blocked during this session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Active products" value={String(activeProducts.length)} detail="Available catalogue records" icon={<Package size={19} />} />
        <StatCard label="Resale items" value={String(activeProducts.filter((item) => item.purpose === "resale").length)} detail="Available for customer sales" icon={<Tags size={19} />} />
        <StatCard label="Business supplies" value={String(activeProducts.filter((item) => item.purpose === "supply").length)} detail="Tracked but not sold" icon={<Boxes size={19} />} />
        <StatCard label="Archived" value={String(archivedProducts.length)} detail="Retained for historical links" icon={<Archive size={19} />} />
      </div>

      <Card className={styles.catalogueCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, SKU, brand, category or barcode…"
              aria-label="Search products"
            />
          </label>
          <div className={styles.filters} aria-label="Product filters">
            {(["all", "resale", "supplies", "archived"] as ProductFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All active" : item === "resale" ? "Resale" : item === "supplies" ? "Supplies" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleProducts.length} products</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.productTable}>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Purpose</th>
                <th>Brand</th>
                <th>Supplier</th>
                <th>Category</th>
                <th>Barcode</th>
                <th>Unit cost</th>
                <th>Selling price</th>
                <th>VAT</th>
                <th>Reorder at</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id}>
                  <td><div className={styles.productIdentity}><span><Package size={17} /></span><div><strong>{product.name}</strong>{product.pending ? <small style={{ display: "block", color: "var(--gold-light)", marginTop: 2 }}>Pending sync</small> : null}</div></div></td>
                  <td><code>{product.sku}</code></td>
                  <td><Badge tone={product.purpose === "resale" ? "gold" : "blue"}>{product.purpose === "resale" ? "Resale stock" : "Business supply"}</Badge></td>
                  <td>{product.brand || <span className="muted">—</span>}</td>
                  <td><span className="muted">Not linked</span></td>
                  <td>{product.category || <span className="muted">—</span>}</td>
                  <td className={styles.barcodeCell}><Barcode size={15} /><span>{product.barcode || "—"}</span></td>
                  <td>{currency.format(Number(product.unit_cost))}</td>
                  <td>{product.selling_price === null ? <span className="muted">Not for sale</span> : currency.format(Number(product.selling_price))}</td>
                  <td>{Number(product.vat_rate)}%</td>
                  <td>{Number(product.reorder_level)} {product.unit_label}</td>
                  <td><Badge tone={product.status === "active" ? "green" : "neutral"}>{product.status === "active" ? "Active" : "Archived"}</Badge></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                      <Button type="button" variant="quiet" disabled={supportMode || product.pending} onClick={() => openEdit(product)}>Edit</Button>
                      <Button type="button" variant="quiet" disabled={supportMode || product.pending || saving} onClick={() => void changeStatus(product)}>
                        {product.status === "active" ? <><Archive size={15} /> Archive</> : <><Undo2 size={15} /> Restore</>}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleProducts.length === 0 ? (
          <div className={styles.emptyState}>
            <Package size={23} />
            <h3>{query ? "No matching products" : filter === "archived" ? "No archived products" : "No products yet"}</h3>
            <p>{query ? "Change the search term or filter." : "Add the first product to establish the shared catalogue."}</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><CircleDollarSign size={20} /></div>
          <p className="eyebrow">Pricing boundary</p>
          <h2>Catalogue values, not stock totals</h2>
          <p className="muted">Unit cost, selling price and VAT belong to the Product definition. Quantity and stock valuation belong to Inventory movements.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <div className={styles.cardIcon}><Truck size={20} /></div>
          <p className="eyebrow">Supplier boundary</p>
          <h2>Supplier relationships come next</h2>
          <p className="muted">Products may have several suppliers. Supplier codes, preferred status, lead time and supplier-specific costs will live in a separate relationship record.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => { if (!saving) setFormOpen(false); }}
        title={editing ? "Edit product" : "Add product"}
        description="Product definitions are shared by Inventory, Purchasing, Sales and invoice lines."
        className={styles.productDialog}
      >
        <form onSubmit={saveProduct}>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <label className={styles.wide}>Product name<input required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Hydra Medic Serum 60ml" /></label>
              <label>SKU / stock code<input required maxLength={64} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="e.g. RPHMS" /></label>
              <label>Barcode<div className={styles.barcodeInput}><input maxLength={64} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} placeholder="Type barcode" /><Button type="button" variant="secondary" disabled><Barcode size={16} /> Scan</Button></div></label>
              <label>Brand<input maxLength={120} value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Brand name" /></label>
              <label>Supplier<select disabled defaultValue=""><option value="">Connected in next slice</option></select></label>
              <label>Category<input maxLength={120} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. Skincare" /></label>
              <label>Item purpose<select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as ProductPurpose })}><option value="resale">Resale stock</option><option value="supply">Business supply</option></select></label>
              <label>Unit label<input required maxLength={24} value={form.unitLabel} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} placeholder="unit" /></label>
              <label>Unit cost ({state.settings.currency})<input required min="0" step="0.0001" type="number" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></label>
              <label>Selling price ({state.settings.currency})<input min="0" step="0.0001" type="number" value={form.sellingPrice} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} placeholder="Not for sale" /></label>
              <label>VAT rate (%)<input required min="0" max="100" step="0.01" type="number" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} /></label>
              <label>Reorder level<input required min="0" step="0.001" type="number" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} /></label>
              <label className={styles.wide}>Notes<textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional product notes" /></label>
            </div>
            <div className={styles.openingStockNote}>
              <Boxes size={18} />
              <div><strong>Opening stock is a separate movement</strong><span>Define the product first. Opening quantity will be recorded through Inventory so movement history remains auditable.</span></div>
            </div>
          </div>
          <div className="dialog-actions">
            <Button type="button" variant="quiet" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || supportMode}>{saving ? "Saving…" : editing ? "Save changes" : "Create product"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

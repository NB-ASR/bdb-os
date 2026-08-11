"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Clock3,
  Link2,
  Package,
  Plus,
  RefreshCw,
  Star,
  TriangleAlert,
  Truck,
  Undo2,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  enqueueProductSupplierCommand,
  failProductSupplierCommand,
  flushProductSupplierQueue,
  readProductSupplierQueue,
  removeProductSupplierCommand,
  submitProductSupplierCommand,
  writeProductSupplierQueue,
  type ProductSupplierCommandAction,
  type ProductSupplierQueuedCommand,
} from "@/lib/modules/product-supplier-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./product-suppliers.module.css";

type RelationshipStatus = "active" | "archived";
type RelationshipFilter = "active" | "archived";

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: "active" | "archived";
  unit_label: string;
}

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  supplier_type: "product" | "service" | "expense";
  document_currency: string;
  status: "active" | "archived";
}

interface ProductSupplierRow {
  id: string;
  workspace_id?: string;
  product_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_cost: number | null;
  currency: string;
  is_preferred: boolean;
  lead_time_days: number;
  minimum_order_quantity: number;
  notes: string | null;
  status: RelationshipStatus;
  version: number;
  created_at?: string;
  updated_at?: string;
  pending?: boolean;
}

interface RelationshipForm {
  supplierId: string;
  supplierSku: string;
  supplierCost: string;
  currency: string;
  isPreferred: boolean;
  leadTimeDays: string;
  minimumOrderQuantity: string;
  notes: string;
}

interface RelationshipCache {
  product: ProductRow | null;
  suppliers: SupplierRow[];
  relationships: ProductSupplierRow[];
}

const CACHE_PREFIX = "bdb-product-supplier-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-product-supplier-last-workspace-v1";

function createEmptyForm(currency: string): RelationshipForm {
  return {
    supplierId: "",
    supplierSku: "",
    supplierCost: "",
    currency,
    isPreferred: false,
    leadTimeDays: "0",
    minimumOrderQuantity: "1",
    notes: "",
  };
}

function cacheKey(workspaceId: string, productId: string) {
  return `${CACHE_PREFIX}:${workspaceId}:${productId}`;
}

function readLastWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function rememberWorkspace(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function readCache(workspaceId: string, productId: string): RelationshipCache {
  const empty: RelationshipCache = { product: null, suppliers: [], relationships: [] };
  if (typeof window === "undefined") return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId, productId)) ?? "null") as RelationshipCache | null;
    return parsed && typeof parsed === "object" ? parsed : empty;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId, productId));
    return empty;
  }
}

function writeCache(
  workspaceId: string,
  productId: string,
  cache: RelationshipCache,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId, productId),
    JSON.stringify({
      ...cache,
      relationships: cache.relationships.map((relationship) => {
        const persisted = { ...relationship };
        delete persisted.pending;
        return persisted;
      }),
    }),
  );
}

function formValues(relationship: ProductSupplierRow): RelationshipForm {
  return {
    supplierId: relationship.supplier_id,
    supplierSku: relationship.supplier_sku ?? "",
    supplierCost: relationship.supplier_cost === null ? "" : String(relationship.supplier_cost),
    currency: relationship.currency,
    isPreferred: relationship.is_preferred,
    leadTimeDays: String(relationship.lead_time_days),
    minimumOrderQuantity: String(relationship.minimum_order_quantity),
    notes: relationship.notes ?? "",
  };
}

function relationshipFromPayload(payload: Record<string, unknown>): ProductSupplierRow {
  return {
    id: String(payload.id),
    product_id: String(payload.productId),
    supplier_id: String(payload.supplierId),
    supplier_sku: payload.supplierSku ? String(payload.supplierSku) : null,
    supplier_cost: payload.supplierCost === null || payload.supplierCost === "" ? null : Number(payload.supplierCost),
    currency: String(payload.currency ?? "EUR").toUpperCase(),
    is_preferred: Boolean(payload.isPreferred),
    lead_time_days: Number(payload.leadTimeDays ?? 0),
    minimum_order_quantity: Number(payload.minimumOrderQuantity ?? 1),
    notes: payload.notes ? String(payload.notes) : null,
    status: "active",
    version: 1,
    pending: true,
  };
}

function applyCommand(
  relationships: readonly ProductSupplierRow[],
  command: ProductSupplierQueuedCommand,
  productId: string,
): ProductSupplierRow[] {
  const payload = command.payload;
  const relationshipId = String(payload.id);
  const commandProductId = String(payload.productId ?? "");

  if (command.action === "create") {
    if (commandProductId !== productId || relationships.some((item) => item.id === relationshipId)) {
      return [...relationships];
    }
    return [...relationships, relationshipFromPayload(payload)];
  }

  return relationships.map((relationship) => {
    if (relationship.id !== relationshipId) return relationship;
    if (command.action === "update") {
      return {
        ...relationship,
        ...relationshipFromPayload(payload),
        id: relationship.id,
        product_id: relationship.product_id,
        supplier_id: relationship.supplier_id,
        status: relationship.status,
        version: Number(payload.expectedVersion ?? relationship.version) + 1,
        pending: true,
      };
    }
    if (command.action === "restore") {
      return {
        ...relationship,
        ...relationshipFromPayload(payload),
        id: relationship.id,
        product_id: relationship.product_id,
        supplier_id: relationship.supplier_id,
        status: "active",
        version: Number(payload.expectedVersion ?? relationship.version) + 1,
        pending: true,
      };
    }
    return {
      ...relationship,
      status: "archived",
      version: Number(payload.expectedVersion ?? relationship.version) + 1,
      pending: true,
    };
  });
}

export default function ProductSuppliersPage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const productId = String(params.productId);
  const { state, mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [relationships, setRelationships] = useState<ProductSupplierRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductSupplierRow | null>(null);
  const [form, setForm] = useState<RelationshipForm>(() => createEmptyForm(state.settings.currency));
  const [filter, setFilter] = useState<RelationshipFilter>("active");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const availableSuppliers = useMemo(() => {
    const linkedIds = new Set(relationships.map((relationship) => relationship.supplier_id));
    return suppliers
      .filter((supplier) => supplier.status === "active" && supplier.supplier_type === "product" && !linkedIds.has(supplier.id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [relationships, suppliers]);

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);

    const [productsResponse, suppliersResponse, relationshipsResponse] = await Promise.all([
      fetch(`/api/products?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/suppliers?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/product-suppliers?workspaceId=${encodeURIComponent(currentWorkspaceId)}&productId=${encodeURIComponent(productId)}`, { cache: "no-store" }),
    ]);
    const [productsResult, suppliersResult, relationshipsResult] = await Promise.all([
      productsResponse.json().catch(() => ({})),
      suppliersResponse.json().catch(() => ({})),
      relationshipsResponse.json().catch(() => ({})),
    ]);
    if (!productsResponse.ok || !productsResult.ok) throw new Error(productsResult.error ?? "Products could not be loaded.");
    if (!suppliersResponse.ok || !suppliersResult.ok) throw new Error(suppliersResult.error ?? "Suppliers could not be loaded.");
    if (!relationshipsResponse.ok || !relationshipsResult.ok) throw new Error(relationshipsResult.error ?? "Product Suppliers could not be loaded.");

    const cloudProduct = ((productsResult.result?.products ?? []) as ProductRow[]).find((item) => item.id === productId) ?? null;
    if (!cloudProduct) throw new Error("The Product could not be found in this workspace.");
    const cloudSuppliers = (suppliersResult.result?.suppliers ?? []) as SupplierRow[];
    const cloudRelationships = (relationshipsResult.result?.relationships ?? []) as ProductSupplierRow[];
    const queue = readProductSupplierQueue(currentWorkspaceId);
    const visibleRelationships = queue.reduce(
      (current, command) => applyCommand(current, command, productId),
      cloudRelationships,
    );

    setProduct(cloudProduct);
    setSuppliers(cloudSuppliers);
    setRelationships(visibleRelationships);
    setPendingCount(queue.length);
    writeCache(currentWorkspaceId, productId, {
      product: cloudProduct,
      suppliers: cloudSuppliers,
      relationships: cloudRelationships,
    });
  }, [productId]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace, productId) : { product: null, suppliers: [], relationships: [] };
      const queued = fallbackWorkspace ? readProductSupplierQueue(fallbackWorkspace) : [];

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setProduct(cached.product);
        setSuppliers(cached.suppliers);
        setRelationships(queued.reduce(
          (current, command) => applyCommand(current, command, productId),
          cached.relationships,
        ));
        setPendingCount(queued.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.product) {
            setNotice("Showing cached Product Supplier terms. Changes will stay queued until the connection returns.");
          } else {
            setError("This Product needs one successful online load before its Supplier terms can open from a cold offline start.");
          }
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Product Suppliers could not be loaded.";
        if (cached.product) {
          if (active) setNotice("Showing cached Product Supplier terms while cloud access is unavailable.");
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode, productId]);

  useEffect(() => {
    if (mode === "demo" && loaded && product) {
      writeCache("demo", productId, { product, suppliers, relationships });
    }
  }, [loaded, mode, product, productId, relationships, suppliers]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncing) return;
    setSyncing(true);
    setError("");
    const result = await flushProductSupplierQueue(workspaceId, setPendingCount);
    setPendingCount(result.remaining);
    if (result.completed) {
      setNotice(`${result.completed} queued Product Supplier change${result.completed === 1 ? "" : "s"} synced.`);
    }
    await loadCloud().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : "Product Suppliers could not be refreshed.");
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
    action: ProductSupplierCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const commandId = crypto.randomUUID();
    const command: ProductSupplierQueuedCommand = {
      id: commandId,
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setRelationships((current) => applyCommand(current, command, productId));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    enqueueProductSupplierCommand(workspaceId, action, payload, commandId);
    setPendingCount(readProductSupplierQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this Product Supplier change when the connection returns.");
      return true;
    }

    try {
      await submitProductSupplierCommand(command);
      removeProductSupplierCommand(workspaceId, command.id);
      setPendingCount(readProductSupplierQueue(workspaceId).length);
      await loadCloud();
      setNotice(action === "create"
        ? "Supplier linked to Product."
        : action === "update"
          ? "Product Supplier terms updated."
          : action === "archive"
            ? "Product Supplier relationship archived."
            : "Product Supplier relationship restored.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Product Supplier change could not be saved.";
      failProductSupplierCommand(workspaceId, command.id, message);
      setPendingCount(readProductSupplierQueue(workspaceId).length);
      setError(`${message} The change remains in the local retry queue.`);
      return false;
    }
  }, [loadCloud, mode, productId, workspaceId]);

  const visibleRelationships = useMemo(
    () => relationships
      .filter((relationship) => relationship.status === filter)
      .sort((left, right) => {
        if (left.is_preferred !== right.is_preferred) return left.is_preferred ? -1 : 1;
        return (supplierById.get(left.supplier_id)?.name ?? "").localeCompare(supplierById.get(right.supplier_id)?.name ?? "");
      }),
    [filter, relationships, supplierById],
  );

  function openCreate() {
    setEditing(null);
    setForm(createEmptyForm(state.settings.currency));
    setFormOpen(true);
  }

  function openEdit(relationship: ProductSupplierRow) {
    setEditing(relationship);
    setForm(formValues(relationship));
    setFormOpen(true);
  }

  async function saveRelationship(event: FormEvent) {
    event.preventDefault();
    if (saving || !product) return;
    setSaving(true);
    const id = editing?.id ?? crypto.randomUUID();
    const saved = await submitCommand(editing ? "update" : "create", {
      id,
      expectedVersion: editing?.version,
      productId: product.id,
      supplierId: editing?.supplier_id ?? form.supplierId,
      supplierSku: form.supplierSku,
      supplierCost: form.supplierCost === "" ? null : Number(form.supplierCost),
      currency: form.currency.toUpperCase(),
      isPreferred: form.isPreferred,
      leadTimeDays: Number(form.leadTimeDays),
      minimumOrderQuantity: Number(form.minimumOrderQuantity),
      notes: form.notes,
    });
    setSaving(false);
    if (!saved) return;
    setFormOpen(false);
    setEditing(null);
    setForm(createEmptyForm(state.settings.currency));
  }

  async function changeStatus(relationship: ProductSupplierRow) {
    if (saving || relationship.pending) return;
    setSaving(true);
    const action = relationship.status === "active" ? "archive" : "restore";
    await submitCommand(action, action === "archive"
      ? { id: relationship.id, expectedVersion: relationship.version }
      : {
        id: relationship.id,
        expectedVersion: relationship.version,
        productId: relationship.product_id,
        supplierId: relationship.supplier_id,
        supplierSku: relationship.supplier_sku,
        supplierCost: relationship.supplier_cost,
        currency: relationship.currency,
        isPreferred: relationship.is_preferred,
        leadTimeDays: relationship.lead_time_days,
        minimumOrderQuantity: relationship.minimum_order_quantity,
        notes: relationship.notes,
      });
    setSaving(false);
  }

  function discardQueue() {
    if (!workspaceId || workspaceId === "demo") return;
    writeProductSupplierQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local Product Supplier changes were discarded.");
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Product Suppliers…</main>;
  }

  const activeRelationships = relationships.filter((relationship) => relationship.status === "active");
  const archivedRelationships = relationships.filter((relationship) => relationship.status === "archived");
  const preferred = activeRelationships.find((relationship) => relationship.is_preferred) ?? null;
  const leadTimes = activeRelationships.map((relationship) => Number(relationship.lead_time_days));

  return (
    <>
      <PageHeader
        eyebrow="Product purchasing terms"
        title={product ? `${product.name} · Suppliers` : "Product Suppliers"}
        description={product
          ? `Manage Supplier-specific purchasing terms for ${product.sku}. Product pricing and Inventory quantity remain separate.`
          : "Manage Product-to-Supplier purchasing terms."}
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => router.push("/products")}>
              <ArrowLeft size={17} /> Products
            </Button>
            <Button onClick={openCreate} disabled={!product || product.status !== "active" || availableSuppliers.length === 0}>
              <Plus size={17} /> Link supplier
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Link2 size={19} />
        <div>
          <strong>Functional Product–Supplier relationship</strong>
          <p>Supplier-specific SKU, cost, lead time and order quantity now live in an audited relationship without duplicating the Product or Supplier record.</p>
        </div>
      </div>

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Product Suppliers need attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Product Suppliers updated</strong><p>{notice}</p></div> : null}

      {pendingCount > 0 ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingCount} Product Supplier change{pendingCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Commands retain stable retry keys. Relationship conflicts are stopped rather than silently overwritten.</p>
          <div className={styles.queueActions}>
            <Button variant="secondary" disabled={syncing} onClick={() => void syncPending()}>
              <RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry
            </Button>
            <Button variant="quiet" onClick={discardQueue}>Discard local changes</Button>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Active suppliers" value={String(activeRelationships.length)} detail="Current purchasing relationships" icon={<Truck size={19} />} />
        <StatCard label="Preferred" value={preferred ? supplierById.get(preferred.supplier_id)?.name ?? "Assigned" : "None"} detail="One active preferred supplier maximum" icon={<Star size={19} />} />
        <StatCard label="Shortest lead time" value={leadTimes.length ? `${Math.min(...leadTimes)} days` : "—"} detail="Catalogue planning value" icon={<Clock3 size={19} />} />
        <StatCard label="Archived" value={String(archivedRelationships.length)} detail="Retained for purchasing history" icon={<Archive size={19} />} />
      </div>

      <Card className={styles.relationshipCard}>
        <div className={styles.toolbar}>
          <div className={styles.productContext}>
            <Package size={18} />
            <div><strong>{product?.name ?? "Product unavailable"}</strong><span>{product?.sku ?? productId}</span></div>
          </div>
          <div className={styles.filters} aria-label="Product Supplier filters">
            {(["active", "archived"] as RelationshipFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? styles.activeFilter : ""}
                onClick={() => setFilter(item)}
              >
                {item === "active" ? "Active" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleRelationships.length} relationships</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.relationshipTable}>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Supplier SKU</th>
                <th>Supplier cost</th>
                <th>Preferred</th>
                <th>Lead time</th>
                <th>Minimum order</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleRelationships.map((relationship) => {
                const supplier = supplierById.get(relationship.supplier_id);
                const money = new Intl.NumberFormat("en-GB", {
                  style: "currency",
                  currency: relationship.currency,
                });
                return (
                  <tr key={relationship.id}>
                    <td>
                      <div className={styles.supplierIdentity}>
                        <span><Truck size={17} /></span>
                        <div>
                          <strong>{supplier?.name ?? "Supplier unavailable"}</strong>
                          <small>{supplier?.code ?? relationship.supplier_id}{relationship.pending ? " · Pending sync" : ""}</small>
                        </div>
                      </div>
                    </td>
                    <td><code>{relationship.supplier_sku || "—"}</code></td>
                    <td>{relationship.supplier_cost === null ? <span className="muted">Not recorded</span> : money.format(Number(relationship.supplier_cost))}</td>
                    <td>{relationship.is_preferred ? <Badge tone="gold"><Star size={13} /> Preferred</Badge> : <span className="muted">Alternative</span>}</td>
                    <td>{Number(relationship.lead_time_days)} days</td>
                    <td>{Number(relationship.minimum_order_quantity)} {product?.unit_label ?? "units"}</td>
                    <td><Badge tone={relationship.status === "active" ? "green" : "neutral"}>{relationship.status === "active" ? "Active" : "Archived"}</Badge></td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button type="button" variant="quiet" disabled={relationship.pending || relationship.status === "archived"} onClick={() => openEdit(relationship)}>Edit</Button>
                        <Button type="button" variant="quiet" disabled={relationship.pending || saving} onClick={() => void changeStatus(relationship)}>
                          {relationship.status === "active" ? <><Archive size={15} /> Archive</> : <><Undo2 size={15} /> Restore</>}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleRelationships.length === 0 ? (
          <div className={styles.emptyState}>
            <Link2 size={23} />
            <h3>{filter === "archived" ? "No archived relationships" : "No suppliers linked"}</h3>
            <p>{filter === "archived" ? "Archived Product Supplier history will remain here." : availableSuppliers.length ? "Link the first Product supplier." : "Create an active Product supplier before linking it."}</p>
          </div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}>
          <p className="eyebrow">Purchasing boundary</p>
          <h2>Relationship cost is a planning value</h2>
          <p className="muted">Supplier cost can initialise a future document line. The approved supplier invoice or credit note must preserve the actual historical cost and currency.</p>
        </Card>
        <Card className={styles.guidanceCard}>
          <p className="eyebrow">Inventory boundary</p>
          <h2>Linking a Supplier does not change stock</h2>
          <p className="muted">Inventory quantity changes only when an approved purchasing document posts an auditable movement.</p>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onClose={() => { if (!saving) setFormOpen(false); }}
        title={editing ? "Edit Product Supplier terms" : "Link Supplier to Product"}
        description="Store Supplier-specific purchasing terms without changing Product pricing or document history."
        className={styles.relationshipDialog}
      >
        <form onSubmit={saveRelationship}>
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <label className={styles.wide}>Product<input disabled value={product ? `${product.name} · ${product.sku}` : productId} /></label>
              <label>Supplier
                <select
                  required
                  disabled={Boolean(editing)}
                  value={editing?.supplier_id ?? form.supplierId}
                  onChange={(event) => {
                    const supplier = supplierById.get(event.target.value);
                    setForm({
                      ...form,
                      supplierId: event.target.value,
                      currency: supplier?.document_currency ?? state.settings.currency,
                    });
                  }}
                >
                  <option value="">Select Product supplier</option>
                  {(editing
                    ? suppliers.filter((supplier) => supplier.id === editing.supplier_id)
                    : availableSuppliers
                  ).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code}</option>)}
                </select>
              </label>
              <label>Supplier SKU<input maxLength={64} value={form.supplierSku} onChange={(event) => setForm({ ...form, supplierSku: event.target.value })} placeholder="Supplier's product code" /></label>
              <label>Supplier cost<input min="0" step="0.0001" type="number" value={form.supplierCost} onChange={(event) => setForm({ ...form, supplierCost: event.target.value })} placeholder="Not recorded" /></label>
              <label>Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
              <label>Lead time (days)<input required min="0" max="3650" step="1" type="number" value={form.leadTimeDays} onChange={(event) => setForm({ ...form, leadTimeDays: event.target.value })} /></label>
              <label>Minimum order quantity<input required min="0.001" step="0.001" type="number" value={form.minimumOrderQuantity} onChange={(event) => setForm({ ...form, minimumOrderQuantity: event.target.value })} /></label>
              <label className={styles.checkboxLabel}><input type="checkbox" checked={form.isPreferred} onChange={(event) => setForm({ ...form, isPreferred: event.target.checked })} /><span><strong>Preferred supplier</strong><small>Only one active preferred Supplier is allowed for this Product.</small></span></label>
              <label className={styles.wide}>Notes<textarea maxLength={2000} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional ordering or catalogue notes" /></label>
            </div>
            <div className={styles.boundaryNote}>
              <Link2 size={18} />
              <div><strong>Product and Supplier identities are fixed</strong><span>Archive this relationship and create another instead of changing either side. This protects document and Activity history.</span></div>
            </div>
          </div>
          <div className="dialog-actions">
            <Button type="button" variant="quiet" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save terms" : "Link supplier"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

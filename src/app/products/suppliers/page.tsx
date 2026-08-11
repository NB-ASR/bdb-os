"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Package, RefreshCw, Search, Star, TriangleAlert, Truck } from "lucide-react";
import { useBdb } from "@/lib/store";
import { readProductSupplierQueue, type ProductSupplierQueuedCommand } from "@/lib/modules/product-supplier-queue";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";
import styles from "./product-supplier-index.module.css";

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: "active" | "archived";
}

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  supplier_type: "product" | "service" | "expense";
  status: "active" | "archived";
}

interface ProductSupplierRow {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier_cost: number | null;
  currency: string;
  is_preferred: boolean;
  status: "active" | "archived";
  version: number;
  pending?: boolean;
}

interface IndexCache {
  products: ProductRow[];
  suppliers: SupplierRow[];
  relationships: ProductSupplierRow[];
}

const CACHE_PREFIX = "bdb-product-supplier-index-v1";
const LAST_WORKSPACE_KEY = "bdb-product-supplier-last-workspace-v1";

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

function readCache(workspaceId: string): IndexCache {
  const empty: IndexCache = { products: [], suppliers: [], relationships: [] };
  if (typeof window === "undefined") return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as IndexCache | null;
    return parsed && typeof parsed === "object" ? parsed : empty;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return empty;
  }
}

function writeCache(workspaceId: string, cache: IndexCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey(workspaceId), JSON.stringify(cache));
}

function queuedRelationship(command: ProductSupplierQueuedCommand): ProductSupplierRow | null {
  const payload = command.payload;
  if (!payload.id || !payload.productId || !payload.supplierId) return null;
  return {
    id: String(payload.id),
    product_id: String(payload.productId),
    supplier_id: String(payload.supplierId),
    supplier_cost: payload.supplierCost === null || payload.supplierCost === "" ? null : Number(payload.supplierCost),
    currency: String(payload.currency ?? "EUR"),
    is_preferred: Boolean(payload.isPreferred),
    status: command.action === "archive" ? "archived" : "active",
    version: Number(payload.expectedVersion ?? 0) + 1,
    pending: true,
  };
}

function applyQueue(
  relationships: readonly ProductSupplierRow[],
  commands: readonly ProductSupplierQueuedCommand[],
) {
  return commands.reduce<ProductSupplierRow[]>((current, command) => {
    const payloadId = String(command.payload.id ?? "");
    if (command.action === "create") {
      const queued = queuedRelationship(command);
      return queued && !current.some((item) => item.id === queued.id) ? [...current, queued] : current;
    }
    return current.map((relationship) => {
      if (relationship.id !== payloadId) return relationship;
      if (command.action === "archive") return { ...relationship, status: "archived", pending: true };
      const queued = queuedRelationship(command);
      return queued ? { ...relationship, ...queued, id: relationship.id } : relationship;
    });
  }, [...relationships]);
}

export default function ProductSupplierIndexPage() {
  const router = useRouter();
  const { mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [relationships, setRelationships] = useState<ProductSupplierRow[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
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

    const [productsResponse, suppliersResponse, relationshipsResponse] = await Promise.all([
      fetch(`/api/products?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/suppliers?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
      fetch(`/api/product-suppliers?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" }),
    ]);
    const [productsResult, suppliersResult, relationshipsResult] = await Promise.all([
      productsResponse.json().catch(() => ({})),
      suppliersResponse.json().catch(() => ({})),
      relationshipsResponse.json().catch(() => ({})),
    ]);
    if (!productsResponse.ok || !productsResult.ok) throw new Error(productsResult.error ?? "Products could not be loaded.");
    if (!suppliersResponse.ok || !suppliersResult.ok) throw new Error(suppliersResult.error ?? "Suppliers could not be loaded.");
    if (!relationshipsResponse.ok || !relationshipsResult.ok) throw new Error(relationshipsResult.error ?? "Supplier terms could not be loaded.");

    const cloudProducts = (productsResult.result?.products ?? []) as ProductRow[];
    const cloudSuppliers = (suppliersResult.result?.suppliers ?? []) as SupplierRow[];
    const cloudRelationships = (relationshipsResult.result?.relationships ?? []) as ProductSupplierRow[];
    const queue = readProductSupplierQueue(currentWorkspaceId);

    setProducts(cloudProducts);
    setSuppliers(cloudSuppliers);
    setRelationships(applyQueue(cloudRelationships, queue));
    setPendingCount(queue.length);
    writeCache(currentWorkspaceId, {
      products: cloudProducts,
      suppliers: cloudSuppliers,
      relationships: cloudRelationships,
    });
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : { products: [], suppliers: [], relationships: [] };
      const queue = fallbackWorkspace ? readProductSupplierQueue(fallbackWorkspace) : [];

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setProducts(cached.products);
        setSuppliers(cached.suppliers);
        setRelationships(applyQueue(cached.relationships, queue));
        setPendingCount(queue.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.products.length) setNotice("Showing cached Product Supplier terms while offline.");
          else setError("Supplier terms need one successful online load before this page can open from a cold offline start.");
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Supplier terms could not be loaded.";
        if (cached.products.length) {
          if (active) setNotice("Showing cached Supplier terms while cloud access is unavailable.");
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

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const activeProducts = useMemo(
    () => products.filter((product) => product.status === "active"),
    [products],
  );

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return activeProducts
      .filter((product) => !term || `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [activeProducts, query]);

  const activeRelationships = relationships.filter((relationship) => relationship.status === "active");
  const linkedProductCount = new Set(activeRelationships.map((relationship) => relationship.product_id)).size;
  const preferredCount = activeRelationships.filter((relationship) => relationship.is_preferred).length;
  const availableProductSuppliers = suppliers.filter((supplier) => supplier.status === "active" && supplier.supplier_type === "product").length;

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Supplier terms…</main>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Product purchasing terms"
        title="Supplier terms"
        description="Choose a Product to manage Supplier-specific SKU, cost, lead time, minimum order quantity and preferred status."
        action={<Button variant="secondary" onClick={() => void loadCloud()} disabled={!workspaceId || mode === "demo"}><RefreshCw size={17} /> Refresh</Button>}
      />

      <div className="review-callout">
        <Link2 size={19} />
        <div><strong>Connected catalogue workflow</strong><p>Relationships reference existing Product and Supplier records. They do not duplicate either record or change Inventory quantity.</p></div>
      </div>

      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Supplier terms need attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Cached Supplier terms</strong><p>{notice}</p></div> : null}
      {pendingCount ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>{pendingCount} relationship change{pendingCount === 1 ? "" : "s"} waiting to sync</strong><p>Open the affected Product to retry or discard its queued changes.</p></div> : null}
      <div className="stat-grid">
        <StatCard label="Active products" value={String(activeProducts.length)} detail="Catalogue records available for sourcing" icon={<Package size={19} />} />
        <StatCard label="Products linked" value={String(linkedProductCount)} detail="Products with at least one Supplier" icon={<Link2 size={19} />} />
        <StatCard label="Preferred assigned" value={String(preferredCount)} detail="Products with a preferred Supplier" icon={<Star size={19} />} />
        <StatCard label="Product suppliers" value={String(availableProductSuppliers)} detail="Active Suppliers available to link" icon={<Truck size={19} />} />
      </div>

      <Card className={styles.indexCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Product or SKU…" aria-label="Search Products" />
          </label>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleProducts.length} products</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.indexTable}>
            <thead><tr><th>Product</th><th>SKU</th><th>Active suppliers</th><th>Preferred supplier</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visibleProducts.map((product) => {
                const productRelationships = activeRelationships.filter((relationship) => relationship.product_id === product.id);
                const preferred = productRelationships.find((relationship) => relationship.is_preferred);
                const preferredSupplier = preferred ? supplierById.get(preferred.supplier_id) : null;
                return (
                  <tr key={product.id}>
                    <td><div className={styles.productIdentity}><span><Package size={17} /></span><strong>{product.name}</strong></div></td>
                    <td><code>{product.sku}</code></td>
                    <td>{productRelationships.length}</td>
                    <td>{preferredSupplier ? <Badge tone="gold"><Star size={13} /> {preferredSupplier.name}</Badge> : <span className="muted">Not assigned</span>}</td>
                    <td><Button type="button" variant="quiet" onClick={() => router.push(`/products/${product.id}/suppliers`)}>Manage terms</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleProducts.length === 0 ? <div className={styles.emptyState}><Package size={23} /><h3>{query ? "No matching Products" : "No active Products"}</h3><p>{query ? "Change the search term." : "Create a Product before adding Supplier terms."}</p></div> : null}
      </Card>
    </>
  );
}

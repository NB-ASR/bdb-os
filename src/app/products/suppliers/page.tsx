"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Package, RefreshCw, Search, Star, TriangleAlert, Truck } from "lucide-react";
import { useBdb } from "@/lib/store";
import { readProductSupplierQueue } from "@/lib/modules/product-supplier-queue";
import { Badge, Button, Card, PageHeader, StatCard } from "@/components/ui";
import styles from "./product-supplier-index.module.css";

interface SupplierTermRow {
  product_id: string;
  sku: string;
  name: string;
  active_supplier_count: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
}

interface SupplierTermsSummary {
  activeProducts: number;
  activeRelationships: number;
  preferredRelationships: number;
  productSuppliers: number;
}

interface RegisterCursor {
  name: string;
  id: string;
}

interface IndexCache {
  terms: SupplierTermRow[];
  summary: SupplierTermsSummary;
}

const CACHE_PREFIX = "bdb-product-supplier-index-v2";
const LAST_WORKSPACE_KEY = "bdb-product-supplier-last-workspace-v1";
const CACHE_LIMIT = 500;
const PAGE_SIZE = 100;
const EMPTY_SUMMARY: SupplierTermsSummary = {
  activeProducts: 0,
  activeRelationships: 0,
  preferredRelationships: 0,
  productSuppliers: 0,
};

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
  const empty: IndexCache = { terms: [], summary: EMPTY_SUMMARY };
  if (typeof window === "undefined") return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as IndexCache | null;
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      terms: Array.isArray(parsed.terms) ? parsed.terms.slice(0, CACHE_LIMIT) : [],
      summary: parsed.summary && typeof parsed.summary === "object" ? parsed.summary : EMPTY_SUMMARY,
    };
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return empty;
  }
}

function writeCache(workspaceId: string, cache: IndexCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId),
    JSON.stringify({ terms: cache.terms.slice(0, CACHE_LIMIT), summary: cache.summary }),
  );
}

export default function ProductSupplierIndexPage() {
  const router = useRouter();
  const { mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [terms, setTerms] = useState<SupplierTermRow[]>([]);
  const [summary, setSummary] = useState<SupplierTermsSummary>(EMPTY_SUMMARY);
  const [query, setQuery] = useState("");
  const nextCursorRef = useRef<RegisterCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supportMode = false;

  useEffect(() => {
    let active = true;
    async function resolveWorkspace() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      if (fallbackWorkspace && active) {
        const cached = readCache(fallbackWorkspace);
        setWorkspaceId(fallbackWorkspace);
        setTerms(cached.terms);
        setSummary(cached.summary);
        setPendingCount(readProductSupplierQueue(fallbackWorkspace).length);
      }

      try {
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (fallbackWorkspace && readCache(fallbackWorkspace).terms.length) {
            setNotice("Showing cached Supplier terms while offline.");
          } else {
            setError("Supplier terms need one successful online load before this page can open from a cold offline start.");
          }
          return;
        }

        const response = await fetch("/api/workspace/context", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.currentWorkspaceId) {
          throw new Error(result.error ?? "The current workspace could not be resolved.");
        }
        if (!active) return;
        const currentWorkspaceId = String(result.currentWorkspaceId);
        setWorkspaceId(currentWorkspaceId);
        rememberWorkspace(currentWorkspaceId);
        setPendingCount(readProductSupplierQueue(currentWorkspaceId).length);
      } catch (initialError) {
        if (!fallbackWorkspace || readCache(fallbackWorkspace).terms.length === 0) {
          setError(initialError instanceof Error ? initialError.message : "Supplier terms could not be loaded.");
        } else {
          setNotice("Showing cached Supplier terms while cloud access is unavailable.");
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void resolveWorkspace();
    return () => { active = false; };
  }, [mode]);

  const loadPage = useCallback(async (options?: { append?: boolean; search?: string }) => {
    if (!workspaceId || workspaceId === "demo" || !navigator.onLine) return;
    const append = Boolean(options?.append);
    const search = String(options?.search ?? "").trim();
    const cursor = append ? nextCursorRef.current : null;
    setLoadingPage(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({
        workspaceId,
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("query", search);
      if (cursor) {
        params.set("afterName", cursor.name);
        params.set("afterId", cursor.id);
      }
      const response = await fetch(`/api/product-suppliers/register?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Supplier terms could not be loaded.");

      const pageTerms = (result.result?.terms ?? []) as SupplierTermRow[];
      const pageSummary = (result.result?.summary ?? EMPTY_SUMMARY) as SupplierTermsSummary;
      setTerms((current) => append ? [...current, ...pageTerms] : pageTerms);
      setSummary(pageSummary);
      setHasMore(Boolean(result.result?.hasMore));
      nextCursorRef.current = result.result?.nextCursor ?? null;
      setPendingCount(readProductSupplierQueue(workspaceId).length);
      if (!append && !search) writeCache(workspaceId, { terms: pageTerms, summary: pageSummary });
    } catch (loadError) {
      const cached = readCache(workspaceId);
      if (!append && !search && cached.terms.length) {
        setTerms(cached.terms);
        setSummary(cached.summary);
        setNotice("Showing cached Supplier terms while cloud access is unavailable.");
      } else {
        setError(loadError instanceof Error ? loadError.message : "Supplier terms could not be loaded.");
      }
    } finally {
      setLoadingPage(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!loaded || mode !== "cloud" || !workspaceId || workspaceId === "demo" || !navigator.onLine) return;
    const timer = window.setTimeout(() => void loadPage({ search: query }), 250);
    return () => window.clearTimeout(timer);
  }, [loaded, loadPage, mode, query, workspaceId]);

  useEffect(() => {
    if (!workspaceId || workspaceId === "demo") return;
    const handleOnline = () => void loadPage({ search: query });
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [loadPage, query, workspaceId]);

  const visibleTerms = useMemo(() => {
    const online = typeof navigator !== "undefined" && navigator.onLine;
    if (mode === "cloud" && online) return terms;
    const needle = query.trim().toLowerCase();
    return terms.filter((term) => !needle || `${term.name} ${term.sku}`.toLowerCase().includes(needle));
  }, [mode, query, terms]);

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Supplier terms…</main>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Product purchasing terms"
        title="Supplier terms"
        description="Choose a Product to manage Supplier-specific SKU, cost, lead time, minimum order quantity and preferred status."
        action={(
          <Button
            variant="secondary"
            onClick={() => void loadPage({ search: query })}
            disabled={!workspaceId || workspaceId === "demo" || loadingPage}
          >
            <RefreshCw className={loadingPage ? "spin" : undefined} size={17} /> Refresh
          </Button>
        )}
      />

      <div className="review-callout">
        <Link2 size={19} />
        <div><strong>Connected catalogue workflow</strong><p>Relationships reference existing Product and Supplier records. They do not duplicate either record or change Inventory quantity.</p></div>
      </div>

      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Supplier terms need attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Cached Supplier terms</strong><p>{notice}</p></div> : null}
      {pendingCount ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>{pendingCount} relationship change{pendingCount === 1 ? "" : "s"} waiting to sync</strong><p>Open the affected Product to retry or discard its queued changes.</p></div> : null}
      {supportMode ? <div className={styles.supportNotice}><Link2 size={18} /><div><strong>Read-only access</strong><span>Supplier terms are visible but cannot be changed during this session.</span></div></div> : null}

      <div className="stat-grid">
        <StatCard label="Active products" value={String(summary.activeProducts)} detail="Catalogue records available for sourcing" icon={<Package size={19} />} />
        <StatCard label="Active relationships" value={String(summary.activeRelationships)} detail="Current Product-to-Supplier links" icon={<Link2 size={19} />} />
        <StatCard label="Preferred assigned" value={String(summary.preferredRelationships)} detail="Products with a preferred Supplier" icon={<Star size={19} />} />
        <StatCard label="Product suppliers" value={String(summary.productSuppliers)} detail="Active Suppliers available to link" icon={<Truck size={19} />} />
      </div>

      <Card className={styles.indexCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Product or SKU…" aria-label="Search Products" />
          </label>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleTerms.length}{hasMore ? "+" : ""} products</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.indexTable}>
            <thead><tr><th>Product</th><th>SKU</th><th>Active suppliers</th><th>Preferred supplier</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visibleTerms.map((term) => (
                <tr key={term.product_id}>
                  <td><div className={styles.productIdentity}><span><Package size={17} /></span><strong>{term.name}</strong></div></td>
                  <td><code>{term.sku}</code></td>
                  <td>{term.active_supplier_count}</td>
                  <td>{term.preferred_supplier_name ? <Badge tone="gold"><Star size={13} /> {term.preferred_supplier_name}</Badge> : <span className="muted">Not assigned</span>}</td>
                  <td><Button type="button" variant="quiet" onClick={() => router.push(`/products/${term.product_id}/suppliers`)}>Manage terms</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleTerms.length === 0 ? <div className={styles.emptyState}><Package size={23} /><h3>{query ? "No matching Products" : "No active Products"}</h3><p>{query ? "Change the search term." : "Create a Product before adding Supplier terms."}</p></div> : null}
        {hasMore && mode === "cloud" ? (
          <div className={styles.toolbar} style={{ justifyContent: "center", borderTop: "1px solid var(--border)", borderBottom: 0 }}>
            <Button type="button" variant="secondary" onClick={() => void loadPage({ append: true, search: query })} disabled={loadingPage}>
              {loadingPage ? <RefreshCw className="spin" size={17} /> : null} Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

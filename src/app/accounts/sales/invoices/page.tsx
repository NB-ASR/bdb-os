"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, FileText, Filter, Plus, RefreshCw, Search } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import styles from "../../accounts-workspace.module.css";

type InvoiceRow = {
  id: string;
  number: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  issued_at: string;
  due_at: string | null;
  description: string;
  currency: string;
  total_amount: number;
  credited_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  display_status: string;
  payment_status: string;
  sales_order_reference: string | null;
};

type PageResult = {
  workspaceId: string;
  rows: InvoiceRow[];
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type Filters = {
  q: string;
  status: string;
  paymentStatus: string;
  credit: string;
  dateFrom: string;
  dateTo: string;
};

const defaultFilters: Filters = { q: "", status: "all", paymentStatus: "all", credit: "any", dateFrom: "", dateTo: "" };
const CACHE_PREFIX = "bdb-accounts-invoice-register-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readCache(workspaceId: string): PageResult | null {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(workspaceId)) ?? "null") as PageResult | null;
    return value?.workspaceId === workspaceId ? value : null;
  } catch {
    return null;
  }
}

function writeCache(result: PageResult) {
  localStorage.setItem(cacheKey(result.workspaceId), JSON.stringify(result));
}

function isDefault(filters: Filters) {
  return Object.entries(filters).every(([key, value]) => value === defaultFilters[key as keyof Filters]);
}

function statusTone(status: string) {
  if (status === "paid" || status === "cancelled") return "good";
  if (status === "overdue" || status === "partially_paid") return "attention";
  return "neutral";
}

export default function InvoiceRegisterPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  const loadPage = useCallback(async (targetWorkspaceId: string, targetFilters: Filters, cursor: string | null, cacheAllowed: boolean) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ workspaceId: targetWorkspaceId, pageSize: "50" });
      if (targetFilters.q) params.set("q", targetFilters.q);
      if (targetFilters.status !== "all") params.set("status", targetFilters.status);
      if (targetFilters.paymentStatus !== "all") params.set("paymentStatus", targetFilters.paymentStatus);
      if (targetFilters.credit !== "any") params.set("credit", targetFilters.credit);
      if (targetFilters.dateFrom) params.set("dateFrom", targetFilters.dateFrom);
      if (targetFilters.dateTo) params.set("dateTo", targetFilters.dateTo);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/accounts/invoices?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Invoice register could not be loaded.");
      const page = result.result as PageResult;
      setRows(page.rows);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setCached(false);
      if (cacheAllowed && !cursor && isDefault(targetFilters)) writeCache(page);
    } catch (loadError) {
      if (cacheAllowed && !cursor && isDefault(targetFilters)) {
        const local = readCache(targetWorkspaceId);
        if (local) {
          setRows(local.rows);
          setHasMore(false);
          setNextCursor(null);
          setCached(true);
        }
      }
      setError(loadError instanceof Error ? loadError.message : "Invoice register could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      try {
        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
        const id = String(context.currentWorkspaceId);
        if (!active) return;
        setWorkspaceId(id);
        const local = readCache(id);
        if (local) {
          setRows(local.rows);
          setCached(true);
        }
        await loadPage(id, defaultFilters, null, true);
      } catch (initialError) {
        if (active) setError(initialError instanceof Error ? initialError.message : "Invoice register could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadPage]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId) return;
    setApplied(filters);
    setCursorStack([null]);
    setPageIndex(0);
    void loadPage(workspaceId, filters, null, true);
  }

  function clearFilters() {
    setFilters(defaultFilters);
    setApplied(defaultFilters);
    setCursorStack([null]);
    setPageIndex(0);
    if (workspaceId) void loadPage(workspaceId, defaultFilters, null, true);
  }

  function nextPage() {
    if (!workspaceId || !nextCursor) return;
    const nextIndex = pageIndex + 1;
    const nextStack = [...cursorStack.slice(0, nextIndex), nextCursor];
    setCursorStack(nextStack);
    setPageIndex(nextIndex);
    void loadPage(workspaceId, applied, nextCursor, false);
  }

  function previousPage() {
    if (!workspaceId || pageIndex <= 0) return;
    const previousIndex = pageIndex - 1;
    const cursor = cursorStack[previousIndex] ?? null;
    setPageIndex(previousIndex);
    void loadPage(workspaceId, applied, cursor, false);
  }

  const activeFilterCount = useMemo(() => Object.entries(applied).filter(([key, value]) => value !== defaultFilters[key as keyof Filters]).length, [applied]);

  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Accounts · Sales · Invoices</p>
          <h1>Invoice register</h1>
          <p>Built for volume: BDB OS loads 50 rows at a time, searches in Supabase, and only opens full financial detail when you choose one Invoice.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.secondaryLink} href="/accounts/sales"><ArrowLeft size={16} /> Sales</Link>
          <Link className={styles.primaryLink} href="/accounts/sales/invoices/new"><Plus size={16} /> New Invoice</Link>
        </div>
      </section>

      {cached ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Cached working set</strong><br />Showing the last verified first page. Deep history and filtered searches require a live connection.</div></div> : null}
      {error ? <div className={styles.notice}><AlertTriangle size={17} /><div><strong>Invoice register needs attention</strong><br />{error}</div></div> : null}

      <form className={styles.filterPanel} onSubmit={applyFilters}>
        <div className={styles.sectionHeader}>
          <div><h2>Find Invoices</h2><p>Search by Invoice number, customer name or Sales Order reference. Filters run in the database.</p></div>
          <span className={styles.helper}>{activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : "No filters"}</span>
        </div>
        <div className={styles.filters}>
          <label>Search<div className={styles.inlineActions}><Search size={15} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="INV001, ABC Ltd, SO123…" /></div></label>
          <label>Status<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">All</option><option value="sent">Sent</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option><option value="draft">Legacy draft</option></select></label>
          <label>Payment<select value={filters.paymentStatus} onChange={(event) => setFilters((current) => ({ ...current, paymentStatus: event.target.value }))}><option value="all">All</option><option value="unpaid">Unpaid</option><option value="partially_paid">Part paid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></label>
          <label>Credit Note<select value={filters.credit} onChange={(event) => setFilters((current) => ({ ...current, credit: event.target.value }))}><option value="any">Any</option><option value="with">Has credit</option><option value="without">No credit</option></select></label>
          <label>From<input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label>To<input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        </div>
        <div className={styles.filterActions}><button type="submit" disabled={!workspaceId || loading}><Filter size={14} /> Apply</button><button type="button" onClick={clearFilters} disabled={loading}>Clear</button></div>
      </form>

      <section className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>SO</th><th>Status</th><th className={styles.money}>Original</th><th className={styles.money}>Credits</th><th className={styles.money}>Paid</th><th className={styles.money}>Balance</th><th /></tr></thead>
            <tbody>
              {rows.map((invoice) => (
                <tr key={invoice.id}>
                  <td><strong>{invoice.number}</strong><span className={styles.subtle}>{invoice.description}</span></td>
                  <td>{formatDate(invoice.issued_at)}</td>
                  <td><strong>{invoice.customer_name_snapshot}</strong><span className={styles.subtle}>{invoice.customer_code_snapshot}</span></td>
                  <td>{invoice.sales_order_reference ?? "—"}</td>
                  <td><span className={styles.status} data-tone={statusTone(invoice.display_status)}>{invoice.display_status.replaceAll("_", " ")}</span></td>
                  <td className={styles.money}>{formatMoney(Number(invoice.total_amount), invoice.currency)}</td>
                  <td className={styles.money}>{Number(invoice.credited_amount) > 0 ? formatMoney(Number(invoice.credited_amount), invoice.currency) : "—"}</td>
                  <td className={styles.money}>{Number(invoice.allocated_amount) > 0 ? formatMoney(Number(invoice.allocated_amount), invoice.currency) : "—"}</td>
                  <td className={styles.money}><strong>{formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</strong></td>
                  <td><Link className={styles.quietLink} href={`/accounts/sales/invoices/${invoice.id}`}>Open <ArrowRight size={14} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className={styles.emptyState}><FileText size={24} /><strong>{loading ? "Loading Invoices…" : "No Invoices match these filters"}</strong><span>Change the filters or create a new Invoice.</span></div> : null}
        <div className={styles.pagination}>
          <span className={styles.helper}>Page {pageIndex + 1} · up to 50 rows · no full-history browser load</span>
          <div className={styles.tableActions}><button type="button" onClick={previousPage} disabled={loading || pageIndex === 0}><ArrowLeft size={14} /> Back</button><button type="button" onClick={nextPage} disabled={loading || !hasMore || !nextCursor}>Next <ArrowRight size={14} /></button></div>
        </div>
      </section>
    </main>
  );
}

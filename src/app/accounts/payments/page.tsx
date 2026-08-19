"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import styles from "../accounts-workspace.module.css";

type PaymentRow = {
  id: string;
  reference: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  received_at: string;
  status: string;
  allocated_amount: number;
  unallocated_amount: number;
};

type PageResult = {
  workspaceId: string;
  rows: PaymentRow[];
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
};

const CACHE_PREFIX = "bdb-accounts-payments-register-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

export default function AccountsPaymentsPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [q, setQ] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [status, setStatus] = useState("all");
  const [method, setMethod] = useState("all");
  const [allocation, setAllocation] = useState("any");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (targetCursor: string | null, allowCache = false) => {
    setLoading(true);
    setError("");
    try {
      let currentWorkspaceId = workspaceId;
      if (!currentWorkspaceId) {
        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
        currentWorkspaceId = String(context.currentWorkspaceId);
        setWorkspaceId(currentWorkspaceId);
      }

      if (allowCache) {
        try {
          const local = JSON.parse(localStorage.getItem(cacheKey(currentWorkspaceId)) ?? "null") as PageResult | null;
          if (local?.workspaceId === currentWorkspaceId) {
            setRows(local.rows ?? []);
            setNextCursor(local.nextCursor ?? null);
            setHasMore(Boolean(local.hasMore));
            setCached(true);
          }
        } catch { /* ignore stale local register */ }
      }

      const params = new URLSearchParams({ workspaceId: currentWorkspaceId, pageSize: "50", status, method, allocation });
      if (q) params.set("q", q);
      if (targetCursor) params.set("cursor", targetCursor);
      const response = await fetch(`/api/accounts/payments?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Payments could not be loaded.");
      const page = result.result as PageResult;
      setRows(page.rows ?? []);
      setNextCursor(page.nextCursor ?? null);
      setHasMore(Boolean(page.hasMore));
      setCached(false);
      if (!targetCursor && !q && status === "all" && method === "all" && allocation === "any") {
        localStorage.setItem(cacheKey(currentWorkspaceId), JSON.stringify(page));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Payments could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [allocation, method, q, status, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null, true), 0);
    return () => window.clearTimeout(timer);
  }, []); // initial workspace load only

  function applyFilters() {
    setQ(draftQ.trim());
    setCursor(null);
    setHistory([]);
    window.setTimeout(() => void load(null), 0);
  }

  function clearFilters() {
    setDraftQ(""); setQ(""); setStatus("all"); setMethod("all"); setAllocation("any"); setCursor(null); setHistory([]);
    window.setTimeout(() => void load(null), 0);
  }

  function nextPage() {
    if (!nextCursor) return;
    setHistory((current) => [...current, cursor]);
    setCursor(nextCursor);
    void load(nextCursor);
  }

  function previousPage() {
    const previous = history.at(-1) ?? null;
    setHistory((current) => current.slice(0, -1));
    setCursor(previous);
    void load(previous);
  }

  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Accounts · Payments</p>
          <h1>Payments</h1>
          <p>A bounded operational register. Recording a Payment remains separate from the permanent Invoice; Banking will later prove it through reconciliation.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.primaryLink} href="/accounts/operations"><Banknote size={16} /> Record Payment</Link>
        </div>
      </section>

      {cached ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Cached working page</strong><br />Showing the last verified first page while live data reconnects.</div></div> : null}
      {error ? <div className={styles.notice}><TriangleAlert size={17} /><div><strong>Payments needs attention</strong><br />{error}</div></div> : null}

      <section className={styles.filterPanel}>
        <div className={styles.filters}>
          <label>Search<input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="Reference, customer, bank reference…" /></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="posted">Posted</option><option value="reversed">Reversed</option></select></label>
          <label>Method<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="all">All</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
          <label>Allocation<select value={allocation} onChange={(event) => setAllocation(event.target.value)}><option value="any">Any</option><option value="unallocated">Needs allocation</option><option value="allocated">Fully allocated</option></select></label>
        </div>
        <div className={styles.filterActions}><button onClick={applyFilters}><Search size={14} /> Apply</button><button onClick={clearFilters}>Clear</button></div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={styles.table}><thead><tr><th>Payment</th><th>Customer</th><th>Received</th><th>Method</th><th>Status</th><th className={styles.money}>Amount</th><th className={styles.money}>Allocated</th><th className={styles.money}>Unallocated</th></tr></thead>
          <tbody>{rows.map((payment) => <tr key={payment.id}><td><strong>{payment.reference}</strong>{payment.external_reference ? <span className={styles.subtle}>{payment.external_reference}</span> : null}</td><td><strong>{payment.customer_name_snapshot}</strong><span className={styles.subtle}>{payment.customer_code_snapshot}</span></td><td>{formatDate(payment.received_at)}</td><td>{payment.payment_method.replaceAll("_", " ")}</td><td><span className={styles.status} data-tone={payment.status === "posted" ? "good" : undefined}>{payment.status}</span></td><td className={styles.money}>{formatMoney(Number(payment.amount), payment.currency)}</td><td className={styles.money}>{formatMoney(Number(payment.allocated_amount), payment.currency)}</td><td className={styles.money}>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</td></tr>)}</tbody></table>
        </div>
        {!rows.length ? <div className={styles.emptyState}>{loading ? "Loading Payments…" : "No Payments match these filters."}</div> : null}
        <div className={styles.pagination}><span className={styles.helper}>{loading ? "Refreshing…" : `${rows.length} rows on this page`}</span><div className={styles.inlineActions}><button disabled={!history.length || loading} onClick={previousPage}><ArrowLeft size={14} /> Back</button><button disabled={!hasMore || !nextCursor || loading} onClick={nextPage}>Next <ArrowRight size={14} /></button></div></div>
      </section>
    </main>
  );
}

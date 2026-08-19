"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Search, TriangleAlert, Users } from "lucide-react";
import { formatMoney } from "@/lib/format";
import styles from "../accounts-workspace.module.css";

type CustomerBalance = {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  company: string | null;
  outstanding_amount: number;
  unallocated_credit: number;
  net_balance: number;
  balance_status: "amount_due" | "customer_credit" | "clear";
};

type PageResult = {
  workspaceId: string;
  rows: CustomerBalance[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export default function AccountsCustomersPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<CustomerBalance[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [status, setStatus] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const requestPage = useCallback(async (targetPage: number, search = q, balanceStatus = status) => {
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
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId, page: String(targetPage), pageSize: "50", status: balanceStatus });
      if (search) params.set("q", search);
      const response = await fetch(`/api/accounts/customers?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Customer balances could not be loaded.");
      const next = result.result as PageResult;
      setRows(next.rows ?? []);
      setPage(next.page);
      setHasMore(Boolean(next.hasMore));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Customer balances could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [q, status, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void requestPage(1, "", "all"), 0);
    return () => window.clearTimeout(timer);
  }, []); // initial workspace load only

  function applyFilters() {
    const nextSearch = draftQ.trim();
    setQ(nextSearch);
    setPage(1);
    void requestPage(1, nextSearch, status);
  }

  function clearFilters() {
    setDraftQ(""); setQ(""); setStatus("all"); setPage(1);
    void requestPage(1, "", "all");
  }

  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Accounts · Customers</p>
          <h1>Customer balances</h1>
          <p>Financial balances stay connected to the customer record without loading every Invoice or Payment into this screen.</p>
        </div>
        <div className={styles.heroActions}><Link className={styles.secondaryLink} href="/customers"><Users size={16} /> Customer profiles</Link></div>
      </section>

      {error ? <div className={styles.notice}><TriangleAlert size={17} /><div><strong>Customer balances needs attention</strong><br />{error}</div></div> : null}

      <section className={styles.filterPanel}>
        <div className={styles.filters}>
          <label>Search<input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="Customer, code or company…" /></label>
          <label>Balance<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="amount_due">Amount due</option><option value="customer_credit">Customer credit</option><option value="clear">Clear</option></select></label>
        </div>
        <div className={styles.filterActions}><button onClick={applyFilters}><Search size={14} /> Apply</button><button onClick={clearFilters}>Clear</button></div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Customer</th><th>Code</th><th>Status</th><th className={styles.money}>Outstanding</th><th className={styles.money}>Credit</th><th className={styles.money}>Net balance</th><th>Profile</th></tr></thead>
        <tbody>{rows.map((balance) => <tr key={balance.customer_id}><td><strong>{balance.customer_name}</strong>{balance.company ? <span className={styles.subtle}>{balance.company}</span> : null}</td><td>{balance.customer_code}</td><td><span className={styles.status} data-tone={balance.balance_status === "amount_due" ? "attention" : balance.balance_status === "customer_credit" ? "good" : undefined}>{balance.balance_status.replaceAll("_", " ")}</span></td><td className={styles.money}>{formatMoney(Number(balance.outstanding_amount), "EUR")}</td><td className={styles.money}>{formatMoney(Number(balance.unallocated_credit), "EUR")}</td><td className={styles.money}><strong>{formatMoney(Number(balance.net_balance), "EUR")}</strong></td><td><Link className={styles.quietLink} href={`/customers/${balance.customer_id}`}>Open</Link></td></tr>)}</tbody></table></div>
        {!rows.length ? <div className={styles.emptyState}>{loading ? "Loading customer balances…" : "No customers match these filters."}</div> : null}
        <div className={styles.pagination}><span className={styles.helper}>{loading ? <><RefreshCw size={13} /> Refreshing…</> : `Page ${page} · ${rows.length} rows`}</span><div className={styles.inlineActions}><button disabled={page <= 1 || loading} onClick={() => void requestPage(page - 1)}><ArrowLeft size={14} /> Back</button><button disabled={!hasMore || loading} onClick={() => void requestPage(page + 1)}>Next <ArrowRight size={14} /></button></div></div>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, FileMinus2, Search, TriangleAlert } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import styles from "../../accounts-workspace.module.css";

type Row = {
  id: string;
  number: string;
  invoice_id: string;
  customer_id: string;
  customer_name_snapshot: string;
  currency: string;
  reason: string;
  status: string;
  issued_at: string | null;
  total_amount: number;
  created_at: string;
  sales_order_reference: string | null;
};
type PageResult = { workspaceId: string; rows: Row[]; hasMore: boolean; nextCursor: string | null };

export default function CreditNotesRegisterPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (targetCursor: string | null, search = q, targetStatus = status) => {
    setLoading(true); setError("");
    try {
      let currentWorkspaceId = workspaceId;
      if (!currentWorkspaceId) {
        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
        currentWorkspaceId = String(context.currentWorkspaceId); setWorkspaceId(currentWorkspaceId);
      }
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId, pageSize: "50", status: targetStatus });
      if (search) params.set("q", search);
      if (targetCursor) params.set("cursor", targetCursor);
      const response = await fetch(`/api/accounts/credit-notes?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Credit Notes could not be loaded.");
      const page = result.result as PageResult;
      setRows(page.rows ?? []); setHasMore(Boolean(page.hasMore)); setNextCursor(page.nextCursor ?? null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Credit Notes could not be loaded."); }
    finally { setLoading(false); }
  }, [q, status, workspaceId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(null, "", "all"), 0); return () => window.clearTimeout(timer); }, []);

  function applyFilters() { const search = draftQ.trim(); setQ(search); setCursor(null); setHistory([]); void load(null, search, status); }
  function clearFilters() { setDraftQ(""); setQ(""); setStatus("all"); setCursor(null); setHistory([]); void load(null, "", "all"); }
  function nextPage() { if (!nextCursor) return; setHistory((current) => [...current, cursor]); setCursor(nextCursor); void load(nextCursor); }
  function previousPage() { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); void load(previous); }

  return <main className={styles.workspace}>
    <section className={styles.hero}><div className={styles.heroCopy}><p className={styles.eyebrow}>Accounts · Sales</p><h1>Credit Notes</h1><p>Quantity-backed reversals remain tied to their original Invoice while the register scales independently of the full Accounts history.</p></div><div className={styles.heroActions}><Link className={styles.primaryLink} href="/accounts/operations"><FileMinus2 size={16} /> New Credit Note</Link></div></section>
    {error ? <div className={styles.notice}><TriangleAlert size={17} /><div><strong>Credit Notes needs attention</strong><br />{error}</div></div> : null}
    <section className={styles.filterPanel}><div className={styles.filters}><label>Search<input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="CN, customer, reason, SO…" /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="issued">Issued</option><option value="draft">Legacy drafts</option></select></label></div><div className={styles.filterActions}><button onClick={applyFilters}><Search size={14} /> Apply</button><button onClick={clearFilters}>Clear</button></div></section>
    <section className={styles.tableCard}><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Credit Note</th><th>Customer</th><th>Date</th><th>Status</th><th>Reason</th><th>SO</th><th className={styles.money}>Total</th><th>Invoice</th></tr></thead><tbody>{rows.map((note) => <tr key={note.id}><td><strong>{note.number}</strong></td><td>{note.customer_name_snapshot}</td><td>{formatDate(note.issued_at ?? note.created_at)}</td><td><span className={styles.status} data-tone={note.status === "issued" ? "good" : undefined}>{note.status}</span></td><td>{note.reason}</td><td>{note.sales_order_reference ?? "—"}</td><td className={styles.money}>{formatMoney(Number(note.total_amount), note.currency)}</td><td><Link className={styles.quietLink} href={`/accounts/sales/invoices/${note.invoice_id}`}>Open Invoice</Link></td></tr>)}</tbody></table></div>{!rows.length ? <div className={styles.emptyState}>{loading ? "Loading Credit Notes…" : "No Credit Notes match these filters."}</div> : null}<div className={styles.pagination}><span className={styles.helper}>{loading ? "Refreshing…" : `${rows.length} rows on this page`}</span><div className={styles.inlineActions}><button disabled={!history.length || loading} onClick={previousPage}><ArrowLeft size={14} /> Back</button><button disabled={!hasMore || !nextCursor || loading} onClick={nextPage}>Next <ArrowRight size={14} /></button></div></div></section>
  </main>;
}

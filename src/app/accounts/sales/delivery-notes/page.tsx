"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, PackageCheck, Search, TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import styles from "../../accounts-workspace.module.css";

type Row = {
  id: string;
  number: string;
  source_invoice_id: string | null;
  source_sale_id: string | null;
  customer_id: string;
  customer_name_snapshot: string;
  delivery_address: string | null;
  delivery_date: string;
  status: string;
  created_at: string;
};
type PageResult = { workspaceId: string; rows: Row[]; hasMore: boolean; nextCursor: string | null };

export default function DeliveryNotesRegisterPage() {
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
      const response = await fetch(`/api/accounts/delivery-notes?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Delivery Notes could not be loaded.");
      const page = result.result as PageResult;
      setRows(page.rows ?? []); setHasMore(Boolean(page.hasMore)); setNextCursor(page.nextCursor ?? null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Delivery Notes could not be loaded."); }
    finally { setLoading(false); }
  }, [q, status, workspaceId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(null, "", "all"), 0); return () => window.clearTimeout(timer); }, []);
  function applyFilters() { const search = draftQ.trim(); setQ(search); setCursor(null); setHistory([]); void load(null, search, status); }
  function clearFilters() { setDraftQ(""); setQ(""); setStatus("all"); setCursor(null); setHistory([]); void load(null, "", "all"); }
  function nextPage() { if (!nextCursor) return; setHistory((current) => [...current, cursor]); setCursor(nextCursor); void load(nextCursor); }
  function previousPage() { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); void load(previous); }

  return <main className={styles.workspace}>
    <section className={styles.hero}><div className={styles.heroCopy}><p className={styles.eyebrow}>Accounts · Sales</p><h1>Delivery Notes</h1><p>Fulfilment history stays separate from customer balances and is fetched in bounded pages even for high-volume businesses.</p></div><div className={styles.heroActions}><Link className={styles.primaryLink} href="/accounts/operations"><PackageCheck size={16} /> New Delivery Note</Link></div></section>
    {error ? <div className={styles.notice}><TriangleAlert size={17} /><div><strong>Delivery Notes needs attention</strong><br />{error}</div></div> : null}
    <section className={styles.filterPanel}><div className={styles.filters}><label>Search<input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="DN, customer, address…" /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="issued">Issued</option><option value="draft">Legacy drafts</option></select></label></div><div className={styles.filterActions}><button onClick={applyFilters}><Search size={14} /> Apply</button><button onClick={clearFilters}>Clear</button></div></section>
    <section className={styles.tableCard}><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Delivery Note</th><th>Customer</th><th>Delivery date</th><th>Status</th><th>Address</th><th>Source</th></tr></thead><tbody>{rows.map((note) => <tr key={note.id}><td><strong>{note.number}</strong></td><td>{note.customer_name_snapshot}</td><td>{formatDate(note.delivery_date)}</td><td><span className={styles.status} data-tone={note.status === "issued" ? "good" : undefined}>{note.status}</span></td><td>{note.delivery_address ?? "—"}</td><td>{note.source_invoice_id ? <Link className={styles.quietLink} href={`/accounts/sales/invoices/${note.source_invoice_id}`}>Invoice</Link> : note.source_sale_id ? "Sale" : "Standalone"}</td></tr>)}</tbody></table></div>{!rows.length ? <div className={styles.emptyState}>{loading ? "Loading Delivery Notes…" : "No Delivery Notes match these filters."}</div> : null}<div className={styles.pagination}><span className={styles.helper}>{loading ? "Refreshing…" : `${rows.length} rows on this page`}</span><div className={styles.inlineActions}><button disabled={!history.length || loading} onClick={previousPage}><ArrowLeft size={14} /> Back</button><button disabled={!hasMore || !nextCursor || loading} onClick={nextPage}>Next <ArrowRight size={14} /></button></div></div></section>
  </main>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Banknote, FileText, RefreshCw, Scale, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { readAccountsQueue } from "@/lib/modules/accounts-queue";
import styles from "./accounts-workspace.module.css";

type Summary = {
  workspace_id: string;
  currency: string;
  invoice_count: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  credited_invoice_count: number;
  outstanding_amount: number;
  customer_credit_amount: number;
  unallocated_payment_count: number;
  unallocated_payment_amount: number;
};

type RecentDocument = {
  document_type: "invoice" | "credit_note" | "delivery_note";
  id: string;
  number: string;
  customer_name: string;
  document_date: string;
  status: string;
  currency: string | null;
  total_amount: number | null;
  balance_amount: number | null;
};

type OverviewBundle = { workspaceId: string; summary: Summary; recentDocuments: RecentDocument[] };
const CACHE_PREFIX = "bdb-accounts-overview-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readCache(workspaceId: string): OverviewBundle | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(workspaceId)) ?? "null") as OverviewBundle | null;
    return parsed?.workspaceId === workspaceId ? parsed : null;
  } catch { return null; }
}
function writeCache(bundle: OverviewBundle) { localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle)); }
function documentHref(workspaceId: string, document: RecentDocument) {
  if (document.document_type === "invoice") return `/accounts/sales/invoices/${document.id}`;
  const params = new URLSearchParams({ workspaceId, type: document.document_type, id: document.id, format: "html" });
  return `/api/business-documents/render?${params.toString()}`;
}

export default function AccountsOverviewPage() {
  const [bundle, setBundle] = useState<OverviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
      const workspaceId = String(context.currentWorkspaceId);
      const local = readCache(workspaceId);
      if (local) { setBundle(local); setCached(true); }
      setPendingSync(readAccountsQueue(workspaceId).length);
      const response = await fetch(`/api/accounts/overview?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Accounts overview could not be loaded.");
      const next = result.result as OverviewBundle;
      setBundle(next); setCached(false); writeCache(next);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Accounts overview could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const summary = bundle?.summary;
  const currency = summary?.currency ?? "EUR";

  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>Accounts workspace</p><h1>Financial control without the clutter</h1><p>Owners see what needs attention here. High-volume finance work lives in dedicated registers underneath, so BDB OS never needs to load the whole accounting history into one page.</p></div>
        <div className={styles.heroActions}><Link className={styles.primaryLink} href="/accounts/sales/invoices/new"><FileText size={16} /> New Invoice</Link><Link className={styles.secondaryLink} href="/accounts/sales/invoices">Open Invoices <ArrowRight size={16} /></Link></div>
      </section>

      {cached ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Offline-ready snapshot</strong><br />Showing the last verified Accounts overview while live data reconnects.</div></div> : null}
      {pendingSync ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>{pendingSync} Accounts change{pendingSync === 1 ? "" : "s"} Pending sync</strong><br />Queued financial commands remain separate from this read-only overview.</div></div> : null}
      {error ? <div className={styles.notice}><AlertTriangle size={17} /><div><strong>Accounts needs attention</strong><br />{error}</div></div> : null}

      <section className={styles.statGrid} aria-label="Accounts attention summary">
        <article className={styles.statCard}><span>Outstanding</span><strong>{formatMoney(Number(summary?.outstanding_amount ?? 0), currency)}</strong><small>{Number(summary?.open_invoice_count ?? 0).toLocaleString()} open Invoice{Number(summary?.open_invoice_count ?? 0) === 1 ? "" : "s"}</small></article>
        <article className={styles.statCard}><span>Overdue Invoices</span><strong>{Number(summary?.overdue_invoice_count ?? 0).toLocaleString()}</strong><small>Needs collection attention</small></article>
        <article className={styles.statCard}><span>Customer credit</span><strong>{formatMoney(Number(summary?.customer_credit_amount ?? 0), currency)}</strong><small>Unallocated credit held on customer accounts</small></article>
        <article className={styles.statCard}><span>Unallocated Payments</span><strong>{formatMoney(Number(summary?.unallocated_payment_amount ?? 0), currency)}</strong><small>{Number(summary?.unallocated_payment_count ?? 0).toLocaleString()} Payment{Number(summary?.unallocated_payment_count ?? 0) === 1 ? "" : "s"} to review</small></article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>Work areas</h2><p>Simple entry points for owners; dedicated operational surfaces for finance teams.</p></div></div>
        <div className={styles.salesGrid}>
          <article className={styles.card}><span className={styles.cardIcon}><FileText size={19} /></span><h3>Sales documents</h3><p>Invoices, Credit Notes and Delivery Notes with bounded registers and permanent issued-document history.</p><div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/sales">Open Sales <ArrowRight size={15} /></Link></div></article>
          <article className={styles.card}><span className={styles.cardIcon}><Banknote size={19} /></span><h3>Payments</h3><p>Money received stays separate from the permanent Invoice and can later be proven in Banking through reconciliation.</p><div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/payments">Open Payments <ArrowRight size={15} /></Link></div></article>
          <article className={styles.card}><span className={styles.cardIcon}><Users size={19} /></span><h3>Customer balances</h3><p>See what each customer owes or holds as credit without loading their full document history.</p><div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/customers">Open balances <ArrowRight size={15} /></Link></div></article>
          <article className={styles.card}><span className={styles.cardIcon}><Scale size={19} /></span><h3>Supplier Payables</h3><p>Supplier-side financial obligations remain their own operational area inside Accounts.</p><div className={styles.cardFooter}><Link className={styles.quietLink} href="/accounts/payables">Open Payables <ArrowRight size={15} /></Link></div></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>Recent documents</h2><p>A small working set only. Full history stays database-side until searched.</p></div><Link className={styles.secondaryLink} href="/accounts/sales/invoices">Invoice register</Link></div>
        {bundle?.recentDocuments.length ? <div className={styles.recentList}>{bundle.recentDocuments.map((document) => <Link key={`${document.document_type}:${document.id}`} className={styles.recentRow} href={documentHref(bundle.workspaceId, document)}><span><strong>{document.number}</strong><small>{document.document_type.replaceAll("_", " ")}</small></span><span><strong>{document.customer_name}</strong></span><span>{formatDate(document.document_date)}</span><span className={styles.status}>{document.status.replaceAll("_", " ")}</span><span className={styles.money}>{document.total_amount == null ? "—" : formatMoney(Number(document.total_amount), document.currency ?? currency)}</span></Link>)}</div> : <div className={styles.emptyState}>{loading ? "Loading Accounts…" : "No business documents yet."}</div>}
      </section>
    </main>
  );
}

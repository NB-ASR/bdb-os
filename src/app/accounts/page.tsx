"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Banknote, FileText, RefreshCw, Scale, Trash2, Users } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import {
  flushAccountsQueue,
  readAccountsQueue,
  removeAccountsCommand,
  type AccountsQueuedCommand,
} from "@/lib/modules/accounts-queue";
import {
  cacheAccountsWorkspaceContext,
  readAccountsWorkspaceContext,
} from "@/lib/modules/accounts-working-cache";
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
function actionLabel(action: string) {
  return action.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AccountsOverviewPage() {
  const [bundle, setBundle] = useState<OverviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<AccountsQueuedCommand[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let workspaceId = "";
      if (navigator.onLine) {
        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
        cacheAccountsWorkspaceContext(context);
        workspaceId = String(context.currentWorkspaceId);
      } else {
        workspaceId = readAccountsWorkspaceContext()?.currentWorkspaceId ?? "";
        if (!workspaceId) throw new Error("The current Accounts workspace has not been cached on this device yet.");
      }

      const local = readCache(workspaceId);
      if (local) { setBundle(local); setCached(true); }
      setPendingCommands(readAccountsQueue(workspaceId));
      if (!navigator.onLine) return;

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

  async function retryPending() {
    if (!bundle?.workspaceId || !navigator.onLine) return;
    setSyncing(true); setError("");
    const result = await flushAccountsQueue(bundle.workspaceId);
    setPendingCommands(readAccountsQueue(bundle.workspaceId));
    setSyncing(false);
    if (result.remaining) {
      setError(readAccountsQueue(bundle.workspaceId)[0]?.lastError ?? "Accounts synchronisation stopped for review.");
      return;
    }
    await load();
  }

  function discardPending(command: AccountsQueuedCommand) {
    if (!bundle?.workspaceId) return;
    if (!window.confirm("Discard this unsynchronised Accounts change? This removes the local queued command and cannot be undone.")) return;
    removeAccountsCommand(bundle.workspaceId, command.id);
    setPendingCommands(readAccountsQueue(bundle.workspaceId));
  }

  return (
    <main className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>Accounts workspace</p><h1>Financial control without the clutter</h1><p>Owners see what needs attention here. High-volume finance work lives in dedicated registers underneath, so BDB OS never needs to load the whole accounting history into one page.</p></div>
        <div className={styles.heroActions}><Link className={styles.primaryLink} href="/accounts/sales/invoices/new"><FileText size={16} /> New Invoice</Link><Link className={styles.secondaryLink} href="/accounts/sales/invoices">Open Invoices <ArrowRight size={16} /></Link></div>
      </section>

      {cached ? <div className={styles.notice}><RefreshCw size={17} /><div><strong>Offline-ready snapshot</strong><br />Showing the last verified Accounts overview while live data reconnects.</div></div> : null}
      {pendingCommands.length ? <section className={styles.detailCard}><h3><RefreshCw size={16} /> Pending sync · {pendingCommands.length}</h3><p className={styles.muted}>Queued financial changes are preserved locally and applied in order. A failed command stops the queue for review rather than silently changing accounting data.</p><div className={styles.linkList}>{pendingCommands.slice(0, 5).map((command, index) => <div className={styles.linkRow} key={command.id}><span><strong>{actionLabel(command.action)}</strong><span className={styles.subtle}>{command.lastError || `Queued ${formatDate(command.createdAt)}`}</span></span>{index === 0 ? <button className={styles.secondaryLink} type="button" onClick={() => discardPending(command)}><Trash2 size={14} /> Discard blocked change</button> : <span className={styles.muted}>Waiting</span>}</div>)}</div><div className={styles.inlineActions}><button className={styles.secondaryLink} type="button" disabled={syncing} onClick={() => void retryPending()}><RefreshCw size={14} /> {syncing ? "Synchronising…" : "Retry queue"}</button></div></section> : null}
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

"use client";

import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { formatTimeAgo } from "@/lib/format";
import {
  readBusinessInsightCache,
  readLastBusinessInsightWorkspace,
  writeBusinessInsightCache,
} from "@/lib/modules/business-insight-cache";
import styles from "./reports.module.css";

type CurrencyMetric = {
  currency: string;
  completed_sale_count: number;
  completed_sale_amount: number;
  issued_invoice_count: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  issued_invoice_amount: number;
  outstanding_invoice_amount: number;
  overdue_invoice_amount: number;
  posted_payment_count: number;
  received_payment_amount: number;
  unallocated_payment_amount: number;
  bank_transaction_count: number;
  unreconciled_transaction_count: number;
  unreconciled_transaction_amount: number;
  open_supplier_payable_count: number;
  outstanding_supplier_payable_amount: number;
};

type MonthlyMetric = {
  month_start: string;
  currency: string;
  completed_sale_count: number;
  completed_sale_amount: number;
};

type CustomerMetric = {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  currency: string;
  completed_sale_count: number;
  completed_sale_amount: number;
  last_sale_at: string;
};

type ReportBundle = {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  supportReadOnly: boolean;
  dataBoundary: string;
  currencies: CurrencyMetric[];
  monthly: MonthlyMetric[];
  customers: CustomerMetric[];
  operational: Record<string, number | string>;
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

export default function ReportsPage() {
  const [bundle, setBundle] = useState<ReportBundle | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const install = useCallback((result: ReportBundle, cached = false, savedAt: string | null = null) => {
    setBundle(result);
    setCachedAt(savedAt);
    setSelectedCurrency((current) => result.currencies.some((item) => item.currency === current)
      ? current
      : result.currencies[0]?.currency ?? "");
    if (!cached) setNotice("");
  }, []);

  const load = useCallback(async () => {
    setError("");
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current business could not be resolved.");
    const workspaceId = String(context.currentWorkspaceId);
    const response = await fetch(`/api/reports?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Reports could not be loaded.");
    const result = payload.result as ReportBundle;
    install(result);
    writeBusinessInsightCache("reports", workspaceId, result);
  }, [install]);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const lastWorkspace = readLastBusinessInsightWorkspace();
      const cached = lastWorkspace ? readBusinessInsightCache<ReportBundle>("reports", lastWorkspace) : null;
      if (cached && active) install(cached.payload, true, cached.cachedAt);
      try {
        if (!window.navigator.onLine) {
          if (cached) setNotice("Showing the last trusted Reporting snapshot while offline.");
          else setError("Reports need one successful online load before they can reopen offline.");
          return;
        }
        await load();
      } catch (loadError) {
        if (!cached && active) setError(loadError instanceof Error ? loadError.message : "Reports could not be loaded.");
        else if (active) setNotice("Showing cached Reports because live records are unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [install, load]);

  async function refresh() {
    if (!online) {
      setNotice("Reconnect to refresh authoritative reports.");
      return;
    }
    setLoading(true);
    try {
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Reports could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }

  const selected = bundle?.currencies.find((item) => item.currency === selectedCurrency) ?? null;
  const monthly = useMemo(() => (
    (bundle?.monthly ?? []).filter((item) => item.currency === selectedCurrency).slice(-12)
  ), [bundle?.monthly, selectedCurrency]);
  const customers = useMemo(() => (
    (bundle?.customers ?? []).filter((item) => item.currency === selectedCurrency).slice(0, 8)
  ), [bundle?.customers, selectedCurrency]);
  const monthlyMax = Math.max(...monthly.map((item) => item.completed_sale_amount), 1);

  return (
    <main className={styles.shell}>
      <PageHeader
        eyebrow="Business intelligence"
        title="Reports"
        description="Authoritative operational and financial signals from BDB OS records. Each currency remains separate."
      />

      <div className={styles.toolbar}>
        <div className={styles.status}>
          {online && !cachedAt ? <Wifi size={15} /> : <WifiOff size={15} />}
          <span>{cachedAt ? `Cached ${formatTimeAgo(cachedAt)}` : bundle?.generatedAt ? `Updated ${formatTimeAgo(bundle.generatedAt)}` : "Loading records"}</span>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading || !online}>
          <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
        </Button>
      </div>

      {notice ? <div className={styles.boundary}>{notice}</div> : null}
      {error ? <div className={`${styles.boundary} ${styles.error}`}>{error}</div> : null}

      <div className={styles.currencyTabs} aria-label="Report currency">
        {(bundle?.currencies ?? []).map((item) => (
          <button
            key={item.currency}
            type="button"
            className={`${styles.currencyTab} ${selectedCurrency === item.currency ? styles.currencyTabActive : ""}`}
            onClick={() => setSelectedCurrency(item.currency)}
          >
            {item.currency}
          </button>
        ))}
      </div>

      {selected ? (
        <>
          <section className={styles.metricGrid}>
            <article className={styles.metric}><span>Completed sales</span><strong>{money(selected.completed_sale_amount, selected.currency)}</strong><small>{selected.completed_sale_count} completed sale{selected.completed_sale_count === 1 ? "" : "s"}</small></article>
            <article className={styles.metric}><span>Payments received</span><strong>{money(selected.received_payment_amount, selected.currency)}</strong><small>{selected.posted_payment_count} posted payment{selected.posted_payment_count === 1 ? "" : "s"}</small></article>
            <article className={styles.metric}><span>Customer outstanding</span><strong>{money(selected.outstanding_invoice_amount, selected.currency)}</strong><small>{selected.open_invoice_count} open · {selected.overdue_invoice_count} overdue</small></article>
            <article className={styles.metric}><span>Supplier outstanding</span><strong>{money(selected.outstanding_supplier_payable_amount, selected.currency)}</strong><small>{selected.open_supplier_payable_count} open supplier payable{selected.open_supplier_payable_count === 1 ? "" : "s"}</small></article>
          </section>

          <section className={styles.grid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><div><h2>Completed sales trend</h2><p>Latest twelve recorded months · {selected.currency}</p></div></div>
              {monthly.length ? (
                <div className={styles.chart}>
                  {monthly.map((item) => (
                    <div className={styles.barGroup} key={`${item.month_start}-${item.currency}`} title={money(item.completed_sale_amount, item.currency)}>
                      <div className={styles.bar} style={{ height: `${Math.max(4, item.completed_sale_amount / monthlyMax * 100)}%` }} />
                      <small>{monthLabel(item.month_start)}</small>
                    </div>
                  ))}
                </div>
              ) : <div className={styles.empty}>No completed Sales history exists for this currency.</div>}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}><div><h2>Largest Customers</h2><p>Completed Sales only · {selected.currency}</p></div></div>
              <div className={styles.list}>
                {customers.map((customer) => (
                  <div className={styles.row} key={`${customer.customer_id}-${customer.currency}`}>
                    <div><strong>{customer.customer_name}</strong><span>{customer.customer_code} · {customer.completed_sale_count} sale{customer.completed_sale_count === 1 ? "" : "s"}</span></div>
                    <b>{money(customer.completed_sale_amount, customer.currency)}</b>
                  </div>
                ))}
                {customers.length === 0 ? <div className={styles.empty}>No Customer Sales are available for this currency.</div> : null}
              </div>
            </article>
          </section>

          <section className={styles.grid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><div><h2>Accounts and Banking</h2><p>Current record position · {selected.currency}</p></div></div>
              <div className={styles.list}>
                <div className={styles.row}><div><strong>Invoices issued</strong><span>{selected.issued_invoice_count} issued records</span></div><b>{money(selected.issued_invoice_amount, selected.currency)}</b></div>
                <div className={styles.row}><div><strong>Overdue invoices</strong><span>{selected.overdue_invoice_count} overdue records</span></div><b>{money(selected.overdue_invoice_amount, selected.currency)}</b></div>
                <div className={styles.row}><div><strong>Unallocated Customer Payments</strong><span>Funds not yet assigned to invoices</span></div><b>{money(selected.unallocated_payment_amount, selected.currency)}</b></div>
                <div className={styles.row}><div><strong>Unreconciled bank movement</strong><span>{selected.unreconciled_transaction_count} bank transaction{selected.unreconciled_transaction_count === 1 ? "" : "s"}</span></div><b>{money(selected.unreconciled_transaction_amount, selected.currency)}</b></div>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}><div><h2>Operational position</h2><p>Counts are safe to show without combining currencies.</p></div></div>
              <div className={styles.list}>
                <div className={styles.row}><div><strong>Active Customers</strong><span>Current Customer directory</span></div><b>{Number(bundle?.operational.customer_count ?? 0)}</b></div>
                <div className={styles.row}><div><strong>Upcoming Appointments</strong><span>Pending or confirmed</span></div><b>{Number(bundle?.operational.upcoming_appointment_count ?? 0)}</b></div>
                <div className={styles.row}><div><strong>Unread Communications</strong><span>Across open and closed threads</span></div><b>{Number(bundle?.operational.unread_message_count ?? 0)}</b></div>
                <div className={styles.row}><div><strong>Low-stock Products</strong><span>At or below reorder level</span></div><b>{Number(bundle?.operational.low_stock_product_count ?? 0)}</b></div>
              </div>
            </article>
          </section>
        </>
      ) : (
        <div className={styles.empty}>No currency-based financial records are available for this access profile.</div>
      )}

      <div className={styles.boundary}>{bundle?.dataBoundary ?? "Reports use authoritative BDB OS records only."}</div>
    </main>
  );
}

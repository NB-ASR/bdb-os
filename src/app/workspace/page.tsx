"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  FileText,
  Landmark,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShoppingBag,
  UsersRound,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";
import { formatTimeAgo } from "@/lib/format";
import {
  readBusinessInsightCache,
  readLastBusinessInsightWorkspace,
  writeBusinessInsightCache,
} from "@/lib/modules/business-insight-cache";
import styles from "./business-hub.module.css";

type AmountDetail = { currency: string; amount: number; count: number };

type DepartmentSignal = {
  key: string;
  name: string;
  href: string;
  value: number;
  label: string;
  detail: string | AmountDetail[];
  attention: number;
};

type AttentionItem = {
  source_id: string;
  department: string;
  title: string;
  detail: string;
  route: string;
  tone: string;
  occurred_at: string;
};

type ActivityItem = {
  source_id: string;
  department: string;
  title: string;
  detail: string;
  route: string;
  occurred_at: string;
  customer_name: string | null;
};

type CurrencyMetric = {
  currency: string;
  completed_sale_amount: number;
  outstanding_invoice_amount: number;
  received_payment_amount: number;
  overdue_invoice_amount: number;
  unreconciled_transaction_amount: number;
  outstanding_supplier_payable_amount: number;
};

type HubBundle = {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  cached: boolean;
  supportReadOnly: boolean;
  operational: Record<string, number | string>;
  departments: DepartmentSignal[];
  currencies: CurrencyMetric[];
  attention: AttentionItem[];
  activity: ActivityItem[];
  quickActions: Array<{ key: string; label: string; href: string }>;
};

const icons: Record<string, LucideIcon> = {
  customers: UsersRound,
  calendar: CalendarDays,
  sales: ShoppingBag,
  accounts: CircleDollarSign,
  communications: MessageSquareText,
  documents: FileText,
  banking: Landmark,
  inventory: Boxes,
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function signalDetail(detail: DepartmentSignal["detail"]) {
  if (typeof detail === "string") return detail;
  if (detail.length === 0) return "No recorded monetary activity";
  return detail.slice(0, 2).map((item) => money(item.amount, item.currency)).join(" · ");
}

export default function WorkspacePage() {
  const [bundle, setBundle] = useState<HubBundle | null>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current business could not be resolved.");
    }
    const workspaceId = String(context.currentWorkspaceId);
    const response = await fetch(`/api/business-hub?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The Business Hub could not be loaded.");
    const result = payload.result as HubBundle;
    setBundle(result);
    setCachedAt(null);
    setNotice("");
    writeBusinessInsightCache("hub", workspaceId, result);
  }, []);

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
      const cached = lastWorkspace ? readBusinessInsightCache<HubBundle>("hub", lastWorkspace) : null;
      if (cached && active) {
        setBundle({ ...cached.payload, cached: true });
        setCachedAt(cached.cachedAt);
      }
      try {
        if (!window.navigator.onLine) {
          if (cached) setNotice("Showing the last trusted Business Hub snapshot while offline.");
          else setError("The Business Hub needs one successful online load before it can reopen offline.");
          return;
        }
        await load();
      } catch (loadError) {
        if (!cached && active) setError(loadError instanceof Error ? loadError.message : "The Business Hub could not be loaded.");
        else if (active) setNotice("Showing the cached Business Hub because live records are unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [load]);

  async function refresh() {
    if (!online) {
      setNotice("Reconnect to refresh authoritative Business Hub records.");
      return;
    }
    setLoading(true);
    try {
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "The Business Hub could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }

  const attentionCount = Number(bundle?.operational.attention_count ?? bundle?.attention.length ?? 0);

  return (
    <main className={styles.shell}>
      <div className={styles.statusBar}>
        <div className={styles.statusText}>
          {online && !bundle?.cached ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>
            <strong>{online && !bundle?.cached ? "Live business records" : "Cached business view"}</strong>
            {cachedAt ? ` · saved ${formatTimeAgo(cachedAt)}` : bundle?.generatedAt ? ` · updated ${formatTimeAgo(bundle.generatedAt)}` : ""}
          </span>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading || !online}>
          <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
        </Button>
      </div>

      {notice ? <div className={styles.statusBar}><span className={styles.statusText}>{notice}</span></div> : null}
      {error ? <div className={`${styles.statusBar} ${styles.error}`}>{error}</div> : null}

      <section className={styles.hubStage} aria-label="Business departments">
        <div className={styles.orbit} aria-hidden="true" />
        <div className={styles.center}>
          <span className={styles.monogram}>BDB</span>
          <h1>{bundle?.workspaceName ?? "Business Hub"}</h1>
          <p>Connected operations</p>
          <span className={styles.attentionCount}>
            {attentionCount > 0 ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention` : "Everything is in order"}
          </span>
        </div>
        {(bundle?.departments ?? []).map((department, index, departments) => {
          const Icon = icons[department.key] ?? Activity;
          const angle = `${(index * 360) / Math.max(departments.length, 1)}deg`;
          return (
            <Link
              key={department.key}
              href={department.href}
              className={styles.departmentNode}
              style={{ "--angle": angle } as CSSProperties}
            >
              {department.attention > 0 ? <span className={styles.nodeAttention}>{department.attention}</span> : null}
              <Icon size={20} />
              <strong>{department.name}</strong>
              <b>{department.value}</b>
              <small>{department.label}<br />{signalDetail(department.detail)}</small>
            </Link>
          );
        })}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h2>Quick actions</h2><p>Only actions permitted in this business are shown.</p></div>
          {bundle?.supportReadOnly ? <span className="badge">Founder support · read only</span> : null}
        </div>
        <div className={styles.quickActions}>
          {(bundle?.quickActions ?? []).map((action) => (
            <Link href={action.href} className={styles.quickAction} key={action.key}><Plus size={14} /> {action.label}</Link>
          ))}
          {bundle && bundle.quickActions.length === 0 ? <span className={styles.empty}>No create actions are available for this access profile.</span> : null}
        </div>
      </section>

      <div className={styles.sectionGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h2>Needs attention</h2><p>Highest-priority actions across connected departments.</p></div>
            <span className="badge">{bundle?.attention.length ?? 0} shown</span>
          </div>
          <div className={styles.actionList}>
            {(bundle?.attention ?? []).map((item) => (
              <Link href={item.route} className={styles.actionRow} key={`${item.department}-${item.source_id}`}>
                <span className={styles.rowIcon}><ArrowRight size={15} /></span>
                <span className={styles.rowCopy}><strong>{item.title}</strong><span>{item.detail}</span></span>
                <span className={styles.rowTime}>{formatTimeAgo(item.occurred_at)}</span>
              </Link>
            ))}
            {bundle && bundle.attention.length === 0 ? <div className={styles.empty}>No operational actions currently require attention.</div> : null}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h2>Recent activity</h2><p>Authoritative events from connected business records.</p></div>
            <Link href="/activity" className="link-button">View all</Link>
          </div>
          <div className={styles.activityList}>
            {(bundle?.activity ?? []).slice(0, 8).map((item) => (
              <Link href={item.route || "/workspace"} className={styles.activityRow} key={`${item.department}-${item.source_id}-${item.occurred_at}`}>
                <span className={styles.rowIcon}><Activity size={15} /></span>
                <span className={styles.rowCopy}><strong>{item.title}</strong><span>{item.customer_name ? `${item.customer_name} · ` : ""}{item.detail}</span></span>
                <span className={styles.rowTime}>{formatTimeAgo(item.occurred_at)}</span>
              </Link>
            ))}
            {bundle && bundle.activity.length === 0 ? <div className={styles.empty}>Business activity will appear here as departments record work.</div> : null}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h2>Financial position by currency</h2><p>Amounts are never combined across currencies.</p></div>
          <Link href="/reports" className="link-button">Open Reports</Link>
        </div>
        <div className={styles.currencyGrid}>
          {(bundle?.currencies ?? []).map((metric) => (
            <article className={styles.currencyCard} key={metric.currency}>
              <header><span>Currency</span><strong>{metric.currency}</strong></header>
              <div className={styles.currencyMetric}><span>Completed sales</span><b>{money(metric.completed_sale_amount, metric.currency)}</b></div>
              <div className={styles.currencyMetric}><span>Payments received</span><b>{money(metric.received_payment_amount, metric.currency)}</b></div>
              <div className={styles.currencyMetric}><span>Customer outstanding</span><b>{money(metric.outstanding_invoice_amount, metric.currency)}</b></div>
              <div className={styles.currencyMetric}><span>Supplier outstanding</span><b>{money(metric.outstanding_supplier_payable_amount, metric.currency)}</b></div>
              <div className={styles.currencyMetric}><span>Bank unreconciled</span><b>{money(metric.unreconciled_transaction_amount, metric.currency)}</b></div>
            </article>
          ))}
          {bundle && bundle.currencies.length === 0 ? <div className={styles.empty}>No financial records are available for this access profile.</div> : null}
        </div>
      </section>
    </main>
  );
}

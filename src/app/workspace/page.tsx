"use client";

import Link from "next/link";
import {
  AlertCircle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Landmark,
  MessageSquareText,
  ShoppingBag,
  UsersRound,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type HubBundle = {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  cached: boolean;
  supportReadOnly: boolean;
  operational: Record<string, number | string>;
  departments: DepartmentSignal[];
  attention: AttentionItem[];
  quickActions: Array<{ key: string; label: string; href: string }>;
};

type FocusItem = {
  key: string;
  department: string;
  title: string;
  detail: string;
  href: string;
  status: string;
  occurredAt?: string;
  tone: string;
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

function detailText(detail: DepartmentSignal["detail"]) {
  if (typeof detail === "string") return detail;
  if (!detail.length) return "Open the department for details";
  return detail
    .slice(0, 2)
    .map((item) => `${item.currency} ${Number(item.amount).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`)
    .join(" · ");
}

function buildFocus(bundle: HubBundle | null): FocusItem[] {
  if (!bundle) return [];

  const attention = bundle.attention.map((item) => ({
    key: `attention-${item.department}-${item.source_id}`,
    department: item.department,
    title: item.title,
    detail: item.detail,
    href: item.route,
    status: "Needs attention",
    occurredAt: item.occurred_at,
    tone: item.tone || "gold",
  }));

  if (attention.length >= 5) return attention.slice(0, 5);

  const represented = new Set(attention.map((item) => item.department));
  const preferredDepartments = ["calendar", "communications", "sales", "inventory", "accounts", "customers"];
  const fillers = preferredDepartments
    .map((key) => bundle.departments.find((department) => department.key === key))
    .filter((department): department is DepartmentSignal => Boolean(department))
    .filter((department) => !represented.has(department.key) && department.value > 0)
    .map((department) => ({
      key: `today-${department.key}`,
      department: department.key,
      title: `${department.value} ${department.label}`,
      detail: detailText(department.detail),
      href: department.href,
      status: department.key === "calendar" ? "Today" : "Open",
      tone: department.attention > 0 ? "gold" : "neutral",
    }));

  return [...attention, ...fillers].slice(0, 5);
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
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "The Overview could not be loaded.");

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
          if (cached) setNotice("Offline · showing your last saved Overview.");
          else setError("Open the Overview online once before using it offline.");
          return;
        }
        await load();
      } catch (loadError) {
        if (!cached && active) {
          setError(loadError instanceof Error ? loadError.message : "The Overview could not be loaded.");
        } else if (active) {
          setNotice("Live records are unavailable · showing your last saved Overview.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialise();
    return () => { active = false; };
  }, [load]);

  const focus = useMemo(() => buildFocus(bundle), [bundle]);
  const attentionCount = Number(bundle?.operational.attention_count ?? bundle?.attention.length ?? 0);
  const statusLine = bundle?.cached
    ? `Saved ${formatTimeAgo(cachedAt ?? bundle.generatedAt)}`
    : bundle?.generatedAt
      ? `Updated ${formatTimeAgo(bundle.generatedAt)}`
      : "";

  return (
    <main className={styles.shell}>
      {(notice || error || !online) ? (
        <div className={`${styles.connectionNote} ${error ? styles.error : ""}`} role={error ? "alert" : "status"}>
          <WifiOff size={15} />
          <span>{error || notice || "Offline · showing saved business information."}</span>
          {statusLine ? <small>{statusLine}</small> : null}
        </div>
      ) : null}

      <section className={styles.focusPanel} aria-labelledby="today-attention-title">
        <header className={styles.focusHeader}>
          <div>
            <p className={styles.eyebrow}>Overview</p>
            <h1 id="today-attention-title">Today &amp; Attention</h1>
            <p>
              {loading && !bundle
                ? "Checking what needs you now…"
                : attentionCount > 0
                  ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention across the areas you can access.`
                  : "Only the work relevant to your access appears here."}
            </p>
          </div>
          {bundle?.supportReadOnly ? <span className={styles.readOnly}>Read only</span> : null}
        </header>

        {loading && !bundle ? (
          <div className={styles.loadingRows} aria-hidden="true">
            <span /><span /><span />
          </div>
        ) : focus.length ? (
          <div className={styles.focusList}>
            {focus.map((item) => {
              const Icon = icons[item.department] ?? AlertCircle;
              return (
                <Link href={item.href} className={styles.focusRow} data-tone={item.tone} key={item.key}>
                  <span className={styles.focusIcon}><Icon size={18} /></span>
                  <span className={styles.focusCopy}>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span className={styles.focusMeta}>
                    <b>{item.status}</b>
                    {item.occurredAt ? <small>{formatTimeAgo(item.occurredAt)}</small> : null}
                  </span>
                  <span className={styles.chevron} aria-hidden="true">›</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={styles.clearState}>
            <span><CheckCircle2 size={22} /></span>
            <div>
              <strong>Nothing needs your attention right now.</strong>
              <p>Use Create or the navigation to continue working.</p>
            </div>
          </div>
        )}
      </section>

      {bundle && !bundle.cached && statusLine ? <p className={styles.updated}>{statusLine}</p> : null}
    </main>
  );
}

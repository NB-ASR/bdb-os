"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Clock3, Inbox, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import styles from "./sales-inbox.module.css";

type EnquiryStatus = "new" | "contacted" | "qualified" | "won" | "lost" | "spam";
type Enquiry = {
  id: string;
  name: string;
  business_name: string;
  email: string;
  starting_plan: string;
  sector: string;
  challenge: string;
  team_size: string;
  preferred_term: string;
  status: EnquiryStatus;
  source: string;
  source_path: string;
  submitted_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  spam: "Spam",
};

function label(value: string) {
  return value.split("-").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

export default function SalesInboxPage() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EnquiryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/enquiries", { cache: "no-store" });
      if (response.status === 428) { window.location.href = "/mfa"; return; }
      if (response.status === 401) { window.location.href = "/login?next=/admin/enquiries"; return; }
      const body = await response.json() as { enquiries?: Enquiry[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sales enquiries could not be loaded.");
      const next = body.enquiries ?? [];
      setEnquiries(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Sales enquiries could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return enquiries.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!needle) return true;
      return [item.name, item.business_name, item.email, item.sector, item.challenge]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [enquiries, filter, query]);
  const selected = enquiries.find((item) => item.id === selectedId) ?? visible[0];

  async function updateStatus(status: EnquiryStatus) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/enquiries", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enquiryId: selected.id, status }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The enquiry could not be updated.");
      setEnquiries((current) => current.map((item) => item.id === selected.id
        ? { ...item, status, updated_at: new Date().toISOString() }
        : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "The enquiry could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const newCount = enquiries.filter((item) => item.status === "new").length;
  const qualifiedCount = enquiries.filter((item) => item.status === "qualified").length;
  const wonCount = enquiries.filter((item) => item.status === "won").length;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><p className="eyebrow">Founder control plane</p><h1>Sales inbox</h1><p>Every public discovery request is retained here even when the optional CRM notification is unavailable.</p></div>
        <button className="button button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /> Refresh</button>
      </header>

      <section className={styles.stats} aria-label="Sales pipeline summary">
        <article><span><Inbox size={17} /></span><small>New</small><strong>{newCount}</strong></article>
        <article><span><Clock3 size={17} /></span><small>Qualified</small><strong>{qualifiedCount}</strong></article>
        <article><span><CheckCircle2 size={17} /></span><small>Won</small><strong>{wonCount}</strong></article>
        <article><span><Building2 size={17} /></span><small>Total retained</small><strong>{enquiries.length}</strong></article>
      </section>

      {error && <div className={styles.error} role="alert"><strong>Action needed</strong><p>{error}</p></div>}

      <section className={styles.grid}>
        <div className={styles.listPanel}>
          <div className={styles.tools}>
            <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search enquiries" aria-label="Search enquiries" /></label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as EnquiryStatus | "all")} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
          <div className={styles.list}>
            {loading && <div className={styles.empty}><Loader2 className="spin" /> Loading secure sales inbox…</div>}
            {!loading && !visible.length && <div className={styles.empty}>No enquiries match this view.</div>}
            {visible.map((item) => <button key={item.id} className={item.id === selected?.id ? styles.active : ""} onClick={() => setSelectedId(item.id)}>
              <span className={styles.initial}>{item.business_name.slice(0, 2).toUpperCase()}</span>
              <span><strong>{item.business_name}</strong><small>{item.name} · {label(item.starting_plan)}</small><time>{new Date(item.submitted_at).toLocaleString()}</time></span>
              <em data-status={item.status}>{STATUS_LABELS[item.status]}</em>
            </button>)}
          </div>
        </div>

        <div className={styles.detail}>
          {selected ? <>
            <div className={styles.detailHead}><div><p className="eyebrow">{label(selected.sector)} · {label(selected.team_size)}</p><h2>{selected.business_name}</h2><a href={`mailto:${selected.email}`}>{selected.name} · {selected.email}</a></div><ShieldCheck size={24} /></div>
            <div className={styles.meta}><span><small>Starting plan</small><strong>{label(selected.starting_plan)}</strong></span><span><small>Preferred term</small><strong>{label(selected.preferred_term)}</strong></span><span><small>Submitted</small><strong>{new Date(selected.submitted_at).toLocaleString()}</strong></span></div>
            <div className={styles.challenge}><small>What is taking too much time</small><p>{selected.challenge}</p></div>
            <div className={styles.statusEditor}><label htmlFor="enquiry-status">Pipeline status</label><select id="enquiry-status" value={selected.status} disabled={busy} onChange={(event) => void updateStatus(event.target.value as EnquiryStatus)}>{Object.entries(STATUS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><a className="button button-primary" href={`mailto:${selected.email}?subject=${encodeURIComponent(`BDB OS discovery — ${selected.business_name}`)}`}>Reply by email</a></div>
            <footer>Source: {selected.source} · {selected.source_path}</footer>
          </> : <div className={styles.empty}>Select an enquiry to review it.</div>}
        </div>
      </section>
    </div>
  </main>;
}

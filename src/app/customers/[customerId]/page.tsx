"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  FileText,
  History,
  Mail,
  MessageSquareText,
  NotebookPen,
  Phone,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  TriangleAlert,
  UserRound,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { useBdb } from "@/lib/store";
import {
  enqueueCustomerNoteCommand,
  flushCustomerNoteQueue,
  readCustomerNoteQueue,
  type CustomerNoteQueuedCommand,
} from "@/lib/modules/customer-note-queue";
import styles from "./customer-profile.module.css";

type ProfileTab = "overview" | "activity" | "appointments" | "sales" | "accounts" | "documents" | "communications";
type ActivityFilter = "all" | "customer" | "customer_note" | "appointment" | "sale" | "invoice" | "payment" | "document" | "communication";
type Tone = "neutral" | "gold" | "green" | "blue" | "red";

type Customer = {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
  preferences: Record<string, unknown>;
  status: "active" | "archived";
  version: number;
  legacy_source: string | null;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
};

type OperationalSummary = {
  appointment_count: number;
  upcoming_appointment_count: number;
  completed_appointment_count: number;
  sale_count: number;
  completed_sale_count: number;
  invoice_count: number;
  open_invoice_count: number;
  payment_count: number;
  document_count: number;
  message_count: number;
  unread_message_count: number;
  note_count: number;
  active_note_count: number;
  last_activity_at: string | null;
};

type FinancialSummary = {
  currency: string;
  issued_invoice_count: number;
  open_invoice_count: number;
  payment_count: number;
  issued_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  received_amount: number;
  unallocated_credit: number;
  net_balance: number;
  balance_status: "amount_due" | "customer_credit" | "clear";
};

type ActivityItem = {
  source_type: ActivityFilter extends "all" ? never : string;
  source_id: string;
  event_type: string;
  title: string;
  detail: string;
  tone: Tone;
  occurred_at: string;
  route: string;
  metadata: Record<string, unknown>;
  pending?: boolean;
};

type CustomerNote = {
  id: string;
  customer_id: string;
  body: string;
  actor_user_id: string | null;
  occurred_at: string;
  created_at: string;
  status: "active" | "void";
  void_note_id: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  pending?: boolean;
};

type Appointment = {
  id: string;
  reference: string;
  title: string;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  staff_name: string;
  status: string;
  room_name: string | null;
  notes: string | null;
  cancellation_reason: string | null;
};

type Sale = {
  id: string;
  reference: string;
  channel: string;
  currency: string;
  total_amount: number;
  settlement_status: string;
  notes: string | null;
  status: string;
  occurred_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
};

type Invoice = {
  id: string;
  number: string;
  source_sale_id: string | null;
  issued_at: string;
  due_at: string;
  description: string;
  currency: string;
  total_amount: number;
  display_status: string;
  payment_status: string;
  allocated_amount: number;
  outstanding_amount: number;
  notes: string | null;
};

type Payment = {
  id: string;
  reference: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  notes: string | null;
  received_at: string;
  status: string;
  reversal_reason: string | null;
  allocated_amount: number;
  unallocated_amount: number;
};

type CustomerDocument = {
  id: string;
  name: string;
  document_type: string;
  size_label: string;
  linked_to: string;
  uploaded_at: string;
};

type CustomerMessage = {
  id: string;
  channel: string;
  subject: string;
  preview: string;
  occurred_at: string;
  unread: boolean;
  status: string;
};

type ProfileBundle = {
  workspaceId: string;
  customer: Customer;
  access: Record<string, boolean>;
  operational: OperationalSummary | null;
  financial: FinancialSummary[];
  activity: ActivityItem[];
  notes: CustomerNote[];
  actors: Record<string, string>;
  appointments: Appointment[];
  sales: Sale[];
  invoices: Invoice[];
  payments: Payment[];
  documents: CustomerDocument[];
  messages: CustomerMessage[];
};

const CACHE_PREFIX = "bdb-customer-360-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-customer-360-last-workspace-v1";
const cacheKey = (workspaceId: string, customerId: string) => `${CACHE_PREFIX}:${workspaceId}:${customerId}`;

function readCache(workspaceId: string, customerId: string): ProfileBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId, customerId)) ?? "null") as ProfileBundle | null;
    return value?.customer?.id === customerId ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId, customerId));
    return null;
  }
}

function writeCache(bundle: ProfileBundle) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey(bundle.workspaceId, bundle.customer.id), JSON.stringify(bundle));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function noteAuthor(note: CustomerNote, actors: Record<string, string>) {
  return (note.actor_user_id && actors[note.actor_user_id]) || "Team member";
}

function sourceLabel(source: string) {
  switch (source) {
    case "customer_note": return "Note";
    case "appointment": return "Calendar";
    case "sale": return "Sales";
    case "invoice": return "Invoice";
    case "payment": return "Payment";
    case "document": return "Document";
    case "communication": return "Communication";
    default: return "Customer";
  }
}

function sourceIcon(source: string) {
  switch (source) {
    case "customer_note": return <NotebookPen size={17} />;
    case "appointment": return <CalendarDays size={17} />;
    case "sale": return <ShoppingBag size={17} />;
    case "invoice": return <ReceiptText size={17} />;
    case "payment": return <CircleDollarSign size={17} />;
    case "document": return <FileText size={17} />;
    case "communication": return <MessageSquareText size={17} />;
    default: return <UserRound size={17} />;
  }
}

function badgeTone(value: string): Tone {
  if (["completed", "paid", "posted", "matched", "active", "clear"].includes(value)) return "green";
  if (["overdue", "pending", "partially_paid", "amount_due", "review"].includes(value)) return "gold";
  if (["reversed", "void", "archived", "cancelled"].includes(value)) return "neutral";
  return "blue";
}

function applyOptimistic(bundle: ProfileBundle, command: CustomerNoteQueuedCommand): ProfileBundle {
  const occurredAt = String(command.payload.occurredAt ?? command.createdAt);
  if (command.action === "create") {
    const noteId = String(command.payload.id);
    const body = String(command.payload.body ?? "");
    if (bundle.notes.some((note) => note.id === noteId)) return bundle;
    const note: CustomerNote = {
      id: noteId,
      customer_id: command.customerId,
      body,
      actor_user_id: null,
      occurred_at: occurredAt,
      created_at: command.createdAt,
      status: "active",
      void_note_id: null,
      void_reason: null,
      voided_by: null,
      voided_at: null,
      pending: true,
    };
    const activity: ActivityItem = {
      source_type: "customer_note",
      source_id: noteId,
      event_type: "note_added",
      title: "Customer note added",
      detail: body,
      tone: "gold",
      occurred_at: occurredAt,
      route: `/customers/${command.customerId}`,
      metadata: { pending: true },
      pending: true,
    };
    return {
      ...bundle,
      notes: [note, ...bundle.notes],
      activity: [activity, ...bundle.activity],
      operational: bundle.operational ? {
        ...bundle.operational,
        note_count: bundle.operational.note_count + 1,
        active_note_count: bundle.operational.active_note_count + 1,
        last_activity_at: occurredAt,
      } : bundle.operational,
    };
  }

  const noteId = String(command.payload.noteId ?? "");
  const reason = String(command.payload.reason ?? "");
  const voidId = String(command.payload.id ?? command.id);
  const activity: ActivityItem = {
    source_type: "customer_note",
    source_id: voidId,
    event_type: "note_voided",
    title: "Customer note voided",
    detail: reason,
    tone: "neutral",
    occurred_at: occurredAt,
    route: `/customers/${command.customerId}`,
    metadata: { note_id: noteId, pending: true },
    pending: true,
  };
  return {
    ...bundle,
    notes: bundle.notes.map((note) => note.id === noteId ? {
      ...note,
      status: "void",
      void_note_id: voidId,
      void_reason: reason,
      voided_at: occurredAt,
      pending: true,
    } : note),
    activity: [activity, ...bundle.activity],
    operational: bundle.operational ? {
      ...bundle.operational,
      active_note_count: Math.max(0, bundle.operational.active_note_count - 1),
      last_activity_at: occurredAt,
    } : bundle.operational,
  };
}

function RestrictedSection({ label }: { label: string }) {
  return (
    <Card className={styles.emptyCard}>
      <TriangleAlert size={20} />
      <div>
        <h2>{label} is restricted</h2>
        <p>Your current role does not have permission to view this department’s records.</p>
      </div>
    </Card>
  );
}

export default function CustomerProfilePage() {
  const params = useParams<{ customerId: string }>();
  const customerId = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;
  const { mode } = useBdb();
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [queueCount, setQueueCount] = useState(0);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [voidingNote, setVoidingNote] = useState<CustomerNote | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const refreshQueue = useCallback((workspaceId: string) => {
    setQueueCount(readCustomerNoteQueue(workspaceId).filter((item) => item.customerId === customerId).length);
  }, [customerId]);

  const load = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const workspaceId = String(context.currentWorkspaceId);
    setSupportReadOnly(Boolean(context.supportAccess) && context.supportAccessMode !== "test_write");
    const response = await fetch(
      `/api/customers/profile?workspaceId=${encodeURIComponent(workspaceId)}&customerId=${encodeURIComponent(customerId)}`,
      { cache: "no-store" },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "The Customer profile could not be loaded.");
    }
    const next = result.result as ProfileBundle;
    const queued = readCustomerNoteQueue(workspaceId).filter((item) => item.customerId === customerId);
    const withPending = queued.reduce(applyOptimistic, next);
    setBundle(withPending);
    writeCache(withPending);
    refreshQueue(workspaceId);
    return withPending;
  }, [customerId, refreshQueue]);

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
      const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = lastWorkspace ? readCache(lastWorkspace, customerId) : null;
      if (cached && active) {
        const queued = readCustomerNoteQueue(lastWorkspace).filter((item) => item.customerId === customerId);
        setBundle(queued.reduce(applyOptimistic, cached));
        refreshQueue(lastWorkspace);
      }
      try {
        if (mode === "demo") {
          if (!cached) setError("Customer 360 requires an active cloud workspace in this preview.");
          return;
        }
        if (!window.navigator.onLine) {
          if (cached) setNotice("Showing the cached Customer profile. Note changes will remain queued until reconnection.");
          else setError("Customer 360 needs one successful online load before it can reopen offline.");
          return;
        }
        await load();
      } catch (initialError) {
        if (!cached && active) setError(initialError instanceof Error ? initialError.message : "The Customer profile could not be loaded.");
        else if (active) setNotice("Showing the cached Customer profile while cloud access is unavailable.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [customerId, load, mode, refreshQueue]);

  const syncQueue = useCallback(async () => {
    if (!bundle?.workspaceId || !online || busy) return;
    setBusy(true);
    setError("");
    try {
      const completed = await flushCustomerNoteQueue(bundle.workspaceId);
      await load();
      if (completed) setNotice(`${completed} Customer note command${completed === 1 ? "" : "s"} synced.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Customer note synchronisation stopped on a conflict.");
      refreshQueue(bundle.workspaceId);
    } finally {
      setBusy(false);
    }
  }, [bundle?.workspaceId, busy, load, online, refreshQueue]);

  useEffect(() => {
    if (!online || !bundle?.workspaceId || queueCount === 0 || busy) return;
    void syncQueue();
  }, [bundle?.workspaceId, busy, online, queueCount, syncQueue]);

  async function queueCommand(action: "create" | "void", payload: Record<string, unknown>) {
    if (!bundle || supportReadOnly || busy) return;
    const commandId = crypto.randomUUID();
    const command = enqueueCustomerNoteCommand(bundle.workspaceId, bundle.customer.id, action, payload, commandId);
    const next = applyOptimistic(bundle, command);
    setBundle(next);
    writeCache(next);
    refreshQueue(bundle.workspaceId);
    if (!online) {
      setNotice("Saved offline. BDB OS will replay this Customer note command when the connection returns.");
      return;
    }
    await syncQueue();
  }

  async function createNote(event: FormEvent) {
    event.preventDefault();
    if (!noteBody.trim()) return;
    const occurredAt = new Date().toISOString();
    await queueCommand("create", {
      id: crypto.randomUUID(),
      body: noteBody.trim(),
      occurredAt,
    });
    setNoteBody("");
    setNoteOpen(false);
  }

  async function voidNote(event: FormEvent) {
    event.preventDefault();
    if (!voidingNote || voidReason.trim().length < 5) return;
    await queueCommand("void", {
      id: crypto.randomUUID(),
      noteId: voidingNote.id,
      reason: voidReason.trim(),
      occurredAt: new Date().toISOString(),
    });
    setVoidingNote(null);
    setVoidReason("");
  }

  const filteredActivity = useMemo(() => {
    if (!bundle) return [];
    return bundle.activity.filter((item) => activityFilter === "all" || item.source_type === activityFilter);
  }, [activityFilter, bundle]);

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Customer 360…</main>;
  }

  if (!bundle) {
    return (
      <>
        <PageHeader eyebrow="Customer records" title="Customer 360" description="The Customer profile could not be opened." />
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Customer profile unavailable</strong><p>{error || "Return to the Customer directory and choose another record."}</p></div>
        </div>
        <Link href="/customers"><Button variant="secondary"><ArrowLeft size={16} /> Back to Customers</Button></Link>
      </>
    );
  }

  const customer = bundle.customer;
  const operational = bundle.operational;
  const activeNotes = bundle.notes.filter((note) => note.status === "active");
  const preferenceSummary = typeof customer.preferences?.summary === "string" ? customer.preferences.summary : "";
  const latestActivity = bundle.activity.slice(0, 6);
  const tabs: Array<{ key: ProfileTab; label: string; available: boolean }> = [
    { key: "overview", label: "Overview", available: true },
    { key: "activity", label: "Activity", available: true },
    { key: "appointments", label: "Appointments", available: bundle.access.calendar !== false },
    { key: "sales", label: "Sales", available: bundle.access.sales !== false },
    { key: "accounts", label: "Accounts", available: bundle.access.accounts !== false },
    { key: "documents", label: "Documents", available: bundle.access.documents !== false },
    { key: "communications", label: "Communications", available: bundle.access.communications !== false },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Customer 360"
        title={customer.name}
        description={`${customer.company || "Individual Customer"} · ${customer.code}`}
        action={(
          <div className={styles.headerActions}>
            <Link href="/customers"><Button variant="secondary"><ArrowLeft size={16} /> Customers</Button></Link>
            <Button disabled={supportReadOnly} onClick={() => setNoteOpen(true)}><NotebookPen size={16} /> Add note</Button>
          </div>
        )}
      />

      <div className="review-callout">
        <UserRound size={19} />
        <div>
          <strong>Customer-centred operating record</strong>
          <p>Each department still owns its records. This profile connects them without copying or changing their source-of-truth data.</p>
        </div>
      </div>

      {!online ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong><WifiOff size={15} style={{ display: "inline", marginRight: 6 }} />Offline Customer 360</strong>
          <p>Cached records remain available. New note commands keep stable identities and replay in order after reconnection.</p>
        </div>
      ) : null}

      {supportReadOnly ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>Read-only access</strong>
          <p>Customer notes are blocked during this session.</p>
        </div>
      ) : null}

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Customer 360 needs attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Customer 360 updated</strong><p>{notice}</p></div> : null}

      {queueCount > 0 ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{queueCount} Customer note command{queueCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Synchronisation stops on the first conflict rather than overwriting current server state.</p>
          <Button variant="secondary" disabled={!online || busy} onClick={() => void syncQueue()}>
            <RefreshCw size={16} className={busy ? "spin" : ""} /> Retry
          </Button>
        </div>
      ) : null}

      <div className={styles.identityGrid}>
        <Card className={styles.identityCard}>
          <div className={styles.avatar}><UserRound size={30} /></div>
          <div>
            <div className={styles.identityTitle}>
              <h2>{customer.name}</h2>
              <Badge tone={customer.status === "active" ? "green" : "neutral"}>{customer.status}</Badge>
            </div>
            <p>{customer.company || "Individual Customer"}</p>
            <code>{customer.code}</code>
            {customer.legacy_source ? <Badge tone="blue">Vanita provenance retained</Badge> : null}
          </div>
        </Card>

        <Card className={styles.contactCard}>
          <h2>Contact</h2>
          <div className={styles.contactRows}>
            <span><Mail size={16} /> {customer.email || "No email recorded"}</span>
            <span><Phone size={16} /> {customer.phone || "No phone recorded"}</span>
            <span><History size={16} /> Last activity {formatDateTime(operational?.last_activity_at)}</span>
          </div>
          {customer.address ? <p className={styles.address}>{customer.address}</p> : null}
        </Card>
      </div>

      <div className="stat-grid">
        <StatCard label="Appointments" value={String(operational?.appointment_count ?? 0)} detail={`${operational?.upcoming_appointment_count ?? 0} upcoming`} icon={<CalendarDays size={19} />} />
        <StatCard label="Sales" value={String(operational?.sale_count ?? 0)} detail={`${operational?.completed_sale_count ?? 0} completed`} icon={<ShoppingBag size={19} />} />
        <StatCard label="Open invoices" value={String(operational?.open_invoice_count ?? 0)} detail={`${operational?.invoice_count ?? 0} total`} icon={<ReceiptText size={19} />} />
        <StatCard label="Notes" value={String(operational?.active_note_count ?? 0)} detail={`${operational?.note_count ?? 0} historical`} icon={<NotebookPen size={19} />} />
      </div>

      {bundle.access.accounts && bundle.financial.length ? (
        <div className={styles.financialGrid}>
          {bundle.financial.map((summary) => (
            <Card key={summary.currency} className={styles.financialCard}>
              <div className={styles.cardHeading}>
                <div><Banknote size={18} /><strong>{summary.currency} position</strong></div>
                <Badge tone={badgeTone(summary.balance_status)}>{statusLabel(summary.balance_status)}</Badge>
              </div>
              <div className={styles.moneyValue}>{formatMoney(Number(summary.net_balance), summary.currency)}</div>
              <div className={styles.financialBreakdown}>
                <span>Outstanding <strong>{formatMoney(Number(summary.outstanding_amount), summary.currency)}</strong></span>
                <span>Unallocated credit <strong>{formatMoney(Number(summary.unallocated_credit), summary.currency)}</strong></span>
                <span>Received <strong>{formatMoney(Number(summary.received_amount), summary.currency)}</strong></span>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <div className={styles.tabs} role="tablist" aria-label="Customer profile sections">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? styles.activeTab : ""}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {!item.available ? <span className={styles.lockMark}>Restricted</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className={styles.twoColumn}>
          <Card className={styles.sectionCard}>
            <div className={styles.cardHeading}>
              <div><NotebookPen size={18} /><h2>Customer notes</h2></div>
              <Button variant="quiet" disabled={supportReadOnly} onClick={() => setNoteOpen(true)}>Add note</Button>
            </div>
            {activeNotes.length ? (
              <div className={styles.noteList}>
                {activeNotes.slice(0, 5).map((note) => (
                  <article key={note.id} className={styles.noteItem}>
                    <div className={styles.noteMeta}>
                      <strong>{noteAuthor(note, bundle.actors)}</strong>
                      <span>{formatDateTime(note.occurred_at)}</span>
                      {note.pending ? <Badge tone="gold">Pending sync</Badge> : null}
                    </div>
                    <p>{note.body}</p>
                    <Button variant="quiet" disabled={supportReadOnly || note.pending} onClick={() => { setVoidingNote(note); setVoidReason(""); }}>Void note</Button>
                  </article>
                ))}
              </div>
            ) : <div className={styles.emptyInline}>No active Customer notes.</div>}
          </Card>

          <Card className={styles.sectionCard}>
            <div className={styles.cardHeading}><div><History size={18} /><h2>Latest activity</h2></div><Button variant="quiet" onClick={() => setTab("activity")}>View all</Button></div>
            <div className={styles.timeline}>
              {latestActivity.length ? latestActivity.map((item) => (
                <article key={`${item.source_type}-${item.source_id}-${item.event_type}`} className={styles.timelineItem}>
                  <span className={styles.timelineIcon}>{sourceIcon(item.source_type)}</span>
                  <div>
                    <div className={styles.timelineTitle}><strong>{item.title}</strong><Badge tone={item.tone}>{sourceLabel(item.source_type)}</Badge></div>
                    <p>{item.detail}</p>
                    <small>{formatDateTime(item.occurred_at)}{item.pending ? " · Pending sync" : ""}</small>
                  </div>
                </article>
              )) : <div className={styles.emptyInline}>No Customer activity recorded yet.</div>}
            </div>
          </Card>

          <Card className={styles.sectionCard}>
            <h2>Preferences and context</h2>
            <dl className={styles.detailList}>
              <div><dt>VAT number</dt><dd>{customer.vat_number || "No VAT number recorded"}</dd></div>
              <div><dt>Preferences</dt><dd>{preferenceSummary || "No preferences recorded"}</dd></div>
              <div><dt>Legacy/imported context</dt><dd>{customer.notes || "No legacy/imported context"}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(customer.created_at)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDateTime(customer.updated_at)}</dd></div>
            </dl>
          </Card>

          <Card className={styles.sectionCard}>
            <h2>Connected records</h2>
            <div className={styles.connectionList}>
              <button onClick={() => setTab("appointments")}><CalendarDays size={17} /><span>Appointments</span><strong>{operational?.appointment_count ?? 0}</strong></button>
              <button onClick={() => setTab("sales")}><ShoppingBag size={17} /><span>Sales</span><strong>{operational?.sale_count ?? 0}</strong></button>
              <button onClick={() => setTab("accounts")}><ReceiptText size={17} /><span>Invoices and Payments</span><strong>{(operational?.invoice_count ?? 0) + (operational?.payment_count ?? 0)}</strong></button>
              <button onClick={() => setTab("documents")}><FileText size={17} /><span>Documents</span><strong>{operational?.document_count ?? 0}</strong></button>
              <button onClick={() => setTab("communications")}><MessageSquareText size={17} /><span>Communications</span><strong>{operational?.message_count ?? 0}</strong></button>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "activity" ? (
        <Card className={styles.sectionCard}>
          <div className={styles.cardHeading}>
            <div><History size={18} /><h2>Unified activity</h2></div>
            <Badge tone="neutral">{filteredActivity.length} events</Badge>
          </div>
          <div className={styles.filterRow}>
            {(["all", "customer", "customer_note", "appointment", "sale", "invoice", "payment", "document", "communication"] as ActivityFilter[]).map((filter) => (
              <button key={filter} className={activityFilter === filter ? styles.activeFilter : ""} onClick={() => setActivityFilter(filter)}>{filter === "all" ? "All" : sourceLabel(filter)}</button>
            ))}
          </div>
          <div className={styles.timeline}>
            {filteredActivity.map((item) => (
              <article key={`${item.source_type}-${item.source_id}-${item.event_type}`} className={styles.timelineItem}>
                <span className={styles.timelineIcon}>{sourceIcon(item.source_type)}</span>
                <div>
                  <div className={styles.timelineTitle}><strong>{item.title}</strong><Badge tone={item.tone}>{sourceLabel(item.source_type)}</Badge></div>
                  <p>{item.detail}</p>
                  <small>{formatDateTime(item.occurred_at)}{item.pending ? " · Pending sync" : ""}</small>
                  {item.route && item.route !== `/customers/${customer.id}` ? <Link href={item.route}>Open source record</Link> : null}
                </div>
              </article>
            ))}
            {!filteredActivity.length ? <div className={styles.emptyInline}>No events match this filter.</div> : null}
          </div>
        </Card>
      ) : null}

      {tab === "appointments" ? bundle.access.calendar === false ? <RestrictedSection label="Calendar" /> : (
        <Card className="table-card">
          <div className="toolbar"><h2>Appointments</h2><Badge tone="neutral">{bundle.appointments.length}</Badge></div>
          <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Date</th><th>Service</th><th>Staff</th><th>Status</th></tr></thead><tbody>
            {bundle.appointments.map((appointment) => <tr key={appointment.id}><td><code>{appointment.reference}</code></td><td>{formatDate(appointment.booking_date)} · {appointment.booking_time.slice(0, 5)}</td><td>{appointment.title}</td><td>{appointment.staff_name}{appointment.room_name ? ` · ${appointment.room_name}` : ""}</td><td><Badge tone={badgeTone(appointment.status)}>{statusLabel(appointment.status)}</Badge></td></tr>)}
          </tbody></table></div>
          {!bundle.appointments.length ? <div className="card-pad"><p className="muted">No Appointments are linked to this Customer.</p></div> : null}
        </Card>
      ) : null}

      {tab === "sales" ? bundle.access.sales === false ? <RestrictedSection label="Sales" /> : (
        <Card className="table-card">
          <div className="toolbar"><h2>Sales</h2><Badge tone="neutral">{bundle.sales.length}</Badge></div>
          <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Date</th><th>Channel</th><th>Total</th><th>Status</th></tr></thead><tbody>
            {bundle.sales.map((sale) => <tr key={sale.id}><td><code>{sale.reference}</code></td><td>{formatDateTime(sale.occurred_at)}</td><td>{sale.channel}</td><td>{formatMoney(Number(sale.total_amount), sale.currency)}</td><td><Badge tone={badgeTone(sale.status)}>{statusLabel(sale.status)}</Badge></td></tr>)}
          </tbody></table></div>
          {!bundle.sales.length ? <div className="card-pad"><p className="muted">No Sales are linked to this Customer.</p></div> : null}
        </Card>
      ) : null}

      {tab === "accounts" ? bundle.access.accounts === false ? <RestrictedSection label="Accounts" /> : (
        <div className={styles.accountStack}>
          <Card className="table-card">
            <div className="toolbar"><h2>Invoices</h2><Badge tone="neutral">{bundle.invoices.length}</Badge></div>
            <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>
              {bundle.invoices.map((invoice) => <tr key={invoice.id}><td><code>{invoice.number}</code></td><td>{formatDate(invoice.issued_at)}</td><td>{formatDate(invoice.due_at)}</td><td>{formatMoney(Number(invoice.total_amount), invoice.currency)}</td><td>{formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</td><td><Badge tone={badgeTone(invoice.display_status)}>{statusLabel(invoice.display_status)}</Badge></td></tr>)}
            </tbody></table></div>
            {!bundle.invoices.length ? <div className="card-pad"><p className="muted">No Invoices are linked to this Customer.</p></div> : null}
          </Card>
          <Card className="table-card">
            <div className="toolbar"><h2>Customer Payments</h2><Badge tone="neutral">{bundle.payments.length}</Badge></div>
            <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Received</th><th>Method</th><th>Amount</th><th>Unallocated</th><th>Status</th></tr></thead><tbody>
              {bundle.payments.map((payment) => <tr key={payment.id}><td><code>{payment.reference}</code></td><td>{formatDateTime(payment.received_at)}</td><td>{statusLabel(payment.payment_method)}</td><td>{formatMoney(Number(payment.amount), payment.currency)}</td><td>{formatMoney(Number(payment.unallocated_amount), payment.currency)}</td><td><Badge tone={badgeTone(payment.status)}>{statusLabel(payment.status)}</Badge></td></tr>)}
            </tbody></table></div>
            {!bundle.payments.length ? <div className="card-pad"><p className="muted">No Customer Payments are linked to this Customer.</p></div> : null}
          </Card>
        </div>
      ) : null}

      {tab === "documents" ? bundle.access.documents === false ? <RestrictedSection label="Documents" /> : (
        <Card className="table-card">
          <div className="toolbar"><h2>Documents</h2><Badge tone="neutral">{bundle.documents.length}</Badge></div>
          <div className="table-scroll"><table><thead><tr><th>Name</th><th>Type</th><th>Linked to</th><th>Size</th><th>Uploaded</th></tr></thead><tbody>
            {bundle.documents.map((document) => <tr key={document.id}><td>{document.name}</td><td>{document.document_type}</td><td>{document.linked_to}</td><td>{document.size_label}</td><td>{formatDateTime(document.uploaded_at)}</td></tr>)}
          </tbody></table></div>
          {!bundle.documents.length ? <div className="card-pad"><p className="muted">No Documents are linked to this Customer.</p></div> : null}
        </Card>
      ) : null}

      {tab === "communications" ? bundle.access.communications === false ? <RestrictedSection label="Communications" /> : (
        <Card className="table-card">
          <div className="toolbar"><h2>Communications</h2><Badge tone={operational?.unread_message_count ? "gold" : "neutral"}>{bundle.messages.length}</Badge></div>
          <div className="table-scroll"><table><thead><tr><th>Channel</th><th>Subject</th><th>Preview</th><th>Date</th><th>Status</th></tr></thead><tbody>
            {bundle.messages.map((message) => <tr key={message.id}><td>{message.channel}</td><td>{message.subject}</td><td>{message.preview}</td><td>{formatDateTime(message.occurred_at)}</td><td><Badge tone={message.unread ? "gold" : "blue"}>{message.unread ? "Unread" : statusLabel(message.status)}</Badge></td></tr>)}
          </tbody></table></div>
          {!bundle.messages.length ? <div className="card-pad"><p className="muted">No Communications are linked to this Customer.</p></div> : null}
        </Card>
      ) : null}

      <Dialog open={noteOpen} onClose={() => { if (!busy) setNoteOpen(false); }} title="Add Customer note" description="Notes are append-only. Corrections preserve the original note and add a linked void record.">
        <form onSubmit={(event) => void createNote(event)}>
          <div className="field"><label htmlFor="customer-360-note">Internal note</label><textarea id="customer-360-note" required maxLength={4000} rows={7} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} /></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setNoteOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !noteBody.trim()}>{busy ? "Saving…" : online ? "Add note" : "Save offline"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(voidingNote)} onClose={() => { if (!busy) setVoidingNote(null); }} title="Void Customer note" description="The original note remains visible in history. Enter the reason for the correction.">
        <form onSubmit={(event) => void voidNote(event)}>
          {voidingNote ? <div className={styles.voidPreview}>{voidingNote.body}</div> : null}
          <div className="field"><label htmlFor="customer-note-void-reason">Reason</label><textarea id="customer-note-void-reason" required minLength={5} maxLength={500} rows={4} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setVoidingNote(null)}>Cancel</Button><Button type="submit" disabled={busy || voidReason.trim().length < 5}>{busy ? "Saving…" : online ? "Void note" : "Queue void"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

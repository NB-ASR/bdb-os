"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  CheckCheck,
  Inbox,
  MessageCircleMore,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatTimeAgo } from "@/lib/format";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import {
  enqueueUnifiedCommunicationCommand,
  flushUnifiedCommunicationQueue,
  listUnifiedCommunicationCommands,
} from "@/lib/modules/unified-communication-queue";

const CHANNELS = ["Email", "WhatsApp", "Instagram", "Web"] as const;
const CACHE_PREFIX = "bdb-unified-communications-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-unified-communications-last-workspace-v1";
const channelCode = { Email: "EM", WhatsApp: "WA", Instagram: "IG", Web: "WEB" } as const;

type Channel = typeof CHANNELS[number];
type Direction = "inbound" | "outbound";
type DraftState = "none" | "review" | "dismissed";

type CustomerLabel = {
  id: string;
  code: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
};

type CommunicationThread = {
  id: string;
  workspace_id: string;
  customer_id: string;
  channel: Channel;
  subject: string;
  status: "open" | "closed";
  last_message_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  message_count: number;
  unread_count: number;
  draft_review_count: number;
  latest_message_id: string;
  latest_direction: Direction;
  latest_body: string;
  latest_draft_state: DraftState;
  latest_occurred_at: string;
  pending?: boolean;
};

type CommunicationMessage = {
  id: string;
  workspace_id: string;
  customer_id: string;
  thread_id: string;
  channel: Channel;
  direction: Direction;
  subject: string;
  body: string;
  preview: string;
  occurred_at: string;
  unread: boolean;
  status: "open" | "replied" | "approval";
  draft_state: DraftState;
  read_at: string | null;
  reply_to_message_id: string | null;
  created_at: string;
  updated_at: string;
  pending?: boolean;
};

type CommunicationBundle = {
  workspaceId: string;
  access: Record<string, boolean>;
  threads: CommunicationThread[];
  selectedThreadId: string | null;
  messages: CommunicationMessage[];
  customers: CustomerLabel[];
};

type CachedWorkspace = {
  workspaceId: string;
  access: Record<string, boolean>;
  threads: CommunicationThread[];
  customers: CustomerLabel[];
  messagesByThread: Record<string, CommunicationMessage[]>;
  cachedAt: string;
};

type ComposeState = {
  threadId: string;
  customerId: string;
  channel: Channel;
  direction: Direction;
  subject: string;
  body: string;
  replyToMessageId: string;
  draftReview: boolean;
};

const emptyCompose = (): ComposeState => ({
  threadId: "",
  customerId: "",
  channel: "Email",
  direction: "inbound",
  subject: "",
  body: "",
  replyToMessageId: "",
  draftReview: false,
});

const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readCache(workspaceId: string): CachedWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as CachedWorkspace | null;
    return value?.workspaceId === workspaceId ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeCache(value: CachedWorkspace) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey(value.workspaceId), JSON.stringify(value));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, value.workspaceId);
}

function requestedThreadFromLocation() {
  if (typeof window === "undefined") return undefined;
  const value = new URL(window.location.href).searchParams.get("threadId")?.trim();
  return value || undefined;
}

function updateThreadLocation(thread: CommunicationThread) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("threadId", thread.id);
  url.searchParams.set("customerId", thread.customer_id);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
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

function customerLabel(customers: CustomerLabel[], customerId: string) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return "Restricted Customer";
  return customer.company ? `${customer.name} · ${customer.company}` : customer.name;
}

function messageStatus(message: CommunicationMessage) {
  if (message.pending) return { label: "Pending sync", tone: "gold" as const };
  if (message.draft_state === "review") return { label: "Draft review", tone: "gold" as const };
  if (message.draft_state === "dismissed") return { label: "Draft dismissed", tone: "neutral" as const };
  if (message.direction === "inbound" && message.unread) return { label: "Unread", tone: "blue" as const };
  return {
    label: message.direction === "inbound" ? "Received" : "Recorded outbound",
    tone: message.direction === "inbound" ? "blue" as const : "green" as const,
  };
}

export default function CommunicationsPage() {
  const { mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState("");
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [threads, setThreads] = useState<CommunicationThread[]>([]);
  const [customers, setCustomers] = useState<CustomerLabel[]>([]);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, CommunicationMessage[]>>({});
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [dismissMessage, setDismissMessage] = useState<CommunicationMessage | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const selected = threads.find((item) => item.id === selectedId) ?? threads[0];
  const selectedMessages = useMemo(
    () => selected ? messagesByThread[selected.id] ?? [] : [],
    [messagesByThread, selected],
  );

  const refreshQueue = useCallback(async (targetWorkspaceId: string) => {
    const queue = await listUnifiedCommunicationCommands(targetWorkspaceId);
    setQueueCount(queue.length);
  }, []);

  const load = useCallback(async (requestedThreadId?: string) => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    setSupportReadOnly(Boolean(context.supportAccess) && context.supportAccessMode !== "test_write");

    const params = new URLSearchParams({ workspaceId: currentWorkspaceId });
    if (requestedThreadId) params.set("threadId", requestedThreadId);
    const response = await fetch(`/api/communications?${params.toString()}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.ok) throw new Error(json.error ?? "Communications could not be loaded.");

    const result = json.result as CommunicationBundle;
    const nextThreads = result.threads ?? [];
    const nextCustomers = result.customers ?? [];
    const nextAccess = result.access ?? {};

    setAccess(nextAccess);
    setThreads(nextThreads);
    setCustomers(nextCustomers);
    setSelectedId(result.selectedThreadId ?? "");
    setMessagesByThread((current) => {
      const next = {
        ...current,
        ...(result.selectedThreadId ? { [result.selectedThreadId]: result.messages ?? [] } : {}),
      };
      writeCache({
        workspaceId: currentWorkspaceId,
        access: nextAccess,
        threads: nextThreads,
        customers: nextCustomers,
        messagesByThread: next,
        cachedAt: new Date().toISOString(),
      });
      return next;
    });
    await refreshQueue(currentWorkspaceId);
    return result;
  }, [refreshQueue]);

  const selectThread = useCallback(async (thread: CommunicationThread) => {
    setSelectedId(thread.id);
    updateThreadLocation(thread);
    if (!online || mode === "demo" || messagesByThread[thread.id]) return;

    setBusy(true);
    setError("");
    try {
      await load(thread.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The conversation could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [load, messagesByThread, mode, online]);

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
      const requestedThreadId = requestedThreadFromLocation();
      const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = lastWorkspace ? readCache(lastWorkspace) : null;

      if (cached && active) {
        setWorkspaceId(cached.workspaceId);
        setAccess(cached.access);
        setThreads(cached.threads);
        setCustomers(cached.customers);
        setMessagesByThread(cached.messagesByThread);
        setSelectedId(
          requestedThreadId && cached.threads.some((thread) => thread.id === requestedThreadId)
            ? requestedThreadId
            : cached.threads[0]?.id ?? "",
        );
        await refreshQueue(cached.workspaceId);
      }

      try {
        if (mode === "demo") {
          if (!cached) setError("Unified Communications requires an active cloud workspace in this preview.");
          return;
        }
        if (!window.navigator.onLine) {
          if (cached) setNotice("Showing the cached unified inbox. Changes will remain queued until reconnection.");
          else setError("Unified Communications needs one successful online load before it can be used offline.");
          return;
        }
        await load(requestedThreadId);
      } catch (loadError) {
        if (!cached) setError(loadError instanceof Error ? loadError.message : "Communications could not be loaded.");
      } finally {
        if (active) setLoaded(true);
      }
    }

    void initialise();
    return () => { active = false; };
  }, [load, mode, refreshQueue]);

  useEffect(() => {
    if (!online || !workspaceId || mode === "demo") return;
    let active = true;

    async function sync() {
      try {
        const completed = await flushUnifiedCommunicationQueue(workspaceId);
        if (!active) return;
        if (completed) {
          setNotice(`${completed} communication command${completed === 1 ? "" : "s"} synchronised.`);
          await load(selectedId || undefined);
        }
        await refreshQueue(workspaceId);
      } catch (syncError) {
        if (active) setError(syncError instanceof Error ? syncError.message : "Communication synchronisation stopped.");
      }
    }

    void sync();
    return () => { active = false; };
  }, [load, mode, online, refreshQueue, selectedId, workspaceId]);

  useEffect(() => {
    if (!selected || !workspaceId || supportReadOnly) return;
    const unreadMessages = selectedMessages.filter(
      (message) => message.direction === "inbound" && message.unread && !message.pending,
    );
    if (!unreadMessages.length) return;

    let active = true;
    async function markRead() {
      const occurredAt = new Date().toISOString();
      for (const message of unreadMessages) {
        await enqueueUnifiedCommunicationCommand(
          workspaceId,
          selected.id,
          "mark_read",
          { occurredAt },
          message.id,
          crypto.randomUUID(),
        );
      }
      if (online) await flushUnifiedCommunicationQueue(workspaceId);
      if (!active) return;

      const unreadIds = new Set(unreadMessages.map((message) => message.id));
      setMessagesByThread((current) => ({
        ...current,
        [selected.id]: (current[selected.id] ?? []).map((message) => unreadIds.has(message.id)
          ? { ...message, unread: false, read_at: occurredAt }
          : message),
      }));
      setThreads((current) => current.map((thread) => thread.id === selected.id
        ? { ...thread, unread_count: 0 }
        : thread));
      await refreshQueue(workspaceId);
    }

    void markRead().catch((markError) => {
      if (active) setError(markError instanceof Error ? markError.message : "The message could not be marked read.");
    });
    return () => { active = false; };
  }, [online, refreshQueue, selected, selectedMessages, supportReadOnly, workspaceId]);

  const visibleThreads = useMemo(
    () => threads.filter((thread) => showClosed || thread.status === "open"),
    [showClosed, threads],
  );
  const unread = useMemo(
    () => threads.reduce((total, thread) => total + Number(thread.unread_count || 0), 0),
    [threads],
  );
  const reviews = useMemo(
    () => threads.reduce((total, thread) => total + Number(thread.draft_review_count || 0), 0),
    [threads],
  );
  const openThreads = useMemo(
    () => threads.filter((thread) => thread.status === "open").length,
    [threads],
  );

  function openNew() {
    setCompose({ ...emptyCompose(), customerId: customers[0]?.id ?? "" });
    setComposeOpen(true);
  }

  function openReply() {
    if (!selected) return;
    setCompose({
      threadId: selected.id,
      customerId: selected.customer_id,
      channel: selected.channel,
      direction: "outbound",
      subject: selected.subject.startsWith("Re:") ? selected.subject : `Re: ${selected.subject}`,
      body: "",
      replyToMessageId: selectedMessages.at(-1)?.id ?? "",
      draftReview: false,
    });
    setComposeOpen(true);
  }

  async function submitCommunication(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !compose.customerId || !compose.subject.trim() || !compose.body.trim() || busy) return;

    const threadId = compose.threadId || crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    setBusy(true);
    setError("");

    try {
      await enqueueUnifiedCommunicationCommand(
        workspaceId,
        threadId,
        "record_message",
        {
          customerId: compose.customerId,
          channel: compose.channel,
          direction: compose.direction,
          subject: compose.subject.trim(),
          body: compose.body.trim(),
          replyToMessageId: compose.replyToMessageId || null,
          draftState: compose.draftReview ? "review" : "none",
          occurredAt,
        },
        messageId,
        crypto.randomUUID(),
      );

      const pendingMessage: CommunicationMessage = {
        id: messageId,
        workspace_id: workspaceId,
        customer_id: compose.customerId,
        thread_id: threadId,
        channel: compose.channel,
        direction: compose.direction,
        subject: compose.subject.trim(),
        body: compose.body.trim(),
        preview: compose.body.trim().slice(0, 500),
        occurred_at: occurredAt,
        unread: compose.direction === "inbound",
        status: compose.draftReview ? "approval" : compose.direction === "outbound" ? "replied" : "open",
        draft_state: compose.draftReview ? "review" : "none",
        read_at: compose.direction === "outbound" ? occurredAt : null,
        reply_to_message_id: compose.replyToMessageId || null,
        created_at: occurredAt,
        updated_at: occurredAt,
        pending: true,
      };

      setMessagesByThread((current) => ({
        ...current,
        [threadId]: [...(current[threadId] ?? []), pendingMessage],
      }));
      setThreads((current) => {
        const existing = current.find((thread) => thread.id === threadId);
        if (existing) {
          return current.map((thread) => thread.id === threadId ? {
            ...thread,
            latest_message_id: messageId,
            latest_direction: compose.direction,
            latest_body: compose.body.trim(),
            latest_draft_state: compose.draftReview ? "review" : "none",
            latest_occurred_at: occurredAt,
            last_message_at: occurredAt,
            message_count: thread.message_count + 1,
            unread_count: thread.unread_count + (compose.direction === "inbound" ? 1 : 0),
            draft_review_count: thread.draft_review_count + (compose.draftReview ? 1 : 0),
            pending: true,
          } : thread);
        }
        return [{
          id: threadId,
          workspace_id: workspaceId,
          customer_id: compose.customerId,
          channel: compose.channel,
          subject: compose.subject.trim(),
          status: "open",
          last_message_at: occurredAt,
          created_at: occurredAt,
          updated_at: occurredAt,
          closed_at: null,
          message_count: 1,
          unread_count: compose.direction === "inbound" ? 1 : 0,
          draft_review_count: compose.draftReview ? 1 : 0,
          latest_message_id: messageId,
          latest_direction: compose.direction,
          latest_body: compose.body.trim(),
          latest_draft_state: compose.draftReview ? "review" : "none",
          latest_occurred_at: occurredAt,
          pending: true,
        }, ...current];
      });

      setSelectedId(threadId);
      setComposeOpen(false);
      setCompose(emptyCompose());
      await refreshQueue(workspaceId);

      if (online) {
        await flushUnifiedCommunicationQueue(workspaceId);
        await load(threadId);
        setNotice("Communication recorded in BDB OS. No external provider delivery was attempted.");
      } else {
        setNotice("Communication queued. It is not confirmed or externally delivered until synchronisation succeeds.");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The communication could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function dismissDraft(event: FormEvent) {
    event.preventDefault();
    if (!dismissMessage || dismissReason.trim().length < 5 || busy) return;

    setBusy(true);
    setError("");
    try {
      await enqueueUnifiedCommunicationCommand(
        workspaceId,
        dismissMessage.thread_id,
        "dismiss_draft",
        { reason: dismissReason.trim(), occurredAt: new Date().toISOString() },
        dismissMessage.id,
      );
      if (online) {
        await flushUnifiedCommunicationQueue(workspaceId);
        await load(dismissMessage.thread_id);
      } else {
        setMessagesByThread((current) => ({
          ...current,
          [dismissMessage.thread_id]: (current[dismissMessage.thread_id] ?? []).map((message) => message.id === dismissMessage.id
            ? { ...message, draft_state: "dismissed", pending: true }
            : message),
        }));
      }
      setDismissMessage(null);
      setDismissReason("");
      setNotice(online ? "Draft dismissed and retained in history." : "Draft dismissal queued for synchronisation.");
      await refreshQueue(workspaceId);
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : "The draft could not be dismissed.");
    } finally {
      setBusy(false);
    }
  }

  async function closeThread(event: FormEvent) {
    event.preventDefault();
    if (!selected || closeReason.trim().length < 5 || busy) return;

    setBusy(true);
    setError("");
    try {
      await enqueueUnifiedCommunicationCommand(
        workspaceId,
        selected.id,
        "close_thread",
        { reason: closeReason.trim(), occurredAt: new Date().toISOString() },
      );
      if (online) {
        await flushUnifiedCommunicationQueue(workspaceId);
        await load(selected.id);
      } else {
        setThreads((current) => current.map((thread) => thread.id === selected.id
          ? { ...thread, status: "closed", pending: true }
          : thread));
      }
      setCloseOpen(false);
      setCloseReason("");
      setNotice(online ? "Communication thread closed." : "Thread closure queued for synchronisation.");
      await refreshQueue(workspaceId);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "The thread could not be closed.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded && !threads.length) {
    return <div className="card-pad"><p className="muted">Loading Unified Communications…</p></div>;
  }

  const canCompose = customers.length > 0 && access.customers !== false && !supportReadOnly;

  return (
    <>
      <PageHeader
        eyebrow="Unified customer communication record"
        title="Communications"
        description="Keep inbound and outbound conversations together. Version 1 records communication inside BDB OS; it does not send through Email, WhatsApp, Instagram or Web providers."
        action={<Button disabled={!canCompose || busy} onClick={openNew}><Plus size={17} /> Record communication</Button>}
      />

      {!online ? <div className="review-callout"><WifiOff size={19} /><div><strong>Offline Communications mode</strong><p>Cached conversations remain available. Changes replay in order after reconnection.</p></div></div> : null}
      {supportReadOnly ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Read-only access</strong><p>Communication commands are disabled for this session.</p></div></div> : null}
      {!access.customers ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Customer identities are restricted</strong><p>The inbox remains visible under Communications permission, but Customer labels and new conversation creation require Customers access.</p></div></div> : null}
      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Communications needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Communications updated</strong><p>{notice}</p></div> : null}
      {queueCount > 0 ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>{queueCount} command{queueCount === 1 ? "" : "s"} waiting to sync</strong><p>Synchronisation stops at the first conflict rather than recording duplicate communication.</p><Button variant="secondary" disabled={!online || busy} onClick={() => void load(selectedId || undefined)}><RefreshCw size={16} /> Retry</Button></div> : null}

      <div className="stat-grid">
        <StatCard label="Open threads" value={String(openThreads)} detail={`${threads.length} total`} icon={<Inbox size={19} />} />
        <StatCard label="Unread" value={String(unread)} detail="Inbound records needing review" icon={<MessageCircleMore size={19} />} />
        <StatCard label="Draft review" value={String(reviews)} detail="Human decision required" icon={<Sparkles size={19} />} />
        <StatCard label="Recorded" value={String(threads.reduce((total, thread) => total + Number(thread.message_count || 0), 0))} detail="Not provider delivery" icon={<CheckCheck size={19} />} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button variant="quiet" onClick={() => setShowClosed((value) => !value)}>{showClosed ? "Hide closed" : "Show closed"}</Button>
      </div>

      <Card className="inbox-layout">
        <div className="message-list">
          {visibleThreads.map((thread) => (
            <button
              key={thread.id}
              className={`message-row ${selected?.id === thread.id ? "selected" : ""}`}
              onClick={() => void selectThread(thread)}
            >
              <span className="message-channel">{channelCode[thread.channel]}</span>
              <span className="message-copy">
                <strong>{customerLabel(customers, thread.customer_id)}</strong>
                <span>{thread.subject}</span>
                <small>{thread.latest_body}</small>
              </span>
              <span>
                {thread.unread_count > 0
                  ? <Badge tone="blue">{thread.unread_count}</Badge>
                  : thread.pending
                    ? <Badge tone="gold">Pending</Badge>
                    : <small className="muted">{formatTimeAgo(thread.last_message_at)}</small>}
              </span>
            </button>
          ))}
          {!visibleThreads.length ? <div className="card-pad"><h2>No communication threads</h2><p className="muted">Record an inbound or outbound Customer communication when there is something worth retaining.</p></div> : null}
        </div>

        <div className="message-view">
          {selected ? <>
            <div className="message-view-header">
              <div>
                <p className="eyebrow">{selected.channel} · {selected.status}</p>
                <h2>{selected.subject}</h2>
                <p className="muted small" style={{ margin: 0 }}>{customerLabel(customers, selected.customer_id)}</p>
              </div>
              <Badge tone={selected.status === "closed" ? "neutral" : selected.unread_count ? "blue" : "green"}>{selected.status}</Badge>
            </div>

            <div style={{ display: "grid", gap: 12, padding: "18px 0" }}>
              {selectedMessages.map((message) => {
                const state = messageStatus(message);
                return <article key={message.id} className="message-body" style={{ borderLeft: message.direction === "inbound" ? "3px solid var(--gold)" : "3px solid var(--success)", paddingLeft: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <strong>{message.direction === "inbound" ? "Inbound" : "Outbound"} · {message.channel}</strong>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
                  <small className="muted">{formatDateTime(message.occurred_at)}</small>
                  {message.draft_state === "review" ? <div className="ai-draft" style={{ marginTop: 14 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={16} /><strong>Draft requires human review</strong><Badge tone="gold">Not sent</Badge></div><p>This record is not a final reply and has not been delivered through a provider.</p><div style={{ display: "flex", gap: 8, marginTop: 12 }}><Button disabled={supportReadOnly || selected.status === "closed"} onClick={openReply}><Send size={15} /> Record final reply</Button><Button variant="quiet" disabled={supportReadOnly} onClick={() => { setDismissMessage(message); setDismissReason(""); }}>Dismiss draft</Button></div></div> : null}
                </article>;
              })}
              {!selectedMessages.length ? <p className="muted">No messages are cached for this thread.</p> : null}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="secondary" disabled={supportReadOnly || selected.status === "closed"} onClick={openReply}><Send size={15} /> Record reply</Button>
              <Button variant="quiet" disabled={supportReadOnly || selected.status === "closed"} onClick={() => { setCloseReason(""); setCloseOpen(true); }}><Archive size={15} /> Close thread</Button>
            </div>
          </> : <div className="card-pad"><h2>No conversation selected</h2><p className="muted">Choose a communication thread from the inbox.</p></div>}
        </div>
      </Card>

      <Dialog open={composeOpen} onClose={() => { if (!busy) setComposeOpen(false); }} title={compose.threadId ? "Record reply" : "Record communication"} description="This creates an authoritative BDB OS record. It does not send through an external provider.">
        <form onSubmit={submitCommunication}>
          <div className="form-grid">
            <div className="field"><label htmlFor="communication-customer">Customer</label><select id="communication-customer" required disabled={Boolean(compose.threadId)} value={compose.customerId} onChange={(event) => setCompose({ ...compose, customerId: event.target.value })}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select></div>
            <div className="field"><label htmlFor="communication-channel">Channel</label><select id="communication-channel" disabled={Boolean(compose.threadId)} value={compose.channel} onChange={(event) => setCompose({ ...compose, channel: event.target.value as Channel })}>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></div>
            <div className="field"><label htmlFor="communication-direction">Direction</label><select id="communication-direction" disabled={Boolean(compose.threadId)} value={compose.direction} onChange={(event) => setCompose({ ...compose, direction: event.target.value as Direction, draftReview: event.target.value === "outbound" ? compose.draftReview : false })}><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
            <div className="field"><label htmlFor="communication-review">Record type</label><select id="communication-review" disabled={compose.direction !== "outbound"} value={compose.draftReview ? "review" : "final"} onChange={(event) => setCompose({ ...compose, draftReview: event.target.value === "review" })}><option value="final">Final record</option><option value="review">Draft awaiting review</option></select></div>
            <div className="field field-full"><label htmlFor="communication-subject">Subject</label><input id="communication-subject" required value={compose.subject} onChange={(event) => setCompose({ ...compose, subject: event.target.value })} placeholder="Conversation subject" /></div>
            <div className="field field-full"><label htmlFor="communication-body">Communication record</label><textarea id="communication-body" required maxLength={10000} value={compose.body} onChange={(event) => setCompose({ ...compose, body: event.target.value })} placeholder="Record what was received, sent or drafted…" style={{ minHeight: 170 }} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setComposeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || supportReadOnly}><Send size={15} /> {busy ? "Saving…" : online ? "Record communication" : "Queue communication"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(dismissMessage)} onClose={() => { if (!busy) setDismissMessage(null); }} title="Dismiss draft" description="The draft remains in history but will no longer appear as awaiting review.">
        <form onSubmit={dismissDraft}>
          <div className="field"><label htmlFor="dismiss-reason">Reason</label><textarea id="dismiss-reason" required minLength={5} maxLength={500} value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} placeholder="Why is this draft not being used?" /></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setDismissMessage(null)}>Cancel</Button><Button type="submit" disabled={busy || supportReadOnly}>Dismiss draft</Button></div>
        </form>
      </Dialog>

      <Dialog open={closeOpen} onClose={() => { if (!busy) setCloseOpen(false); }} title="Close communication thread" description="Closed threads remain readable and cannot receive new messages in Version 1.">
        <form onSubmit={closeThread}>
          <div className="field"><label htmlFor="close-reason">Reason</label><textarea id="close-reason" required minLength={5} maxLength={500} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Why is this conversation complete?" /></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={busy} onClick={() => setCloseOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || supportReadOnly}>Close thread</Button></div>
        </form>
      </Dialog>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCheck, Inbox, MessageCircleMore, Plus, Send, Sparkles } from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatTimeAgo } from "@/lib/format";
import type { Message } from "@/lib/types";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

const channelCode = { Email: "EM", WhatsApp: "WA", Instagram: "IG", Web: "WEB" } as const;

export default function CommunicationsPage() {
  const { state, sendMessage, markMessageRead, dismissMessageDraft } = useBdb();
  const [selectedId, setSelectedId] = useState(state.messages[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [form, setForm] = useState<{ customerId: string; channel: Message["channel"]; subject: string; preview: string }>({ customerId: state.customers[0]?.id ?? "", channel: "Email", subject: "", preview: "" });
  const selected = state.messages.find((item) => item.id === selectedId) ?? state.messages[0];
  const customer = state.customers.find((item) => item.id === selected?.customerId);
  const unread = state.messages.filter((item) => item.unread).length;
  const pending = state.messages.filter((item) => item.status === "approval").length;

  useEffect(() => {
    if (selected?.unread) void markMessageRead(selected.id);
  }, [markMessageRead, selected]);

  const sorted = useMemo(() => [...state.messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [state.messages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.customerId || !form.subject || !form.preview || saving) return;
    setSaving(true);
    const confirmed = await sendMessage(form);
    setSaving(false);
    if (!confirmed) return;
    setForm({ customerId: state.customers[0]?.id ?? "", channel: "Email", subject: "", preview: "" });
    setOpen(false);
  }

  function composeReply() {
    if (!selected) return;
    setForm({ customerId: selected.customerId, channel: selected.channel, subject: `Re: ${selected.subject}`, preview: "" });
    setOpen(true);
  }

  async function dismissDraft() {
    if (!selected || dismissing) return;
    setDismissing(true);
    await dismissMessageDraft(selected.id);
    setDismissing(false);
  }

  const canCompose = state.customers.length > 0;

  return (
    <>
      <PageHeader eyebrow="Unified communication record" title="Communications" description="Keep customer conversations together. External delivery integrations are not enabled yet, so new entries are recorded in BDB OS rather than sent to a provider." action={<Button disabled={!canCompose} onClick={() => setOpen(true)}><Plus size={17} /> Record message</Button>} />
      {!canCompose ? <div className="review-callout"><Inbox size={19} /><div><strong>Add a customer before recording communication</strong><p>Every message record must connect to a customer.</p></div></div> : null}
      <div className="stat-grid">
        <StatCard label="Messages" value={String(state.messages.length)} detail="Recorded conversations" icon={<Inbox size={19} />} />
        <StatCard label="Unread" value={String(unread)} detail="Needs review" icon={<MessageCircleMore size={19} />} />
        <StatCard label="Draft review" value={String(pending)} detail="Human decision required" icon={<Sparkles size={19} />} />
        <StatCard label="Handled" value={String(state.messages.filter((item) => item.status === "replied").length)} detail="Marked as replied" icon={<CheckCheck size={19} />} />
      </div>

      <Card className="inbox-layout">
        <div className="message-list">
          {sorted.map((message) => {
            const sender = state.customers.find((item) => item.id === message.customerId);
            return <button key={message.id} className={`message-row ${selected?.id === message.id ? "selected" : ""}`} onClick={() => setSelectedId(message.id)}>
              <span className="message-channel">{channelCode[message.channel]}</span>
              <span className="message-copy"><strong>{sender?.name ?? "Unknown customer"}</strong><span>{message.subject}</span><small>{message.preview}</small></span>
              <span>{message.unread ? <span className="unread-dot" /> : <small className="muted">{formatTimeAgo(message.timestamp)}</small>}</span>
            </button>;
          })}
          {sorted.length === 0 ? <div className="card-pad"><h2>No communications recorded</h2><p className="muted">Record a customer conversation when there is something worth keeping with their history.</p></div> : null}
        </div>
        <div className="message-view">
          {selected ? <>
            <div className="message-view-header">
              <div><p className="eyebrow">{selected.channel}</p><h2>{selected.subject}</h2><p className="muted small" style={{ margin: 0 }}>Customer · {customer?.name ?? "Unknown"}{customer?.company ? ` · ${customer.company}` : ""}</p></div>
              <Badge tone={selected.status === "approval" ? "gold" : selected.status === "replied" ? "green" : "neutral"}>{selected.status === "approval" ? "draft review" : selected.status}</Badge>
            </div>
            <div className="message-body"><p>{selected.preview}</p></div>
            {selected.status === "approval" ? <div className="ai-draft"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={16} /><strong>Draft requires review</strong><Badge tone="gold">Not sent</Badge></div><p>BDB OS has retained the incoming context, but no generated reply is presented as final content. Write and review the response before recording it.</p><div style={{ display: "flex", gap: 8, marginTop: 13 }}><Button onClick={composeReply}><Send size={15} /> Write reply</Button><Button variant="quiet" disabled={dismissing} onClick={() => void dismissDraft()}>{dismissing ? "Saving…" : "Dismiss draft"}</Button></div></div> : <Button variant="secondary" onClick={composeReply}><Send size={15} /> Record reply</Button>}
          </> : <div className="card-pad"><h2>No conversation selected</h2><p className="muted">Choose a message from the list.</p></div>}
        </div>
      </Card>

      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title="Record communication" description="This saves a communication record in BDB OS. It does not send through Email, WhatsApp, Instagram or another provider.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label htmlFor="message-customer">Customer</label><select id="message-customer" required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="message-channel">Channel</label><select id="message-channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value as typeof form.channel })}><option>Email</option><option>WhatsApp</option><option>Instagram</option><option>Web</option></select></div>
            <div className="field field-full"><label htmlFor="message-subject">Subject</label><input id="message-subject" required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Conversation subject" /></div>
            <div className="field field-full"><label htmlFor="message-body">Message record</label><textarea id="message-body" required value={form.preview} onChange={(event) => setForm({ ...form, preview: event.target.value })} placeholder="Record what was sent or received…" style={{ minHeight: 150 }} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}><Send size={15} /> {saving ? "Saving…" : "Record message"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

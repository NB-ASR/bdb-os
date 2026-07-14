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
  const [form, setForm] = useState<{ customerId: string; channel: Message["channel"]; subject: string; preview: string }>({ customerId: state.customers[0]?.id ?? "", channel: "Email", subject: "", preview: "" });
  const selected = state.messages.find((item) => item.id === selectedId) ?? state.messages[0];
  const customer = state.customers.find((item) => item.id === selected?.customerId);
  const unread = state.messages.filter((item) => item.unread).length;
  const pending = state.messages.filter((item) => item.status === "approval").length;

  useEffect(() => {
    if (selected?.unread) markMessageRead(selected.id);
  }, [markMessageRead, selected]);

  const sorted = useMemo(() => [...state.messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [state.messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.subject || !form.preview) return;
    sendMessage(form);
    setForm({ customerId: state.customers[0]?.id ?? "", channel: "Email", subject: "", preview: "" });
    setOpen(false);
  }

  function useDraft() {
    setForm({
      customerId: selected.customerId,
      channel: selected.channel,
      subject: `Re: ${selected.subject}`,
      preview: "Hi Daniel, thanks for checking. Yes, we can have the first concept ready by next Friday. I’ll send a short milestone plan today so everything is clear before we begin.",
    });
    setOpen(true);
  }

  return (
    <>
      <PageHeader eyebrow="Unified inbox" title="Communications" description="Every conversation in one calm workspace, with AI drafts that remain under your control." action={<Button onClick={() => setOpen(true)}><Plus size={17} /> New message</Button>} />
      <div className="stat-grid">
        <StatCard label="Messages" value={String(state.messages.length)} detail="Across four channels" icon={<Inbox size={19} />} />
        <StatCard label="Unread" value={String(unread)} detail="Needs review" icon={<MessageCircleMore size={19} />} />
        <StatCard label="Approval" value={String(pending)} detail="Human decision required" icon={<Sparkles size={19} />} />
        <StatCard label="Replied" value={String(state.messages.filter((item) => item.status === "replied").length)} detail="Conversations handled" icon={<CheckCheck size={19} />} />
      </div>

      <Card className="inbox-layout">
        <div className="message-list">
          {sorted.map((message) => {
            const sender = state.customers.find((item) => item.id === message.customerId);
            return (
              <button key={message.id} className={`message-row ${selected?.id === message.id ? "selected" : ""}`} onClick={() => setSelectedId(message.id)}>
                <span className="message-channel">{channelCode[message.channel]}</span>
                <span className="message-copy"><strong>{sender?.name ?? "Unknown"}</strong><span>{message.subject}</span><small>{message.preview}</small></span>
                <span>{message.unread ? <span className="unread-dot" /> : <small className="muted">{formatTimeAgo(message.timestamp)}</small>}</span>
              </button>
            );
          })}
        </div>
        <div className="message-view">
          {selected ? <>
            <div className="message-view-header">
              <div><p className="eyebrow">{selected.channel}</p><h2>{selected.subject}</h2><p className="muted small" style={{ margin: 0 }}>From {customer?.name} · {customer?.company}</p></div>
              <Badge tone={selected.status === "approval" ? "gold" : selected.status === "replied" ? "green" : "neutral"}>{selected.status}</Badge>
            </div>
            <div className="message-body"><p>Hi {state.settings.ownerName},</p><p>{selected.preview}</p><p>Best,<br />{customer?.name}</p></div>
            {selected.status === "approval" ? <div className="ai-draft"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={16} /><strong>Suggested reply</strong><Badge tone="gold">Review required</Badge></div><p>Hi Daniel, thanks for checking. Yes, we can have the first concept ready by next Friday. I’ll send a short milestone plan today so everything is clear before we begin.</p><div style={{ display: "flex", gap: 8, marginTop: 13 }}><Button onClick={useDraft}><Send size={15} /> Review and send</Button><Button variant="quiet" onClick={() => dismissMessageDraft(selected.id)}>Dismiss</Button></div></div> : <Button variant="secondary" onClick={() => { setForm({ customerId: selected.customerId, channel: selected.channel, subject: `Re: ${selected.subject}`, preview: "" }); setOpen(true); }}><Send size={15} /> Reply</Button>}
          </> : null}
        </div>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Compose message" description="Review the content before it is recorded as sent.">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label htmlFor="message-customer">Customer</label><select id="message-customer" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>{state.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="message-channel">Channel</label><select id="message-channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value as typeof form.channel })}><option>Email</option><option>WhatsApp</option><option>Instagram</option><option>Web</option></select></div>
            <div className="field field-full"><label htmlFor="message-subject">Subject</label><input id="message-subject" required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Message subject" /></div>
            <div className="field field-full"><label htmlFor="message-body">Message</label><textarea id="message-body" required value={form.preview} onChange={(event) => setForm({ ...form, preview: event.target.value })} placeholder="Write your message…" style={{ minHeight: 150 }} /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit"><Send size={15} /> Send message</Button></div>
        </form>
      </Dialog>
    </>
  );
}

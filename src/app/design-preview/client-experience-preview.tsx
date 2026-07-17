"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Command,
  CreditCard,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  House,
  Landmark,
  LayoutGrid,
  ListFilter,
  LockKeyhole,
  Mail,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  PieChart,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserPlus,
  UsersRound,
  WalletCards,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./preview.module.css";

type Role = "owner" | "staff";
type DepartmentId = "hub" | "customers" | "calendar" | "communications" | "accounts" | "banking" | "documents" | "reports" | "team" | "settings" | "more";
type ModalId = "customer" | "appointment" | "invoice" | "document" | "member" | null;
type Tone = "gold" | "blue" | "green" | "rose";

type Department = {
  id: DepartmentId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
  group: "daily" | "business" | "system";
};

type Customer = {
  initials: string;
  name: string;
  code: string;
  email: string;
  phone: string;
  detail: string;
  tone: Tone;
  balance: number;
  appointment: string;
  channel: string;
};

type Notify = (message: string) => void;
type OpenModal = (modal: ModalId) => void;

const departments: Department[] = [
  { id: "hub", label: "Business Hub", shortLabel: "Hub", description: "Today and next actions", icon: House, group: "daily" },
  { id: "customers", label: "Customers", shortLabel: "Customers", description: "People and connected records", icon: UsersRound, group: "daily" },
  { id: "calendar", label: "Calendar", shortLabel: "Calendar", description: "Appointments and availability", icon: CalendarDays, group: "daily" },
  { id: "communications", label: "Communications", shortLabel: "Comms", description: "One inbox across channels", icon: MessageSquareText, group: "daily" },
  { id: "accounts", label: "Accounts", shortLabel: "Accounts", description: "Invoices, payments and balances", icon: CircleDollarSign, ownerOnly: true, group: "business" },
  { id: "banking", label: "Banking", shortLabel: "Banking", description: "Feeds, matching and payouts", icon: Landmark, ownerOnly: true, group: "business" },
  { id: "documents", label: "Documents", shortLabel: "Documents", description: "Files connected to work", icon: FolderOpen, group: "business" },
  { id: "reports", label: "Reports", shortLabel: "Reports", description: "Useful insight for owners", icon: PieChart, ownerOnly: true, group: "business" },
  { id: "team", label: "Team", shortLabel: "Team", description: "Roles and responsibility", icon: UsersRound, ownerOnly: true, group: "system" },
  { id: "settings", label: "Settings", shortLabel: "Settings", description: "Workspace preferences", icon: Settings2, group: "system" },
  { id: "more", label: "More", shortLabel: "More", description: "More workspace tools", icon: MoreHorizontal, group: "system" },
];

const customers: Customer[] = [
  { initials: "MC", name: "Maya Collins", code: "CLI-0142", email: "maya.collins@example.com", phone: "+356 7900 1420", detail: "Appointment today · €420 open", tone: "gold", balance: 420, appointment: "Today, 09:30", channel: "WhatsApp" },
  { initials: "AP", name: "Adrian Pace", code: "CLI-0138", email: "adrian.pace@example.com", phone: "+356 7944 2381", detail: "Requested a new appointment time", tone: "blue", balance: 380, appointment: "Tomorrow, 11:15", channel: "Email" },
  { initials: "SR", name: "Sofia Rossi", code: "CLI-0131", email: "sofia.rossi@example.com", phone: "+356 7721 9014", detail: "Invoice paid · appointment pending", tone: "green", balance: 0, appointment: "Today, 14:00", channel: "Messenger" },
  { initials: "JM", name: "Joseph Mifsud", code: "CLI-0127", email: "joseph.mifsud@example.com", phone: "+356 9982 1140", detail: "Document requested yesterday", tone: "rose", balance: 460, appointment: "24 July, 10:00", channel: "Email" },
  { initials: "LB", name: "Leanne Borg", code: "CLI-0122", email: "leanne.borg@example.com", phone: "+356 7703 6432", detail: "No action needed", tone: "green", balance: 0, appointment: "24 July, 15:30", channel: "WhatsApp" },
];

const baseSchedule = [
  { id: "apt-1", time: "09:30", title: "Maya Collins", detail: "Consultation · Meeting room 1", state: "Confirmed" },
  { id: "apt-2", time: "11:15", title: "Adrian Pace", detail: "Follow-up · Video call", state: "Confirmed" },
  { id: "apt-3", time: "14:00", title: "Sofia Rossi", detail: "Document review · Office", state: "Pending" },
  { id: "apt-4", time: "16:30", title: "Open slot", detail: "45 minutes available", state: "Open" },
];

const baseMessages = [
  { id: "msg-1", initials: "MC", name: "Maya Collins", channel: "WhatsApp", preview: "Perfect, I will bring the documents.", time: "10m", unread: true },
  { id: "msg-2", initials: "AP", name: "Adrian Pace", channel: "Email", preview: "Could we move the call to tomorrow?", time: "1h", unread: true },
  { id: "msg-3", initials: "SR", name: "Sofia Rossi", channel: "Messenger", preview: "Thank you for confirming the payment.", time: "3h", unread: false },
  { id: "msg-4", initials: "JM", name: "Joseph Mifsud", channel: "Email", preview: "Can you resend the agreement?", time: "Yesterday", unread: false },
];

const invoiceSeed = [
  { id: "BDB-1042", customer: "Maya Collins", amount: 420, state: "Overdue", detail: "Due 16 Jul" },
  { id: "BDB-1041", customer: "Sofia Rossi", amount: 620, state: "Paid", detail: "Paid 15 Jul" },
  { id: "BDB-1040", customer: "Adrian Pace", amount: 380, state: "Sent", detail: "Due 22 Jul" },
  { id: "BDB-1039", customer: "Leanne Borg", amount: 460, state: "Draft", detail: "Edited today" },
  { id: "BDB-1038", customer: "Joseph Mifsud", amount: 460, state: "Sent", detail: "Due 28 Jul" },
];

const documentSeed = [
  { id: "doc-1", name: "Service agreement", type: "Agreement", customer: "Maya Collins", updated: "Today, 08:42", state: "Signed", size: "1.8 MB" },
  { id: "doc-2", name: "Invoice BDB-1042", type: "Invoice", customer: "Maya Collins", updated: "Yesterday", state: "Current", size: "248 KB" },
  { id: "doc-3", name: "Identity documents", type: "Customer", customer: "Adrian Pace", updated: "15 Jul", state: "Review", size: "4.2 MB" },
  { id: "doc-4", name: "Appointment notes", type: "Notes", customer: "Sofia Rossi", updated: "12 Jul", state: "Current", size: "92 KB" },
  { id: "doc-5", name: "Payment receipt", type: "Receipt", customer: "Sofia Rossi", updated: "10 Jul", state: "Paid", size: "188 KB" },
];

function BdbMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`${styles.brandMark} ${compact ? styles.brandMarkCompact : ""}`} aria-hidden="true">
      <svg viewBox="0 0 72 72" role="img">
        <circle cx="36" cy="36" r="34" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.42" />
        <path d="M21 18h15c9 0 14 4 14 10 0 4-2 7-6 9 5 1 8 5 8 10 0 8-6 12-16 12H21V18Zm10 9v7h5c3 0 5-1 5-4s-2-3-5-3h-5Zm0 15v8h6c4 0 6-1 6-4s-2-4-6-4h-6Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function PageHeading({ eyebrow, title, description, action, secondary }: { eyebrow: string; title: string; description: string; action?: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <section className={styles.pageHeading}>
      <div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      <div className={styles.headingActions}>{secondary}{action}</div>
    </section>
  );
}

function Tabs({ items, value, onChange }: { items: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void }) {
  return <div className={styles.tabs}>{items.map((item) => <button className={value === item.id ? styles.tabActive : ""} type="button" key={item.id} onClick={() => onChange(item.id)}>{item.label}{typeof item.count === "number" ? <span>{item.count}</span> : null}</button>)}</div>;
}

function EmptyState({ icon: Icon, title, copy, action }: { icon: LucideIcon; title: string; copy: string; action?: React.ReactNode }) {
  return <div className={styles.emptyState}><span><Icon size={23} /></span><strong>{title}</strong><p>{copy}</p>{action}</div>;
}

function HubView({ role, online, setActive, openModal, notify }: { role: Role; online: boolean; setActive: (id: DepartmentId) => void; openModal: OpenModal; notify: Notify }) {
  const [completed, setCompleted] = useState<string[]>([]);
  const ownerActions = [
    { id: "invoice", title: "Review overdue invoice", detail: "€420 from Maya Collins · due yesterday", meta: "Priority", icon: CircleDollarSign, target: "accounts" as DepartmentId },
    { id: "messages", title: "Reply to two new messages", detail: "Both customers are already matched", meta: "2 unread", icon: MessageSquareText, target: "communications" as DepartmentId },
    { id: "appointment", title: "Confirm Sofia’s appointment", detail: "Today at 14:00 · document review", meta: "Today", icon: CalendarDays, target: "calendar" as DepartmentId },
  ];
  const staffActions = [
    { id: "appointment", title: "Confirm Sofia’s appointment", detail: "Today at 14:00 · document review", meta: "Next", icon: CalendarDays, target: "calendar" as DepartmentId },
    { id: "messages", title: "Reply to two new messages", detail: "Both customers are already matched", meta: "2 unread", icon: MessageSquareText, target: "communications" as DepartmentId },
    { id: "notes", title: "Add notes for Maya Collins", detail: "Her 09:30 consultation is complete", meta: "Follow-up", icon: UsersRound, target: "customers" as DepartmentId },
  ];
  const actions = role === "owner" ? ownerActions : staffActions;
  const remaining = actions.filter((item) => !completed.includes(item.id));
  const primary = remaining[0] || actions[0];

  function complete(id: string, title: string) {
    setCompleted((current) => current.includes(id) ? current : [...current, id]);
    notify(`${title} marked complete in the preview.`);
  }

  return (
    <div className={styles.viewStack}>
      <section className={styles.heroCard}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Saturday, 18 July</p>
          <h1>Good morning, Niki.</h1>
          <p className={styles.heroCopy}>{remaining.length ? `${remaining.length} useful ${remaining.length === 1 ? "action is" : "actions are"} waiting. Everything else is in good shape.` : "Your important work is clear. The rest of the business is quietly organised."}</p>
          <button className={styles.primaryButton} type="button" onClick={() => setActive(primary.target)}><primary.icon size={18} /> {remaining.length ? primary.title : "Review today"}<ArrowRight size={17} /></button>
        </div>
        <div className={styles.businessPulse} aria-label={`Business pulse: ${remaining.length} actions remaining`}>
          <span className={styles.pulseRing} /><span className={styles.pulseRingInner} />
          <div className={styles.pulseCore}><BdbMark compact /><strong>{remaining.length}</strong><small>actions remaining</small></div>
          <span className={`${styles.pulseDot} ${styles.pulseDotOne}`} /><span className={`${styles.pulseDot} ${styles.pulseDotTwo}`} /><span className={`${styles.pulseDot} ${styles.pulseDotThree}`} />
        </div>
      </section>

      {!online ? <section className={styles.offlineNotice} role="status"><WifiOff size={19} /><div><strong>Working offline</strong><p>Customer records and today’s work remain available. Two preview changes are queued for sync.</p></div><span>2 queued</span></section> : null}

      <section className={styles.hubGrid}>
        <article className={styles.attentionCard}>
          <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Needs attention</p><h2>{remaining.length ? "Do these next." : "You are caught up."}</h2></div><span className={styles.countBubble}>{remaining.length}</span></div>
          <div className={styles.actionList}>
            {actions.map((item, index) => {
              const Icon = item.icon;
              const done = completed.includes(item.id);
              return <div className={`${styles.actionRow} ${index === 0 && !done ? styles.actionRowPrimary : ""} ${done ? styles.actionRowDone : ""}`} key={item.id}>
                <button className={styles.actionMain} type="button" onClick={() => setActive(item.target)}><span className={styles.actionIcon}>{done ? <Check size={19} /> : <Icon size={19} />}</span><span className={styles.actionCopy}><strong>{item.title}</strong><small>{done ? "Completed in this preview" : item.detail}</small></span><span className={styles.actionMeta}>{done ? "Done" : item.meta}</span><ChevronRight size={18} /></button>
                {!done ? <button className={styles.completeButton} type="button" onClick={() => complete(item.id, item.title)} aria-label={`Mark ${item.title} complete`}><Check size={16} /></button> : null}
              </div>;
            })}
          </div>
        </article>

        <article className={styles.todayCard}>
          <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Today</p><h2>Four appointments.</h2></div><button className={styles.textButton} type="button" onClick={() => setActive("calendar")}>Full calendar <ChevronRight size={16} /></button></div>
          <div className={styles.dayProgress}><span><i /></span><p><strong>3 of 4 confirmed</strong><small>Your day is 75% ready.</small></p></div>
          <div className={styles.todayTimeline}>{baseSchedule.slice(0, 3).map((item) => <button type="button" key={item.id} onClick={() => setActive("calendar")}><time>{item.time}</time><span className={item.state === "Pending" ? styles.timelinePending : ""} /><p><strong>{item.title}</strong><small>{item.detail.split(" · ")[0]}</small></p><em>{item.state}</em></button>)}</div>
          <button className={styles.secondaryButtonWide} type="button" onClick={() => openModal("appointment")}><Plus size={17} /> New appointment</button>
        </article>
      </section>

      <section className={styles.quickActionsSection}>
        <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Quick actions</p><h2>Start without hunting.</h2></div></div>
        <div className={styles.quickActionGrid}>
          <button type="button" onClick={() => openModal("customer")}><span><UserPlus size={20} /></span><strong>New customer</strong><small>Create one connected record</small></button>
          <button type="button" onClick={() => openModal("appointment")}><span><CalendarDays size={20} /></span><strong>Book appointment</strong><small>Choose customer and time</small></button>
          {role === "owner" ? <button type="button" onClick={() => openModal("invoice")}><span><ReceiptText size={20} /></span><strong>Create invoice</strong><small>Link it to a customer</small></button> : <button type="button" onClick={() => setActive("customers")}><span><Pencil size={20} /></span><strong>Add customer note</strong><small>Keep history complete</small></button>}
          <button type="button" onClick={() => openModal("document")}><span><Upload size={20} /></span><strong>Add document</strong><small>Attach it to real work</small></button>
        </div>
      </section>

      <section className={styles.signalGrid} aria-label="Business summary">
        <button type="button" onClick={() => setActive("calendar")}><span><CalendarDays size={18} /></span><div><small>Today</small><strong>4 appointments</strong></div><em>1 pending</em></button>
        <button type="button" onClick={() => setActive("communications")}><span><MessageSquareText size={18} /></span><div><small>Inbox</small><strong>2 unread</strong></div><em>All channels</em></button>
        {role === "owner" ? <button type="button" onClick={() => setActive("accounts")}><span><ReceiptText size={18} /></span><div><small>Outstanding</small><strong>€1,260</strong></div><em>3 invoices</em></button> : <button type="button" onClick={() => notify("Six daily actions are complete.")}><span><CheckCircle2 size={18} /></span><div><small>Completed</small><strong>6 actions</strong></div><em>Today</em></button>}
      </section>
    </div>
  );
}

function CustomersView({ role, openModal, notify }: { role: Role; openModal: OpenModal; notify: Notify }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Customer>(customers[0]);
  const [tab, setTab] = useState("overview");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<string[]>(["Prefers WhatsApp for appointment reminders."]);
  const filtered = useMemo(() => customers.filter((customer) => {
    const matches = `${customer.name} ${customer.code} ${customer.email}`.toLowerCase().includes(query.toLowerCase());
    if (filter === "balance") return matches && customer.balance > 0;
    if (filter === "today") return matches && customer.appointment.startsWith("Today");
    return matches;
  }), [filter, query]);

  function saveNote() {
    if (!note.trim()) return;
    setNotes((current) => [note.trim(), ...current]);
    setNote(""); setNoteOpen(false); notify(`Note added to ${selected.name}.`);
  }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Customers" title="Every relationship, connected." description="Appointments, invoices, messages, files and notes remain attached to one clear customer record." secondary={<button className={styles.secondaryButton} type="button" onClick={() => notify("Customer import preview opened.")}><Upload size={16} /> Import</button>} action={<button className={styles.primaryButton} type="button" onClick={() => openModal("customer")}><Plus size={17} /> New customer</button>} />
    <div className={styles.customerLayout}>
      <section className={styles.listPanel}>
        <label className={styles.searchField}><Search size={18} /><input value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} aria-label="Search customers" placeholder="Search name, code or email" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button> : null}</label>
        <div className={styles.filterChips}><button className={filter === "all" ? styles.filterChipActive : ""} type="button" onClick={() => setFilter("all")}>All</button><button className={filter === "today" ? styles.filterChipActive : ""} type="button" onClick={() => setFilter("today")}>Today</button><button className={filter === "balance" ? styles.filterChipActive : ""} type="button" onClick={() => setFilter("balance")}>Open balance</button></div>
        <div className={styles.listSummary}><span>{filtered.length} customers</span><button type="button" onClick={() => notify("Customer sort changed to recent activity.")}>Recent <ChevronDown size={14} /></button></div>
        <div className={styles.customerList}>{filtered.length ? filtered.map((customer) => <button className={`${styles.customerRow} ${selected.code === customer.code ? styles.customerRowActive : ""}`} type="button" key={customer.code} onClick={() => { setSelected(customer); setTab("overview"); }}><span className={`${styles.avatar} ${styles[`avatar${customer.tone}`]}`}>{customer.initials}</span><span><strong>{customer.name}</strong><small>{customer.detail}</small></span>{customer.balance > 0 ? <em>€{customer.balance}</em> : <CheckCircle2 size={17} />} </button>) : <EmptyState icon={Search} title="No customers found" copy="Try another name, client code or email address." />}</div>
      </section>
      <section className={styles.detailPanel}>
        <div className={styles.customerHero}><span className={`${styles.avatar} ${styles.avatarLarge} ${styles[`avatar${selected.tone}`]}`}>{selected.initials}</span><div><p className={styles.eyebrow}>{selected.code}</p><h2>{selected.name}</h2><p>{selected.email} · {selected.phone}</p></div><button className={styles.iconButton} type="button" aria-label="Customer options" onClick={() => notify("Customer options opened.")}><MoreHorizontal size={20} /></button></div>
        <div className={styles.customerActions}><button type="button" onClick={() => notify(`Conversation with ${selected.name} opened.`)}><MessageSquareText size={17} /> Message</button><button type="button" onClick={() => openModal("appointment")}><CalendarDays size={17} /> Book</button><button type="button" onClick={() => setNoteOpen((value) => !value)}><Pencil size={17} /> Add note</button>{role === "owner" ? <button type="button" onClick={() => openModal("invoice")}><ReceiptText size={17} /> Invoice</button> : null}</div>
        {noteOpen ? <div className={styles.inlineComposer}><textarea value={note} onChange={(event: { target: { value: string } }) => setNote(event.target.value)} placeholder={`Add a private note about ${selected.name}`} /><div><button className={styles.textButton} type="button" onClick={() => setNoteOpen(false)}>Cancel</button><button className={styles.secondaryButton} type="button" onClick={saveNote}><Check size={16} /> Save note</button></div></div> : null}
        <Tabs value={tab} onChange={setTab} items={[{ id: "overview", label: "Overview" }, { id: "activity", label: "Activity", count: 6 }, { id: "billing", label: "Billing" }, { id: "documents", label: "Documents", count: 3 }]} />
        {tab === "overview" ? <>
          <div className={styles.customerStats}><div><small>Next appointment</small><strong>{selected.appointment}</strong></div><div><small>Open balance</small><strong>{selected.balance ? `€${selected.balance}` : "Clear"}</strong></div><div><small>Preferred channel</small><strong>{selected.channel}</strong></div></div>
          <div className={styles.recordSection}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Recent history</p><h3>Connected records</h3></div><button className={styles.textButton} type="button" onClick={() => setTab("activity")}>View all <ChevronRight size={15} /></button></div><div className={styles.recordRow}><span><MessageSquareText size={17} /></span><div><strong>{selected.channel} message received</strong><small>“I will bring the documents.”</small></div><time>10m</time></div><div className={styles.recordRow}><span><FileText size={17} /></span><div><strong>Service agreement added</strong><small>Linked to next appointment</small></div><time>Yesterday</time></div><div className={styles.recordRow}><span><CircleDollarSign size={17} /></span><div><strong>Invoice BDB-1042 sent</strong><small>€420 · due tomorrow</small></div><time>12 Jul</time></div></div>
        </> : null}
        {tab === "activity" ? <div className={styles.activityList}>{[...notes, "Appointment confirmed for 09:30", "Invoice reminder sent", "Service agreement uploaded", "Customer record updated"].map((item, index) => <div className={styles.activityItem} key={`${item}-${index}`}><span>{index < notes.length ? <Pencil size={16} /> : <Activity size={16} />}</span><div><strong>{item}</strong><small>{index === 0 ? "Just now" : `${index + 1} days ago`}</small></div></div>)}</div> : null}
        {tab === "billing" ? <div className={styles.customerTabGrid}><div className={styles.miniMetric}><small>Outstanding</small><strong>€{selected.balance}</strong><span>{selected.balance ? "Needs attention" : "Nothing due"}</span></div><div className={styles.miniMetric}><small>Lifetime value</small><strong>€3,840</strong><span>8 paid invoices</span></div><button className={styles.connectedCard} type="button" onClick={() => notify("Invoice BDB-1042 opened.")}><ReceiptText size={20} /><span><strong>BDB-1042</strong><small>€420 · due tomorrow</small></span><ChevronRight size={17} /></button></div> : null}
        {tab === "documents" ? <div className={styles.documentMiniList}>{documentSeed.slice(0, 3).map((document) => <button type="button" key={document.id} onClick={() => notify(`${document.name} opened.`)}><span><FileText size={18} /></span><div><strong>{document.name}</strong><small>{document.state} · {document.size}</small></div><ChevronRight size={17} /></button>)}</div> : null}
      </section>
    </div>
  </div>;
}

function CalendarView({ openModal, notify }: { openModal: OpenModal; notify: Notify }) {
  const [selectedDay, setSelectedDay] = useState("Sat 18");
  const [mode, setMode] = useState("day");
  const [confirmed, setConfirmed] = useState<string[]>(["apt-1", "apt-2"]);
  const [selectedAppointment, setSelectedAppointment] = useState(baseSchedule[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openAppointment(item: typeof baseSchedule[number]) { setSelectedAppointment(item); setDrawerOpen(true); }
  function confirm(id: string, name: string) { setConfirmed((current) => current.includes(id) ? current : [...current, id]); notify(`${name} is confirmed.`); }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Calendar" title="Your time, clearly organised." description="Appointments, availability and customer context stay together without turning scheduling into a puzzle." secondary={<div className={styles.segmented}><button className={mode === "day" ? styles.segmentActive : ""} type="button" onClick={() => setMode("day")}>Day</button><button className={mode === "week" ? styles.segmentActive : ""} type="button" onClick={() => setMode("week")}>Week</button></div>} action={<button className={styles.primaryButton} type="button" onClick={() => openModal("appointment")}><Plus size={17} /> New appointment</button>} />
    <section className={styles.calendarPanel}>
      <div className={styles.calendarTopline}><button className={styles.iconButton} type="button" onClick={() => notify("Previous week shown.")}><ChevronLeft size={19} /></button><div><strong>13–19 July</strong><span>4 appointments · 1 open slot today</span></div><button className={styles.iconButton} type="button" onClick={() => notify("Next week shown.")}><ChevronRight size={19} /></button><button className={styles.secondaryButton} type="button" onClick={() => notify("Availability editor opened.")}><Clock3 size={16} /> Availability</button></div>
      <div className={styles.dateStrip}>{["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"].map((day, index) => <button className={day === selectedDay ? styles.dateActive : ""} type="button" key={day} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay}><span>{day.split(" ")[0]}</span><strong>{day.split(" ")[1]}</strong><i className={index === 5 ? styles.dayBusy : index === 4 ? styles.dayMedium : ""} /></button>)}</div>
      {mode === "day" ? <div className={styles.schedule}>{baseSchedule.map((item) => {
        const state = item.state === "Pending" && confirmed.includes(item.id) ? "Confirmed" : item.state;
        return <article className={styles.scheduleRow} key={item.id}><time>{item.time}</time><span className={`${styles.timelineDot} ${state === "Pending" ? styles.timelinePending : state === "Open" ? styles.timelineOpen : ""}`} /><button className={styles.scheduleMain} type="button" onClick={() => openAppointment(item)}><strong>{item.title}</strong><small>{item.detail}</small></button>{state === "Pending" ? <button type="button" className={styles.confirmButton} onClick={() => confirm(item.id, item.title)}><Check size={16} /> Confirm</button> : state === "Open" ? <button type="button" className={styles.bookSlotButton} onClick={() => openModal("appointment")}><Plus size={16} /> Book slot</button> : <span className={styles.statePill}>{state}</span>}</article>;
      })}</div> : <div className={styles.weekGrid}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => <div key={day}><strong>{day}</strong>{index === 5 ? <><button type="button" onClick={() => openAppointment(baseSchedule[0])}><time>09:30</time><span>Maya Collins</span></button><button type="button" className={styles.weekPending} onClick={() => openAppointment(baseSchedule[2])}><time>14:00</time><span>Sofia Rossi</span></button></> : index === 4 ? <button type="button"><time>11:15</time><span>Adrian Pace</span></button> : <span className={styles.weekEmpty}>Available</span>}</div>)}</div>}
    </section>
    {drawerOpen ? <aside className={styles.contextDrawer}><header><div><p className={styles.eyebrow}>Appointment</p><h2>{selectedAppointment.title}</h2></div><button className={styles.iconButton} type="button" onClick={() => setDrawerOpen(false)}><X size={19} /></button></header><div className={styles.drawerBody}><div className={styles.drawerTime}><CalendarDays size={19} /><span><strong>Saturday, 18 July</strong><small>{selectedAppointment.time} · 45 minutes</small></span></div><div className={styles.drawerTime}><UsersRound size={19} /><span><strong>{selectedAppointment.title}</strong><small>Linked customer record</small></span></div><label>Internal note<textarea defaultValue="Bring the signed agreement and review payment options." /></label></div><footer><button className={styles.secondaryButton} type="button" onClick={() => notify("Reschedule flow opened.")}>Reschedule</button><button className={styles.primaryButton} type="button" onClick={() => { confirm(selectedAppointment.id, selectedAppointment.title); setDrawerOpen(false); }}><Check size={17} /> Confirm</button></footer></aside> : null}
  </div>;
}

function CommunicationsView({ notify }: { notify: Notify }) {
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(baseMessages[0].id);
  const [draft, setDraft] = useState("Hi Maya, that’s perfect. We’ll have everything ready for your appointment at 09:30. See you then.");
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<{ id: string; text: string }[]>([]);
  const selected = baseMessages.find((message) => message.id === selectedId) || baseMessages[0];
  const filtered = baseMessages.filter((message) => filter === "unread" ? message.unread : filter === "whatsapp" ? message.channel === "WhatsApp" : true);

  function sendReply() {
    const text = reply.trim();
    if (!text) return;
    setSent((current) => [...current, { id: `${Date.now()}`, text }]);
    setReply(""); notify("Preview message added to the conversation. Nothing was sent externally.");
  }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Communications" title="One inbox. Every customer." description="BDB identifies the person and keeps the conversation connected, regardless of which platform they used." secondary={<button className={styles.secondaryButton} type="button" onClick={() => notify("Assignment filter opened.")}><ListFilter size={16} /> Assignments</button>} action={<button className={styles.primaryButton} type="button" onClick={() => notify("New message composer opened.")}><Pencil size={17} /> New message</button>} />
    <section className={styles.inboxPanel}>
      <div className={styles.inboxList}><label className={styles.searchField}><Search size={18} /><input aria-label="Search conversations" placeholder="Search conversations" /></label><Tabs value={filter} onChange={setFilter} items={[{ id: "all", label: "All", count: 4 }, { id: "unread", label: "Unread", count: 2 }, { id: "whatsapp", label: "WhatsApp" }]} />{filtered.map((message) => <button className={`${styles.messageRow} ${selected.id === message.id ? styles.messageRowActive : ""}`} type="button" key={message.id} onClick={() => { setSelectedId(message.id); setDraft(`Hi ${message.name.split(" ")[0]}, thanks for your message. I’ll help with that and confirm the next step shortly.`); }}><span className={styles.avatar}>{message.initials}</span><span><strong>{message.name}{message.unread ? <i /> : null}</strong><small>{message.channel} · {message.preview}</small></span><time>{message.time}</time></button>)}</div>
      <div className={styles.conversation}><header><div><span className={styles.avatar}>{selected.initials}</span><div><strong>{selected.name}</strong><small>{selected.channel} · linked customer</small></div></div><div><button className={styles.iconButton} type="button" aria-label="Open customer" onClick={() => notify(`${selected.name}'s customer record opened.`)}><UsersRound size={19} /></button><button className={styles.iconButton} type="button" aria-label="Conversation options"><MoreHorizontal size={20} /></button></div></header><div className={styles.messageCanvas}><div className={styles.messageBubble}><p>{selected.preview}</p><small>{selected.time} ago · {selected.channel}</small></div><div className={styles.aiDraft}><div><Sparkles size={17} /><span><strong>Suggested reply</strong><small>AI assists. You decide.</small></span></div><textarea value={draft} onChange={(event: { target: { value: string } }) => setDraft(event.target.value)} aria-label="Suggested reply draft" /><div><button type="button" className={styles.textButton} onClick={() => setDraft("")}>Discard</button><button type="button" className={styles.secondaryButton} onClick={() => { setReply(draft); notify("Draft inserted into the composer for review."); }}><Check size={16} /> Insert draft</button></div></div>{sent.map((message) => <div className={styles.sentBubble} key={message.id}><p>{message.text}</p><small>Just now · preview only</small></div>)}</div><div className={styles.composer}><button className={styles.iconButton} type="button" aria-label="Attach file" onClick={() => notify("Attachment picker opened.")}><Paperclip size={19} /></button><input value={reply} onChange={(event: { target: { value: string } }) => setReply(event.target.value)} onKeyDown={(event: { key: string; preventDefault: () => void }) => { if (event.key === "Enter") { event.preventDefault(); sendReply(); } }} aria-label="Write a reply" placeholder={`Reply to ${selected.name}`} /><button className={styles.sendButton} type="button" onClick={sendReply}><Send size={17} /><span>Send</span></button></div></div>
    </section>
  </div>;
}

function AccountsView({ openModal, notify }: { openModal: OpenModal; notify: Notify }) {
  const [tab, setTab] = useState("invoices");
  const [statusFilter, setStatusFilter] = useState("all");
  const [invoices, setInvoices] = useState(invoiceSeed);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = invoices.find((invoice) => invoice.id === selectedId);
  const filtered = invoices.filter((invoice) => statusFilter === "all" ? true : invoice.state.toLowerCase() === statusFilter);
  const outstanding = invoices.filter((invoice) => invoice.state !== "Paid").reduce((sum, invoice) => sum + invoice.amount, 0);

  function markPaid(id: string) { setInvoices((current) => current.map((invoice) => invoice.id === id ? { ...invoice, state: "Paid", detail: "Paid just now" } : invoice)); notify(`${id} marked paid in the preview.`); }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Accounts" title="Money made understandable." description="See what was paid, what is due and what needs a human decision without forcing business owners to think like accountants." secondary={<button className={styles.secondaryButton} type="button" onClick={() => notify("Statement export prepared.")}><Upload size={16} /> Export</button>} action={<button className={styles.primaryButton} type="button" onClick={() => openModal("invoice")}><Plus size={17} /> New invoice</button>} />
    <section className={styles.moneyGrid}><article className={styles.balanceCard}><span><CircleDollarSign size={21} /></span><small>Outstanding</small><strong>€{outstanding.toLocaleString()}</strong><p>Across {invoices.filter((invoice) => invoice.state !== "Paid").length} open invoices</p><button type="button" onClick={() => setStatusFilter("overdue")}>€420 overdue <ArrowRight size={15} /></button></article><article className={styles.moneyCard}><span><CheckCircle2 size={20} /></span><small>Received this month</small><strong>€8,940</strong><p>12 invoices paid</p><i className={styles.metricUp}>+8.4%</i></article><article className={styles.moneyCard}><span><Clock3 size={20} /></span><small>Due this week</small><strong>€840</strong><p>2 invoices</p><i>Next due tomorrow</i></article><article className={styles.moneyCard}><span><RefreshCw size={20} /></span><small>Recurring</small><strong>4</strong><p>Active schedules</p><i>€1,920 monthly</i></article></section>
    <section className={styles.tablePanel}><div className={styles.tableHeader}><Tabs value={tab} onChange={setTab} items={[{ id: "invoices", label: "Invoices", count: invoices.length }, { id: "payments", label: "Payments", count: 12 }, { id: "recurring", label: "Recurring", count: 4 }]} /><div className={styles.tableActions}><select value={statusFilter} onChange={(event: { target: { value: string } }) => setStatusFilter(event.target.value)} aria-label="Filter invoice status"><option value="all">All statuses</option><option value="overdue">Overdue</option><option value="sent">Sent</option><option value="draft">Draft</option><option value="paid">Paid</option></select><button className={styles.iconButton} type="button"><Filter size={17} /></button></div></div>
      {tab === "invoices" ? <div className={styles.invoiceList}>{filtered.map((invoice) => <button className={styles.invoiceRow} type="button" key={invoice.id} onClick={() => setSelectedId(invoice.id)}><span className={styles.invoiceIcon}><ReceiptText size={17} /></span><div><strong>{invoice.id}</strong><small>{invoice.customer}</small></div><div className={styles.invoiceAmount}><strong>€{invoice.amount}</strong><small>{invoice.detail}</small></div><span className={`${styles.statePill} ${styles[`state${invoice.state}`]}`}>{invoice.state}</span><ChevronRight size={17} /></button>)}</div> : null}
      {tab === "payments" ? <div className={styles.paymentList}>{["Sofia Rossi · €620", "Harbour Studio · €1,240", "Leanne Borg · €460"].map((item, index) => <div key={item}><span><CheckCircle2 size={18} /></span><div><strong>{item}</strong><small>{index === 0 ? "Card payment · 15 Jul" : "Bank transfer · 12 Jul"}</small></div><em>Reconciled</em></div>)}</div> : null}
      {tab === "recurring" ? <div className={styles.recurringGrid}>{["Monthly support", "Quarterly consultation", "Annual service", "Retainer"].map((item, index) => <button type="button" key={item} onClick={() => notify(`${item} schedule opened.`)}><RefreshCw size={19} /><span><strong>{item}</strong><small>Next invoice {20 + index} Jul · €{240 + index * 80}</small></span><ChevronRight size={17} /></button>)}</div> : null}
    </section>
    {selected ? <aside className={styles.contextDrawer}><header><div><p className={styles.eyebrow}>Invoice</p><h2>{selected.id}</h2></div><button className={styles.iconButton} type="button" onClick={() => setSelectedId(null)}><X size={19} /></button></header><div className={styles.drawerBody}><div className={styles.invoicePreview}><BdbMark compact /><span><small>Amount</small><strong>€{selected.amount}</strong></span><span className={`${styles.statePill} ${styles[`state${selected.state}`]}`}>{selected.state}</span></div><dl><div><dt>Customer</dt><dd>{selected.customer}</dd></div><div><dt>Issued</dt><dd>12 July 2026</dd></div><div><dt>Due</dt><dd>{selected.detail}</dd></div><div><dt>Payment link</dt><dd>Active</dd></div></dl><button className={styles.connectedCard} type="button" onClick={() => notify(`${selected.customer}'s customer record opened.`)}><UsersRound size={20} /><span><strong>{selected.customer}</strong><small>Open connected customer</small></span><ChevronRight size={17} /></button></div><footer><button className={styles.secondaryButton} type="button" onClick={() => notify("Invoice reminder queued.")}><Mail size={16} /> Send reminder</button>{selected.state !== "Paid" ? <button className={styles.primaryButton} type="button" onClick={() => { markPaid(selected.id); setSelectedId(null); }}><Check size={17} /> Mark paid</button> : null}</footer></aside> : null}
  </div>;
}

function BankingView({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState("reconcile");
  const [syncing, setSyncing] = useState(false);
  const [matched, setMatched] = useState<string[]>(["txn-2"]);
  const transactions = [
    { id: "txn-1", date: "Today", merchant: "Maya Collins", detail: "Incoming transfer", amount: 420, suggestion: "BDB-1042" },
    { id: "txn-2", date: "Yesterday", merchant: "Stripe Payments", detail: "Card settlement", amount: 620, suggestion: "BDB-1041" },
    { id: "txn-3", date: "16 Jul", merchant: "Office Supplies Ltd", detail: "Card purchase", amount: -86.4, suggestion: "Office expense" },
    { id: "txn-4", date: "15 Jul", merchant: "Harbour Studio", detail: "Incoming transfer", amount: 1240, suggestion: "BDB-1036" },
  ];
  function sync() { setSyncing(true); setTimeout(() => { setSyncing(false); notify("Bank feeds refreshed. No production account was contacted."); }, 900); }
  function toggleMatch(id: string) { setMatched((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Banking" title="Confidence around every movement." description="Bank feeds, matching and payouts remain understandable, reviewable and under human control." action={<button className={styles.primaryButton} type="button" onClick={sync}><RefreshCw className={syncing ? styles.spin : ""} size={17} /> {syncing ? "Refreshing" : "Refresh feeds"}</button>} />
    <section className={styles.bankSummary}><article><span><WalletCards size={20} /></span><div><small>Available balance</small><strong>€24,860</strong><p>Across 2 connected accounts</p></div></article><article><span><RefreshCw size={20} /></span><div><small>Needs reconciliation</small><strong>{transactions.length - matched.length}</strong><p>Human decisions remaining</p></div></article><article><span><ShieldCheck size={20} /></span><div><small>Payout confidence</small><strong>High</strong><p>All required checks passed</p></div></article></section>
    <section className={styles.bankingLayout}><div className={styles.bankMain}><Tabs value={tab} onChange={setTab} items={[{ id: "reconcile", label: "Reconcile", count: transactions.length - matched.length }, { id: "feed", label: "Bank feed" }, { id: "payouts", label: "Payouts" }]} />
      {tab === "reconcile" ? <div className={styles.transactionList}>{transactions.map((transaction) => { const isMatched = matched.includes(transaction.id); return <div className={`${styles.transactionRow} ${isMatched ? styles.transactionMatched : ""}`} key={transaction.id}><span className={styles.transactionIcon}>{transaction.amount > 0 ? <ArrowLeft size={17} /> : <CreditCard size={17} />}</span><div><strong>{transaction.merchant}</strong><small>{transaction.date} · {transaction.detail}</small></div><strong className={transaction.amount < 0 ? styles.negativeAmount : ""}>{transaction.amount < 0 ? "−" : "+"}€{Math.abs(transaction.amount).toFixed(2)}</strong><div className={styles.matchSuggestion}><small>{isMatched ? "Matched to" : "Suggested match"}</small><span>{transaction.suggestion}</span></div><button className={isMatched ? styles.matchedButton : styles.matchButton} type="button" onClick={() => toggleMatch(transaction.id)}>{isMatched ? <><Check size={15} /> Matched</> : "Review"}</button></div>; })}</div> : null}
      {tab === "feed" ? <div className={styles.bankFeed}>{transactions.map((transaction) => <div key={transaction.id}><span className={styles.transactionIcon}><Banknote size={17} /></span><div><strong>{transaction.merchant}</strong><small>{transaction.date} · Harbour & Stone Current</small></div><strong>{transaction.amount < 0 ? "−" : "+"}€{Math.abs(transaction.amount).toFixed(2)}</strong></div>)}</div> : null}
      {tab === "payouts" ? <div className={styles.payoutGrid}><article><p className={styles.eyebrow}>Next payout</p><strong>€3,420</strong><span>Expected Monday, 20 July</span><button className={styles.secondaryButton} type="button" onClick={() => notify("Payout detail opened.")}>View breakdown</button></article><article><p className={styles.eyebrow}>Recent payout</p><strong>€2,840</strong><span>Completed 15 July</span><span className={styles.verifiedLine}><ShieldCheck size={16} /> Verified</span></article></div> : null}
    </div><aside className={styles.bankAccounts}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Connected accounts</p><h3>Live status</h3></div></div>{[{ name: "Harbour & Stone Current", ending: "4821", balance: "€18,420", status: "Connected" }, { name: "Business Reserve", ending: "1189", balance: "€6,440", status: "Connected" }].map((account) => <button type="button" key={account.ending} onClick={() => notify(`${account.name} feed opened.`)}><span><Landmark size={19} /></span><div><strong>{account.name}</strong><small>•••• {account.ending} · {account.status}</small></div><em>{account.balance}</em><ChevronRight size={17} /></button>)}<button className={styles.addConnection} type="button" onClick={() => notify("Secure bank connection flow opened.")}><Plus size={17} /> Connect another account</button><div className={styles.confidenceCard}><ShieldCheck size={21} /><div><strong>Connection health: strong</strong><p>Feeds updated two minutes ago. No authentication issues detected.</p></div></div></aside></section>
  </div>;
}

function DocumentsView({ openModal, notify }: { openModal: OpenModal; notify: Notify }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starred, setStarred] = useState<string[]>(["doc-1"]);
  const selected = documentSeed.find((document) => document.id === selectedId);
  const filtered = documentSeed.filter((document) => `${document.name} ${document.customer}`.toLowerCase().includes(query.toLowerCase()) && (category === "all" || document.type.toLowerCase() === category));

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Documents" title="Every file has a reason to exist." description="Contracts, invoices, forms and notes stay connected to the customer and work they belong to." secondary={<div className={styles.segmented}><button className={view === "list" ? styles.segmentActive : ""} type="button" onClick={() => setView("list")}><ListFilter size={16} /></button><button className={view === "grid" ? styles.segmentActive : ""} type="button" onClick={() => setView("grid")}><LayoutGrid size={16} /></button></div>} action={<button className={styles.primaryButton} type="button" onClick={() => openModal("document")}><Upload size={17} /> Upload document</button>} />
    <section className={styles.documentToolbar}><label className={styles.searchField}><Search size={18} /><input value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} placeholder="Search documents or customers" /></label><div className={styles.filterChips}>{["all", "agreement", "invoice", "customer", "notes", "receipt"].map((item) => <button className={category === item ? styles.filterChipActive : ""} type="button" key={item} onClick={() => setCategory(item)}>{item === "all" ? "All files" : item[0].toUpperCase() + item.slice(1)}</button>)}</div></section>
    {filtered.length ? view === "list" ? <section className={styles.documentTable}><div className={styles.documentHeader}><span>Name</span><span>Customer</span><span>Updated</span><span>Status</span><span /></div>{filtered.map((document) => <div className={styles.documentRow} key={document.id}><button className={styles.documentName} type="button" onClick={() => setSelectedId(document.id)}><span><FileText size={19} /></span><div><strong>{document.name}</strong><small>{document.type} · {document.size}</small></div></button><span>{document.customer}</span><span>{document.updated}</span><span className={styles.statePill}>{document.state}</span><button className={`${styles.starButton} ${starred.includes(document.id) ? styles.starActive : ""}`} type="button" onClick={() => setStarred((current) => current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id])} aria-label="Toggle favourite"><Sparkles size={16} /></button></div>)}</section> : <section className={styles.documentGrid}>{filtered.map((document) => <button type="button" key={document.id} onClick={() => setSelectedId(document.id)}><span><FileText size={24} /></span><strong>{document.name}</strong><small>{document.customer}</small><em>{document.state} · {document.size}</em></button>)}</section> : <EmptyState icon={FolderOpen} title="No documents found" copy="Try another search or upload a new file." action={<button className={styles.primaryButton} type="button" onClick={() => openModal("document")}><Upload size={16} /> Upload</button>} />}
    {selected ? <aside className={styles.contextDrawer}><header><div><p className={styles.eyebrow}>{selected.type}</p><h2>{selected.name}</h2></div><button className={styles.iconButton} type="button" onClick={() => setSelectedId(null)}><X size={19} /></button></header><div className={styles.drawerBody}><div className={styles.documentPreview}><FileText size={42} /><strong>{selected.name}</strong><small>{selected.size} · PDF preview</small></div><dl><div><dt>Customer</dt><dd>{selected.customer}</dd></div><div><dt>Updated</dt><dd>{selected.updated}</dd></div><div><dt>Status</dt><dd>{selected.state}</dd></div><div><dt>Offline</dt><dd>Available locally</dd></div></dl><button className={styles.connectedCard} type="button" onClick={() => notify(`${selected.customer}'s record opened.`)}><UsersRound size={20} /><span><strong>{selected.customer}</strong><small>Open connected customer</small></span><ChevronRight size={17} /></button></div><footer><button className={styles.secondaryButton} type="button" onClick={() => notify("Document share panel opened.")}><Send size={16} /> Share</button><button className={styles.primaryButton} type="button" onClick={() => notify("Document downloaded for preview.")}><ArrowRight size={17} /> Open</button></footer></aside> : null}
  </div>;
}

function ReportsView({ notify }: { notify: Notify }) {
  const [period, setPeriod] = useState("month");
  const [metric, setMetric] = useState("revenue");
  const [compare, setCompare] = useState(true);
  const chart = metric === "revenue" ? [42, 58, 48, 72, 66, 84, 78, 92, 86, 96, 88, 100] : metric === "appointments" ? [52, 44, 62, 58, 70, 66, 72, 80, 76, 88, 82, 94] : [80, 75, 72, 66, 62, 58, 52, 48, 44, 39, 34, 28];

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Reports" title="Clarity without metric tourism." description="The owner sees trends that support decisions, not a wall of charts waiting to be admired and ignored." secondary={<label className={styles.compareToggle}><input type="checkbox" checked={compare} onChange={() => setCompare((value) => !value)} /><span /> Compare previous</label>} action={<select className={styles.periodSelect} value={period} onChange={(event: { target: { value: string } }) => setPeriod(event.target.value)} aria-label="Report period"><option value="week">This week</option><option value="month">This month</option><option value="quarter">This quarter</option></select>} />
    <section className={styles.reportMetrics}><button className={metric === "revenue" ? styles.reportMetricActive : ""} type="button" onClick={() => setMetric("revenue")}><small>Revenue</small><strong>€24,860</strong><span className={styles.metricUp}>+8.4% vs previous</span></button><button className={metric === "appointments" ? styles.reportMetricActive : ""} type="button" onClick={() => setMetric("appointments")}><small>Appointments</small><strong>84</strong><span className={styles.metricUp}>+12 confirmed</span></button><button className={metric === "outstanding" ? styles.reportMetricActive : ""} type="button" onClick={() => setMetric("outstanding")}><small>Outstanding</small><strong>€1,260</strong><span className={styles.metricDown}>−18% vs previous</span></button><button type="button" onClick={() => notify("Customer growth report opened.")}><small>Active customers</small><strong>128</strong><span>+6 this month</span></button></section>
    <section className={styles.reportLayout}><article className={styles.chartCard}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>{period}</p><h2>{metric === "revenue" ? "Revenue movement" : metric === "appointments" ? "Appointment volume" : "Outstanding balance"}</h2></div><button className={styles.textButton} type="button" onClick={() => notify("Detailed report opened.")}>View detail <ChevronRight size={16} /></button></div><div className={styles.barChart}>{chart.map((height, index) => <div key={`${height}-${index}`}><span style={{ height: `${height}%` }} /><i style={{ height: `${compare ? Math.max(15, height - (index % 3) * 8 - 6) : 0}%` }} /><em>{index + 1}</em></div>)}</div><div className={styles.chartLegend}><span><i className={styles.legendCurrent} /> Current period</span>{compare ? <span><i className={styles.legendPrevious} /> Previous period</span> : null}</div></article><aside className={styles.insightPanel}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Useful signals</p><h3>What deserves attention</h3></div></div><button type="button" onClick={() => notify("Overdue invoice report opened.")}><span className={styles.insightIcon}><CircleDollarSign size={18} /></span><div><strong>Overdue value is falling</strong><small>18% lower than last month</small></div><ChevronRight size={17} /></button><button type="button" onClick={() => notify("Calendar utilisation report opened.")}><span className={styles.insightIcon}><CalendarDays size={18} /></span><div><strong>Thursday has spare capacity</strong><small>Three bookable slots remain</small></div><ChevronRight size={17} /></button><button type="button" onClick={() => notify("Customer retention report opened.")}><span className={styles.insightIcon}><UsersRound size={18} /></span><div><strong>Repeat bookings are up</strong><small>12 customers returned this month</small></div><ChevronRight size={17} /></button></aside></section>
  </div>;
}

function TeamView({ openModal, notify }: { openModal: OpenModal; notify: Notify }) {
  const [selectedRole, setSelectedRole] = useState("manager");
  const [activeMembers, setActiveMembers] = useState(["Niki Bianchini", "Elena Vella", "Daniel Camilleri"]);
  const members = [{ name: "Niki Bianchini", initials: "NB", role: "Owner", detail: "Full workspace access", tone: "gold" }, { name: "Elena Vella", initials: "EV", role: "Manager", detail: "Customers, calendar, communications, reports", tone: "blue" }, { name: "Daniel Camilleri", initials: "DC", role: "Staff", detail: "Customers, calendar and communications", tone: "green" }];
  function toggleMember(name: string) { setActiveMembers((current) => current.includes(name) ? current.filter((member) => member !== name) : [...current, name]); notify(`${name}'s preview access changed.`); }

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Team" title="Responsibility should be obvious." description="People see the tools their role requires, while ownership and sensitive financial access remain explicit." action={<button className={styles.primaryButton} type="button" onClick={() => openModal("member")}><UserPlus size={17} /> Invite member</button>} />
    <section className={styles.teamLayout}><div className={styles.teamList}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Members</p><h2>Three active people</h2></div><button className={styles.iconButton} type="button"><Filter size={17} /></button></div>{members.map((member) => { const active = activeMembers.includes(member.name); return <div className={`${styles.memberRow} ${!active ? styles.memberInactive : ""}`} key={member.name}><span className={`${styles.avatar} ${styles[`avatar${member.tone}`]}`}>{member.initials}</span><div><strong>{member.name}</strong><small>{member.role} · {member.detail}</small></div><span className={styles.statePill}>{active ? "Active" : "Inactive"}</span><button className={styles.iconButton} type="button" onClick={() => toggleMember(member.name)} aria-label={`Toggle ${member.name} access`}><MoreHorizontal size={18} /></button></div>; })}</div><aside className={styles.permissionPanel}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Role preview</p><h3>What each role sees</h3></div></div><div className={styles.roleCards}>{["owner", "manager", "staff"].map((role) => <button className={selectedRole === role ? styles.roleCardActive : ""} type="button" key={role} onClick={() => setSelectedRole(role)}><span>{role === "owner" ? <ShieldCheck size={19} /> : role === "manager" ? <SlidersHorizontal size={19} /> : <UsersRound size={19} />}</span><div><strong>{role[0].toUpperCase() + role.slice(1)}</strong><small>{role === "owner" ? "Everything except Founder Admin" : role === "manager" ? "Daily work and selected reports" : "Daily customer work only"}</small></div></button>)}</div><div className={styles.permissionMatrix}>{["Customers", "Calendar", "Communications", "Documents", "Accounts", "Banking", "Reports", "Team settings"].map((permission) => { const allowed = selectedRole === "owner" || (selectedRole === "manager" && !["Banking", "Team settings"].includes(permission)) || (selectedRole === "staff" && ["Customers", "Calendar", "Communications", "Documents"].includes(permission)); return <div key={permission}><span>{permission}</span>{allowed ? <CheckCircle2 size={17} /> : <LockKeyhole size={16} />}</div>; })}</div></aside></section>
  </div>;
}

function SettingsView({ role, online, setOnline, notify }: { role: Role; online: boolean; setOnline: (value: boolean | ((current: boolean) => boolean)) => void; notify: Notify }) {
  const [tab, setTab] = useState("workspace");
  const [settings, setSettings] = useState({ reminders: true, summaries: true, reducedMotion: false, compact: false, offlineFiles: true, aiDrafts: true });
  function toggle(key: keyof typeof settings) { setSettings((current) => ({ ...current, [key]: !current[key] })); notify("Preference updated in the preview."); }
  const tabs = [{ id: "workspace", label: "Workspace" }, { id: "notifications", label: "Notifications" }, { id: "integrations", label: "Connected services" }, { id: "accessibility", label: "Accessibility" }];

  return <div className={styles.viewStack}>
    <PageHeading eyebrow="Settings" title="Control without configuration overload." description={role === "owner" ? "Manage the client workspace safely. Founder administration remains separate." : "Your personal preferences appear here. Business and financial controls remain owner-only."} />
    <section className={styles.settingsLayout}><aside className={styles.settingsNav}>{tabs.map((item) => <button className={tab === item.id ? styles.settingsNavActive : ""} type="button" key={item.id} onClick={() => setTab(item.id)}>{item.label}<ChevronRight size={16} /></button>)}</aside><div className={styles.settingsPanel}>
      {tab === "workspace" ? <><div className={styles.settingsSection}><div><p className={styles.eyebrow}>Workspace identity</p><h2>Harbour & Stone</h2><p>Client Experience V2 · Europe/Malta · EUR</p></div>{role === "owner" ? <button className={styles.secondaryButton} type="button" onClick={() => notify("Workspace identity editor opened.")}><Pencil size={16} /> Edit</button> : null}</div><div className={styles.settingRow}><span><strong>Connection preview</strong><small>Test how the product behaves when offline</small></span><button className={`${styles.toggle} ${online ? styles.toggleOn : ""}`} type="button" onClick={() => setOnline((value) => !value)} aria-pressed={online}><i /></button></div><div className={styles.storageCard}><div><strong>Offline storage</strong><span>128 MB of 500 MB</span></div><span><i /></span><p>Customers, today’s appointments, recent messages and selected documents are available offline.</p></div></> : null}
      {tab === "notifications" ? <><SettingToggle title="Appointment reminders" copy="Notify you before appointments need confirmation" value={settings.reminders} onClick={() => toggle("reminders")} /><SettingToggle title="Daily summary" copy="A calm summary of work needing attention" value={settings.summaries} onClick={() => toggle("summaries")} /><SettingToggle title="AI draft suggestions" copy="Suggest replies without sending them" value={settings.aiDrafts} onClick={() => toggle("aiDrafts")} /></> : null}
      {tab === "integrations" ? <div className={styles.integrationList}>{[{ name: "WhatsApp Business", status: "Connected", icon: MessageSquareText }, { name: "Email", status: "Connected", icon: Mail }, ...(role === "owner" ? [{ name: "Bank feeds", status: "2 accounts", icon: Landmark }, { name: "Stripe payments", status: "Connected", icon: CreditCard }] : [])].map((integration) => { const Icon = integration.icon; return <button type="button" key={integration.name} onClick={() => notify(`${integration.name} settings opened.`)}><span><Icon size={19} /></span><div><strong>{integration.name}</strong><small>{integration.status}</small></div><span className={styles.connectedDot} /><ChevronRight size={17} /></button>; })}</div> : null}
      {tab === "accessibility" ? <><SettingToggle title="Reduce motion" copy="Limit non-essential transitions and animated feedback" value={settings.reducedMotion} onClick={() => toggle("reducedMotion")} /><SettingToggle title="Compact density" copy="Show more information with slightly tighter spacing" value={settings.compact} onClick={() => toggle("compact")} /><SettingToggle title="Keep selected files offline" copy="Download marked documents for offline access" value={settings.offlineFiles} onClick={() => toggle("offlineFiles")} /></> : null}
    </div></section>
  </div>;
}

function SettingToggle({ title, copy, value, onClick }: { title: string; copy: string; value: boolean; onClick: () => void }) {
  return <div className={styles.settingRow}><span><strong>{title}</strong><small>{copy}</small></span><button className={`${styles.toggle} ${value ? styles.toggleOn : ""}`} type="button" onClick={onClick} aria-pressed={value}><i /></button></div>;
}

function MoreView({ role, setActive }: { role: Role; setActive: (id: DepartmentId) => void }) {
  const visible = departments.filter((department) => !["hub", "customers", "calendar", "communications", "more"].includes(department.id) && !(role === "staff" && department.ownerOnly));
  return <div className={styles.viewStack}><PageHeading eyebrow="More" title="The rest of your workspace." description={role === "owner" ? "Advanced departments stay available without crowding everyday work." : "Only tools relevant to your role appear here."} /><section className={styles.moreGrid}>{visible.map((item) => { const Icon = item.icon; return <button type="button" className={styles.moreCard} key={item.id} onClick={() => setActive(item.id)}><span><Icon size={22} /></span><div><strong>{item.label}</strong><small>{item.description}</small></div><ChevronRight size={18} /></button>; })}</section><section className={styles.roleNote}><Sparkles size={19} /><div><strong>{role === "owner" ? "Owner workspace" : "Staff workspace"}</strong><p>{role === "owner" ? "Financial controls, reports and team decisions are visible. Founder Admin remains separate." : "Financial and platform controls are removed rather than displayed as disabled clutter."}</p></div></section></div>;
}

function Modal({ id, close, notify }: { id: ModalId; close: () => void; notify: Notify }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const labels = { customer: ["New customer", "Create one connected customer record"], appointment: ["New appointment", "Choose a customer, time and service"], invoice: ["New invoice", "Create and link a clear invoice"], document: ["Upload document", "Connect the file to useful context"], member: ["Invite team member", "Choose a role before access is granted"] } as const;
  if (!id) return null;
  const [title, copy] = labels[id];
  function submit(event: { preventDefault: () => void }) { event.preventDefault(); if (step === 1 && id !== "document") { setStep(2); return; } notify(`${title} completed in the interactive preview.`); close(); }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={close}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}><header><div><p className={styles.eyebrow}>Preview flow</p><h2>{title}</h2><p>{copy}</p></div><button className={styles.iconButton} type="button" onClick={close}><X size={19} /></button></header><form onSubmit={submit}><div className={styles.modalProgress}><span className={step >= 1 ? styles.progressActive : ""}>1</span><i /><span className={step >= 2 ? styles.progressActive : ""}>2</span></div>{id === "customer" ? step === 1 ? <div className={styles.formGrid}><label className={styles.formWide}>Customer name<input value={name} onChange={(event: { target: { value: string } }) => setName(event.target.value)} placeholder="Full name or company" required /></label><label>Email<input type="email" placeholder="customer@example.com" required /></label><label>Phone<input placeholder="+356" /></label><label className={styles.formWide}>Notes<textarea placeholder="Anything the team should know" /></label></div> : <div className={styles.reviewPanel}><CheckCircle2 size={28} /><h3>Ready to create {name || "this customer"}</h3><p>The customer will become the shared record for appointments, messages, invoices and documents.</p></div> : null}{id === "appointment" ? step === 1 ? <div className={styles.formGrid}><label className={styles.formWide}>Customer<select><option>Maya Collins</option><option>Adrian Pace</option><option>Sofia Rossi</option></select></label><label>Date<input type="date" defaultValue="2026-07-20" /></label><label>Time<input type="time" defaultValue="10:30" /></label><label className={styles.formWide}>Service<input placeholder="Consultation" /></label></div> : <div className={styles.reviewPanel}><CalendarDays size={28} /><h3>Monday at 10:30</h3><p>Maya Collins · Consultation · 45 minutes. A confirmation message will remain under human control.</p></div> : null}{id === "invoice" ? step === 1 ? <div className={styles.formGrid}><label className={styles.formWide}>Customer<select><option>Maya Collins</option><option>Adrian Pace</option><option>Joseph Mifsud</option></select></label><label>Description<input defaultValue="Consultation services" /></label><label>Amount<input type="number" defaultValue="420" /></label><label>Due date<input type="date" defaultValue="2026-07-25" /></label><label>Tax<select><option>Included</option><option>Not applicable</option></select></label></div> : <div className={styles.reviewPanel}><ReceiptText size={28} /><h3>Invoice total: €420</h3><p>Maya Collins · due 25 July. The invoice remains a draft until you explicitly send it.</p></div> : null}{id === "document" ? <div className={styles.uploadZone}><Upload size={30} /><strong>Drop a file here</strong><p>or select a fictional file for this preview</p><button className={styles.secondaryButton} type="button" onClick={() => notify("Preview file selected.")}>Choose file</button><label>Connect to<select><option>Maya Collins</option><option>Appointment · 20 July</option><option>Invoice BDB-1042</option></select></label></div> : null}{id === "member" ? step === 1 ? <div className={styles.formGrid}><label className={styles.formWide}>Email<input type="email" placeholder="team@example.com" required /></label><label className={styles.formWide}>Role<select><option>Staff</option><option>Manager</option><option>Owner</option></select></label><label className={styles.formWide}>Welcome message<textarea defaultValue="You have been invited to the Harbour & Stone workspace." /></label></div> : <div className={styles.reviewPanel}><ShieldCheck size={28} /><h3>Access is ready for review</h3><p>The new member will see only the departments allowed by the selected role.</p></div> : null}<footer>{step === 2 && id !== "document" ? <button className={styles.secondaryButton} type="button" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button> : <span />}<button className={styles.primaryButton} type="submit">{step === 1 && id !== "document" ? "Continue" : id === "document" ? "Upload preview" : "Confirm"}<ArrowRight size={16} /></button></footer></form></section></div>;
}

function CommandPalette({ role, close, setActive, openModal }: { role: Role; close: () => void; setActive: (id: DepartmentId) => void; openModal: OpenModal }) {
  const [query, setQuery] = useState("");
  const results = departments.filter((department) => department.id !== "more" && !(role === "staff" && department.ownerOnly) && `${department.label} ${department.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={styles.modalBackdrop} onMouseDown={close}><section className={styles.commandPalette} role="dialog" aria-label="Search BDB OS" onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}><label><Search size={20} /><input autoFocus value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} placeholder="Search pages, customers and actions" /><kbd>esc</kbd></label><div className={styles.commandResults}><p className={styles.eyebrow}>Go to</p>{results.map((department) => { const Icon = department.icon; return <button type="button" key={department.id} onClick={() => { setActive(department.id); close(); }}><span><Icon size={18} /></span><div><strong>{department.label}</strong><small>{department.description}</small></div><ArrowRight size={16} /></button>; })}<p className={styles.eyebrow}>Create</p><button type="button" onClick={() => { openModal("customer"); close(); }}><span><UserPlus size={18} /></span><div><strong>New customer</strong><small>Create a connected customer record</small></div><ArrowRight size={16} /></button><button type="button" onClick={() => { openModal("appointment"); close(); }}><span><CalendarDays size={18} /></span><div><strong>New appointment</strong><small>Book time with a customer</small></div><ArrowRight size={16} /></button></div></section></div>;
}

export default function ClientExperiencePreview() {
  const [role, setRole] = useState<Role>("owner");
  const [active, setActive] = useState<DepartmentId>("hub");
  const [online, setOnline] = useState(true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [modal, setModal] = useState<ModalId>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleDepartments = departments.filter((item) => item.id !== "more" && !(role === "staff" && item.ownerOnly));
  const mobileDepartments = departments.filter((item) => ["hub", "customers", "calendar", "communications", "more"].includes(item.id));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
      if (event.key === "Escape") { setCommandOpen(false); setModal(null); setQuickOpen(false); setNotificationsOpen(false); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("keydown", keydown); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => { if (role === "staff" && ["accounts", "banking", "reports", "team"].includes(active)) setActive("hub"); }, [active, role]);

  function notify(message: string) { setToast(message); if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = setTimeout(() => setToast(""), 3300); }
  function chooseRole(nextRole: Role) { setRole(nextRole); setActive("hub"); setMobileMenu(false); notify(nextRole === "owner" ? "Owner preview active." : "Staff preview active. Financial and management controls are removed."); }
  function navigate(id: DepartmentId) { setActive(id); setMobileMenu(false); setQuickOpen(false); setNotificationsOpen(false); }

  function renderActive() {
    switch (active) {
      case "customers": return <CustomersView role={role} openModal={setModal} notify={notify} />;
      case "calendar": return <CalendarView openModal={setModal} notify={notify} />;
      case "communications": return <CommunicationsView notify={notify} />;
      case "accounts": return role === "owner" ? <AccountsView openModal={setModal} notify={notify} /> : null;
      case "banking": return role === "owner" ? <BankingView notify={notify} /> : null;
      case "documents": return <DocumentsView openModal={setModal} notify={notify} />;
      case "reports": return role === "owner" ? <ReportsView notify={notify} /> : null;
      case "team": return role === "owner" ? <TeamView openModal={setModal} notify={notify} /> : null;
      case "settings": return <SettingsView role={role} online={online} setOnline={setOnline} notify={notify} />;
      case "more": return <MoreView role={role} setActive={navigate} />;
      default: return <HubView role={role} online={online} setActive={navigate} openModal={setModal} notify={notify} />;
    }
  }

  return <div className={`${styles.previewRoot} ${navCollapsed ? styles.navIsCollapsed : ""}`}>
    <header className={styles.topbar}><button className={styles.mobileMenuButton} type="button" onClick={() => setMobileMenu((value) => !value)} aria-label="Open navigation"><Menu size={20} /></button><div className={styles.brandLockup}><BdbMark compact /><div><strong>BDB OS</strong><small>Client Experience V2</small></div></div><button className={styles.businessIdentity} type="button" onClick={() => navigate("settings")}><span>H&amp;S</span><div><strong>Harbour &amp; Stone</strong><small>Business workspace</small></div><ChevronDown size={15} /></button><button className={styles.commandButton} type="button" onClick={() => setCommandOpen(true)}><Search size={17} /><span>Search BDB OS</span><kbd><Command size={12} />K</kbd></button><div className={styles.topbarActions}><div className={styles.roleSwitch} aria-label="Preview role"><button className={role === "owner" ? styles.roleActive : ""} type="button" onClick={() => chooseRole("owner")} aria-pressed={role === "owner"}>Owner</button><button className={role === "staff" ? styles.roleActive : ""} type="button" onClick={() => chooseRole("staff")} aria-pressed={role === "staff"}>Staff</button></div><button className={`${styles.statusButton} ${!online ? styles.statusOffline : ""}`} type="button" onClick={() => setOnline((value) => !value)} aria-label="Toggle preview connection status">{online ? <Wifi size={16} /> : <WifiOff size={16} />}<span>{online ? "Synced" : "Offline"}</span></button><div className={styles.quickCreateWrap}><button className={styles.createButton} type="button" onClick={() => setQuickOpen((value) => !value)} aria-expanded={quickOpen}><Plus size={17} /><span>Create</span><ChevronDown size={14} /></button>{quickOpen ? <div className={styles.quickMenu}><button type="button" onClick={() => { setModal("customer"); setQuickOpen(false); }}><UsersRound size={17} /><span><strong>New customer</strong><small>Add one connected record</small></span></button><button type="button" onClick={() => { setModal("appointment"); setQuickOpen(false); }}><CalendarDays size={17} /><span><strong>New appointment</strong><small>Book time with a customer</small></span></button>{role === "owner" ? <button type="button" onClick={() => { setModal("invoice"); setQuickOpen(false); }}><ReceiptText size={17} /><span><strong>New invoice</strong><small>Create and link an invoice</small></span></button> : null}<button type="button" onClick={() => { setModal("document"); setQuickOpen(false); }}><Upload size={17} /><span><strong>Upload document</strong><small>Connect a file to work</small></span></button></div> : null}</div><div className={styles.notificationWrap}><button className={styles.iconButton} type="button" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={19} /><i /></button>{notificationsOpen ? <div className={styles.notificationPanel}><div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Notifications</p><h3>Two useful updates</h3></div><button className={styles.textButton} type="button" onClick={() => notify("Notifications marked read.")}>Mark read</button></div><button type="button" onClick={() => navigate("communications")}><MessageSquareText size={18} /><span><strong>Adrian replied</strong><small>Requested a new appointment time · 1h</small></span></button><button type="button" onClick={() => navigate("banking")}><Landmark size={18} /><span><strong>Payment matched</strong><small>€620 linked to BDB-1041 · 2h</small></span></button></div> : null}</div><button className={styles.profile} type="button" onClick={() => navigate("settings")}>NB</button></div></header>
    <div className={styles.appFrame}><aside className={`${styles.navRail} ${mobileMenu ? styles.navRailMobileOpen : ""}`}><div className={styles.navScroll}>{["daily", "business", "system"].map((group) => <div className={styles.navGroup} key={group}><p>{group === "daily" ? "Daily work" : group === "business" ? "Business" : "Workspace"}</p><nav aria-label={`${group} navigation`}>{visibleDepartments.filter((department) => department.group === group).map((department) => { const Icon = department.icon; return <button className={active === department.id ? styles.navActive : ""} type="button" key={department.id} onClick={() => navigate(department.id)} aria-current={active === department.id ? "page" : undefined} title={navCollapsed ? department.label : undefined}><span><Icon size={20} /></span><div><strong>{department.label}</strong><small>{department.description}</small></div>{active === department.id ? <i /> : null}</button>; })}</nav></div>)}</div><button className={styles.collapseButton} type="button" onClick={() => setNavCollapsed((value) => !value)}>{navCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}<span>{navCollapsed ? "" : "Collapse navigation"}</span></button><div className={styles.previewBadge}><Sparkles size={16} /><div><strong>Interactive design preview</strong><small>Fictional data · no production writes</small></div></div></aside><main className={styles.mainCanvas}><div className={styles.viewTransition} key={`${active}-${role}`}>{renderActive()}</div></main></div>
    <nav className={styles.mobileNav} aria-label="Mobile workspace navigation">{mobileDepartments.map((department) => { const Icon = department.icon; const activeOnMobile = active === department.id || (department.id === "more" && !["hub", "customers", "calendar", "communications"].includes(active)); return <button className={activeOnMobile ? styles.mobileActive : ""} type="button" key={department.id} onClick={() => navigate(department.id)} aria-current={activeOnMobile ? "page" : undefined}><Icon size={20} /><span>{department.shortLabel}</span></button>; })}</nav>
    {modal ? <Modal id={modal} close={() => setModal(null)} notify={notify} /> : null}{commandOpen ? <CommandPalette role={role} close={() => setCommandOpen(false)} setActive={navigate} openModal={setModal} /> : null}{toast ? <div className={styles.toast} role="status"><CheckCircle2 size={18} /><span>{toast}</span></div> : null}
  </div>;
}

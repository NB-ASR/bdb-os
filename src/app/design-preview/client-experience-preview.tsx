"use client";

import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  FolderOpen,
  House,
  Landmark,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
  Send,
  Settings2,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./preview.module.css";

type Role = "owner" | "staff";
type DepartmentId = "hub" | "customers" | "calendar" | "accounts" | "communications" | "more";
type Tone = "gold" | "blue" | "green";

type Department = {
  id: DepartmentId;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

type Customer = {
  initials: string;
  name: string;
  code: string;
  email: string;
  phone: string;
  detail: string;
  tone: Tone;
};

const departments: Department[] = [
  { id: "hub", label: "Business Hub", shortLabel: "Hub", description: "Today and next actions", icon: House },
  { id: "customers", label: "Customers", shortLabel: "Customers", description: "People and connected records", icon: UsersRound },
  { id: "calendar", label: "Calendar", shortLabel: "Calendar", description: "Appointments and availability", icon: CalendarDays },
  { id: "accounts", label: "Accounts", shortLabel: "Accounts", description: "Invoices, payments and balances", icon: CircleDollarSign, ownerOnly: true },
  { id: "communications", label: "Communications", shortLabel: "Comms", description: "One inbox across channels", icon: MessageSquareText },
  { id: "more", label: "More", shortLabel: "More", description: "Documents, reports and settings", icon: MoreHorizontal },
];

const customers: Customer[] = [
  { initials: "MC", name: "Maya Collins", code: "CLI-0142", email: "maya.collins@example.com", phone: "+356 7900 1420", detail: "Appointment today · €420 open", tone: "gold" },
  { initials: "AP", name: "Adrian Pace", code: "CLI-0138", email: "adrian.pace@example.com", phone: "+356 7944 2381", detail: "Last contacted 2 days ago", tone: "blue" },
  { initials: "SR", name: "Sofia Rossi", code: "CLI-0131", email: "sofia.rossi@example.com", phone: "+356 7721 9014", detail: "Invoice paid · no action needed", tone: "green" },
  { initials: "JM", name: "Joseph Mifsud", code: "CLI-0127", email: "joseph.mifsud@example.com", phone: "+356 9982 1140", detail: "Document requested yesterday", tone: "blue" },
  { initials: "LB", name: "Leanne Borg", code: "CLI-0122", email: "leanne.borg@example.com", phone: "+356 7703 6432", detail: "Next appointment 24 July", tone: "green" },
];

const schedule = [
  { time: "09:30", title: "Maya Collins", detail: "Consultation · Meeting room 1", state: "Confirmed" },
  { time: "11:15", title: "Adrian Pace", detail: "Follow-up · Video call", state: "Confirmed" },
  { time: "14:00", title: "Sofia Rossi", detail: "Document review · Office", state: "Pending" },
  { time: "16:30", title: "New customer slot", detail: "45 minutes available", state: "Open" },
];

const messages = [
  { initials: "MC", name: "Maya Collins", channel: "WhatsApp", preview: "Perfect, I will bring the documents.", time: "10m", unread: true },
  { initials: "AP", name: "Adrian Pace", channel: "Email", preview: "Could we move the call to tomorrow?", time: "1h", unread: true },
  { initials: "SR", name: "Sofia Rossi", channel: "Messenger", preview: "Thank you for confirming the payment.", time: "3h", unread: false },
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

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <section className={styles.pageHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}

function HubView({ role, online, setActive, notify }: { role: Role; online: boolean; setActive: (id: DepartmentId) => void; notify: (message: string) => void }) {
  const ownerActions = [
    { title: "Review overdue invoice", detail: "€420 from Maya Collins · due yesterday", meta: "Priority", icon: CircleDollarSign, target: "accounts" as DepartmentId },
    { title: "Reply to two new messages", detail: "Both customers are already matched", meta: "2 unread", icon: MessageSquareText, target: "communications" as DepartmentId },
    { title: "Confirm Sofia’s appointment", detail: "Today at 14:00 · document review", meta: "Today", icon: CalendarDays, target: "calendar" as DepartmentId },
  ];
  const staffActions = [
    { title: "Confirm Sofia’s appointment", detail: "Today at 14:00 · document review", meta: "Next", icon: CalendarDays, target: "calendar" as DepartmentId },
    { title: "Reply to two new messages", detail: "Both customers are already matched", meta: "2 unread", icon: MessageSquareText, target: "communications" as DepartmentId },
    { title: "Add notes for Maya Collins", detail: "Her 09:30 consultation is complete", meta: "Follow-up", icon: UsersRound, target: "customers" as DepartmentId },
  ];
  const actions = role === "owner" ? ownerActions : staffActions;
  const primary = actions[0];
  const visibleDepartments = departments.filter((item) => item.id !== "hub" && item.id !== "more" && !(role === "staff" && item.ownerOnly));

  return (
    <div className={styles.viewStack}>
      <section className={styles.heroCard}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Friday, 17 July</p>
          <h1>Good evening, Niki.</h1>
          <p className={styles.heroCopy}>{role === "owner" ? "Your business is in good shape. One item needs your decision first." : "Your day is organised. The next customer action is ready."}</p>
          <button className={styles.primaryButton} type="button" onClick={() => setActive(primary.target)}>
            <primary.icon size={18} /> {primary.title} <ArrowRight size={17} />
          </button>
        </div>
        <div className={styles.businessPulse} aria-label="Business pulse: three actions, four appointments, synced">
          <span className={styles.pulseRing} />
          <span className={styles.pulseRingInner} />
          <div className={styles.pulseCore}>
            <BdbMark compact />
            <strong>3</strong>
            <small>actions today</small>
          </div>
          <span className={`${styles.pulseDot} ${styles.pulseDotOne}`} />
          <span className={`${styles.pulseDot} ${styles.pulseDotTwo}`} />
          <span className={`${styles.pulseDot} ${styles.pulseDotThree}`} />
        </div>
      </section>

      {!online ? (
        <section className={styles.offlineNotice} role="status">
          <WifiOff size={18} />
          <div><strong>Working offline</strong><p>Core records remain available. Two changes will sync automatically when the connection returns.</p></div>
          <span>2 queued</span>
        </section>
      ) : null}

      <section className={styles.hubGrid}>
        <article className={styles.attentionCard}>
          <div className={styles.sectionIntro}>
            <div><p className={styles.eyebrow}>Needs attention</p><h2>Do these next.</h2></div>
            <span className={styles.countBubble}>{actions.length}</span>
          </div>
          <div className={styles.actionList}>
            {actions.map((item, index) => {
              const Icon = item.icon;
              return (
                <button className={`${styles.actionRow} ${index === 0 ? styles.actionRowPrimary : ""}`} type="button" key={item.title} onClick={() => setActive(item.target)}>
                  <span className={styles.actionIcon}><Icon size={19} /></span>
                  <span className={styles.actionCopy}><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <span className={styles.actionMeta}>{item.meta}</span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </div>
        </article>

        <article className={styles.todayCard}>
          <div className={styles.sectionIntro}>
            <div><p className={styles.eyebrow}>Today</p><h2>Four appointments.</h2></div>
            <button className={styles.textButton} type="button" onClick={() => setActive("calendar")}>Full calendar <ChevronRight size={16} /></button>
          </div>
          <div className={styles.dayProgress}><span><i /></span><p><strong>3 of 4 confirmed</strong><small>Your day is 75% ready.</small></p></div>
          <div className={styles.todayTimeline}>
            {schedule.slice(0, 3).map((item) => (
              <button type="button" key={item.time} onClick={() => setActive("calendar")}>
                <time>{item.time}</time><span className={item.state === "Pending" ? styles.timelinePending : ""} />
                <p><strong>{item.title}</strong><small>{item.detail.split(" · ")[0]}</small></p>
                <em>{item.state}</em>
              </button>
            ))}
          </div>
          <button className={styles.secondaryButtonWide} type="button" onClick={() => notify("A new appointment flow would open here.")}><Plus size={17} /> New appointment</button>
        </article>
      </section>

      <section className={styles.departmentSection}>
        <div className={styles.sectionIntro}>
          <div><p className={styles.eyebrow}>Workspace</p><h2>Continue somewhere else.</h2></div>
          <button className={styles.textButton} type="button" onClick={() => setActive("more")}>All departments <ChevronRight size={16} /></button>
        </div>
        <div className={styles.departmentGrid}>
          {visibleDepartments.map((department) => {
            const Icon = department.icon;
            return (
              <button type="button" className={styles.departmentCard} key={department.id} onClick={() => setActive(department.id)}>
                <span><Icon size={21} /></span><div><strong>{department.label}</strong><small>{department.description}</small></div><ChevronRight size={17} />
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.signalGrid} aria-label="Business summary">
        <article><span><CalendarDays size={18} /></span><div><small>Today</small><strong>4 appointments</strong></div><em>1 pending</em></article>
        <article><span><MessageSquareText size={18} /></span><div><small>Inbox</small><strong>2 unread</strong></div><em>All channels</em></article>
        {role === "owner" ? <article><span><ReceiptText size={18} /></span><div><small>Outstanding</small><strong>€1,260</strong></div><em>3 invoices</em></article> : <article><span><CheckCircle2 size={18} /></span><div><small>Completed</small><strong>6 actions</strong></div><em>Today</em></article>}
      </section>
    </div>
  );
}

function CustomersView({ notify }: { notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer>(customers[0]);
  const filtered = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.code} ${customer.email}`.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <div className={styles.viewStack}>
      <PageHeading eyebrow="Customers" title="Every relationship, connected." description="Appointments, invoices, messages, files and notes remain attached to one clear customer record." action={<button className={styles.primaryButton} type="button" onClick={() => notify("A clean new-customer form would open here.")}><Plus size={17} /> New customer</button>} />
      <div className={styles.customerLayout}>
        <section className={styles.listPanel}>
          <label className={styles.searchField}><Search size={18} /><input value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} aria-label="Search customers" placeholder="Search name, code or email" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button> : null}</label>
          <div className={styles.listSummary}><span>{filtered.length} customers</span><button type="button">Recent <ChevronDown size={14} /></button></div>
          <div className={styles.customerList}>
            {filtered.length ? filtered.map((customer) => (
              <button className={`${styles.customerRow} ${selected.code === customer.code ? styles.customerRowActive : ""}`} type="button" key={customer.code} onClick={() => setSelected(customer)}>
                <span className={`${styles.avatar} ${styles[`avatar${customer.tone}`]}`}>{customer.initials}</span>
                <span><strong>{customer.name}</strong><small>{customer.detail}</small></span>
                <ChevronRight size={17} />
              </button>
            )) : <div className={styles.emptyState}><Search size={22} /><strong>No customers found</strong><p>Try another name, client code or email address.</p></div>}
          </div>
        </section>
        <section className={styles.detailPanel}>
          <div className={styles.customerHero}>
            <span className={`${styles.avatar} ${styles.avatarLarge} ${styles[`avatar${selected.tone}`]}`}>{selected.initials}</span>
            <div><p className={styles.eyebrow}>{selected.code}</p><h2>{selected.name}</h2><p>{selected.email} · {selected.phone}</p></div>
            <button className={styles.iconButton} type="button" aria-label="Customer options"><MoreHorizontal size={20} /></button>
          </div>
          <div className={styles.customerActions}>
            <button type="button" onClick={() => notify(`Opening a message to ${selected.name}.`)}><MessageSquareText size={17} /> Message</button>
            <button type="button" onClick={() => notify(`Opening appointment booking for ${selected.name}.`)}><CalendarDays size={17} /> Book</button>
            <button type="button" onClick={() => notify(`A note would be added to ${selected.name}.`)}><Plus size={17} /> Add note</button>
          </div>
          <div className={styles.customerStats}>
            <div><small>Next appointment</small><strong>Today, 09:30</strong></div>
            <div><small>Open balance</small><strong>€420</strong></div>
            <div><small>Last contact</small><strong>10 minutes ago</strong></div>
          </div>
          <div className={styles.recordSection}>
            <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Recent history</p><h3>Connected records</h3></div><button className={styles.textButton} type="button">View all <ChevronRight size={15} /></button></div>
            <div className={styles.recordRow}><span><MessageSquareText size={17} /></span><div><strong>WhatsApp message received</strong><small>“I will bring the documents.”</small></div><time>10m</time></div>
            <div className={styles.recordRow}><span><FileText size={17} /></span><div><strong>Service agreement added</strong><small>Linked to today’s appointment</small></div><time>Yesterday</time></div>
            <div className={styles.recordRow}><span><CircleDollarSign size={17} /></span><div><strong>Invoice BDB-1042 sent</strong><small>€420 · due tomorrow</small></div><time>12 Jul</time></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CalendarView({ notify }: { notify: (message: string) => void }) {
  const [selectedDay, setSelectedDay] = useState("Fri 17");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className={styles.viewStack}>
      <PageHeading eyebrow="Calendar" title="Your day, without the noise." description="Only the information needed to keep appointments moving, with customer context one click away." action={<button className={styles.primaryButton} type="button" onClick={() => notify("A focused appointment form would open here.")}><Plus size={17} /> New appointment</button>} />
      <section className={styles.calendarPanel}>
        <div className={styles.dateStrip}>
          {["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"].map((day) => (
            <button className={day === selectedDay ? styles.dateActive : ""} type="button" key={day} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay}><span>{day.split(" ")[0]}</span><strong>{day.split(" ")[1]}</strong></button>
          ))}
        </div>
        <div className={styles.calendarToolbar}><div><strong>{selectedDay === "Fri 17" ? "Friday, 17 July" : selectedDay}</strong><span>4 appointments · 1 open slot</span></div><button type="button" className={styles.secondaryButton} onClick={() => notify("Availability controls would open here.")}><Clock3 size={16} /> Availability</button></div>
        <div className={styles.schedule}>
          {schedule.map((item) => {
            const state = item.title === "Sofia Rossi" && confirmed ? "Confirmed" : item.state;
            return (
              <article className={styles.scheduleRow} key={`${item.time}-${item.title}`}>
                <time>{item.time}</time><span className={`${styles.timelineDot} ${state === "Pending" ? styles.timelinePending : state === "Open" ? styles.timelineOpen : ""}`} />
                <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                {state === "Pending" ? <button type="button" className={styles.confirmButton} onClick={() => { setConfirmed(true); notify("Sofia’s appointment is now confirmed."); }}><Check size={16} /> Confirm</button> : <span className={`${styles.statePill} ${state === "Open" ? styles.stateOpen : ""}`}>{state}</span>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AccountsView({ notify }: { notify: (message: string) => void }) {
  return (
    <div className={styles.viewStack}>
      <PageHeading eyebrow="Accounts" title="Money made understandable." description="See what was paid, what is due and what needs a human decision. No accounting fog machine required." action={<button className={styles.primaryButton} type="button" onClick={() => notify("A guided invoice flow would open here.")}><Plus size={17} /> New invoice</button>} />
      <section className={styles.moneyGrid}>
        <article className={styles.balanceCard}><span><CircleDollarSign size={21} /></span><small>Outstanding</small><strong>€1,260</strong><p>Across 3 open invoices</p><div className={styles.balanceTrend}>€420 overdue <ArrowRight size={15} /></div></article>
        <article className={styles.moneyCard}><span><CheckCircle2 size={20} /></span><small>Received this month</small><strong>€8,940</strong><p>12 invoices paid</p></article>
        <article className={styles.moneyCard}><span><Clock3 size={20} /></span><small>Due this week</small><strong>€840</strong><p>2 invoices</p></article>
      </section>
      <section className={styles.tablePanel}>
        <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Invoices</p><h2>Recent activity</h2></div><button className={styles.textButton} type="button">View all <ChevronRight size={16} /></button></div>
        <div className={styles.invoiceList}>
          {[
            ["BDB-1042", "Maya Collins", "€420", "Overdue", "Due 16 Jul"],
            ["BDB-1041", "Sofia Rossi", "€620", "Paid", "Paid 15 Jul"],
            ["BDB-1040", "Adrian Pace", "€380", "Sent", "Due 22 Jul"],
            ["BDB-1039", "Leanne Borg", "€460", "Draft", "Edited today"],
          ].map(([id, customer, amount, state, detail]) => (
            <button className={styles.invoiceRow} type="button" key={id} onClick={() => notify(`${id} would open in a focused invoice view.`)}>
              <span className={styles.invoiceIcon}><ReceiptText size={17} /></span><div><strong>{id}</strong><small>{customer}</small></div><div className={styles.invoiceAmount}><strong>{amount}</strong><small>{detail}</small></div><span className={`${styles.statePill} ${state === "Overdue" ? styles.stateOverdue : state === "Paid" ? styles.statePaid : state === "Draft" ? styles.stateDraft : ""}`}>{state}</span><ChevronRight size={17} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CommunicationsView({ notify }: { notify: (message: string) => void }) {
  const [selected, setSelected] = useState(messages[0]);
  const [draft, setDraft] = useState("Hi Maya, that’s perfect. We’ll have everything ready for your appointment at 09:30. See you then.");
  return (
    <div className={styles.viewStack}>
      <PageHeading eyebrow="Communications" title="One inbox. Every customer." description="BDB identifies the person and keeps the conversation connected, regardless of which platform they used." />
      <section className={styles.inboxPanel}>
        <div className={styles.inboxList}>
          <label className={styles.searchField}><Search size={18} /><input aria-label="Search conversations" placeholder="Search conversations" /></label>
          <div className={styles.channelTabs}><button className={styles.channelActive} type="button">All <span>2</span></button><button type="button">Unread</button><button type="button">Assigned</button></div>
          {messages.map((message) => (
            <button className={`${styles.messageRow} ${selected.name === message.name ? styles.messageRowActive : ""}`} type="button" key={message.name} onClick={() => setSelected(message)}>
              <span className={styles.avatar}>{message.initials}</span><span><strong>{message.name}{message.unread ? <i /> : null}</strong><small>{message.channel} · {message.preview}</small></span><time>{message.time}</time>
            </button>
          ))}
        </div>
        <div className={styles.conversation}>
          <header><div><span className={styles.avatar}>{selected.initials}</span><div><strong>{selected.name}</strong><small>{selected.channel} · linked customer</small></div></div><button className={styles.iconButton} type="button" aria-label="Conversation options"><MoreHorizontal size={20} /></button></header>
          <div className={styles.messageCanvas}>
            <div className={styles.messageBubble}><p>{selected.preview}</p><small>{selected.time} ago · {selected.channel}</small></div>
            <div className={styles.aiDraft}><div><Sparkles size={17} /><span><strong>Suggested reply</strong><small>AI assists. You decide.</small></span></div><textarea value={draft} onChange={(event: { target: { value: string } }) => setDraft(event.target.value)} aria-label="Suggested reply draft" /><div><button type="button" className={styles.textButton} onClick={() => setDraft("")}>Discard</button><button type="button" className={styles.secondaryButton} onClick={() => notify("The suggested reply is ready for your review.")}><Check size={16} /> Use draft</button></div></div>
          </div>
          <div className={styles.composer}><button className={styles.iconButton} type="button" aria-label="Attach file"><Plus size={19} /></button><input aria-label="Write a reply" placeholder={`Reply to ${selected.name}`} /><button className={styles.sendButton} type="button" onClick={() => notify("Preview only: no message was sent.")}><Send size={17} /><span>Send</span></button></div>
        </div>
      </section>
    </div>
  );
}

function MoreView({ role, setActive, notify }: { role: Role; setActive: (id: DepartmentId) => void; notify: (message: string) => void }) {
  const items = [
    { label: "Documents", detail: "Files connected to customers and work", icon: FolderOpen },
    ...(role === "owner" ? [
      { label: "Banking", detail: "Reconciliation with human approval", icon: Landmark },
      { label: "Reports", detail: "Useful insight without dashboard clutter", icon: Activity },
      { label: "Automation", detail: "Assistance and controlled workflows", icon: Sparkles },
    ] : [
      { label: "Activity", detail: "Recent actions in this workspace", icon: Activity },
    ]),
    { label: "Settings", detail: "Workspace preferences and accessibility", icon: Settings2 },
  ];
  return (
    <div className={styles.viewStack}>
      <PageHeading eyebrow="More" title="The rest of your workspace." description={role === "owner" ? "Advanced departments stay available without crowding everyday work." : "Only the tools relevant to your role appear here."} />
      {role === "owner" ? <section className={styles.mobileAccountsCallout}><div><CircleDollarSign size={20} /><span><strong>Accounts</strong><small>Invoices, payments and balances</small></span></div><button type="button" onClick={() => setActive("accounts")}>Open <ChevronRight size={16} /></button></section> : null}
      <section className={styles.moreGrid}>
        {items.map((item) => {
          const Icon = item.icon;
          return <button type="button" className={styles.moreCard} key={item.label} onClick={() => notify(`${item.label} would open here without changing the approved production UI.`)}><span><Icon size={22} /></span><div><strong>{item.label}</strong><small>{item.detail}</small></div><ChevronRight size={18} /></button>;
        })}
      </section>
      <section className={styles.roleNote}><Sparkles size={19} /><div><strong>{role === "owner" ? "Owner workspace" : "Staff workspace"}</strong><p>{role === "owner" ? "Financial controls, reports and team-level decisions are visible. The Founder Admin remains a separate privileged environment." : "Financial and platform administration controls are removed entirely, rather than displayed as confusing disabled options."}</p></div></section>
    </div>
  );
}

export default function ClientExperiencePreview() {
  const [role, setRole] = useState<Role>("owner");
  const [active, setActive] = useState<DepartmentId>("hub");
  const [online, setOnline] = useState(true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleDepartments = departments.filter((item) => !(role === "staff" && item.ownerOnly));
  const mobileDepartments = departments.filter((item) => ["hub", "customers", "calendar", "communications", "more"].includes(item.id));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (role === "staff" && active === "accounts") setActive("hub");
  }, [active, role]);

  function notify(message: string) {
    setToast(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(""), 3200);
  }

  function chooseRole(nextRole: Role) {
    setRole(nextRole);
    setActive("hub");
    notify(nextRole === "owner" ? "Owner preview active." : "Staff preview active. Financial controls are hidden.");
  }

  function renderActive() {
    switch (active) {
      case "customers": return <CustomersView notify={notify} />;
      case "calendar": return <CalendarView notify={notify} />;
      case "accounts": return role === "owner" ? <AccountsView notify={notify} /> : <HubView role={role} online={online} setActive={setActive} notify={notify} />;
      case "communications": return <CommunicationsView notify={notify} />;
      case "more": return <MoreView role={role} setActive={setActive} notify={notify} />;
      default: return <HubView role={role} online={online} setActive={setActive} notify={notify} />;
    }
  }

  return (
    <div className={styles.previewRoot}>
      <header className={styles.topbar}>
        <div className={styles.brandLockup}><BdbMark compact /><div><strong>BDB OS</strong><small>Client Experience V1.1</small></div></div>
        <div className={styles.businessIdentity}><span>H&amp;S</span><div><strong>Harbour &amp; Stone</strong><small>Business workspace</small></div></div>
        <div className={styles.topbarActions}>
          <div className={styles.roleSwitch} aria-label="Preview role"><button className={role === "owner" ? styles.roleActive : ""} type="button" onClick={() => chooseRole("owner")} aria-pressed={role === "owner"}>Owner</button><button className={role === "staff" ? styles.roleActive : ""} type="button" onClick={() => chooseRole("staff")} aria-pressed={role === "staff"}>Staff</button></div>
          <button className={`${styles.statusButton} ${!online ? styles.statusOffline : ""}`} type="button" onClick={() => setOnline((value) => !value)} aria-label="Toggle preview connection status">{online ? <Wifi size={16} /> : <WifiOff size={16} />}<span>{online ? "Synced" : "Offline"}</span></button>
          <div className={styles.quickCreateWrap}>
            <button className={styles.createButton} type="button" onClick={() => setQuickOpen((value) => !value)} aria-expanded={quickOpen}><Plus size={17} /><span>Create</span><ChevronDown size={14} /></button>
            {quickOpen ? <div className={styles.quickMenu}>
              <button type="button" onClick={() => { setQuickOpen(false); setActive("customers"); }}><UsersRound size={17} /><span><strong>New customer</strong><small>Add a connected customer record</small></span></button>
              <button type="button" onClick={() => { setQuickOpen(false); setActive("calendar"); }}><CalendarDays size={17} /><span><strong>New appointment</strong><small>Book time with a customer</small></span></button>
              {role === "owner" ? <button type="button" onClick={() => { setQuickOpen(false); setActive("accounts"); }}><ReceiptText size={17} /><span><strong>New invoice</strong><small>Create and link an invoice</small></span></button> : null}
            </div> : null}
          </div>
          <button className={styles.iconButton} type="button" aria-label="Notifications"><Bell size={19} /><i /></button>
          <span className={styles.profile}>NB</span>
        </div>
      </header>

      <div className={styles.appFrame}>
        <aside className={styles.navRail}>
          <nav aria-label="Client workspace navigation">
            {visibleDepartments.map((department) => {
              const Icon = department.icon;
              return <button className={active === department.id ? styles.navActive : ""} type="button" key={department.id} onClick={() => setActive(department.id)} aria-current={active === department.id ? "page" : undefined}><span><Icon size={20} /></span><div><strong>{department.label}</strong><small>{department.description}</small></div>{active === department.id ? <i /> : null}</button>;
            })}
          </nav>
          <div className={styles.previewBadge}><Sparkles size={16} /><div><strong>Design preview</strong><small>Static data · no production records</small></div></div>
        </aside>

        <main className={styles.mainCanvas}>
          <div className={styles.viewTransition} key={`${active}-${role}`}>{renderActive()}</div>
        </main>
      </div>

      <nav className={styles.mobileNav} aria-label="Mobile workspace navigation">
        {mobileDepartments.map((department) => {
          const Icon = department.icon;
          const activeOnMobile = active === department.id || (department.id === "more" && active === "accounts");
          return <button className={activeOnMobile ? styles.mobileActive : ""} type="button" key={department.id} onClick={() => setActive(department.id)} aria-current={activeOnMobile ? "page" : undefined}><Icon size={20} /><span>{department.shortLabel}</span></button>;
        })}
      </nav>

      {toast ? <div className={styles.toast} role="status"><CheckCircle2 size={18} /><span>{toast}</span></div> : null}
    </div>
  );
}

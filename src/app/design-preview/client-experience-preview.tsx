"use client";

import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  FolderOpen,
  House,
  Landmark,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import styles from "./preview.module.css";

type Role = "owner" | "staff";
type DepartmentId = "hub" | "customers" | "calendar" | "accounts" | "communications" | "more";

type Department = {
  id: DepartmentId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

const departments: Department[] = [
  { id: "hub", label: "Business Hub", shortLabel: "Hub", icon: House },
  { id: "customers", label: "Customers", shortLabel: "Customers", icon: UsersRound },
  { id: "calendar", label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  { id: "accounts", label: "Accounts", shortLabel: "Accounts", icon: CircleDollarSign, ownerOnly: true },
  { id: "communications", label: "Communications", shortLabel: "Comms", icon: MessageSquareText },
  { id: "more", label: "More departments", shortLabel: "More", icon: MoreHorizontal },
];

const customers = [
  { initials: "MC", name: "Maya Collins", code: "CLI-0142", detail: "Appointment today · €420 open", tone: "gold" },
  { initials: "AP", name: "Adrian Pace", code: "CLI-0138", detail: "Last contacted 2 days ago", tone: "blue" },
  { initials: "SR", name: "Sofia Rossi", code: "CLI-0131", detail: "Invoice paid · no action needed", tone: "green" },
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

function BdbMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`${styles.brandMark} ${small ? styles.brandMarkSmall : ""}`} aria-hidden="true">
      <svg viewBox="0 0 72 72" role="img">
        <circle cx="36" cy="36" r="34" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.42" />
        <path d="M21 18h15c9 0 14 4 14 10 0 4-2 7-6 9 5 1 8 5 8 10 0 8-6 12-16 12H21V18Zm10 9v7h5c3 0 5-1 5-4s-2-3-5-3h-5Zm0 15v8h6c4 0 6-1 6-4s-2-4-6-4h-6Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <span className={styles.statusPill}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? "Synced" : "Offline ready"}
    </span>
  );
}

function HubView({ setActive, role }: { setActive: (id: DepartmentId) => void; role: Role }) {
  const orbitDepartments = departments.filter((item) => item.id !== "hub" && item.id !== "more" && !(role === "staff" && item.ownerOnly));

  return (
    <div className={styles.viewStack}>
      <section className={styles.heroCard}>
        <div>
          <p className={styles.eyebrow}>Friday, 17 July</p>
          <h1>Good evening, Niki.</h1>
          <p className={styles.heroCopy}>Everything important is connected and the next action is already waiting.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setActive("customers")}>
          <Plus size={17} /> Add customer
        </button>
      </section>

      <section className={styles.hubGrid}>
        <article className={styles.orbitCard}>
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>Business map</p>
              <h2>Choose where to work.</h2>
            </div>
            <span className={styles.softLabel}>Role: {role === "owner" ? "Owner" : "Staff"}</span>
          </div>
          <div className={styles.orbit}>
            <button className={styles.orbitCenter} type="button" onClick={() => setActive("hub")}>
              <BdbMark />
              <span>Business Hub</span>
              <small>Everything connected</small>
            </button>
            {orbitDepartments.map((department, index) => {
              const Icon = department.icon;
              return (
                <button
                  className={`${styles.orbitNode} ${styles[`orbitNode${index}`]}`}
                  type="button"
                  key={department.id}
                  onClick={() => setActive(department.id)}
                >
                  <span><Icon size={20} /></span>
                  <strong>{department.shortLabel}</strong>
                </button>
              );
            })}
          </div>
        </article>

        <article className={styles.attentionCard}>
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>Needs attention</p>
              <h2>Three useful actions.</h2>
            </div>
            <span className={styles.countBubble}>3</span>
          </div>
          <button className={styles.actionRow} type="button" onClick={() => setActive("accounts")} disabled={role === "staff"}>
            <span className={styles.actionIcon}><CircleDollarSign size={18} /></span>
            <span><strong>Review overdue invoice</strong><small>€420 from Maya Collins</small></span>
            <ChevronRight size={17} />
          </button>
          <button className={styles.actionRow} type="button" onClick={() => setActive("communications")}>
            <span className={styles.actionIcon}><MessageSquareText size={18} /></span>
            <span><strong>Reply to two messages</strong><small>Both customers are already identified</small></span>
            <ChevronRight size={17} />
          </button>
          <button className={styles.actionRow} type="button" onClick={() => setActive("calendar")}>
            <span className={styles.actionIcon}><CalendarDays size={18} /></span>
            <span><strong>Confirm Sofia’s appointment</strong><small>Today at 14:00</small></span>
            <ChevronRight size={17} />
          </button>
        </article>
      </section>

      <section className={styles.signalGrid}>
        <article className={styles.signalCard}>
          <span className={styles.signalIcon}><CalendarDays size={18} /></span>
          <div><small>Today</small><strong>4 appointments</strong></div>
          <span className={styles.signalMeta}>1 pending</span>
        </article>
        <article className={styles.signalCard}>
          <span className={styles.signalIcon}><MessageSquareText size={18} /></span>
          <div><small>Inbox</small><strong>2 unread</strong></div>
          <span className={styles.signalMeta}>All channels</span>
        </article>
        <article className={styles.signalCard}>
          <span className={styles.signalIcon}><CircleDollarSign size={18} /></span>
          <div><small>Outstanding</small><strong>€1,260</strong></div>
          <span className={styles.signalMeta}>3 invoices</span>
        </article>
      </section>
    </div>
  );
}

function CustomersView() {
  const [selected, setSelected] = useState(customers[0]);

  return (
    <div className={styles.viewStack}>
      <section className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Customers</p><h1>Every relationship in one place.</h1><p>Appointments, invoices, messages and files stay linked to the same person.</p></div>
        <button className={styles.primaryButton} type="button"><Plus size={17} /> New customer</button>
      </section>
      <div className={styles.customerLayout}>
        <section className={styles.listPanel}>
          <label className={styles.searchField}><Search size={17} /><input aria-label="Search customers" placeholder="Search customers" /></label>
          <div className={styles.customerList}>
            {customers.map((customer) => (
              <button className={`${styles.customerRow} ${selected.code === customer.code ? styles.customerRowActive : ""}`} type="button" key={customer.code} onClick={() => setSelected(customer)}>
                <span className={`${styles.avatar} ${styles[`avatar${customer.tone}`]}`}>{customer.initials}</span>
                <span><strong>{customer.name}</strong><small>{customer.detail}</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
        <section className={styles.detailPanel}>
          <div className={styles.customerHero}>
            <span className={`${styles.avatar} ${styles.avatarLarge} ${styles[`avatar${selected.tone}`]}`}>{selected.initials}</span>
            <div><p className={styles.eyebrow}>{selected.code}</p><h2>{selected.name}</h2><p>maya.collins@example.com · +356 7900 1420</p></div>
            <button className={styles.iconButton} type="button" aria-label="Customer settings"><MoreHorizontal size={19} /></button>
          </div>
          <div className={styles.customerStats}>
            <div><small>Next appointment</small><strong>Today, 09:30</strong></div>
            <div><small>Open balance</small><strong>€420</strong></div>
            <div><small>Last contact</small><strong>10 minutes ago</strong></div>
          </div>
          <div className={styles.recordSection}>
            <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Recent history</p><h3>Connected records</h3></div></div>
            <div className={styles.recordRow}><span><MessageSquareText size={17} /></span><div><strong>WhatsApp message received</strong><small>“I will bring the documents.”</small></div><time>10m</time></div>
            <div className={styles.recordRow}><span><FileText size={17} /></span><div><strong>Service agreement added</strong><small>Linked to today’s appointment</small></div><time>Yesterday</time></div>
            <div className={styles.recordRow}><span><CircleDollarSign size={17} /></span><div><strong>Invoice BDB-1042 sent</strong><small>€420 · due tomorrow</small></div><time>12 Jul</time></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CalendarView() {
  return (
    <div className={styles.viewStack}>
      <section className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Calendar</p><h1>Your day, without the noise.</h1><p>Only the information needed to keep appointments moving.</p></div>
        <button className={styles.primaryButton} type="button"><Plus size={17} /> New appointment</button>
      </section>
      <section className={styles.calendarPanel}>
        <div className={styles.dateStrip}>
          {["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"].map((day) => (
            <button className={day === "Fri 17" ? styles.dateActive : ""} type="button" key={day}><span>{day.split(" ")[0]}</span><strong>{day.split(" ")[1]}</strong></button>
          ))}
        </div>
        <div className={styles.schedule}>
          {schedule.map((item) => (
            <article className={styles.scheduleRow} key={`${item.time}-${item.title}`}>
              <time>{item.time}</time>
              <span className={styles.timelineDot} />
              <div><strong>{item.title}</strong><small>{item.detail}</small></div>
              <span className={`${styles.statePill} ${item.state === "Pending" ? styles.statePending : item.state === "Open" ? styles.stateOpen : ""}`}>{item.state}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountsView() {
  return (
    <div className={styles.viewStack}>
      <section className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Accounts</p><h1>Money made understandable.</h1><p>See what was paid, what is due and what needs a human decision.</p></div>
        <button className={styles.primaryButton} type="button"><Plus size={17} /> New invoice</button>
      </section>
      <section className={styles.moneyGrid}>
        <article className={styles.balanceCard}><small>Received this month</small><strong>€18,420</strong><span><Check size={14} /> 14 invoices paid</span></article>
        <article className={styles.moneyCard}><small>Outstanding</small><strong>€1,260</strong><span>3 invoices</span></article>
        <article className={styles.moneyCard}><small>Overdue</small><strong>€420</strong><span>Needs follow-up</span></article>
      </section>
      <section className={styles.tablePanel}>
        <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>Invoices</p><h2>Open balances</h2></div><button className={styles.textButton} type="button">View all <ArrowRight size={15} /></button></div>
        <div className={styles.invoiceRow}><span className={styles.invoiceIcon}><FileText size={18} /></span><div><strong>BDB-1042 · Maya Collins</strong><small>Due tomorrow</small></div><strong>€420</strong><span className={`${styles.statePill} ${styles.statePending}`}>Due</span></div>
        <div className={styles.invoiceRow}><span className={styles.invoiceIcon}><FileText size={18} /></span><div><strong>BDB-1039 · Adrian Pace</strong><small>Due 22 July</small></div><strong>€580</strong><span className={styles.statePill}>Sent</span></div>
        <div className={styles.invoiceRow}><span className={styles.invoiceIcon}><FileText size={18} /></span><div><strong>BDB-1034 · Northline Ltd.</strong><small>Overdue by 3 days</small></div><strong>€260</strong><span className={`${styles.statePill} ${styles.stateDanger}`}>Overdue</span></div>
      </section>
    </div>
  );
}

function CommunicationsView() {
  const [selected, setSelected] = useState(messages[0]);

  return (
    <div className={styles.viewStack}>
      <section className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>Communications</p><h1>One inbox. No platform hunting.</h1><p>BDB identifies the customer and keeps every conversation in their record.</p></div>
        <button className={styles.secondaryButton} type="button"><Search size={17} /> Search inbox</button>
      </section>
      <section className={styles.inboxPanel}>
        <div className={styles.inboxList}>
          <div className={styles.inboxHeader}><strong>Inbox</strong><span>2 new</span></div>
          {messages.map((message) => (
            <button className={`${styles.messageRow} ${selected.name === message.name ? styles.messageRowActive : ""}`} type="button" key={message.name} onClick={() => setSelected(message)}>
              <span className={styles.avatar}>{message.initials}</span>
              <span><strong>{message.name}</strong><small>{message.channel} · {message.preview}</small></span>
              <span className={styles.messageMeta}>{message.time}{message.unread ? <i /> : null}</span>
            </button>
          ))}
        </div>
        <div className={styles.conversation}>
          <div className={styles.conversationHeader}><div><strong>{selected.name}</strong><small>{selected.channel} · linked to {selected.name}</small></div><button className={styles.iconButton} type="button" aria-label="Conversation options"><MoreHorizontal size={19} /></button></div>
          <div className={styles.chatArea}>
            <div className={styles.bubbleIncoming}>Hi, just checking that everything is still okay for this morning?</div>
            <div className={styles.bubbleOutgoing}>Everything is confirmed for 09:30. Please bring the signed documents with you.</div>
            <div className={styles.bubbleIncoming}>{selected.preview}</div>
          </div>
          <div className={styles.aiSuggestion}>
            <span><Sparkles size={17} /></span>
            <div><strong>Suggested reply</strong><p>Perfect, thank you. We’ll see you at 09:30.</p></div>
            <button type="button">Use draft</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function MoreView({ role }: { role: Role }) {
  const items = [
    { icon: FileText, title: "Documents", text: "Files linked to customers and work." },
    { icon: Landmark, title: "Banking", text: "Balances and payment matching.", ownerOnly: true },
    { icon: FolderOpen, title: "Reports", text: "Useful detail when you need it.", ownerOnly: true },
    { icon: Sparkles, title: "Automation", text: "Suggestions that always need approval.", ownerOnly: true },
    { icon: Settings2, title: "Settings", text: "Business preferences and access." },
  ].filter((item) => !(role === "staff" && item.ownerOnly));

  return (
    <div className={styles.viewStack}>
      <section className={styles.pageHeading}>
        <div><p className={styles.eyebrow}>More</p><h1>Secondary tools, kept out of the way.</h1><p>The main workspace stays calm. Less frequent departments remain one step away.</p></div>
      </section>
      <section className={styles.moreGrid}>
        {items.map((item) => {
          const Icon = item.icon;
          return <button className={styles.moreCard} type="button" key={item.title}><span><Icon size={22} /></span><div><strong>{item.title}</strong><small>{item.text}</small></div><ChevronRight size={18} /></button>;
        })}
      </section>
      <aside className={styles.roleNote}><Check size={17} /><div><strong>Role-aware by default</strong><p>{role === "owner" ? "You can see financial and management departments." : "Financial and management departments are hidden for staff, not merely disabled and left cluttering the screen."}</p></div></aside>
    </div>
  );
}

function MainView({ active, setActive, role }: { active: DepartmentId; setActive: (id: DepartmentId) => void; role: Role }) {
  if (active === "customers") return <CustomersView />;
  if (active === "calendar") return <CalendarView />;
  if (active === "accounts") return <AccountsView />;
  if (active === "communications") return <CommunicationsView />;
  if (active === "more") return <MoreView role={role} />;
  return <HubView setActive={setActive} role={role} />;
}

function ContextPanel({ active }: { active: DepartmentId }) {
  const contextTitle = active === "hub" ? "Today" : active === "customers" ? "Maya Collins" : active === "calendar" ? "Friday 17 July" : active === "accounts" ? "Accounts signal" : active === "communications" ? "Customer context" : "Workspace";

  return (
    <aside className={styles.contextPanel}>
      <div className={styles.contextTop}><p className={styles.eyebrow}>{contextTitle}</p><button className={styles.iconButton} type="button" aria-label="Notifications"><Bell size={18} /><i /></button></div>
      <div className={styles.contextDate}><strong>17</strong><span>Friday<br />July 2026</span></div>
      <div className={styles.contextTimeline}>
        <div><time>09:30</time><span /><p><strong>Maya Collins</strong><small>Consultation</small></p></div>
        <div><time>11:15</time><span /><p><strong>Adrian Pace</strong><small>Video follow-up</small></p></div>
        <div><time>14:00</time><span /><p><strong>Sofia Rossi</strong><small>Needs confirmation</small></p></div>
      </div>
      <button className={styles.contextAction} type="button"><CalendarDays size={17} /><span><strong>Open today’s calendar</strong><small>4 appointments · 1 pending</small></span><ChevronRight size={17} /></button>
      <div className={styles.offlineCard}><WifiOff size={17} /><div><strong>Core work stays available</strong><p>Cached records and queued changes continue offline. AI and external integrations pause until reconnect.</p></div></div>
    </aside>
  );
}

export default function ClientExperiencePreview() {
  const [role, setRole] = useState<Role>("owner");
  const [active, setActive] = useState<DepartmentId>("hub");
  const [online, setOnline] = useState(true);

  const visibleDepartments = useMemo(
    () => departments.filter((department) => !(role === "staff" && department.ownerOnly)),
    [role],
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (role === "staff" && active === "accounts") setActive("hub");
  }, [active, role]);

  return (
    <div className={styles.previewRoot}>
      <header className={styles.topbar}>
        <div className={styles.brandLockup}><BdbMark small /><div><strong>BDB OS</strong><small>Client Experience V1</small></div></div>
        <div className={styles.previewNotice}><span>Design preview</span><p>Static data · no production records</p></div>
        <div className={styles.topbarActions}>
          <div className={styles.roleSwitch} aria-label="Preview role">
            <button className={role === "owner" ? styles.roleActive : ""} type="button" onClick={() => setRole("owner")}>Owner</button>
            <button className={role === "staff" ? styles.roleActive : ""} type="button" onClick={() => setRole("staff")}>Staff</button>
          </div>
          <StatusPill online={online} />
          <span className={styles.profile}>NB</span>
        </div>
      </header>

      <div className={styles.appFrame}>
        <aside className={styles.navRail}>
          <div className={styles.clientIdentity}><span className={styles.clientLogo}>H&S</span><div><strong>Harbour & Stone</strong><small>Business workspace</small></div></div>
          <nav aria-label="Preview departments">
            {visibleDepartments.map((department) => {
              const Icon = department.icon;
              return (
                <button className={active === department.id ? styles.navActive : ""} type="button" key={department.id} onClick={() => setActive(department.id)} aria-pressed={active === department.id}>
                  <Icon size={19} /><span>{department.label}</span>{active === department.id ? <i /> : null}
                </button>
              );
            })}
          </nav>
          <div className={styles.navFooter}><span className={styles.profile}>NB</span><div><strong>Niki Bianchini</strong><small>{role === "owner" ? "Owner" : "Staff member"}</small></div></div>
        </aside>

        <main className={styles.mainCanvas}>
          <div key={`${active}-${role}`} className={styles.viewTransition}>
            <MainView active={active} setActive={setActive} role={role} />
          </div>
        </main>

        <ContextPanel active={active} />
      </div>

      <nav className={styles.mobileNav} aria-label="Mobile preview navigation">
        {visibleDepartments.slice(0, 5).map((department) => {
          const Icon = department.icon;
          return <button className={active === department.id ? styles.mobileActive : ""} type="button" key={department.id} onClick={() => setActive(department.id)}><Icon size={19} /><span>{department.shortLabel}</span></button>;
        })}
      </nav>
    </div>
  );
}

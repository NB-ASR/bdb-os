"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Inbox,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  WalletCards,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BdbMonogram } from "@/components/brand";
import { formatDate, formatMoney } from "@/lib/format";
import { buildSoloOperatorSnapshot, type SoloOperatorView } from "@/lib/solo-operator";
import { buildSoloOperatorPreviewState } from "@/lib/solo-operator-preview";
import { useBdb } from "@/lib/store";
import styles from "@/app/solo-operator/solo-operator.module.css";

type PolicyMode = "assist" | "approval" | "bounded";

const navigation: Array<{ view: SoloOperatorView; label: string; icon: typeof LayoutDashboard }> = [
  { view: "today", label: "Today", icon: LayoutDashboard },
  { view: "customers", label: "Customers", icon: UsersRound },
  { view: "calendar", label: "Calendar", icon: CalendarDays },
  { view: "inbox", label: "Inbox", icon: Inbox },
  { view: "money", label: "Money", icon: CircleDollarSign },
  { view: "documents", label: "Documents", icon: FileText },
  { view: "operator", label: "Operator", icon: Sparkles },
];

const policyDefinitions = [
  {
    id: "appointment-reminders",
    title: "Appointment reminders",
    description: "Prepare reminders from verified appointments and stop when the booking changes or is cancelled.",
  },
  {
    id: "invoice-follow-up",
    title: "Invoice follow-up",
    description: "Check payment state and customer history before preparing any overdue reminder.",
  },
  {
    id: "new-enquiries",
    title: "New enquiries",
    description: "Organise incoming enquiries, connect the customer record and draft the next response.",
  },
  {
    id: "document-filing",
    title: "Document filing",
    description: "Suggest the correct customer, appointment or financial record before filing the original.",
  },
];

const workflowDefinitions = [
  {
    title: "Protect the diary",
    icon: CalendarDays,
    steps: ["Detect upcoming appointments", "Check confirmation and customer preference", "Prepare reminder or exception", "Record the verified outcome"],
  },
  {
    title: "Stay on top of messages",
    icon: MessageSquareText,
    steps: ["Prioritise unread and sensitive messages", "Connect the customer history", "Draft the next step", "Require approval before external delivery"],
  },
  {
    title: "Protect cash flow",
    icon: WalletCards,
    steps: ["Watch due and overdue invoices", "Check recorded payments", "Prepare a proportionate follow-up", "Escalate disputes and mismatches"],
  },
  {
    title: "Keep records complete",
    icon: FileCheck2,
    steps: ["Capture the original document", "Suggest the linked business record", "Flag uncertain extraction", "Preserve an auditable history"],
  },
];

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SO";
}

function bookingMoment(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState}>
      <div>
        <span className={styles.emptyStateIcon}><CheckCircle2 size={24} /></span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function SoloOperatorExperience() {
  const pathname = usePathname();
  const preview = pathname.startsWith("/solo-operator-preview");
  const { state, ready, mode, role, syncStatus, lastError, clearError } = useBdb();
  const [now] = useState(() => new Date());
  const [activeView, setActiveView] = useState<SoloOperatorView>("today");
  const [online, setOnline] = useState(true);
  const [policies, setPolicies] = useState<Record<string, PolicyMode>>({
    "appointment-reminders": "approval",
    "invoice-follow-up": "assist",
    "new-enquiries": "approval",
    "document-filing": "assist",
  });
  const previewState = useMemo(() => buildSoloOperatorPreviewState(now), [now]);
  const workingState = preview ? previewState : state;
  const snapshot = useMemo(() => buildSoloOperatorSnapshot(workingState, now), [workingState, now]);
  const ownerFirstName = workingState.settings.ownerName.split(/\s+/)[0] || "there";
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);

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

  if (!preview && !ready) {
    return (
      <div className={styles.loading}>
        <div>
          <span className={styles.loadingIcon}><Loader2 size={25} /></span>
          <strong>Opening your Solo Operator</strong>
          <p>Connecting customers, appointments, communications and money.</p>
        </div>
      </div>
    );
  }

  const futureBookings = [...workingState.bookings]
    .filter((booking) => booking.status !== "completed" && bookingMoment(booking.date, booking.time).getTime() >= now.getTime())
    .sort((left, right) => bookingMoment(left.date, left.time).getTime() - bookingMoment(right.date, right.time).getTime());
  const sortedMessages = [...workingState.messages].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const sortedInvoices = [...workingState.invoices].sort((left, right) => {
    const rank = { overdue: 0, sent: 1, draft: 2, paid: 3 } as const;
    return rank[left.status] - rank[right.status] || right.issuedAt.localeCompare(left.issuedAt);
  });
  const sortedDocuments = [...workingState.documents].sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  const paidAmount = workingState.invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const approvals = snapshot.actions.filter((action) => action.autonomy === "approval").length;
  const assisted = snapshot.actions.filter((action) => action.autonomy === "assist").length;

  const connectionLabel = preview
    ? "Preview data"
    : !online || syncStatus === "offline"
      ? "Offline · view only"
      : syncStatus === "saving"
        ? "Saving…"
        : syncStatus === "error"
          ? "Save failed"
          : syncStatus === "saved"
            ? "Changes saved"
            : mode === "demo"
              ? "Local workspace"
              : "Connected";
  const connectionTone = preview
    ? "online"
    : !online || syncStatus === "offline"
      ? "offline"
      : syncStatus === "error"
        ? "error"
        : syncStatus === "saving"
          ? "saving"
          : "online";
  const statusCopy = snapshot.status === "attention"
    ? { label: "Review needed", description: "Sensitive or overdue work is waiting for your decision." }
    : snapshot.status === "review"
      ? { label: "Plan ready", description: "The operator has organised the next useful actions for review." }
      : { label: "Caught up", description: "No urgent work is waiting. The operator is watching the connected records." };

  const navCount = (view: SoloOperatorView) => {
    if (view === "today") return snapshot.actions.length;
    if (view === "customers") return workingState.customers.length;
    if (view === "calendar") return snapshot.metrics.todayBookings;
    if (view === "inbox") return snapshot.metrics.unreadMessages;
    if (view === "money") return snapshot.metrics.overdueInvoices;
    if (view === "documents") return workingState.documents.length;
    return 0;
  };

  const openView = (view: SoloOperatorView) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: workingState.theme.reducedMotion ? "auto" : "smooth" });
  };

  const renderToday = () => (
    <>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{todayLabel}</p>
          <h1>Good morning, {ownerFirstName}. Here is what deserves you.</h1>
          <p className={styles.heroLead}>BDB Solo brings your calendar, conversations, customers and money into one operating plan. Routine work is organised; sensitive decisions remain yours.</p>
          <div className={styles.heroActions}>
            <button className={styles.primaryButton} type="button" onClick={() => openView("today")}>
              <Sparkles size={17} /> Review {snapshot.actions.length || "today's"} action{snapshot.actions.length === 1 ? "" : "s"}
            </button>
            <button className={styles.secondaryButton} type="button" onClick={() => openView("calendar")}>
              <CalendarDays size={17} /> Open today
            </button>
          </div>
        </div>
        <aside className={styles.heroState}>
          <div className={styles.stateTop}>
            <span className={styles.stateLabel}>Operator state</span>
            <div className={styles.stateValue} data-tone={snapshot.status}>{statusCopy.label}</div>
            <p className={styles.stateDescription}>{statusCopy.description}</p>
          </div>
          <div className={styles.stateBottom}>
            <div className={styles.stateMini}><span>Approvals</span><strong>{approvals} waiting</strong></div>
            <div className={styles.stateMini}><span>Prepared</span><strong>{assisted} assisted</strong></div>
          </div>
        </aside>
      </section>

      <section className={styles.metrics} aria-label="Today at a glance">
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><CalendarDays size={18} /></span>
          <strong className={styles.metricValue}>{snapshot.metrics.todayBookings}</strong>
          <span className={styles.metricLabel}>Appointments today</span>
          <small className={styles.metricDetail}>{snapshot.metrics.nextBooking ? `Next at ${snapshot.metrics.nextBooking.time}` : "Diary is clear"}</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><Inbox size={18} /></span>
          <strong className={styles.metricValue}>{snapshot.metrics.unreadMessages}</strong>
          <span className={styles.metricLabel}>Messages to review</span>
          <small className={styles.metricDetail}>{approvals ? `${approvals} need approval` : "No sensitive replies waiting"}</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><CircleDollarSign size={18} /></span>
          <strong className={styles.metricValue}>{formatMoney(snapshot.metrics.outstandingAmount, workingState.settings.currency)}</strong>
          <span className={styles.metricLabel}>Outstanding</span>
          <small className={styles.metricDetail}>{snapshot.metrics.openInvoices} open invoice{snapshot.metrics.openInvoices === 1 ? "" : "s"}</small>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricIcon}><BellRing size={18} /></span>
          <strong className={styles.metricValue}>{snapshot.metrics.overdueInvoices}</strong>
          <span className={styles.metricLabel}>Overdue invoices</span>
          <small className={styles.metricDetail}>{snapshot.metrics.overdueInvoices ? `${formatMoney(snapshot.metrics.overdueAmount, workingState.settings.currency)} needs follow-up` : "Nothing overdue"}</small>
        </article>
      </section>

      <section className={styles.gridTwo}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><h2>Your operator plan</h2><p>Prioritised from connected business records, not decorative dashboard guesses.</p></div>
            <span className={styles.miniBadge}><Sparkles size={11} /> {snapshot.actions.length} actions</span>
          </header>
          {snapshot.actions.length ? (
            <div className={styles.actionList}>
              {snapshot.actions.slice(0, 7).map((action) => (
                <div className={styles.actionCard} data-priority={action.priority} key={action.id}>
                  <span className={styles.actionMarker} />
                  <div className={styles.actionCopy}>
                    <div className={styles.actionTitleRow}>
                      <strong>{action.title}</strong>
                      <span className={styles.priorityBadge} data-priority={action.priority}>{action.priority}</span>
                      <span className={styles.autonomyBadge}>{action.autonomy === "approval" ? "Approval required" : "Assist"}</span>
                    </div>
                    <p>{action.detail}</p>
                    <span className={styles.recordBadge}>{action.recordLabel}</span>
                  </div>
                  <button className={styles.textButton} type="button" onClick={() => openView(action.destination)}>
                    Review <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nothing urgent is waiting" description="The connected records are currently in order. BDB Solo will surface the next exception or decision here." />}
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div><h2>Next appointments</h2><p>The nearest confirmed and pending bookings.</p></div>
            <button className={styles.textButton} type="button" onClick={() => openView("calendar")}>Calendar <ArrowRight size={13} /></button>
          </header>
          {futureBookings.length ? (
            <div className={styles.scheduleList}>
              {futureBookings.slice(0, 5).map((booking) => {
                const customer = workingState.customers.find((item) => item.id === booking.customerId);
                return (
                  <div className={styles.scheduleRow} key={booking.id}>
                    <span className={styles.timeBlock}>{booking.time}</span>
                    <div className={styles.rowCopy}>
                      <strong>{booking.title}</strong>
                      <span>{customer?.name ?? "Customer"} · {formatDate(booking.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                    </div>
                    <span className={styles.rowMeta}>{booking.status}</span>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="The diary is clear" description="Upcoming appointments will appear here with confirmation and reminder status." />}
        </article>
      </section>
    </>
  );

  const renderCustomers = () => (
    <>
      <PageHeader
        eyebrow="Customer memory"
        title="Every relationship, already briefed."
        description="Open balances, next appointments, recent messages and documents are connected around the customer rather than scattered across departments."
        action={!preview ? <Link className={styles.secondaryButton} href="/customers"><UsersRound size={16} /> Full customer records</Link> : undefined}
      />
      {snapshot.customers.length ? (
        <div className={styles.customerGrid}>
          {snapshot.customers.map((item) => (
            <article className={styles.customerCard} key={item.customer.id}>
              <div className={styles.customerTop}>
                <span className={styles.customerAvatar}>{initials(item.customer.name)}</span>
                <div><strong>{item.customer.name}</strong><span>{item.customer.company || item.customer.code}</span></div>
              </div>
              <div className={styles.customerSignals}>
                <div className={styles.customerSignal}><span>Open balance</span><strong>{formatMoney(item.openBalance, workingState.settings.currency)}</strong></div>
                <div className={styles.customerSignal}><span>Unread</span><strong>{item.unreadMessages} message{item.unreadMessages === 1 ? "" : "s"}</strong></div>
                <div className={styles.customerSignal}><span>Next booking</span><strong>{item.nextBooking ? `${item.nextBooking.date} · ${item.nextBooking.time}` : "None"}</strong></div>
                <div className={styles.customerSignal}><span>Documents</span><strong>{item.documentCount}</strong></div>
              </div>
              <div className={styles.customerFoot}>{item.lastMessage ? `Latest: ${item.lastMessage.subject}` : "No communication recorded yet."}</div>
            </article>
          ))}
        </div>
      ) : <div className={styles.panel}><EmptyState title="No customers yet" description="Add a customer to connect their appointments, messages, invoices and documents." /></div>}
    </>
  );

  const renderCalendar = () => (
    <>
      <PageHeader
        eyebrow="Calendar operator"
        title="Protect the day before it becomes a problem."
        description="Appointments are ordered by what happens next: confirmation, customer preference, reminder readiness and exceptions."
        action={!preview ? <Link className={styles.secondaryButton} href="/calendar"><CalendarDays size={16} /> Full calendar</Link> : undefined}
      />
      <div className={styles.gridTwo}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>Upcoming schedule</h2><p>Confirmed and pending customer work.</p></div><span className={styles.miniBadge}>{futureBookings.length} upcoming</span></header>
          {futureBookings.length ? (
            <div className={styles.scheduleList}>
              {futureBookings.map((booking) => {
                const customer = workingState.customers.find((item) => item.id === booking.customerId);
                return (
                  <div className={styles.scheduleRow} key={booking.id}>
                    <span className={styles.timeBlock}>{booking.time}</span>
                    <div className={styles.rowCopy}>
                      <strong>{booking.title}</strong>
                      <span>{customer?.name ?? "Customer"} · {booking.duration} minutes · {formatDate(booking.date, { weekday: "long", day: "numeric", month: "short" })}</span>
                    </div>
                    <span className={styles.priorityBadge} data-priority={booking.status === "pending" ? "today" : "upcoming"}>{booking.status}</span>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No upcoming appointments" description="New bookings will be checked for confirmation, timing and reminder readiness." />}
        </article>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>Reminder boundary</h2><p>What the operator may do without pretending to be you.</p></div><ShieldCheck size={19} /></header>
          <div className={styles.panelPad}>
            <div className={styles.policyNotice}><ShieldCheck size={20} /><div><strong>Approval-first by default</strong><p>Appointment changes, cancellations and sensitive customer replies always return to you. Routine reminders can graduate to bounded autopilot only after a verified provider workflow exists.</p></div></div>
            <ul className={styles.workflowSteps}>
              <li>Check that the appointment still exists and is not completed.</li>
              <li>Check customer preference and business reminder policy.</li>
              <li>Prepare the message with the exact date and time.</li>
              <li>Record provider acceptance, delivery failure or exception.</li>
            </ul>
          </div>
        </article>
      </div>
    </>
  );

  const renderInbox = () => (
    <>
      <PageHeader
        eyebrow="Communications operator"
        title="One inbox. Clear next steps."
        description="The operator prioritises messages and connects the customer context. This branch records and prepares work; it does not claim external delivery without a configured provider."
        action={!preview ? <Link className={styles.secondaryButton} href="/communications"><MessageSquareText size={16} /> Full communications</Link> : undefined}
      />
      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><h2>Conversation queue</h2><p>Unread, approval-gated and recently handled communications.</p></div><span className={styles.miniBadge}>{snapshot.metrics.unreadMessages} unread</span></header>
        {sortedMessages.length ? (
          <div className={styles.messageList}>
            {sortedMessages.map((message) => {
              const customer = workingState.customers.find((item) => item.id === message.customerId);
              return (
                <div className={styles.messageRow} key={message.id}>
                  <span className={styles.channelIcon}>{message.unread ? <Inbox size={18} /> : <MessageSquareText size={18} />}</span>
                  <div className={styles.rowCopy}>
                    <strong>{message.subject}</strong>
                    <span>{customer?.name ?? "Customer"} · {message.channel}</span>
                    <small>{message.preview}</small>
                  </div>
                  <div className={styles.rowMeta}>
                    <span className={styles.priorityBadge} data-priority={message.status === "approval" ? "urgent" : message.unread ? "today" : "upcoming"}>{message.status === "approval" ? "approval" : message.unread ? "unread" : "handled"}</span>
                    <div>{formatDate(message.timestamp, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="Inbox is clear" description="Connected customer communications will appear here with their status and next action." />}
      </article>
    </>
  );

  const renderMoney = () => (
    <>
      <PageHeader
        eyebrow="Money operator"
        title="Know what came in, what is due and what needs you."
        description="BDB Solo simplifies invoices, balances and payment follow-up without presenting fabricated bank balances or making accounting decisions."
        action={!preview ? <Link className={styles.secondaryButton} href="/accounts"><ReceiptText size={16} /> Full accounts</Link> : undefined}
      />
      <section className={styles.moneySummary}>
        <article className={styles.moneySummaryCard}><span>Received</span><strong>{formatMoney(paidAmount, workingState.settings.currency)}</strong><small>From invoices recorded as paid</small></article>
        <article className={styles.moneySummaryCard}><span>Outstanding</span><strong>{formatMoney(snapshot.metrics.outstandingAmount, workingState.settings.currency)}</strong><small>{snapshot.metrics.openInvoices} invoices still open</small></article>
        <article className={styles.moneySummaryCard}><span>Overdue</span><strong>{formatMoney(snapshot.metrics.overdueAmount, workingState.settings.currency)}</strong><small>{snapshot.metrics.overdueInvoices} require review</small></article>
      </section>
      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><h2>Invoice attention queue</h2><p>Payment state first; follow-up second.</p></div><span className={styles.miniBadge}><ShieldCheck size={11} /> Approval gated</span></header>
        {sortedInvoices.length ? (
          <div className={styles.invoiceList}>
            {sortedInvoices.map((invoice) => {
              const customer = workingState.customers.find((item) => item.id === invoice.customerId);
              return (
                <div className={styles.invoiceRow} key={invoice.id}>
                  <span className={styles.channelIcon}>{invoice.status === "paid" ? <CheckCircle2 size={18} /> : <ReceiptText size={18} />}</span>
                  <div className={styles.rowCopy}>
                    <strong>{invoice.number} · {customer?.name ?? "Customer"}</strong>
                    <span>{invoice.description}</span>
                    <small>Due {formatDate(invoice.dueAt)}</small>
                  </div>
                  <div className={styles.rowMeta}>
                    <strong className={styles.invoiceAmount}>{formatMoney(invoice.amount, workingState.settings.currency)}</strong>
                    <span className={styles.priorityBadge} data-priority={invoice.status === "overdue" ? "urgent" : invoice.status === "sent" ? "today" : "upcoming"}>{invoice.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="No invoices recorded" description="Invoices and their confirmed payment state will appear here." />}
      </article>
    </>
  );

  const renderDocuments = () => (
    <>
      <PageHeader
        eyebrow="Document operator"
        title="The original file, connected to the work."
        description="Customer files, agreements, receipts and supplier documents stay linked to the records they support, with uncertain extraction returned for review."
        action={!preview ? <Link className={styles.secondaryButton} href="/documents"><FileText size={16} /> Full documents</Link> : undefined}
      />
      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><h2>Recent documents</h2><p>Stored originals and their linked business context.</p></div><span className={styles.miniBadge}>{workingState.documents.length} files</span></header>
        {sortedDocuments.length ? (
          <div className={styles.documentList}>
            {sortedDocuments.map((document) => (
              <div className={styles.documentRow} key={document.id}>
                <span className={styles.fileIcon}><FileText size={18} /></span>
                <div className={styles.rowCopy}>
                  <strong>{document.name}</strong>
                  <span>{document.type} · {document.size}</span>
                  <small>Linked to {document.linkedTo}</small>
                </div>
                <span className={styles.rowMeta}>{formatDate(document.uploadedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No documents yet" description="Uploaded originals will appear here after they are safely stored and linked." />}
      </article>
    </>
  );

  const renderOperator = () => (
    <>
      <PageHeader
        eyebrow="Bounded autonomy"
        title="Choose what BDB prepares, what you approve and what may run."
        description="The operator is governed workflow by workflow. Financial decisions, disputes, destructive actions and sensitive communication stay human-controlled."
      />
      <div className={styles.policyNotice}>
        <ShieldCheck size={22} />
        <div><strong>Draft branch safety boundary</strong><p>These controls demonstrate the product policy model. No external message, payment action or autonomous financial change is enabled on this branch.</p></div>
      </div>
      <section className={styles.policyGrid}>
        {policyDefinitions.map((policy) => (
          <article className={styles.policyCard} key={policy.id}>
            <h3>{policy.title}</h3>
            <p>{policy.description}</p>
            <div className={styles.modeRow} aria-label={`${policy.title} autonomy mode`}>
              {(["assist", "approval", "bounded"] as PolicyMode[]).map((modeOption) => (
                <button
                  className={`${styles.modeButton} ${policies[policy.id] === modeOption ? styles.modeButtonActive : ""}`}
                  key={modeOption}
                  type="button"
                  onClick={() => setPolicies((current) => ({ ...current, [policy.id]: modeOption }))}
                >
                  {modeOption === "assist" ? "Assist" : modeOption === "approval" ? "Approve" : "Autopilot"}
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
      <PageHeader eyebrow="Operator coverage" title="Four complete outcomes, not forty disconnected features." description="The €100–€150 tier becomes credible when these workflows reliably remove recurring administration and return only exceptions." />
      <section className={styles.workflowGrid}>
        {workflowDefinitions.map((workflow) => {
          const Icon = workflow.icon;
          return (
            <article className={styles.workflowCard} key={workflow.title}>
              <div className={styles.workflowTop}><span className={styles.workflowIcon}><Icon size={19} /></span><span className={styles.editionBadge}>V2 outcome</span></div>
              <h3>{workflow.title}</h3>
              <ul className={styles.workflowSteps}>{workflow.steps.map((step) => <li key={step}>{step}</li>)}</ul>
            </article>
          );
        })}
      </section>
    </>
  );

  const renderView = () => {
    if (activeView === "customers") return renderCustomers();
    if (activeView === "calendar") return renderCalendar();
    if (activeView === "inbox") return renderInbox();
    if (activeView === "money") return renderMoney();
    if (activeView === "documents") return renderDocuments();
    if (activeView === "operator") return renderOperator();
    return renderToday();
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <BdbMonogram href={preview ? "/solo-operator-preview" : "/solo-operator"} compact />
          <div className={styles.editionRow}><strong>BDB Solo</strong><span className={styles.editionBadge}>Operator</span></div>
        </div>
        <nav className={styles.nav} aria-label="Solo Operator navigation">
          <p className={styles.navLabel}>Your business</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            const count = navCount(item.view);
            return (
              <button
                className={`${styles.navButton} ${activeView === item.view ? styles.navButtonActive : ""}`}
                type="button"
                key={item.view}
                onClick={() => openView(item.view)}
                aria-current={activeView === item.view ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {count > 0 ? <span className={styles.navCount}>{count > 99 ? "99+" : count}</span> : activeView === item.view ? <ChevronRight size={14} /> : null}
              </button>
            );
          })}
        </nav>
        <div className={styles.promiseCard}>
          <span className={styles.promiseIcon}><ShieldCheck size={18} /></span>
          <strong>Approval-first operator</strong>
          <p>BDB prepares routine work and returns sensitive decisions, exceptions and financial judgement to you.</p>
        </div>
        <div className={styles.profile}>
          <span className={styles.avatar}>{initials(workingState.settings.ownerName)}</span>
          <div><strong>{workingState.settings.ownerName}</strong><span>{preview ? "Solo Operator preview" : `${role} · Solo workspace`}</span></div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <span className={styles.topbarTitleIcon}><UserRound size={17} /></span>
            <div><strong>{workingState.settings.businessName}</strong><span>Your business operator, built for one</span></div>
          </div>
          <div className={styles.topbarActions}>
            {preview ? <span className={styles.previewBadge}><Zap size={13} /> Product preview</span> : null}
            <span className={styles.statusBadge} data-tone={connectionTone}>
              {connectionTone === "offline" || connectionTone === "error" ? <WifiOff size={13} /> : <Wifi size={13} />}
              {connectionLabel}
            </span>
            <button className={styles.reviewButton} type="button" onClick={() => openView("today")}>
              <Sparkles size={15} /><span>Review queue</span>
            </button>
          </div>
        </header>

        <main className={styles.content}>
          {lastError && !preview ? (
            <div className={styles.errorBanner} role="alert"><WifiOff size={18} /><span>{lastError}</span><button type="button" onClick={clearError} aria-label="Dismiss error"><X size={17} /></button></div>
          ) : null}
          {renderView()}
          {preview ? (
            <div className={styles.policyNotice} style={{ marginTop: 22 }}>
              <Activity size={20} />
              <div><strong>Review environment only</strong><p>This route uses isolated fictional records generated for the current date. The protected Solo route uses the signed-in workspace and the same underlying BDB records.</p></div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Landmark,
  MessageSquareText,
  Plus,
  ReceiptText,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney, formatTimeAgo } from "@/lib/format";
import { Badge, Button, Card, SectionHeading, StatCard } from "@/components/ui";

const modules = [
  { name: "Accounts", description: "Invoices, payments and reconciliation", href: "/accounts", icon: CircleDollarSign },
  { name: "Customers", description: "Every relationship in one record", href: "/customers", icon: UsersRound },
  { name: "Calendar", description: "Bookings, people and availability", href: "/calendar", icon: CalendarDays },
  { name: "Communications", description: "One inbox across every channel", href: "/communications", icon: MessageSquareText },
  { name: "Documents", description: "Files connected to business records", href: "/documents", icon: FileText },
  { name: "Banking", description: "Cash position and transaction matching", href: "/banking", icon: Landmark },
  { name: "Reports", description: "Useful detail when you need it", href: "/reports", icon: BarChart3 },
  { name: "Automation", description: "Smart assistance with human approval", href: "/automation-hub", icon: Sparkles },
];

export default function WorkspacePage() {
  const { state } = useBdb();
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA");
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const paidInvoices = state.invoices.filter((item) => item.status === "paid");
  const paid = paidInvoices.reduce((sum, item) => sum + item.amount, 0);
  const openInvoices = state.invoices.filter((item) => ["sent", "overdue"].includes(item.status));
  const outstanding = openInvoices.reduce((sum, item) => sum + item.amount, 0);
  const overdue = state.invoices.filter((item) => item.status === "overdue");
  const unread = state.messages.filter((item) => item.unread).length;
  const today = state.bookings.filter((item) => item.date === todayKey);
  const pendingBookings = today.filter((item) => item.status === "pending").length;
  const nextBooking = [...state.bookings]
    .filter((item) => new Date(`${item.date}T${item.time}`).getTime() >= now.getTime())
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  const currentMonth = now.toISOString().slice(0, 7);
  const newCustomers = state.customers.filter((item) => item.createdAt.startsWith(currentMonth)).length;
  const actionCount = overdue.length + unread + pendingBookings;

  const focusItems: Array<{ title: string; detail: string; href: string }> = [];
  if (overdue.length > 0) {
    focusItems.push({
      title: `Review ${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`,
      detail: `${formatMoney(overdue.reduce((sum, item) => sum + item.amount, 0), state.settings.currency)} is overdue and needs follow-up.`,
      href: "/accounts",
    });
  }
  if (unread > 0) {
    focusItems.push({
      title: `Read ${unread} new message${unread === 1 ? "" : "s"}`,
      detail: "Open Communications to review the latest customer conversations.",
      href: "/communications",
    });
  }
  if (pendingBookings > 0) {
    focusItems.push({
      title: `Confirm ${pendingBookings} pending appointment${pendingBookings === 1 ? "" : "s"}`,
      detail: "Review today's calendar and confirm the remaining bookings.",
      href: "/calendar",
    });
  }
  if (focusItems.length === 0) {
    focusItems.push(state.customers.length === 0
      ? { title: "Add your first customer", detail: "Customer records connect appointments, invoices, messages and documents.", href: "/customers" }
      : { title: "Everything is in order", detail: "There are no urgent actions waiting in the workspace.", href: "/activity" });
  }

  return (
    <>
      <Card className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">{dateLabel}</p>
          <h1>Welcome to {state.settings.businessName}.</h1>
          <p className="page-description">A clear view of what needs attention, with every customer, appointment, invoice and document connected.</p>
          <div className="hero-actions">
            <Link href="/accounts"><Button><Plus size={17} /> New invoice</Button></Link>
            <Link href="/customers"><Button variant="secondary"><UsersRound size={17} /> Add customer</Button></Link>
          </div>
        </div>
        <div className="hero-signal">
          <p className="eyebrow">Today at a glance</p>
          <div className="signal-row"><span className="muted">Appointments</span><strong>{today.length}</strong></div>
          <div className="signal-row"><span className="muted">Unread messages</span><strong>{unread}</strong></div>
          <div className="signal-row"><span className="muted">Actions</span><strong>{actionCount}</strong></div>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Received" value={formatMoney(paid, state.settings.currency)} detail={`${paidInvoices.length} paid invoice${paidInvoices.length === 1 ? "" : "s"}`} icon={<ReceiptText size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstanding, state.settings.currency)} detail={openInvoices.length === 0 ? "No unpaid invoices" : `${openInvoices.length} invoice${openInvoices.length === 1 ? "" : "s"} open`} icon={<Clock3 size={19} />} />
        <StatCard label="Customers" value={String(state.customers.length)} detail={newCustomers === 0 ? "No new customers this month" : `${newCustomers} new this month`} icon={<UsersRound size={19} />} />
        <StatCard label="Next booking" value={nextBooking?.time ?? "Clear"} detail={nextBooking?.title ?? "No booking scheduled"} icon={<CalendarDays size={19} />} />
      </div>

      <SectionHeading title="Business departments" description="Open a department to continue the work." />
      <div className="module-grid">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Link key={module.href} href={module.href} className="card card-interactive module-card">
              <span className="module-icon"><Icon size={21} /></span>
              <h3>{module.name}</h3>
              <p>{module.description}</p>
              <ArrowUpRight className="module-arrow" size={17} />
            </Link>
          );
        })}
      </div>

      <div className="two-column" style={{ marginTop: 28 }}>
        <Card className="card-pad">
          <SectionHeading title="Your focus" description="Useful actions from live workspace records." action={<Badge tone="gold"><Sparkles size={11} /> Live</Badge>} />
          <div className="focus-list">
            {focusItems.slice(0, 3).map((item) => (
              <Link className="focus-item" href={item.href} key={item.title}>
                <span className="focus-dot" />
                <div><strong>{item.title}</strong><p>{item.detail}</p></div>
              </Link>
            ))}
          </div>
        </Card>
        <Card className="card-pad">
          <SectionHeading title="Recent activity" action={<Link href="/activity" className="link-button">View all</Link>} />
          {state.activity.length > 0 ? (
            <div className="quick-list">
              {state.activity.slice(0, 4).map((item) => (
                <div className="quick-row" key={item.id}>
                  <span className={`activity-icon ${item.tone}`}><Activity size={16} /></span>
                  <span className="quick-row-copy"><strong>{item.action}</strong><small>{item.detail}</small></span>
                  <span className="quick-row-time">{formatTimeAgo(item.timestamp)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="focus-item">
              <span className="activity-icon green"><CheckCircle2 size={16} /></span>
              <div><strong>No activity yet</strong><p>Actions taken in BDB OS will appear here automatically.</p></div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

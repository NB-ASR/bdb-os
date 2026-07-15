"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
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
import { formatDate, formatMoney, formatTimeAgo } from "@/lib/format";
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
  const paid = state.invoices.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const outstanding = state.invoices.filter((item) => ["sent", "overdue"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);
  const unread = state.messages.filter((item) => item.unread).length;
  const today = state.bookings.filter((item) => item.date === todayKey);
  const nextBooking = [...state.bookings].find((item) => new Date(`${item.date}T${item.time}`).getTime() >= now.getTime());

  return (
    <>
      <Card className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">{dateLabel}</p>
          <h1>Good morning, {state.settings.ownerName}. Your business is in order.</h1>
          <p className="page-description">A clear view of what needs your attention, with every record connected behind the scenes.</p>
          <div className="hero-actions">
            <Link href="/accounts"><Button><Plus size={17} /> New invoice</Button></Link>
            <Link href="/customers"><Button variant="secondary"><UsersRound size={17} /> Add customer</Button></Link>
          </div>
        </div>
        <div className="hero-signal">
          <p className="eyebrow">Today at a glance</p>
          <div className="signal-row"><span className="muted">Appointments</span><strong>{today.length}</strong></div>
          <div className="signal-row"><span className="muted">Unread messages</span><strong>{unread}</strong></div>
          <div className="signal-row"><span className="muted">Actions</span><strong>3</strong></div>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Received" value={formatMoney(paid, state.settings.currency)} detail="Across paid invoices" icon={<ReceiptText size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstanding, state.settings.currency)} detail="2 invoices need attention" icon={<Clock3 size={19} />} />
        <StatCard label="Customers" value={String(state.customers.length)} detail="1 new this month" icon={<UsersRound size={19} />} />
        <StatCard label="Next booking" value={nextBooking?.time ?? "Clear"} detail={nextBooking?.title ?? "No booking scheduled"} icon={<CalendarDays size={19} />} />
      </div>

      <SectionHeading title="Your workspace" description="Open a module when the detail becomes useful." />
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
          <SectionHeading title="Your focus" description="Three useful actions, no noise." action={<Badge tone="gold"><Sparkles size={11} /> Assisted</Badge>} />
          <div className="focus-list">
            <div className="focus-item"><span className="focus-dot" /><div><strong>Review the Vella payment match</strong><p>A £1,680 bank transaction closely matches overdue invoice BDB-1041. Your approval is required.</p></div></div>
            <div className="focus-item"><span className="focus-dot" /><div><strong>Reply to Daniel’s timeline question</strong><p>A draft response is ready in Communications. Nothing will be sent without you.</p></div></div>
            <div className="focus-item"><span className="focus-dot" /><div><strong>Prepare for the 14:30 discovery call</strong><p>Webb Property Group’s enquiry and draft invoice are connected to the booking.</p></div></div>
          </div>
        </Card>
        <Card className="card-pad">
          <SectionHeading title="Recent activity" action={<Link href="/activity" className="link-button">View all</Link>} />
          <div className="quick-list">
            {state.activity.slice(0, 4).map((item) => (
              <div className="quick-row" key={item.id}>
                <span className={`activity-icon ${item.tone}`}><Activity size={16} /></span>
                <span className="quick-row-copy"><strong>{item.action}</strong><small>{item.detail}</small></span>
                <span className="quick-row-time">{formatTimeAgo(item.timestamp)}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: "16px 0 0" }}>Last local save · {formatDate("2026-07-14T11:58:00Z", { hour: "2-digit", minute: "2-digit" })}</p>
        </Card>
      </div>
    </>
  );
}

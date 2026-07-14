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
import { useSaas } from "@/lib/saas/context";
import type { FeatureKey } from "@/lib/saas/types";
import { formatDate, formatMoney, formatTimeAgo } from "@/lib/format";
import { Badge, Button, Card, SectionHeading, StatCard } from "@/components/ui";

const modules: Array<{ name: string; description: string; href: string; feature: FeatureKey; icon: typeof CircleDollarSign }> = [
  { name: "Accounts", description: "Invoices, payments and reconciliation", href: "/accounts", feature: "accounts", icon: CircleDollarSign },
  { name: "Customers", description: "Every relationship in one record", href: "/customers", feature: "customers", icon: UsersRound },
  { name: "Calendar", description: "Bookings, people and availability", href: "/calendar", feature: "calendar", icon: CalendarDays },
  { name: "Communications", description: "One inbox across every channel", href: "/communications", feature: "communications", icon: MessageSquareText },
  { name: "Documents", description: "Files connected to business records", href: "/documents", feature: "documents", icon: FileText },
  { name: "Banking", description: "Cash position and transaction matching", href: "/banking", feature: "banking", icon: Landmark },
  { name: "Reports", description: "Useful detail when you need it", href: "/reports", feature: "reports", icon: BarChart3 },
  { name: "Automation", description: "Smart assistance with human approval", href: "/automation-hub", feature: "automation", icon: Sparkles },
];

export default function WorkspacePage() {
  const { state } = useBdb();
  const { loading, mode, workspace, user, hasFeature } = useSaas();

  if (loading) return <div className="page-loading"><span /><p>Opening your private workspace…</p></div>;
  if (mode === "live" && !workspace) return <Card className="empty-state onboarding-prompt"><h1>Your workspace is being prepared</h1><p>Your account is secure, but it is not attached to a client workspace yet. BDB controls provisioning so nobody can bypass an agreed contract.</p><a href="mailto:support@bdb-os.co.uk?subject=Connect%20my%20BDB%20workspace" className="button button-primary">Contact BDB support</a></Card>;

  const paid = state.invoices.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const outstanding = state.invoices.filter((item) => ["sent", "overdue"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);
  const unread = state.messages.filter((item) => item.unread).length;
  const todayString = new Date().toISOString().slice(0, 10);
  const today = state.bookings.filter((item) => item.date === todayString);
  const nowKey = `${todayString}${new Date().toTimeString().slice(0, 5)}`;
  const nextBooking = [...state.bookings].find((item) => `${item.date}${item.time}` >= nowKey);
  const firstName = user?.name.split(" ")[0] || state.settings.ownerName;

  return (
    <>
      <Card className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
          <h1>Good morning, {firstName}. Your business is in order.</h1>
          <p className="page-description">A clear view of what needs your attention, with every record connected inside {workspace?.name ?? state.settings.businessName}.</p>
          <div className="hero-actions">
            {hasFeature("accounts") ? <Link href="/accounts"><Button><Plus size={17} /> New invoice</Button></Link> : null}
            {hasFeature("customers") ? <Link href="/customers"><Button variant="secondary"><UsersRound size={17} /> Add customer</Button></Link> : null}
          </div>
        </div>
        <div className="hero-signal">
          <p className="eyebrow">Today at a glance</p>
          <div className="signal-row"><span className="muted">Appointments</span><strong>{today.length}</strong></div>
          <div className="signal-row"><span className="muted">Unread messages</span><strong>{unread}</strong></div>
          <div className="signal-row"><span className="muted">Actions</span><strong>{state.activity.length ? 3 : 0}</strong></div>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Received" value={formatMoney(paid, state.settings.currency)} detail="Across paid invoices" icon={<ReceiptText size={19} />} />
        <StatCard label="Outstanding" value={formatMoney(outstanding, state.settings.currency)} detail="Invoices needing attention" icon={<Clock3 size={19} />} />
        <StatCard label="Customers" value={String(state.customers.length)} detail="Connected business records" icon={<UsersRound size={19} />} />
        <StatCard label="Next booking" value={nextBooking?.time ?? "Clear"} detail={nextBooking?.title ?? "No booking scheduled"} icon={<CalendarDays size={19} />} />
      </div>

      <SectionHeading title="Your workspace" description="Your contract controls which connected tools appear here." />
      <div className="module-grid">
        {modules.filter((module) => hasFeature(module.feature)).map((module) => {
          const Icon = module.icon;
          return <Link key={module.href} href={module.href} className="card card-interactive module-card"><span className="module-icon"><Icon size={21} /></span><h3>{module.name}</h3><p>{module.description}</p><ArrowUpRight className="module-arrow" size={17} /></Link>;
        })}
      </div>

      <div className="two-column" style={{ marginTop: 28 }}>
        <Card className="card-pad"><SectionHeading title="Your focus" description="Useful actions, no noise." action={<Badge tone="gold"><Sparkles size={11} /> Assisted</Badge>} /><div className="focus-list"><div className="focus-item"><span className="focus-dot" /><div><strong>Review work awaiting approval</strong><p>BDB automation prepares the next step, but you remain in control.</p></div></div><div className="focus-item"><span className="focus-dot" /><div><strong>Prepare for the next appointment</strong><p>Customer history and connected records are ready from the calendar.</p></div></div></div></Card>
        <Card className="card-pad"><SectionHeading title="Recent activity" action={hasFeature("activity") ? <Link href="/activity" className="link-button">View all</Link> : undefined} /><div className="quick-list">{state.activity.slice(0, 4).map((item) => <div className="quick-row" key={item.id}><span className={`activity-icon ${item.tone}`}><Activity size={16} /></span><span className="quick-row-copy"><strong>{item.action}</strong><small>{item.detail}</small></span><span className="quick-row-time">{formatTimeAgo(item.timestamp)}</span></div>)}</div><p className="muted small" style={{ margin: "16px 0 0" }}>Last sync · {formatDate(new Date().toISOString(), { hour: "2-digit", minute: "2-digit" })}</p></Card>
      </div>
    </>
  );
}

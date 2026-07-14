"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Landmark,
  Menu,
  MessageSquareText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useBdb } from "@/lib/store";
import { useSaas } from "@/lib/saas/context";
import type { FeatureKey } from "@/lib/saas/types";
import { BdbBrand } from "./bdb-brand";
import { PwaInstallButton } from "./pwa-install";
import { SearchDialog } from "./search-dialog";

export const navigation: Array<{ name: string; href: string; feature: FeatureKey; icon: typeof Building2 }> = [
  { name: "Overview", href: "/workspace", feature: "overview", icon: Building2 },
  { name: "Accounts", href: "/accounts", feature: "accounts", icon: CircleDollarSign },
  { name: "Customers", href: "/customers", feature: "customers", icon: UsersRound },
  { name: "Calendar", href: "/calendar", feature: "calendar", icon: CalendarDays },
  { name: "Communications", href: "/communications", feature: "communications", icon: MessageSquareText },
  { name: "Documents", href: "/documents", feature: "documents", icon: FileText },
  { name: "Banking", href: "/banking", feature: "banking", icon: Landmark },
  { name: "Reports", href: "/reports", feature: "reports", icon: BarChart3 },
  { name: "Automation", href: "/automation-hub", feature: "automation", icon: Sparkles },
];

const routeFeatures: Record<string, FeatureKey> = Object.fromEntries(navigation.map((item) => [item.href, item.feature]));
routeFeatures["/activity"] = "activity";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, ready } = useBdb();
  const { workspace, user, role, loading, isPlatformAdmin, hasFeature } = useSaas();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <BdbBrand href="/workspace" compact onClick={() => setMobileOpen(false)} />
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>

        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={18} /><span>Search</span><kbd>⌘K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navigation.filter((item) => hasFeature(item.feature)).map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMobileOpen(false)}>
                <Icon size={19} /><span>{item.name}</span>{active ? <ChevronRight size={16} /> : null}
              </Link>
            );
          })}
          <p className="nav-label nav-label-lower">System</p>
          {hasFeature("activity") ? <Link href="/activity" className={pathname === "/activity" ? "active" : ""} onClick={() => setMobileOpen(false)}><Activity size={19} /><span>Activity</span></Link> : null}
          <Link href="/settings" className={pathname === "/settings" ? "active" : ""} onClick={() => setMobileOpen(false)}><Settings size={19} /><span>Settings</span></Link>
          {isPlatformAdmin ? <Link href="/admin" onClick={() => setMobileOpen(false)}><ShieldCheck size={19} /><span>BDB Admin</span></Link> : null}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-avatar">{initials(user?.name ?? state.settings.ownerName)}</div>
          <div className="profile-copy"><strong>{user?.name ?? state.settings.ownerName}</strong><small>{role ? `${role[0].toUpperCase()}${role.slice(1)}` : "Workspace member"}</small></div>
          <form action="/auth/signout" method="post"><button className="signout-button" aria-label="Sign out" title="Sign out">↗</button></form>
        </div>
      </aside>
      {mobileOpen ? <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

      <div className="app-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div className="topbar-title">
            <Building2 size={17} />
            <span>{workspace?.name ?? state.settings.businessName}</span>
            {workspace ? <small className={`workspace-status ${workspace.status}`}>{workspace.planName} · {workspace.status}</small> : null}
          </div>
          <div className="topbar-actions">
            <PwaInstallButton compact />
            <button className="topbar-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search workspace</span></button>
            <span className={`connection-pill ${online ? "online" : "offline"}`}>
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              {online ? "Synced" : "Offline · changes saved"}
            </span>
          </div>
        </header>
        <main className="main-content">{loading || !ready ? <div className="page-loading"><span /><p>Opening workspace…</p></div> : isLocked(pathname, hasFeature) ? <LockedModule /> : children}</main>
        <nav className="mobile-dock" aria-label="Mobile quick navigation">
          {navigation.filter((item) => ["overview", "customers", "calendar", "communications"].includes(item.feature) && hasFeature(item.feature)).map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}><Icon size={19} /><span>{item.name === "Communications" ? "Inbox" : item.name}</span></Link>; })}
          <button onClick={() => setMobileOpen(true)}><Menu size={19} /><span>More</span></button>
        </nav>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BDB";
}

function isLocked(pathname: string, hasFeature: (feature: FeatureKey) => boolean) {
  const feature = routeFeatures[pathname];
  return feature ? !hasFeature(feature) : false;
}

function LockedModule() {
  return <div className="locked-module"><span><ShieldCheck size={28} /></span><p className="eyebrow">Module not enabled</p><h1>This tool isn’t part of this workspace yet.</h1><p>Your records remain private and unchanged. A workspace owner can ask BDB to add this module to the company’s tailored contract.</p><a className="button button-primary" href="mailto:support@bdb-os.co.uk?subject=Add%20a%20module%20to%20our%20BDB%20workspace">Ask BDB about this feature</a><Link className="button button-secondary" href="/workspace">Back to overview</Link></div>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  BookOpen,
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
  Sparkles,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useBdb } from "@/lib/store";
import { SearchDialog } from "./search-dialog";

export const navigation = [
  { name: "Overview", href: "/", icon: Building2 },
  { name: "Accounts", href: "/accounts", icon: CircleDollarSign },
  { name: "Customers", href: "/customers", icon: UsersRound },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Communications", href: "/communications", icon: MessageSquareText },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Banking", href: "/banking", icon: Landmark },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Automation", href: "/automation-hub", icon: Sparkles },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state } = useBdb();
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
          <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark">B</span>
            <span><strong>BDB OS</strong><small>Business. Done. Better.</small></span>
          </Link>
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>

        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={18} /><span>Search</span><kbd>⌘K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMobileOpen(false)}>
                <Icon size={19} /><span>{item.name}</span>{active ? <ChevronRight size={16} /> : null}
              </Link>
            );
          })}
          <p className="nav-label nav-label-lower">System</p>
          <Link href="/activity" className={pathname === "/activity" ? "active" : ""} onClick={() => setMobileOpen(false)}><Activity size={19} /><span>Activity</span></Link>
          <Link href="/settings" className={pathname === "/settings" ? "active" : ""} onClick={() => setMobileOpen(false)}><Settings size={19} /><span>Settings</span></Link>
        </nav>

        <div className="sidebar-footer">
          <div className="profile-avatar">NB</div>
          <div><strong>{state.settings.ownerName}</strong><small>Workspace owner</small></div>
        </div>
      </aside>
      {mobileOpen ? <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

      <div className="app-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div className="topbar-title">
            <BookOpen size={17} />
            <span>{state.settings.businessName}</span>
          </div>
          <div className="topbar-actions">
            <button className="topbar-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search workspace</span></button>
            <span className={`connection-pill ${online ? "online" : "offline"}`}>
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              {online ? "Synced" : "Offline · changes saved"}
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

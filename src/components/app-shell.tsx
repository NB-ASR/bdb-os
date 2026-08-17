"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Landmark,
  Loader2,
  Menu,
  MessageSquareText,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Truck,
  UsersRound,
  Wifi,
  WifiOff,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useBdb } from "@/lib/store";
import { SearchDialog } from "./search-dialog";
import { BdbMonogram, PoweredByBdb } from "./brand";
import { MobileActions } from "./mobile-actions";
import styles from "./app-shell.module.css";

type NavigationItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  featureKey?: string;
};

type NavigationGroup = {
  name: string;
  icon: LucideIcon;
  children: NavigationItem[];
};

type NavigationEntry = NavigationItem | NavigationGroup;
type QuickAction = { key: string; label: string; href: string };

function isNavigationGroup(entry: NavigationEntry): entry is NavigationGroup {
  return "children" in entry;
}

const workspaceNavigation: NavigationEntry[] = [
  { name: "Overview", href: "/workspace", icon: Building2 },
  { name: "Accounts", href: "/accounts", icon: CircleDollarSign },
  { name: "Customers", href: "/customers", icon: UsersRound },
  {
    name: "Calendar",
    icon: CalendarDays,
    children: [
      { name: "Appointments", href: "/calendar", icon: CalendarDays, featureKey: "calendar" },
      { name: "Availability", href: "/calendar/availability", icon: Clock3, featureKey: "calendar" },
      { name: "Timesheets", href: "/calendar/timesheets", icon: Clock3, featureKey: "timesheets" },
      { name: "Meetings", href: "/calendar/meetings", icon: UsersRound, featureKey: "meetings" },
    ],
  },
  {
    name: "Catalogue",
    icon: Boxes,
    children: [
      { name: "Products", href: "/products", icon: Package, featureKey: "products" },
      { name: "Services", href: "/services", icon: Wrench, featureKey: "services" },
      { name: "Inventory", href: "/inventory", icon: Boxes, featureKey: "inventory" },
      { name: "Suppliers", href: "/suppliers", icon: Truck, featureKey: "suppliers" },
    ],
  },
  { name: "Sales", href: "/sales", icon: ShoppingBag, featureKey: "sales" },
  { name: "Communications", href: "/communications", icon: MessageSquareText },
  {
    name: "Documents",
    icon: FileText,
    children: [
      { name: "Document Library", href: "/documents", icon: FileText, featureKey: "documents" },
      { name: "Purchasing", href: "/documents/purchasing", icon: FileCheck2, featureKey: "purchasing" },
    ],
  },
  { name: "Banking", href: "/banking", icon: Landmark },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Automation", href: "/automation-hub", icon: Sparkles },
];

export const navigation: NavigationItem[] = workspaceNavigation.flatMap((entry) => (
  isNavigationGroup(entry) ? entry.children : [entry]
));

type LinkedWorkspace = {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  group_id: string | null;
  group_name: string | null;
  membership_role: string;
  access_profile: string;
  is_active: boolean;
};

type WorkspaceContext = {
  workspaces?: LinkedWorkspace[];
  currentWorkspaceId?: string | null;
  features?: Record<string, boolean>;
};

function roleLabel(role: string) {
  if (role === "staff") return "Employee";
  if (role === "admin") return "Administrator";
  return role ? `${role.slice(0, 1).toUpperCase()}${role.slice(1)}` : "Member";
}

function actionLabel(label: string) {
  return label.replace(/^(Add|Create|Record)\s+/i, "");
}

function BusinessSwitcher({ fallbackName, role, logoUrl, logoEnabled }: {
  fallbackName: string;
  role: string;
  logoUrl?: string | null;
  logoEnabled: boolean;
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<LinkedWorkspace[]>([]);
  const [current, setCurrent] = useState("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void fetch("/api/workspace/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!result) return;
        setWorkspaces(result.workspaces ?? []);
        setCurrent(result.currentWorkspaceId ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function switchWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === current) return;
    setSwitching(true);
    const response = await fetch("/api/workspace/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setSwitching(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      window.alert(result.error ?? "This business could not be opened.");
      return;
    }
    router.replace("/workspace");
    router.refresh();
  }

  const active = workspaces.find((workspace) => workspace.workspace_id === current) ?? workspaces[0];
  const businessName = active?.workspace_name ?? fallbackName;
  const initials = businessName.slice(0, 2).toUpperCase();

  return (
    <div className="topbar-business" title={workspaces.length > 1 ? "Switch connected business" : businessName}>
      <span className="topbar-business-mark">
        {logoEnabled && logoUrl ? <Image src={logoUrl} alt={`${businessName} logo`} width={38} height={38} unoptimized /> : initials}
      </span>
      <span className="topbar-business-copy">
        {workspaces.length > 1 ? (
          <select value={active?.workspace_id ?? ""} onChange={(event) => void switchWorkspace(event.target.value)} disabled={switching} aria-label="Switch connected business">
            {workspaces.map((workspace) => (
              <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}{workspace.group_name ? ` · ${workspace.group_name}` : ""}</option>
            ))}
          </select>
        ) : <strong>{businessName}</strong>}
        <small>{switching ? "Switching…" : roleLabel(active?.membership_role ?? role)}</small>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, mode, role, syncStatus, lastError, clearError } = useBdb();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>({});
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Calendar: true, Catalogue: true, Documents: true });
  const canManageTeam = ["owner", "admin", "manager"].includes(role);
  const connectionLabel = !online ? "Offline" : mode === "demo" ? "Local preview" : syncStatus === "saving" ? "Saving…" : syncStatus === "error" ? "Save failed" : syncStatus === "offline" ? "Offline" : "Connected";
  const connectionTone = !online || syncStatus === "offline" ? "offline" : syncStatus === "error" ? "error" : syncStatus === "saving" ? "saving" : "online";
  const showConnection = connectionTone !== "online" || mode === "demo";

  useEffect(() => {
    let active = true;
    void fetch("/api/workspace/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<WorkspaceContext> : null)
      .then(async (result) => {
        if (!active || !result) return;
        if (result.features) setEnabledFeatures(result.features);
        if (!result.currentWorkspaceId) return;
        const hubResponse = await fetch(`/api/business-hub?workspaceId=${encodeURIComponent(result.currentWorkspaceId)}`, { cache: "no-store" });
        const hubPayload = await hubResponse.json().catch(() => ({}));
        if (active && hubResponse.ok && hubPayload.ok) setQuickActions((hubPayload.result?.quickActions ?? []) as QuickAction[]);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [pathname]);

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

  useEffect(() => { setCreateOpen(false); }, [pathname]);

  function featureVisible(item: NavigationItem) {
    return !item.featureKey || enabledFeatures[item.featureKey];
  }

  function renderNavigationLink(item: NavigationItem, nested = false) {
    const active = pathname === item.href;
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} className={`${active ? "active" : ""} ${nested && active ? styles.activeChild : ""}`.trim()} onClick={() => setMobileOpen(false)}>
        <Icon size={19} /><span>{item.name}</span>{active ? <ChevronRight size={16} /> : null}
      </Link>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <span onClick={() => setMobileOpen(false)}><BdbMonogram href="/workspace" /></span>
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>

        <button className="sidebar-search" onClick={() => setSearchOpen(true)}><Search size={18} /><span>Search</span><kbd>⌘K</kbd></button>

        <nav className={`sidebar-nav ${styles.scrollNav}`} aria-label="Main navigation">
          <p className="nav-label">Business</p>
          {workspaceNavigation.map((entry) => {
            if (!isNavigationGroup(entry)) return featureVisible(entry) ? renderNavigationLink(entry) : null;
            const visibleChildren = entry.children.filter(featureVisible);
            if (visibleChildren.length === 0) return null;
            if (visibleChildren.length === 1) return renderNavigationLink(visibleChildren[0]);
            const activeGroup = visibleChildren.some((item) => pathname === item.href);
            const open = openGroups[entry.name] ?? activeGroup;
            const GroupIcon = entry.icon;
            return (
              <div className={styles.group} key={entry.name}>
                <button type="button" className={`${styles.groupButton} ${activeGroup ? styles.groupButtonActive : ""} ${open ? styles.groupButtonOpen : ""}`.trim()} onClick={() => setOpenGroups((current) => ({ ...current, [entry.name]: !open }))} aria-expanded={open}>
                  <GroupIcon size={19} /><span>{entry.name}</span><ChevronDown size={16} />
                </button>
                {open ? <div className={styles.groupChildren}>{visibleChildren.map((item) => renderNavigationLink(item, true))}</div> : null}
              </div>
            );
          })}
          <p className="nav-label nav-label-lower">Administration</p>
          {canManageTeam && <Link href="/team" className={pathname === "/team" ? "active" : ""} onClick={() => setMobileOpen(false)}><UsersRound size={19} /><span>Team</span>{pathname === "/team" ? <ChevronRight size={16} /> : null}</Link>}
          <Link href="/activity" className={pathname === "/activity" ? "active" : ""} onClick={() => setMobileOpen(false)}><Activity size={19} /><span>Activity</span></Link>
          <Link href="/settings" className={pathname === "/settings" ? "active" : ""} onClick={() => setMobileOpen(false)}><Settings size={19} /><span>Settings</span></Link>
        </nav>

        <div className="sidebar-footer">
          <div className="profile-avatar">{state.settings.ownerName.slice(0, 2).toUpperCase()}</div>
          <div><strong>{state.settings.ownerName}</strong><small>{roleLabel(role)}</small></div>
        </div>
        <PoweredByBdb />
      </aside>
      {mobileOpen ? <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

      <div className="app-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <BusinessSwitcher fallbackName={state.settings.businessName} role={role} logoUrl={state.theme.clientLogoUrl} logoEnabled={Boolean(enabledFeatures.custom_branding)} />
          <div className="topbar-actions">
            <MobileActions />
            <button className="topbar-search" onClick={() => setSearchOpen(true)} aria-label="Search across BDB OS"><Search size={17} /><span>Search across BDB OS…</span><kbd>⌘K</kbd></button>
            <div className="global-create">
              <button type="button" className="global-create-button" onClick={() => setCreateOpen((current) => !current)} disabled={!online || quickActions.length === 0} aria-expanded={createOpen}>
                <Plus size={16} /><span className="global-create-label">Create</span><ChevronDown size={14} />
              </button>
              {createOpen ? <div className="global-create-menu">{quickActions.map((action) => <Link href={action.href} key={action.key} onClick={() => setCreateOpen(false)}><span>{actionLabel(action.label)}</span><ChevronRight size={14} /></Link>)}</div> : null}
            </div>
            {showConnection ? <span className={`connection-pill ${connectionTone}`}>{!online || syncStatus === "offline" ? <WifiOff size={15} /> : <Wifi size={15} />}{connectionLabel}</span> : null}
          </div>
        </header>
        {lastError ? <div className="sync-error-banner" role="alert"><WifiOff size={18} /><span>{lastError}</span><button type="button" onClick={clearError} aria-label="Dismiss save error"><X size={17} /></button></div> : null}
        <main className="main-content">{children}</main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

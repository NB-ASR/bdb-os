"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  FileText,
  Landmark,
  Loader2,
  Menu,
  MessageSquareText,
  Package,
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
import { DevRoleSwitcher } from "./dev-role-switcher";
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

function isNavigationGroup(entry: NavigationEntry): entry is NavigationGroup {
  return "children" in entry;
}

const workspaceNavigation: NavigationEntry[] = [
  { name: "Overview", href: "/workspace", icon: Building2 },
  { name: "Accounts", href: "/accounts", icon: CircleDollarSign },
  { name: "Customers", href: "/customers", icon: UsersRound },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  {
    name: "Catalogue & Stock",
    icon: Boxes,
    children: [
      { name: "Inventory", href: "/inventory", icon: Boxes, featureKey: "inventory" },
      { name: "Products", href: "/products", icon: Package, featureKey: "products" },
      { name: "Services", href: "/services", icon: Wrench, featureKey: "services" },
      { name: "Suppliers", href: "/suppliers", icon: Truck, featureKey: "suppliers" },
    ],
  },
  { name: "Sales", href: "/sales", icon: ShoppingBag, featureKey: "sales" },
  { name: "Communications", href: "/communications", icon: MessageSquareText },
  { name: "Documents", href: "/documents", icon: FileText },
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

function BusinessSwitcher({ fallbackName }: { fallbackName: string }) {
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
    window.location.assign("/workspace");
  }

  if (workspaces.length <= 1) {
    return <div className="topbar-title"><BookOpen size={17} /><span>{fallbackName}</span></div>;
  }

  const active = workspaces.find((workspace) => workspace.workspace_id === current) ?? workspaces[0];
  return (
    <div className="topbar-title" title="Only explicitly linked companies appear here">
      {switching ? <Loader2 size={17} className="spin" /> : <Building2 size={17} />}
      <select
        value={active?.workspace_id ?? ""}
        onChange={(event) => void switchWorkspace(event.target.value)}
        disabled={switching}
        aria-label="Switch linked business"
        style={{ border: 0, background: "transparent", color: "inherit", font: "inherit", maxWidth: 260 }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.workspace_id} value={workspace.workspace_id}>
            {workspace.workspace_name}{workspace.group_name ? ` · ${workspace.group_name}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, mode, role, syncStatus, lastError, clearError } = useBdb();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "Catalogue & Stock": true });
  const canManageTeam = ["owner", "admin", "manager"].includes(role);
  const connectionLabel = !online
    ? "Offline · view only"
    : mode === "demo"
      ? "Local preview"
      : syncStatus === "saving"
        ? "Saving…"
        : syncStatus === "error"
          ? "Save failed"
          : syncStatus === "offline"
            ? "Offline · view only"
            : syncStatus === "saved"
              ? "Changes saved"
              : "Connected";
  const connectionTone = !online || syncStatus === "offline"
    ? "offline"
    : syncStatus === "error"
      ? "error"
      : syncStatus === "saving"
        ? "saving"
        : "online";

  useEffect(() => {
    let active = true;
    void fetch("/api/workspace/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<WorkspaceContext> : null)
      .then((result) => {
        if (active && result?.features) setEnabledFeatures(result.features);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

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

  function featureVisible(item: NavigationItem) {
    return !item.featureKey || enabledFeatures[item.featureKey];
  }

  function renderNavigationLink(item: NavigationItem, nested = false) {
    const active = pathname === item.href;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${active ? "active" : ""} ${nested && active ? styles.activeChild : ""}`.trim()}
        onClick={() => setMobileOpen(false)}
      >
        <Icon size={19} /><span>{item.name}</span>{active ? <ChevronRight size={16} /> : null}
      </Link>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <span onClick={() => setMobileOpen(false)}>
            {state.theme.clientLogoUrl ? (
              <Link href="/workspace" className="client-brand">
                <Image src={state.theme.clientLogoUrl} alt={`${state.settings.businessName} logo`} width={42} height={42} unoptimized />
                <span><strong>{state.settings.businessName}</strong><small>Business workspace</small></span>
              </Link>
            ) : <BdbMonogram href="/workspace" />}
          </span>
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>

        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={18} /><span>Search</span><kbd>⌘K</kbd>
        </button>

        <nav className={`sidebar-nav ${styles.scrollNav}`} aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {workspaceNavigation.map((entry) => {
            if (!isNavigationGroup(entry)) {
              return featureVisible(entry) ? renderNavigationLink(entry) : null;
            }

            const visibleChildren = entry.children.filter(featureVisible);
            if (visibleChildren.length === 0) return null;
            if (visibleChildren.length === 1) return renderNavigationLink(visibleChildren[0]);

            const activeGroup = visibleChildren.some((item) => pathname === item.href);
            const open = openGroups[entry.name] ?? activeGroup;
            const GroupIcon = entry.icon;
            return (
              <div className={styles.group} key={entry.name}>
                <button
                  type="button"
                  className={`${styles.groupButton} ${activeGroup ? styles.groupButtonActive : ""} ${open ? styles.groupButtonOpen : ""}`.trim()}
                  onClick={() => setOpenGroups((current) => ({ ...current, [entry.name]: !open }))}
                  aria-expanded={open}
                >
                  <GroupIcon size={19} /><span>{entry.name}</span><ChevronDown size={16} />
                </button>
                {open ? <div className={styles.groupChildren}>{visibleChildren.map((item) => renderNavigationLink(item, true))}</div> : null}
              </div>
            );
          })}
          <p className="nav-label nav-label-lower">Administration</p>
          {canManageTeam && (
            <Link href="/team" className={pathname === "/team" ? "active" : ""} onClick={() => setMobileOpen(false)}>
              <UsersRound size={19} /><span>Team Management</span>{pathname === "/team" ? <ChevronRight size={16} /> : null}
            </Link>
          )}
          <Link href="/activity" className={pathname === "/activity" ? "active" : ""} onClick={() => setMobileOpen(false)}><Activity size={19} /><span>Activity</span></Link>
          <Link href="/settings" className={pathname === "/settings" ? "active" : ""} onClick={() => setMobileOpen(false)}><Settings size={19} /><span>Settings</span></Link>
        </nav>

        <div className="sidebar-footer">
          <div className="profile-avatar">{state.settings.ownerName.slice(0, 2).toUpperCase()}</div>
          <div><strong>{state.settings.ownerName}</strong><small>{role === "staff" ? "Employee" : role}</small></div>
        </div>
        <PoweredByBdb />
      </aside>
      {mobileOpen ? <button className="sidebar-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}

      <div className="app-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <BusinessSwitcher fallbackName={state.settings.businessName} />
          <div className="topbar-actions">
            <DevRoleSwitcher />
            <MobileActions />
            <button className="topbar-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search workspace</span></button>
            <span className={`connection-pill ${connectionTone}`}>
              {!online || syncStatus === "offline" ? <WifiOff size={15} /> : <Wifi size={15} />}
              {connectionLabel}
            </span>
          </div>
        </header>
        {lastError ? (
          <div className="sync-error-banner" role="alert">
            <WifiOff size={18} />
            <span>{lastError}</span>
            <button type="button" onClick={clearError} aria-label="Dismiss save error"><X size={17} /></button>
          </div>
        ) : null}
        <main className="main-content">{children}</main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

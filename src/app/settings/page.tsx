"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  CreditCard,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import {
  readLastWorkspaceSettingsCache,
  readWorkspaceSettingsCache,
  writeWorkspaceSettingsCache,
} from "@/lib/modules/workspace-settings-cache";
import {
  AppearancePanel,
  BusinessPanel,
  RecoveryPanel,
  type Mode,
  type SettingsBundle,
} from "./core-settings-panels";
import { OperationsPanel } from "./operations-panel";
import { BillingPanel, TeamPanel } from "./team-billing-panels";
import styles from "./settings.module.css";

type Tab = "business" | "appearance" | "operations" | "team" | "billing" | "recovery";

const demoBundle: SettingsBundle = {
  workspaceId: "demo",
  businessName: "BDB OS Demo",
  legalName: "",
  ownerName: "Workspace Owner",
  email: "owner@business.com",
  phone: "",
  currency: "EUR",
  invoicePrefix: "INV",
  vatRate: 18,
  timezone: "Europe/Malta",
  theme: {
    preset: "obsidian-gold",
    mode: "dark",
    accentColor: "#d3a84b",
    fontFamily: "manrope",
    textScale: 1,
    density: "comfortable",
    highContrast: false,
    reducedMotion: false,
    clientLogoPath: null,
    clientLogoUrl: null,
  },
  access: { canManage: true, canRecover: false, supportReadOnly: false },
  recovery: { restorableRecordCount: 0 },
  cached: false,
  generatedAt: new Date(0).toISOString(),
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function TabButton({ active, icon, label, onClick }: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return <button type="button" className={active ? styles.activeTab : ""} onClick={onClick}>{icon}{label}</button>;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("business");
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [draft, setDraft] = useState<SettingsBundle>(demoBundle);
  const [mode, setMode] = useState<Mode>("cloud");
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        if (!navigator.onLine) {
          const cached = readLastWorkspaceSettingsCache<SettingsBundle>();
          if (cached) {
            const next = { ...cached, cached: true };
            setBundle(next);
            setDraft(next);
            setMode("cloud");
            setNotice("Showing the last trusted Settings snapshot while offline.");
            return;
          }
        }
        const preview = readWorkspaceSettingsCache<SettingsBundle>("demo") ?? demoBundle;
        setBundle(preview);
        setDraft(preview);
        setMode("demo");
        setNotice("Preview changes remain in this browser. Cloud recovery is not connected.");
        return;
      }

      const workspaceId = String(context.currentWorkspaceId);
      const response = await fetch(`/api/workspace/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Workspace settings could not be loaded.");
      const next = result.result as SettingsBundle;
      setBundle(next);
      setDraft(next);
      setMode("cloud");
      setNotice("");
      writeWorkspaceSettingsCache(next);
    } catch (loadError) {
      const cached = readLastWorkspaceSettingsCache<SettingsBundle>();
      if (cached) {
        const next = { ...cached, cached: true };
        setBundle(next);
        setDraft(next);
        setMode("cloud");
        setNotice("Showing the last trusted Settings snapshot while offline.");
      } else {
        setError(message(loadError, "Workspace settings could not be loaded."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const canManage = mode === "demo" || Boolean(bundle?.access.canManage);
  const canMutateCloud = mode === "cloud" && online && canManage && !bundle?.access.supportReadOnly;

  async function save() {
    setError("");
    setNotice("");
    if (mode === "demo") {
      const next = { ...draft, cached: false, generatedAt: new Date().toISOString() };
      setBundle(next);
      setDraft(next);
      writeWorkspaceSettingsCache(next);
      setNotice("Preview settings saved in this browser.");
      return;
    }
    if (!canMutateCloud) {
      setError("Reconnect with a workspace Owner or Manager account before changing settings.");
      return;
    }

    setBusy("settings");
    try {
      const response = await fetch("/api/workspace/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          action: "update_configuration",
          workspaceId: draft.workspaceId,
          businessName: draft.businessName,
          legalName: draft.legalName,
          ownerName: draft.ownerName,
          email: draft.email,
          phone: draft.phone,
          currency: draft.currency,
          invoicePrefix: draft.invoicePrefix,
          vatRate: draft.vatRate,
          timezone: draft.timezone,
          theme: draft.theme,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Workspace settings could not be saved.");
      setNotice("Workspace settings saved.");
      await load();
    } catch (saveError) {
      setError(message(saveError, "Workspace settings could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function logo(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (mode === "demo") {
      const reader = new FileReader();
      reader.onload = () => {
        const next = {
          ...draft,
          theme: {
            ...draft.theme,
            clientLogoPath: file.name,
            clientLogoUrl: typeof reader.result === "string" ? reader.result : null,
          },
        };
        setBundle(next);
        setDraft(next);
        writeWorkspaceSettingsCache(next);
        setNotice("Preview logo saved in this browser.");
      };
      reader.readAsDataURL(file);
      return;
    }
    if (!canMutateCloud) {
      setError("Reconnect with a workspace Owner or Manager account before uploading a logo.");
      return;
    }

    setBusy("logo");
    try {
      const form = new FormData();
      form.set("workspaceId", draft.workspaceId);
      form.set("file", file);
      const response = await fetch("/api/workspace/settings", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Workspace logo could not be saved.");
      setNotice("Workspace logo updated.");
      await load();
    } catch (logoError) {
      setError(message(logoError, "Workspace logo could not be saved."));
    } finally {
      setBusy("");
    }
  }

  if (loading && !bundle) {
    return <div className={styles.loading}><Loader2 className="spin" /><span>Opening workspace settings…</span></div>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace control"
        title="Settings"
        description="Manage business identity, operations, security, people, billing and verified recovery without creating a second source of truth."
        actions={<Button type="button" variant="quiet" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Refresh</Button>}
      />
      <div className={styles.statusRow}>
        <span>{mode === "cloud" ? "Cloud workspace" : "Browser preview"}</span>
        {!online ? <span><WifiOff size={14} /> Offline</span> : null}
        {bundle?.access.supportReadOnly ? <span>Read-only access</span> : null}
        {bundle?.cached ? <span>Cached snapshot</span> : null}
      </div>
      {error ? <div className="review-callout" role="alert"><ShieldCheck size={18} /><div><strong>Settings action blocked</strong><p>{error}</p></div></div> : null}
      {notice ? <div className={styles.notice} role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
      <div className={styles.tabs}>
        <TabButton active={tab === "business"} onClick={() => setTab("business")} icon={<Settings2 size={16} />} label="Business" />
        <TabButton active={tab === "appearance"} onClick={() => setTab("appearance")} icon={<Palette size={16} />} label="Appearance" />
        <TabButton active={tab === "operations"} onClick={() => setTab("operations")} icon={<SlidersHorizontal size={16} />} label="Operations & security" />
        <TabButton active={tab === "team"} onClick={() => setTab("team")} icon={<UsersRound size={16} />} label="Team & roles" />
        <TabButton active={tab === "billing"} onClick={() => setTab("billing")} icon={<CreditCard size={16} />} label="Plan & billing" />
        <TabButton active={tab === "recovery"} onClick={() => setTab("recovery")} icon={<ArchiveRestore size={16} />} label="Backup & restore" />
      </div>
      {tab === "business" ? <BusinessPanel draft={draft} setDraft={setDraft} canManage={canManage} online={mode === "demo" || online} saving={busy === "settings"} onSave={save} mode={mode} /> : null}
      {tab === "appearance" ? <AppearancePanel draft={draft} setDraft={setDraft} canManage={canManage} online={mode === "demo" || online} saving={busy === "settings"} uploading={busy === "logo"} onSave={save} onLogo={logo} /> : null}
      {tab === "operations" && bundle ? <OperationsPanel workspaceId={bundle.workspaceId} mode={mode} online={online} canManage={canManage} supportReadOnly={bundle.access.supportReadOnly} onNotice={setNotice} onError={setError} /> : null}
      {tab === "team" ? <TeamPanel mode={mode} canManage={canManage && online} /> : null}
      {tab === "billing" ? <BillingPanel mode={mode} /> : null}
      {tab === "recovery" && bundle ? <RecoveryPanel bundle={bundle} mode={mode} online={online} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} reload={load} /> : null}
    </>
  );
}

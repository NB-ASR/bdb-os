"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Accessibility,
  ArchiveRestore,
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  ImageUp,
  Loader2,
  Palette,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Upload,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { Button, Card, PageHeader, SectionHeading } from "@/components/ui";
import {
  readLastWorkspaceSettingsCache,
  readWorkspaceSettingsCache,
  writeWorkspaceSettingsCache,
} from "@/lib/modules/workspace-settings-cache";
import { BillingPanel, TeamPanel } from "./team-billing-panels";
import styles from "./settings.module.css";

type Tab = "business" | "appearance" | "team" | "billing" | "recovery";
type Mode = "cloud" | "demo";

type WorkspaceTheme = {
  preset: "obsidian-gold" | "ocean" | "forest" | "clay" | "slate" | "custom";
  mode: "dark" | "light" | "system";
  accentColor: string;
  fontFamily: "manrope" | "dm-sans" | "system";
  textScale: number;
  density: "compact" | "comfortable" | "spacious";
  highContrast: boolean;
  reducedMotion: boolean;
  clientLogoPath: string | null;
  clientLogoUrl: string | null;
};

type SettingsBundle = {
  workspaceId: string;
  businessName: string;
  legalName: string;
  ownerName: string;
  email: string;
  phone: string;
  currency: string;
  invoicePrefix: string;
  vatRate: number;
  timezone: string;
  theme: WorkspaceTheme;
  access: { canManage: boolean; canRecover: boolean; supportReadOnly: boolean };
  recovery: { restorableRecordCount: number };
  cached: boolean;
  generatedAt: string;
};

const presets: Array<{ id: WorkspaceTheme["preset"]; name: string; colours: string[] }> = [
  { id: "obsidian-gold", name: "Obsidian Gold", colours: ["#10100f", "#d3a84b"] },
  { id: "ocean", name: "Coastal Blue", colours: ["#112027", "#55a7c9"] },
  { id: "forest", name: "Evergreen", colours: ["#111d17", "#65a779"] },
  { id: "clay", name: "Warm Clay", colours: ["#201613", "#c47f62"] },
  { id: "slate", name: "Modern Slate", colours: ["#151820", "#8897ad"] },
  { id: "custom", name: "Custom", colours: ["#171715", "#d3a84b"] },
];

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
        description="Manage business identity, appearance, people, billing and verified recovery without creating a second source of truth."
        actions={<Button type="button" variant="quiet" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Refresh</Button>}
      />
      <div className={styles.statusRow}>
        <span>{mode === "cloud" ? "Cloud workspace" : "Browser preview"}</span>
        {!online ? <span><WifiOff size={14} /> Offline</span> : null}
        {bundle?.access.supportReadOnly ? <span>Founder support · read-only</span> : null}
        {bundle?.cached ? <span>Cached snapshot</span> : null}
      </div>
      {error ? <div className="review-callout" role="alert"><ShieldCheck size={18} /><div><strong>Settings action blocked</strong><p>{error}</p></div></div> : null}
      {notice ? <div className={styles.notice} role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
      <div className={styles.tabs}>
        <TabButton active={tab === "business"} onClick={() => setTab("business")} icon={<Settings2 size={16} />} label="Business" />
        <TabButton active={tab === "appearance"} onClick={() => setTab("appearance")} icon={<Palette size={16} />} label="Appearance" />
        <TabButton active={tab === "team"} onClick={() => setTab("team")} icon={<UsersRound size={16} />} label="Team & roles" />
        <TabButton active={tab === "billing"} onClick={() => setTab("billing")} icon={<CreditCard size={16} />} label="Plan & billing" />
        <TabButton active={tab === "recovery"} onClick={() => setTab("recovery")} icon={<ArchiveRestore size={16} />} label="Backup & restore" />
      </div>
      {tab === "business" ? <BusinessPanel draft={draft} setDraft={setDraft} canManage={canManage} online={mode === "demo" || online} saving={busy === "settings"} onSave={save} mode={mode} /> : null}
      {tab === "appearance" ? <AppearancePanel draft={draft} setDraft={setDraft} canManage={canManage} online={mode === "demo" || online} saving={busy === "settings"} uploading={busy === "logo"} onSave={save} onLogo={logo} /> : null}
      {tab === "team" ? <TeamPanel mode={mode} canManage={canManage && online} /> : null}
      {tab === "billing" ? <BillingPanel mode={mode} /> : null}
      {tab === "recovery" && bundle ? <RecoveryPanel bundle={bundle} mode={mode} online={online} busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} reload={load} /> : null}
    </>
  );
}

function BusinessPanel({ draft, setDraft, canManage, online, saving, onSave, mode }: {
  draft: SettingsBundle;
  setDraft: (value: SettingsBundle) => void;
  canManage: boolean;
  online: boolean;
  saving: boolean;
  onSave: () => Promise<void>;
  mode: Mode;
}) {
  const update = (key: keyof SettingsBundle, value: string | number) => setDraft({ ...draft, [key]: value });
  return (
    <div className={styles.twoColumn}>
      <Card className="settings-card">
        <SectionHeading title="Business profile" description="Shared identity and defaults used by Accounts, Sales, Communications and Reports." />
        <fieldset disabled={!canManage || !online || saving}>
          <div className="form-grid">
            <div className="field"><label>Business name</label><input required value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} /></div>
            <div className="field"><label>Legal name</label><input value={draft.legalName} onChange={(event) => update("legalName", event.target.value)} /></div>
            <div className="field"><label>Owner name</label><input required value={draft.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></div>
            <div className="field"><label>Business email</label><input type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} /></div>
            <div className="field"><label>Phone</label><input value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></div>
            <div className="field"><label>Currency</label><input maxLength={3} value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} /></div>
            <div className="field"><label>Invoice prefix</label><input maxLength={8} value={draft.invoicePrefix} onChange={(event) => update("invoicePrefix", event.target.value.toUpperCase())} /></div>
            <div className="field"><label>Default VAT rate (%)</label><input type="number" min="0" max="100" step="0.01" value={draft.vatRate} onChange={(event) => update("vatRate", Number(event.target.value))} /></div>
            <div className="field"><label>Timezone</label><input value={draft.timezone} onChange={(event) => update("timezone", event.target.value)} /></div>
          </div>
          <Button type="button" onClick={() => void onSave()} disabled={saving} style={{ marginTop: 18 }}><Save size={16} /> {saving ? "Saving…" : "Save profile"}</Button>
        </fieldset>
      </Card>
      <Card className="settings-note">
        <ShieldCheck size={22} />
        <h2 style={{ marginTop: 10 }}>{mode === "cloud" ? "Workspace protected" : "Safe preview mode"}</h2>
        <p>{mode === "cloud" ? "Identity and defaults are validated together through one trusted command. Operational departments remain authoritative for their own records." : "Preview settings remain in this browser and do not alter a cloud workspace."}</p>
      </Card>
    </div>
  );
}

function AppearancePanel({ draft, setDraft, canManage, online, saving, uploading, onSave, onLogo }: {
  draft: SettingsBundle;
  setDraft: (value: SettingsBundle) => void;
  canManage: boolean;
  online: boolean;
  saving: boolean;
  uploading: boolean;
  onSave: () => Promise<void>;
  onLogo: (file?: File) => Promise<void>;
}) {
  const theme = draft.theme;
  const setTheme = (next: WorkspaceTheme) => setDraft({ ...draft, theme: next });
  return (
    <div className={styles.twoColumn}>
      <Card className="settings-card">
        <SectionHeading title="Branding & appearance" description="A curated workspace identity with practical accessibility controls." />
        <fieldset disabled={!canManage || !online || saving}>
          <div className="theme-presets">
            {presets.map((preset) => (
              <button type="button" key={preset.id} className={theme.preset === preset.id ? "active" : ""} onClick={() => setTheme({ ...theme, preset: preset.id, accentColor: preset.colours[1] })}>
                <span>{preset.colours.map((colour) => <i style={{ background: colour }} key={colour} />)}</span>
                <strong>{preset.name}</strong>{theme.preset === preset.id ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
          <div className="appearance-form-grid">
            <div className="field"><label>Colour mode</label><select value={theme.mode} onChange={(event) => setTheme({ ...theme, mode: event.target.value as WorkspaceTheme["mode"] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match device</option></select></div>
            <div className="field"><label>Accent</label><input type="color" value={theme.accentColor} onChange={(event) => setTheme({ ...theme, preset: "custom", accentColor: event.target.value })} /></div>
            <div className="field"><label>Font</label><select value={theme.fontFamily} onChange={(event) => setTheme({ ...theme, fontFamily: event.target.value as WorkspaceTheme["fontFamily"] })}><option value="manrope">Manrope</option><option value="dm-sans">DM Sans</option><option value="system">System</option></select></div>
            <div className="field"><label>Density</label><select value={theme.density} onChange={(event) => setTheme({ ...theme, density: event.target.value as WorkspaceTheme["density"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></div>
            <div className="field field-full"><label>Text size · {Math.round(theme.textScale * 100)}%</label><input type="range" min="0.9" max="1.2" step="0.05" value={theme.textScale} onChange={(event) => setTheme({ ...theme, textScale: Number(event.target.value) })} /></div>
          </div>
          <div className="accessibility-options">
            <label><input type="checkbox" checked={theme.highContrast} onChange={(event) => setTheme({ ...theme, highContrast: event.target.checked })} /><Accessibility size={17} /><span><strong>Increased contrast</strong><small>Strengthens borders and secondary text.</small></span></label>
            <label><input type="checkbox" checked={theme.reducedMotion} onChange={(event) => setTheme({ ...theme, reducedMotion: event.target.checked })} /><Accessibility size={17} /><span><strong>Reduced motion</strong><small>Minimises animation and transitions.</small></span></label>
          </div>
          <Button type="button" onClick={() => void onSave()} disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Apply appearance"}</Button>
        </fieldset>
      </Card>
      <Card className="logo-upload-card">
        <SectionHeading title="Client logo" description="Stored privately inside this workspace." />
        <div className="logo-preview">
          {theme.clientLogoUrl ? <Image src={theme.clientLogoUrl} alt="Client logo" width={150} height={80} unoptimized /> : <span><ImageUp size={26} /> Your logo</span>}
        </div>
        <label className="button button-secondary file-button">
          {uploading ? <Loader2 className="spin" size={16} /> : <ImageUp size={16} />} {uploading ? "Uploading…" : "Upload logo"}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void onLogo(event.target.files?.[0])} disabled={!canManage || !online || uploading} />
        </label>
        <p>PNG, JPG, WebP or SVG · maximum 5 MB</p>
      </Card>
    </div>
  );
}

function RecoveryPanel({ bundle, mode, online, busy, setBusy, setError, setNotice, reload }: {
  bundle: SettingsBundle;
  mode: Mode;
  online: boolean;
  busy: string;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
  reload: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const requiredConfirmation = `RESTORE ${bundle.businessName}`;
  const canRecover = mode === "cloud" && online && bundle.access.canRecover && !bundle.access.supportReadOnly;
  const empty = bundle.recovery.restorableRecordCount === 0;

  async function download() {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/backup?workspaceId=${encodeURIComponent(bundle.workspaceId)}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Workspace snapshot could not be created.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "workspace.bdb-snapshot.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Verified workspace snapshot downloaded.");
    } catch (downloadError) {
      setError(message(downloadError, "Workspace snapshot could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError("Choose a BDB OS snapshot file.");
    setBusy("restore");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("workspaceId", bundle.workspaceId);
      form.set("confirmation", confirmation);
      form.set("file", file);
      const response = await fetch("/api/workspace/backup", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Workspace snapshot could not be restored.");
      setFile(null);
      setConfirmation("");
      setNotice("Workspace snapshot restored and recorded in Activity.");
      await reload();
    } catch (restoreError) {
      setError(message(restoreError, "Workspace snapshot could not be restored."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.recoveryGrid}>
      <Card className={styles.recoveryCard}>
        <SectionHeading title="Portable business snapshot" description="Exports structured Version 1 workspace records with a SHA-256 checksum and a storage-object manifest." />
        <div className={styles.recoveryFacts}>
          <span><strong>{bundle.recovery.restorableRecordCount}</strong><small>structured operational records</small></span>
          <span><strong>Same workspace</strong><small>recovery identity boundary</small></span>
          <span><strong>Owner only</strong><small>export and restore permission</small></span>
        </div>
        <Button type="button" onClick={() => void download()} disabled={!canRecover || busy === "export"}><Download size={16} /> {busy === "export" ? "Preparing…" : "Download snapshot"}</Button>
        {!canRecover ? <p className="muted">Snapshot export requires an online workspace Owner account.</p> : null}
      </Card>
      <Card className={styles.recoveryCard}>
        <SectionHeading title="Verified restore" description="Restores only into the original workspace after its operational records are empty." />
        {!empty ? <div className={styles.restoreBlocker}><ShieldCheck size={19} /><div><strong>Restore is locked</strong><p>{bundle.recovery.restorableRecordCount} operational records remain. BDB OS will not merge a snapshot into live data.</p></div></div> : null}
        <form onSubmit={restore}>
          <div className="field"><label>Snapshot file</label><input type="file" accept=".json,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={!canRecover || !empty || busy === "restore"} /></div>
          <div className="field" style={{ marginTop: 14 }}><label>Type {requiredConfirmation}</label><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={!canRecover || !empty || busy === "restore"} /></div>
          <Button type="submit" variant="secondary" style={{ marginTop: 18 }} disabled={!canRecover || !empty || !file || confirmation !== requiredConfirmation || busy === "restore"}><Upload size={16} /> {busy === "restore" ? "Restoring…" : "Restore snapshot"}</Button>
        </form>
      </Card>
      <Card className={styles.boundaryCard}>
        <ArchiveRestore size={22} />
        <h2>Recovery boundary</h2>
        <p>This is an application-level structured-data snapshot. It does not contain user accounts, roles, permissions, billing, subscriptions, support sessions, device tokens, command receipts, audit logs or file bytes.</p>
        <p>Document and logo paths are restored only when every referenced private Storage object still exists. Supabase infrastructure backups and point-in-time recovery remain a separate operator-controlled disaster-recovery layer.</p>
      </Card>
    </div>
  );
}

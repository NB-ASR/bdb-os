"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import {
  Accessibility,
  ArchiveRestore,
  Check,
  Download,
  ImageUp,
  Loader2,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button, Card, SectionHeading } from "@/components/ui";
import styles from "./settings.module.css";

export type Mode = "cloud" | "demo";

export type WorkspaceTheme = {
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

export type SettingsBundle = {
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

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function BusinessPanel({ draft, setDraft, canManage, online, saving, onSave, mode }: {
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

export function AppearancePanel({ draft, setDraft, canManage, online, saving, uploading, onSave, onLogo }: {
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

export function RecoveryPanel({ bundle, mode, online, busy, setBusy, setError, setNotice, reload }: {
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
        <p>This is an application-level structured-data snapshot. It does not contain user accounts, roles, permissions, billing, subscriptions, device tokens, command receipts, audit logs or file bytes.</p>
        <p>Document and logo paths are restored only when every referenced private Storage object still exists. Supabase infrastructure backups and point-in-time recovery remain a separate operator-controlled disaster-recovery layer.</p>
      </Card>
    </div>
  );
}

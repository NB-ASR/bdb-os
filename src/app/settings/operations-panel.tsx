"use client";

import Link from "next/link";
import {
  Activity,
  Archive,
  Bell,
  BellOff,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, SectionHeading } from "@/components/ui";
import styles from "./settings.module.css";

type Mode = "cloud" | "demo";
type ExportFormat = "csv" | "json";
type ArchiveDefault = "hide" | "show";
type ExportArea = "customers" | "products" | "services" | "suppliers" | "reports";

type OperationsBundle = {
  workspaceId: string;
  fiscalYearStartMonth: number;
  defaultExportFormat: ExportFormat;
  archivedRecordsDefault: ArchiveDefault;
  appointmentRemindersEnabled: boolean;
  pushSubscriptionCount: number;
  access: { canManage: boolean; supportReadOnly: boolean };
  system: {
    database: string;
    lastWorkspaceActivityAt: string | null;
    structuredOperationalRecordCount: number;
  };
  updatedAt: string | null;
  generatedAt: string;
};

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const areas: Array<{ value: ExportArea; label: string }> = [
  { value: "customers", label: "Customers" },
  { value: "products", label: "Products" },
  { value: "services", label: "Services" },
  { value: "suppliers", label: "Suppliers" },
  { value: "reports", label: "Reporting summary" },
];

const demoBundle: OperationsBundle = {
  workspaceId: "demo",
  fiscalYearStartMonth: 1,
  defaultExportFormat: "csv",
  archivedRecordsDefault: "hide",
  appointmentRemindersEnabled: true,
  pushSubscriptionCount: 0,
  access: { canManage: true, supportReadOnly: false },
  system: {
    database: "preview",
    lastWorkspaceActivityAt: null,
    structuredOperationalRecordCount: 0,
  },
  updatedAt: null,
  generatedAt: new Date(0).toISOString(),
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function base64Key(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function formatDate(value: string | null) {
  if (!value) return "No activity recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export function OperationsPanel({
  workspaceId,
  mode,
  online,
  canManage,
  supportReadOnly,
  onNotice,
  onError,
}: {
  workspaceId: string;
  mode: Mode;
  online: boolean;
  canManage: boolean;
  supportReadOnly: boolean;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const [bundle, setBundle] = useState<OperationsBundle | null>(null);
  const [draft, setDraft] = useState<OperationsBundle>(demoBundle);
  const [busy, setBusy] = useState("");
  const [area, setArea] = useState<ExportArea>("reports");

  const load = useCallback(async () => {
    if (mode === "demo") {
      const cached = window.localStorage.getItem("bdb-operations-preview-v1");
      const next = cached ? JSON.parse(cached) as OperationsBundle : demoBundle;
      setBundle(next);
      setDraft(next);
      return;
    }
    setBusy("load");
    try {
      const response = await fetch(`/api/workspace/operations?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Operational settings could not be loaded.");
      const next = result.result as OperationsBundle;
      setBundle(next);
      setDraft(next);
    } catch (error) {
      onError(message(error, "Operational settings could not be loaded."));
    } finally {
      setBusy("");
    }
  }, [mode, onError, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const canChange = mode === "demo" || (online && canManage && !supportReadOnly);

  async function save() {
    onError("");
    onNotice("");
    if (mode === "demo") {
      const next = { ...draft, updatedAt: new Date().toISOString() };
      window.localStorage.setItem("bdb-operations-preview-v1", JSON.stringify(next));
      setBundle(next);
      setDraft(next);
      onNotice("Preview operational settings saved in this browser.");
      return;
    }
    if (!canChange) {
      onError("Reconnect with an authorised workspace Owner or Manager before changing operational settings.");
      return;
    }
    setBusy("save");
    try {
      const response = await fetch("/api/workspace/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          action: "update_operations",
          workspaceId,
          fiscalYearStartMonth: draft.fiscalYearStartMonth,
          defaultExportFormat: draft.defaultExportFormat,
          archivedRecordsDefault: draft.archivedRecordsDefault,
          appointmentRemindersEnabled: draft.appointmentRemindersEnabled,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Operational settings could not be saved.");
      onNotice("Operational settings saved and recorded in Activity.");
      await load();
    } catch (error) {
      onError(message(error, "Operational settings could not be saved."));
    } finally {
      setBusy("");
    }
  }

  async function exportData() {
    if (mode === "demo") {
      onError("Authoritative exports require a cloud workspace.");
      return;
    }
    if (!online) {
      onError("Reconnect before creating an authoritative export.");
      return;
    }
    setBusy("export");
    onError("");
    onNotice("");
    try {
      const params = new URLSearchParams({
        workspaceId,
        area,
        format: draft.defaultExportFormat,
        includeArchived: String(draft.archivedRecordsDefault === "show"),
      });
      const response = await fetch(`/api/workspace/data-export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "The export could not be created.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `bdb-export.${draft.defaultExportFormat}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice(`${areas.find((item) => item.value === area)?.label ?? "Data"} export downloaded.`);
    } catch (error) {
      onError(message(error, "The export could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function enablePush() {
    if (mode === "demo" || !online) {
      onError("Device notifications require an online cloud workspace.");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      onError("This browser does not support BDB OS push notifications.");
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      onError("Push notifications are not configured for this environment.");
      return;
    }
    setBusy("push");
    onError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64Key(publicKey),
      });
      const serialised = subscription.toJSON();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: serialised.keys }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "This device could not be registered.");
      onNotice("This device is registered for eligible appointment reminders.");
      await load();
    } catch (error) {
      onError(message(error, "This device could not be registered."));
    } finally {
      setBusy("");
    }
  }

  async function disablePush() {
    if (!("serviceWorker" in navigator)) return;
    setBusy("push");
    onError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        onNotice("This browser has no active BDB OS push subscription.");
        return;
      }
      const response = await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "This device could not be removed.");
      await subscription.unsubscribe();
      onNotice("This device was removed from push notifications.");
      await load();
    } catch (error) {
      onError(message(error, "This device could not be removed."));
    } finally {
      setBusy("");
    }
  }

  async function clearReadCaches() {
    const queueKeys = ["queue", "mutation", "pending", "conflict"];
    const removable = ["cache", "snapshot", "workspace-settings", "business-insight"];
    const removed: string[] = [];
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith("bdb-")) continue;
      if (queueKeys.some((token) => key.includes(token))) continue;
      if (!removable.some((token) => key.includes(token))) continue;
      window.localStorage.removeItem(key);
      removed.push(key);
    }
    if ("caches" in window) {
      const names = await window.caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("bdb-")).map((name) => window.caches.delete(name)));
    }
    onNotice(`Cleared ${removed.length} local read-cache entr${removed.length === 1 ? "y" : "ies"}. Pending offline commands were retained.`);
  }

  if (!bundle || busy === "load") {
    return <div className={styles.loading}><Loader2 className="spin" /><span>Opening operational controls…</span></div>;
  }

  return (
    <div className={styles.controlGrid}>
      <Card className={styles.controlCard}>
        <SectionHeading title="Notifications" description="Choose whether eligible appointment reminders run and register this browser for push delivery." />
        <label className={styles.settingToggle}>
          <input
            type="checkbox"
            checked={draft.appointmentRemindersEnabled}
            onChange={(event) => setDraft({ ...draft, appointmentRemindersEnabled: event.target.checked })}
            disabled={!canChange || busy === "save"}
          />
          <Bell size={19} />
          <span><strong>Appointment reminders</strong><small>One-hour reminders use active device subscriptions and the existing delivery receipt controls.</small></span>
        </label>
        <div className={styles.controlActions}>
          <Button type="button" variant="secondary" onClick={() => void enablePush()} disabled={busy === "push" || mode === "demo" || !online}><Smartphone size={16} /> Register this device</Button>
          <Button type="button" variant="quiet" onClick={() => void disablePush()} disabled={busy === "push" || mode === "demo" || !online}><BellOff size={16} /> Remove this device</Button>
        </div>
        <p className={styles.controlMeta}>{bundle.pushSubscriptionCount} active device subscription{bundle.pushSubscriptionCount === 1 ? "" : "s"} for your user in this workspace.</p>
        <div className={styles.fixedSignals}>
          <span><CheckCircle2 size={15} /> Low-stock attention remains active in the Business Hub.</span>
          <span><CheckCircle2 size={15} /> Purchasing review attention remains active in the Business Hub.</span>
          <span><ShieldCheck size={15} /> Security events remain platform-controlled and cannot be disabled by a workspace.</span>
        </div>
      </Card>

      <Card className={styles.controlCard}>
        <SectionHeading title="Data & reporting" description="Set practical reporting defaults and export authoritative workspace data without exposing control-plane records." />
        <fieldset disabled={!canChange || busy === "save"}>
          <div className="form-grid">
            <div className="field"><label>Fiscal year starts</label><select value={draft.fiscalYearStartMonth} onChange={(event) => setDraft({ ...draft, fiscalYearStartMonth: Number(event.target.value) })}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></div>
            <div className="field"><label>Default export format</label><select value={draft.defaultExportFormat} onChange={(event) => setDraft({ ...draft, defaultExportFormat: event.target.value as ExportFormat })}><option value="csv">CSV</option><option value="json">JSON</option></select></div>
            <div className="field field-full"><label>Archived records in exports</label><select value={draft.archivedRecordsDefault} onChange={(event) => setDraft({ ...draft, archivedRecordsDefault: event.target.value as ArchiveDefault })}><option value="hide">Exclude by default</option><option value="show">Include by default</option></select></div>
          </div>
          <Button type="button" onClick={() => void save()} disabled={busy === "save"} style={{ marginTop: 16 }}><Save size={16} /> {busy === "save" ? "Saving…" : "Save operational defaults"}</Button>
        </fieldset>
        <div className={styles.exportBox}>
          <div className="field"><label>Export area</label><select value={area} onChange={(event) => setArea(event.target.value as ExportArea)}>{areas.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <Button type="button" variant="secondary" onClick={() => void exportData()} disabled={busy === "export" || mode === "demo" || !online}>
            {draft.defaultExportFormat === "csv" ? <FileSpreadsheet size={16} /> : <FileJson size={16} />}
            {busy === "export" ? "Preparing…" : `Download ${draft.defaultExportFormat.toUpperCase()}`}
          </Button>
        </div>
        <p className={styles.controlMeta}><Archive size={14} /> Archived records remain preserved. This setting controls exports; it never deletes history.</p>
      </Card>

      <Card className={styles.controlCard}>
        <SectionHeading title="Security" description="Authentication and privileged-access controls stay separate from ordinary business settings." />
        <div className={styles.linkList}>
          <Link href="/mfa"><ShieldCheck size={18} /><span><strong>Two-factor authentication</strong><small>Register and verify an authenticator for privileged access.</small></span></Link>
          <Link href="/change-password"><KeyRound size={18} /><span><strong>Change password</strong><small>Update the signed-in account’s authentication credential.</small></span></Link>
          <Link href="/activity"><Activity size={18} /><span><strong>Business activity</strong><small>Review workspace actions. Security audit records remain separately protected.</small></span></Link>
        </div>
        <div className={styles.fixedSignals}>
          <span><ShieldCheck size={15} /> Session duration is platform-managed.</span>
          <span><ShieldCheck size={15} /> Temporary developer access remains integration-only and audited.</span>
        </div>
      </Card>

      <Card className={styles.controlCard}>
        <SectionHeading title="System diagnostics" description="Read-only diagnostics show whether this workspace can reach its authoritative data. Repair tools remain Founder-controlled." />
        <div className={styles.diagnostics}>
          <span><Database size={18} /><strong>{bundle.system.database === "available" ? "Database available" : "Preview data"}</strong><small>Authoritative workspace connection</small></span>
          <span><HardDrive size={18} /><strong>{bundle.system.structuredOperationalRecordCount}</strong><small>structured operational records</small></span>
          <span><Activity size={18} /><strong>Last activity</strong><small>{formatDate(bundle.system.lastWorkspaceActivityAt)}</small></span>
        </div>
        <div className={styles.controlActions}>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={busy === "load"}><RefreshCw size={16} /> Refresh diagnostics</Button>
          <Button type="button" variant="quiet" onClick={() => void clearReadCaches()}><Trash2 size={16} /> Clear read caches</Button>
        </div>
        <p className={styles.controlMeta}>Pending offline queues are deliberately excluded from cache clearing. Feature flags, maintenance mode and data repair remain in Founder Admin.</p>
      </Card>

      <Card className={styles.operationsBoundary}>
        <Download size={22} />
        <h2>Backup and destructive actions</h2>
        <p>Full verified snapshot export and same-workspace restore remain in the Backup & restore tab. BDB OS will not merge a backup into live records or expose arbitrary department deletion.</p>
        <p>Financial, Inventory and audit history must be corrected through reversals or a separately approved Founder-controlled reset procedure.</p>
      </Card>
    </div>
  );
}

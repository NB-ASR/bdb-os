"use client";

import { useEffect, useState } from "react";
import { Building2, Eye, Loader2, LogOut, ShieldCheck } from "lucide-react";
import styles from "./dev-role-switcher.module.css";
import type { DevAccessView, SupportAccessMode } from "@/lib/dev-access";

type SessionStatus = {
  enabled: boolean;
  view: DevAccessView | null;
  adminConfigured: boolean;
  workspaceConfigured: boolean;
};

type SupportWorkspace = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type SupportStatus = {
  enabled: boolean;
  accessMode: SupportAccessMode;
  active: {
    id: string;
    workspace_id: string;
    reason: string;
    access_mode: SupportAccessMode;
    expires_at: string;
    workspace: SupportWorkspace | null;
  } | null;
  workspaces: SupportWorkspace[];
};

export function DevRoleSwitcher({ expanded = false }: { expanded?: boolean }) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [support, setSupport] = useState<SupportStatus | null>(null);
  const [busy, setBusy] = useState<DevAccessView | "support" | "exit" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void fetch("/api/dev/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.enabled) setStatus(result as SessionStatus);
      })
      .catch(() => undefined);

    void fetch("/api/admin/support-session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.enabled) setSupport(result as SupportStatus);
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, []);

  async function switchView(view: DevAccessView) {
    setBusy(view);
    setError("");
    const response = await fetch("/api/dev/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(null);
      setError(result.error ?? "Development access could not be changed.");
      return;
    }
    window.location.assign(result.redirect ?? (view === "admin" ? "/admin" : "/workspace"));
  }

  async function switchSupportWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === support?.active?.workspace_id) return;
    const writable = support?.accessMode === "test_write";
    const reason = window.prompt(
      writable
        ? "Why are you opening this workspace in full-access Founder testing mode? Changes will affect integration data."
        : "Why are you opening this workspace in read-only support mode?",
    );
    if (!reason) return;

    setBusy("support");
    setError("");
    const response = await fetch("/api/admin/support-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, reason }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(null);
      setError(result.error ?? "The support workspace could not be opened.");
      return;
    }
    window.location.assign(result.redirect ?? "/workspace");
  }

  async function exitSupport() {
    setBusy("exit");
    setError("");
    const response = await fetch("/api/admin/support-session", { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(null);
      setError(result.error ?? "Support mode could not be closed.");
      return;
    }
    window.location.assign(result.redirect ?? "/admin");
  }

  if (support?.active) {
    const writable = support.active.access_mode === "test_write";
    return (
      <div className={`${styles.switcher} ${styles.support} ${expanded ? styles.expanded : ""}`} data-support-access={support.active.access_mode}>
        <div className={styles.copy}>
          <span className={styles.label}>
            {writable ? <ShieldCheck size={13} /> : <Eye size={13} />}
            {writable ? "Founder testing · Full access" : "Founder support · Read only"}
          </span>
          {expanded ? (
            <small>
              Access expires {new Date(support.active.expires_at).toLocaleTimeString()}.
              {writable ? " Changes affect integration data and remain audited." : " All entry and exit events are audited."}
            </small>
          ) : null}
        </div>
        <div className={styles.actions}>
          {busy === "support" ? <Loader2 className={styles.spin} size={15} /> : <Building2 size={15} />}
          <select
            value={support.active.workspace_id}
            onChange={(event) => void switchSupportWorkspace(event.target.value)}
            disabled={Boolean(busy)}
            aria-label="Switch support workspace"
          >
            {support.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => void exitSupport()} disabled={Boolean(busy)} title="Close support access and return to Founder Admin">
            {busy === "exit" ? <Loader2 className={styles.spin} size={15} /> : <LogOut size={15} />}
            <span>Admin</span>
          </button>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className={`${styles.switcher} ${expanded ? styles.expanded : ""}`} data-dev-access>
      <div className={styles.copy}>
        <span className={styles.label}>Preview access</span>
        {expanded ? (
          <small>
            Open Founder Admin, an integration workspace in audited {support?.accessMode === "test_write" ? "full-access testing" : "read-only support"} mode, or the seeded client identity.
          </small>
        ) : null}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={status.view === "admin" ? styles.active : ""}
          onClick={() => void switchView("admin")}
          disabled={Boolean(busy) || !status.adminConfigured}
          title={status.adminConfigured ? "Open the developer admin view" : "Admin development credentials are not configured"}
        >
          {busy === "admin" ? <Loader2 className={styles.spin} size={15} /> : <ShieldCheck size={15} />}
          <span>Admin</span>
        </button>
        {status.view === "admin" && support?.workspaces.length ? (
          <select
            value=""
            onChange={(event) => void switchSupportWorkspace(event.target.value)}
            disabled={Boolean(busy)}
            aria-label="Open a workspace in support mode"
          >
            <option value="">Open workspace…</option>
            {support.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className={status.view === "workspace" ? styles.active : ""}
          onClick={() => void switchView("workspace")}
          disabled={Boolean(busy) || !status.workspaceConfigured}
          title={status.workspaceConfigured ? "Open the seeded client identity" : "Workspace development credentials are not configured"}
        >
          {busy === "workspace" ? <Loader2 className={styles.spin} size={15} /> : <Building2 size={15} />}
          <span>Seeded client</span>
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

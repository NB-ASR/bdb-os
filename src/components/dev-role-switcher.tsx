"use client";

import { useEffect, useState } from "react";
import { Building2, Loader2, ShieldCheck } from "lucide-react";
import styles from "./dev-role-switcher.module.css";
import type { DevAccessView } from "@/lib/dev-access";

type SessionStatus = {
  enabled: boolean;
  view: DevAccessView | null;
  adminConfigured: boolean;
  workspaceConfigured: boolean;
};

export function DevRoleSwitcher({ expanded = false }: { expanded?: boolean }) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState<DevAccessView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/dev/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result?.enabled) setStatus(result as SessionStatus);
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

  if (!status) return null;

  return (
    <div className={`${styles.switcher} ${expanded ? styles.expanded : ""}`} data-dev-access>
      <div className={styles.copy}>
        <span className={styles.label}>Preview access</span>
        {expanded ? <small>Switches between seeded development identities. Production authentication is unchanged.</small> : null}
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
        <button
          type="button"
          className={status.view === "workspace" ? styles.active : ""}
          onClick={() => void switchView("workspace")}
          disabled={Boolean(busy) || !status.workspaceConfigured}
          title={status.workspaceConfigured ? "Open the client workspace view" : "Workspace development credentials are not configured"}
        >
          {busy === "workspace" ? <Loader2 className={styles.spin} size={15} /> : <Building2 size={15} />}
          <span>Workspace</span>
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

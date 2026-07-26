"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BdbMonogram } from "@/components/brand";
import styles from "./page.module.css";

type AvailabilityResponse = {
  enabled?: boolean;
  reason?: string | null;
};

type SetupResponse = {
  ok?: boolean;
  error?: string;
  updated?: string[];
  next?: string;
};

export default function DevelopmentPasswordSetupPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityReason, setAvailabilityReason] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [workspacePassword, setWorkspacePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SetupResponse | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/dev/password-setup", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as AvailabilityResponse;
        if (!active) return;
        setAvailable(Boolean(response.ok && body.enabled));
        setAvailabilityReason(body.reason ?? (response.ok ? null : "Password setup is unavailable."));
      })
      .catch(() => {
        if (!active) return;
        setAvailable(false);
        setAvailabilityReason("Password setup status could not be loaded.");
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (adminPassword === workspacePassword) {
      setError("Use different passwords for the administrator and workspace identities.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/dev/password-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, adminPassword, workspacePassword }),
      });
      const body = (await response.json().catch(() => ({}))) as SetupResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "The passwords could not be updated.");
      }

      setSuccess(body);
      setToken("");
      setAdminPassword("");
      setWorkspacePassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The passwords could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <BdbMonogram href="/dev-access" />
          <div>
            <p className="eyebrow">Protected Preview utility</p>
            <h1>Set development passwords</h1>
          </div>
          <p>
            Update the two existing Supabase Auth identities without changing their user IDs, Founder status,
            workspace ownership or Row Level Security relationships.
          </p>
        </header>

        <div className={styles.card}>
          <p className={styles.notice}>
            This utility is restricted to the approved integration Preview and temporary Supabase project. It is
            enabled only while a branch-scoped one-time setup token exists in Vercel.
          </p>

          {available === false && (
            <p className={styles.error}>{availabilityReason ?? "Password setup is unavailable."}</p>
          )}

          <form className={styles.form} onSubmit={submit}>
            <div className={styles.field}>
              <label htmlFor="setup-token">One-time setup token</label>
              <input
                id="setup-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                minLength={32}
                required
                disabled={available !== true || busy}
              />
              <small>Use the branch-scoped Sensitive token configured in Vercel.</small>
            </div>

            <div className={styles.field}>
              <label htmlFor="admin-password">New password for matdem553@gmail.com</label>
              <input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                disabled={available !== true || busy}
              />
              <small>Minimum 12 characters. Store it in your password manager.</small>
            </div>

            <div className={styles.field}>
              <label htmlFor="workspace-password">New password for newdawn.client.testing@gmail.com</label>
              <input
                id="workspace-password"
                type="password"
                value={workspacePassword}
                onChange={(event) => setWorkspacePassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                disabled={available !== true || busy}
              />
              <small>Use a different password from the administrator identity.</small>
            </div>

            <button className={styles.submit} type="submit" disabled={available !== true || busy}>
              {busy ? "Updating identities…" : "Update both passwords"}
            </button>
          </form>

          {error && <p className={styles.error}>{error}</p>}

          {success?.ok && (
            <div className={styles.success}>
              <strong>Both development passwords were updated.</strong>
              <ul className={styles.nextSteps}>
                {(success.updated ?? []).map((email) => <li key={email}>{email}</li>)}
                <li>Add both passwords to their branch-scoped Sensitive Vercel variables.</li>
                <li>Redeploy and verify the Admin/Workspace switch.</li>
                <li>Remove this page, API route and setup token.</li>
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

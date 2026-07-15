"use client";

import { FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function ChangePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) {
      setMessage("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("The passwords do not match.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setMessage("Cloud authentication is not configured.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    const response = await fetch("/api/auth/password-changed", { method: "POST" });
    if (!response.ok) {
      setMessage("Your password changed, but the account state could not be confirmed. Please sign in again.");
      setLoading(false);
      return;
    }
    window.location.href = "/mfa";
  }

  return (
    <main className="mfa-shell">
      <BdbMonogram />
      <section className="mfa-card">
        <span className="mfa-icon"><ShieldCheck size={25} /></span>
        <p className="marketing-kicker">First-login security</p>
        <h1>Create your private password</h1>
        <p>The temporary founder password cannot be reused after this step. Choose a unique password that you do not use elsewhere.</p>
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="password">New password</label><input id="password" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="field"><label htmlFor="confirm">Confirm password</label><input id="confirm" type="password" minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
          <button className="marketing-primary" disabled={loading}><KeyRound size={17} /> {loading ? "Saving…" : "Save password and continue"}</button>
        </form>
        {message && <p className="mfa-error" role="status">{message}</p>}
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, KeyRound, LogIn, Mail } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { BdbMonogram } from "@/components/brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!isSupabaseConfigured()) {
      setMessage("Cloud sign-in is not configured for this deployment.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const accessToken = data.session?.access_token;
    if (!accessToken) {
      await supabase.auth.signOut();
      setMessage("A secure session could not be created. Please try again.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/auth/post-login", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await supabase.auth.signOut();
      setMessage(result.error === "NOT_CONFIGURED" ? "BDB OS authentication is not fully configured." : "The account could not be opened. Please try again.");
      setLoading(false);
      return;
    }
    window.location.href = result.next ?? "/workspace";
  }

  async function resetPassword() {
    if (!isSupabaseConfigured()) {
      setMessage("Cloud authentication is not configured for this deployment.");
      return;
    }
    if (!email) {
      setMessage("Enter your email first, then choose reset password.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/change-password`,
    });
    setMessage(error ? error.message : "Check your email for the password reset link.");
    setLoading(false);
  }

  return (
    <main className="discovery-shell">
      <Link href="/" className="back-link"><ArrowLeft size={16} /> Back</Link>
      <div className="login-brand"><BdbMonogram /></div>
      <div className="discovery-layout login-layout">
        <section>
          <p className="marketing-kicker">Secure BDB OS access</p>
          <h1>Welcome back.</h1>
          <p className="discovery-lead">Use the account invited to your business. Founder accounts require a password change on first login and MFA before entering the control plane.</p>
        </section>
        <section className="discovery-card">
          <form className="discovery-form" onSubmit={signIn}>
            <div className="field field-full">
              <label htmlFor="email">Work email</label>
              <div className="input-with-icon"><Mail size={17} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></div>
            </div>
            <div className="field field-full">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon"><KeyRound size={17} /><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></div>
            </div>
            <button className="marketing-primary" disabled={loading}><LogIn size={17} /> {loading ? "Signing in…" : "Sign in"}</button>
            <button type="button" className="field-full link-button" onClick={() => void resetPassword()} disabled={loading}>Forgot or reset password</button>
            {message && <p className="field-full muted" role="status">{message}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Mail } from "lucide-react";
import { BdbBrand } from "@/components/bdb-brand";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/config";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError("");

    if (isDemoMode()) {
      router.push("/workspace");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError("Sign-in is not configured yet.");
      setStatus("idle");
      return;
    }

    if (mode === "link") {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(searchParams.get("next") ?? "/workspace")}` },
      });
      if (signInError) setError(signInError.message);
      else setStatus("sent");
      if (signInError) setStatus("idle");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setStatus("idle");
      return;
    }
    router.replace(searchParams.get("next") ?? "/workspace");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <BdbBrand />
        <div><p className="eyebrow">Your private business operating system</p><h1>Pick up exactly where your business left off.</h1><p>One secure login opens your company’s workspace, enabled modules, team access and chosen appearance.</p><ul><li><CheckCircle2 /> Isolated from every other client</li><li><CheckCircle2 /> Access controlled by your contract</li><li><CheckCircle2 /> Designed for desktop and mobile</li></ul></div>
        <small>Bianchini · Demicoli · Buontempo</small>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">Client access</p>
          <h2>Sign in to BDB OS</h2>
          <p className="muted">Use the details supplied when your workspace was created.</p>
          {status === "sent" ? <div className="auth-success"><Mail /><h3>Check your inbox</h3><p>We sent a secure sign-in link to <strong>{email}</strong>.</p></div> : <form onSubmit={submit}>
            <div className="field"><label htmlFor="login-email">Email address</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.co.uk" /></div>
            {mode === "password" ? <div className="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button button-primary auth-submit" disabled={status === "loading"}>{mode === "password" ? <KeyRound size={17} /> : <Mail size={17} />}{status === "loading" ? "Signing in…" : mode === "password" ? "Sign in securely" : "Email me a sign-in link"}<ArrowRight size={16} /></button>
          </form>}
          <button className="auth-switch" type="button" onClick={() => { setMode(mode === "password" ? "link" : "password"); setError(""); setStatus("idle"); }}>{mode === "password" ? "Use a passwordless email link" : "Use email and password"}</button>
          <p className="auth-help">Need access or having trouble? <Link href="mailto:support@bdb-os.co.uk">Contact BDB support</Link>.</p>
        </div>
      </section>
    </main>
  );
}

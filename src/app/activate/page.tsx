"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function ActivateInvitationPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login?error=invitation");
        return;
      }
      setEmail(data.user.email ?? "");
      setFullName(String(data.user.user_metadata?.full_name ?? ""));
    });
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 12) {
      setMessage("Use at least 12 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const passwordResult = await supabase.auth.updateUser({
      password,
      data: { full_name: fullName.trim() },
    });
    if (passwordResult.error) {
      setMessage(passwordResult.error.message);
      setLoading(false);
      return;
    }

    const response = await fetch("/api/auth/activate-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName }),
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(result.error ?? "The invitation could not be activated.");
      return;
    }

    router.replace("/workspace");
    router.refresh();
  }

  return (
    <main className="discovery-shell">
      <div className="login-brand"><BdbMonogram /></div>
      <div className="discovery-layout login-layout">
        <section>
          <p className="marketing-kicker">Private business access</p>
          <h1>Activate your BDB OS account.</h1>
          <p className="discovery-lead">
            Complete your profile and choose a private password. Access is limited
            to the business that invited you and the permissions its administrator
            assigns.
          </p>
          <div className="settings-note" style={{ marginTop: 24 }}>
            <ShieldCheck size={22} />
            <h2 style={{ marginTop: 10 }}>Invitation protected</h2>
            <p>Invitations expire, can only be accepted by the invited email, and are recorded in the business audit trail.</p>
          </div>
        </section>
        <section className="discovery-card">
          <form className="discovery-form" onSubmit={submit}>
            <div className="field field-full">
              <label>Email</label>
              <input value={email} disabled />
            </div>
            <div className="field field-full">
              <label htmlFor="full-name">Full name</label>
              <input id="full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required autoComplete="name" />
            </div>
            <div className="field field-full">
              <label htmlFor="password">Create password</label>
              <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required autoComplete="new-password" />
              <small>At least 12 characters. Do not reuse a personal password.</small>
            </div>
            <div className="field field-full">
              <label htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required autoComplete="new-password" />
            </div>
            <button className="marketing-primary" disabled={loading}>
              {loading ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
              {loading ? "Activating…" : "Activate account"}
            </button>
            {message && <p className="field-full mfa-error">{message}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}

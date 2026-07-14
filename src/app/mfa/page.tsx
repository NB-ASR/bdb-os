"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { BdbBrand } from "@/components/bdb-brand";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/config";

interface Factor {
  id: string;
  status: "verified" | "unverified";
}

export default function MfaPage() {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"loading" | "setup" | "verify" | "complete">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function prepare() {
      if (isDemoMode()) {
        setState("complete");
        return;
      }
      const supabase = createClient();
      if (!supabase) return setError("Secure verification is not configured.");
      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance?.currentLevel === "aal2") {
        setState("complete");
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp.find((item) => item.status === "verified");
      if (verified) {
        setFactor({ id: verified.id, status: "verified" });
        setState("verify");
        return;
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "BDB Founder" });
      if (enrollError || !enrolled) {
        setError(enrollError?.message ?? "Could not begin verification.");
        return;
      }
      setFactor({ id: enrolled.id, status: "unverified" });
      setQrCode(enrolled.totp.qr_code);
      setSecret(enrolled.totp.secret);
      setState("setup");
    }
    void prepare();
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!factor) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setState("complete");
  }

  return <main className="mfa-page"><div className="mfa-card"><BdbBrand /><span className="mfa-icon"><ShieldCheck /></span><p className="eyebrow">Founder security</p><h1>Two-step verification</h1>{state === "loading" ? <div className="page-loading"><span /><p>Checking security level…</p></div> : null}{state === "setup" ? <><p>Scan this code with an authenticator app such as 1Password, Google Authenticator or Microsoft Authenticator.</p><div className="mfa-qr">{qrCode ? <Image unoptimized src={qrCode} alt="Authenticator QR code" width={190} height={190} /> : null}</div><details><summary>Can’t scan the code?</summary><code>{secret}</code></details><VerificationForm code={code} setCode={setCode} error={error} submit={verify} label="Verify and protect account" /></> : null}{state === "verify" ? <><p><Smartphone size={17} /> Open your authenticator app and enter the current six-digit code.</p><VerificationForm code={code} setCode={setCode} error={error} submit={verify} label="Verify founder access" /></> : null}{state === "complete" ? <div className="mfa-complete"><CheckCircle2 /><h2>Founder access verified</h2><p>Your session now meets the security level required for cross-client administration.</p><Link className="button button-primary" href="/admin"><KeyRound size={16} /> Open BDB Admin</Link></div> : null}</div></main>;
}

function VerificationForm({ code, setCode, error, submit, label }: { code: string; setCode: (code: string) => void; error: string; submit: (event: FormEvent) => void; label: string }) {
  return <form className="mfa-form" onSubmit={submit}><div className="field"><label htmlFor="mfa-code">Six-digit code</label><input id="mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></div>{error ? <p className="form-error">{error}</p> : null}<button className="button button-primary" type="submit"><ShieldCheck size={16} /> {label}</button></form>;
}

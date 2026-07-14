"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Factor = { id: string; status?: string; friendly_name?: string };

export default function MfaPage() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(async ({ data }) => {
      const existing = data?.totp?.find((item) => item.status === "verified") ?? data?.totp?.[0];
      if (existing) { setFactor(existing); return; }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "BDB OS founder access" });
      if (enrolled.data) { setFactor(enrolled.data); setQr(enrolled.data.totp.qr_code); setSecret(enrolled.data.totp.secret); }
      if (enrolled.error) setMessage(enrolled.error.message);
    });
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    const supabase = createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) { setMessage(challenge.error?.message ?? "Could not start verification."); return; }
    const result = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
    if (result.error) { setMessage(result.error.message); return; }
    router.push("/admin"); router.refresh();
  }

  return <main className="mfa-shell"><BdbMonogram /><section className="mfa-card"><span className="mfa-icon"><ShieldCheck size={25} /></span><p className="marketing-kicker">Founder security</p><h1>Two-step verification</h1><p>Founder access controls every client workspace, so an authenticator code is required and every action is audited.</p>{qr && <><div className="qr-wrap"><Image src={qr} alt="Authenticator QR code" width={190} height={190} unoptimized /></div><p className="mfa-secret">Manual key: <code>{secret}</code></p></>}<form onSubmit={verify}><div className="field"><label htmlFor="totp">Six-digit authenticator code</label><input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required /></div><button className="marketing-primary"><KeyRound size={17} /> Verify and enter admin</button></form>{message && <p className="mfa-error">{message}</p>}</section></main>;
}

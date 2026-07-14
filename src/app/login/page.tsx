"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, LogIn } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!isSupabaseConfigured()) { setMessage("Cloud sign-in is not configured in this preview. Use the product demo instead."); return; }
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setMessage(error ? error.message : "Check your email for a secure sign-in link.");
    setLoading(false);
  }

  return <main className="discovery-shell"><Link href="/" className="back-link"><ArrowLeft size={16} /> BDB OS</Link><div className="discovery-layout"><section><p className="marketing-kicker">Client access</p><h1>Welcome back.</h1><p className="discovery-lead">Sign in to the private workspace created for your business.</p></section><section className="discovery-card"><form className="discovery-form" onSubmit={signIn}><div className="field field-full"><label htmlFor="email">Work email</label><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" /></div><button className="marketing-primary" disabled={loading}><LogIn size={17} /> {loading ? "Sending…" : "Email me a sign-in link"}</button>{message && <p className="field-full muted">{message}</p>}<Link className="field-full link-button" href="/workspace">Open the product demo</Link></form></section></div></main>;
}

"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";

const PLANS = new Set(["not-sure", "starter", "growth", "solo-operator", "pro"]);

function DiscoveryForm() {
  const searchParams = useSearchParams();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestedPlan = searchParams.get("plan") ?? "";
  const initialPlan = PLANS.has(requestedPlan) ? requestedPlan : "not-sure";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          businessName: form.get("businessName"),
          email: form.get("email"),
          startingPlan: form.get("startingPlan"),
          sector: form.get("sector"),
          challenge: form.get("challenge"),
          teamSize: form.get("teamSize"),
          preferredTerm: form.get("preferredTerm"),
          website: form.get("website"),
          sourcePath: `${window.location.pathname}${window.location.search}`,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "We could not record your enquiry.");
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not record your enquiry.");
    } finally {
      setPending(false);
    }
  }

  return <main className="discovery-shell">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to BDB OS</Link>
    <div className="discovery-layout">
      <section><p className="marketing-kicker">Start discovery</p><h1>Let’s understand the business first.</h1><p className="discovery-lead">Tell us where work feels fragmented or repetitive. We’ll use this to recommend a starting plan, module mix and commitment that make sense.</p>
        <div className="discovery-points"><span><CheckCircle2 size={18} /> No fixed package forced on you</span><span><CheckCircle2 size={18} /> A tailored quote after discovery</span><span><CheckCircle2 size={18} /> Choose a 3 or 6 month minimum term</span></div>
      </section>
      <section className="discovery-card">
        {sent ? <div className="success-state"><CheckCircle2 size={38} /><h2>Thanks—that gives us a useful starting point.</h2><p>Your enquiry is safely recorded. We’ll review the business, recommend the right starting point and contact you using the work email you supplied.</p><Link href="/">Return home</Link></div> :
        <form onSubmit={submit} className="discovery-form">
          <div className="discovery-honeypot" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
          <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" required minLength={2} maxLength={120} autoComplete="name" placeholder="Jane Smith" /></div>
          <div className="field"><label htmlFor="businessName">Business name</label><input id="businessName" name="businessName" required minLength={2} maxLength={160} autoComplete="organization" placeholder="Your company" /></div>
          <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="jane@company.com" /></div>
          <div className="field"><label htmlFor="startingPlan">Starting plan</label><select id="startingPlan" name="startingPlan" defaultValue={initialPlan}><option value="not-sure">Not sure yet</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="solo-operator">Solo Operator</option><option value="pro">Pro</option></select></div>
          <div className="field"><label htmlFor="sector">Business sector</label><select id="sector" name="sector" defaultValue="general"><option value="general">General services</option><option value="healthcare">Healthcare</option><option value="wellness">Wellness</option><option value="legal">Legal services</option><option value="accounting">Accounting</option><option value="other">Another sector</option></select></div>
          <div className="field"><label htmlFor="teamSize">Team size</label><select id="teamSize" name="teamSize"><option value="solo">Just me</option><option value="2-5">2–5</option><option value="6-15">6–15</option><option value="16-50">16–50</option><option value="50-plus">50+</option></select></div>
          <div className="field field-full"><label htmlFor="challenge">What is taking too much time right now?</label><textarea id="challenge" name="challenge" required minLength={20} maxLength={4000} placeholder="Tell us about the admin, disconnected tools or workflows you want to improve…" /></div>
          <div className="field"><label htmlFor="preferredTerm">Preferred minimum term</label><select id="preferredTerm" name="preferredTerm"><option value="3-months">3 months</option><option value="6-months">6 months</option><option value="open">Open to either</option></select></div>
          <div className="discovery-submit"><button className="marketing-primary" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="discovery-spinner" size={17} /> Recording enquiry</> : <>Send enquiry <ArrowRight size={17} /></>}</button>{error && <p className="form-error" role="alert">{error}</p>}</div>
        </form>}
      </section>
    </div>
  </main>;
}

export default function DiscoveryPage() {
  return <Suspense><DiscoveryForm /></Suspense>;
}

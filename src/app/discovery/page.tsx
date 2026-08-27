"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";

export default function DiscoveryPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    const form = new FormData(event.currentTarget);
    const serviceLabel = String(form.get("serviceLabel") ?? "Not sure yet");
    const challenge = String(form.get("challenge") ?? "");
    const response = await fetch("/api/discovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        businessName: form.get("businessName"),
        email: form.get("email"),
        startingPlan: form.get("startingPlan"),
        sector: form.get("sector"),
        challenge: `[Service interest: ${serviceLabel}]\n\n${challenge}`,
        teamSize: form.get("teamSize"),
        preferredTerm: form.get("preferredTerm"),
        website: form.get("website"),
      }),
    }).catch(() => null);

    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      setError(result?.error ?? "We could not send your enquiry. Please try again.");
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return <main className="discovery-shell">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to BDB OS</Link>
    <div className="discovery-layout">
      <section><p className="marketing-kicker">Free business review</p><h1>What would make the biggest difference next?</h1><p className="discovery-lead">Tell us what you want to improve—your website, growth, repeated admin or the systems behind the business. We’ll review it and recommend a focused next step.</p>
        <div className="discovery-points"><span><CheckCircle2 size={18} /> Start with the outcome, not a package</span><span><CheckCircle2 size={18} /> A practical recommendation after discovery</span><span><CheckCircle2 size={18} /> Build, test and improve with one partner</span></div>
      </section>
      <section className="discovery-card">
        {status === "sent" ? <div className="success-state"><CheckCircle2 size={38} /><h2>Thanks—we have your enquiry.</h2><p>We’ll review what you shared and come back with a useful next step.</p><Link href="/">Return home</Link></div> :
        <form onSubmit={submit} className="discovery-form">
          <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" required minLength={2} maxLength={120} placeholder="Jane Smith" /></div>
          <div className="field"><label htmlFor="businessName">Business name</label><input id="businessName" name="businessName" required minLength={2} maxLength={160} placeholder="Your company" /></div>
          <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required maxLength={254} placeholder="jane@company.com" /></div>
          <div className="field"><label htmlFor="startingPlan">What do you need?</label><select id="startingPlan" name="startingPlan" defaultValue="not-sure" onChange={(event) => { const option = event.currentTarget.selectedOptions[0]; const hidden = event.currentTarget.form?.elements.namedItem("serviceLabel") as HTMLInputElement | null; if (hidden) hidden.value = option.text; }}><option value="not-sure">Not sure yet</option><option value="starter">A website or digital launch</option><option value="growth">AI, automation or growth help</option><option value="pro">BDB OS or a custom system</option><option value="solo-operator">Ongoing hands-on support</option></select><input type="hidden" name="serviceLabel" defaultValue="Not sure yet" /></div>
          <div className="field"><label htmlFor="sector">Sector</label><select id="sector" name="sector" defaultValue="general"><option value="general">General business</option><option value="healthcare">Healthcare</option><option value="wellness">Wellness</option><option value="legal">Legal</option><option value="accounting">Accounting</option><option value="other">Other</option></select></div>
          <div className="field"><label htmlFor="teamSize">Team size</label><select id="teamSize" name="teamSize" defaultValue="solo"><option value="solo">Just me</option><option value="2-5">2–5</option><option value="6-15">6–15</option><option value="16-50">16–50</option><option value="50-plus">50+</option></select></div>
          <div className="field field-full"><label htmlFor="challenge">What outcome would make the biggest difference?</label><textarea id="challenge" name="challenge" required minLength={20} maxLength={3900} placeholder="Tell us what you want to improve, what is getting in the way and what success would look like…" /></div>
          <div className="field"><label htmlFor="preferredTerm">Preferred support term</label><select id="preferredTerm" name="preferredTerm" defaultValue="open"><option value="open">Open to either</option><option value="3-months">3 months</option><option value="6-months">6 months</option></select></div>
          <div className="website-field" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
          {status === "error" && <p className="form-error" role="alert">{error}</p>}
          <button className="marketing-primary" type="submit" disabled={status === "sending"}>{status === "sending" ? <><LoaderCircle className="spin" size={17} /> Sending…</> : <>Send enquiry <ArrowRight size={17} /></>}</button>
        </form>}
      </section>
    </div>
  </main>;
}

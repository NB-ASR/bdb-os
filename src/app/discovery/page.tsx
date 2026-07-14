"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";

export default function DiscoveryPage() {
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  return <main className="discovery-shell">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to BDB OS</Link>
    <div className="discovery-layout">
      <section><p className="marketing-kicker">Start discovery</p><h1>Let’s understand the business first.</h1><p className="discovery-lead">Tell us where work feels fragmented or repetitive. We’ll use this to recommend a starting plan, module mix and commitment that make sense.</p>
        <div className="discovery-points"><span><CheckCircle2 size={18} /> No fixed package forced on you</span><span><CheckCircle2 size={18} /> A tailored quote after discovery</span><span><CheckCircle2 size={18} /> Choose a 3 or 6 month minimum term</span></div>
      </section>
      <section className="discovery-card">
        {sent ? <div className="success-state"><CheckCircle2 size={38} /><h2>Thanks—that gives us a useful starting point.</h2><p>This preview keeps enquiries on your device. Connect the production email or CRM destination before launch and new requests will be delivered to your team.</p><Link href="/">Return home</Link></div> :
        <form onSubmit={submit} className="discovery-form">
          <div className="field"><label htmlFor="name">Your name</label><input id="name" required placeholder="Jane Smith" /></div>
          <div className="field"><label htmlFor="business">Business name</label><input id="business" required placeholder="Your company" /></div>
          <div className="field"><label htmlFor="email">Work email</label><input id="email" type="email" required placeholder="jane@company.com" /></div>
          <div className="field"><label htmlFor="plan">Starting plan</label><select id="plan" defaultValue="not-sure"><option value="not-sure">Not sure yet</option><option>Starter</option><option>Growth</option><option>Pro</option></select></div>
          <div className="field field-full"><label htmlFor="challenge">What is taking too much time right now?</label><textarea id="challenge" required placeholder="Tell us about the admin, disconnected tools or workflows you want to improve…" /></div>
          <div className="field"><label htmlFor="team">Team size</label><select id="team"><option>Just me</option><option>2–5</option><option>6–15</option><option>16–50</option><option>50+</option></select></div>
          <div className="field"><label htmlFor="term">Preferred minimum term</label><select id="term"><option>3 months</option><option>6 months</option><option>Open to either</option></select></div>
          <button className="marketing-primary" type="submit">Send enquiry <ArrowRight size={17} /></button>
        </form>}
      </section>
    </div>
  </main>;
}

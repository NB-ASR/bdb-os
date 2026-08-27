import Link from "next/link";
import { ArrowRight, BrainCircuit, Check, ChevronRight, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

const offers = [
  {
    name: "Website & Digital Launch",
    slug: "starter",
    eyebrow: "Build a stronger front door",
    description: "Launch or improve a website that explains your value clearly and turns more visitors into real conversations.",
    examples: ["Website strategy and design", "Conversion-focused pages", "Analytics and ongoing improvements"],
  },
  {
    name: "AI Growth & Automation",
    slug: "growth",
    eyebrow: "Do more without more admin",
    description: "Use practical AI and connected workflows to improve follow-up, marketing, delivery and the way your team works.",
    examples: ["AI opportunity review", "Workflow and admin automation", "Growth experiments with clear measures"],
    featured: true,
  },
  {
    name: "BDB OS & Custom Systems",
    slug: "pro",
    eyebrow: "Connect the whole operation",
    description: "Replace disconnected tools with a secure operating system shaped around your customers, money and daily work.",
    examples: ["BDB OS workspace", "Custom business tools", "Ongoing support and iteration"],
  },
];

export default function MarketingPage() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav">
        <BdbMonogram />
        <div className="marketing-links">
          <a href="#services">Services</a>
          <a href="#how-it-works">How we work</a>
          <Link href="/login">Login</Link>
          <Link href="/discovery" className="marketing-nav-cta">Book a business review <ArrowRight size={15} /></Link>
        </div>
      </nav>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-kicker"><Sparkles size={14} /> Business. Done. Better.</p>
          <h1>Websites, AI and systems built to grow your business.</h1>
          <p>We help ambitious companies win more work and operate better—from a stronger website to useful AI, automation and a secure business operating system.</p>
          <div className="marketing-actions">
            <Link href="/discovery" className="marketing-primary">Book a free business review <ArrowRight size={17} /></Link>
            <Link href="/login" className="marketing-secondary">Login to BDB OS</Link>
          </div>
          <div className="marketing-trust"><span><Check size={14} /> Tailored to your goals</span><span><Check size={14} /> Practical AI, not hype</span><span><Check size={14} /> Build, learn and improve</span></div>
        </div>
        <div className="marketing-product-card">
          <div className="product-card-top"><span>Live workspace</span><span className="live-dot">Connected and secure</span></div>
          <h2>A clear view of what matters.</h2>
          <div className="product-stat-row"><div><small>Business records</small><strong>Live</strong></div><div><small>Departments</small><strong>Connected</strong></div></div>
          <div className="product-focus"><span className="focus-dot" /><div><strong>One useful next action</strong><p>See what needs attention without searching across disconnected tools.</p></div><ChevronRight size={16} /></div>
          <div className="product-modules"><span>Accounts</span><span>Customers</span><span>Calendar</span><span>Reports</span></div>
        </div>
      </section>

      <section className="marketing-section" id="how-it-works">
        <div className="marketing-section-heading"><p className="marketing-kicker">A hands-on partner</p><h2>Start with the business problem, then build what will move it.</h2><p>We diagnose the opportunity, deliver the right mix of service and software, and improve it with real-world feedback.</p></div>
        <div className="marketing-value-grid">
          <article><span><BrainCircuit size={20} /></span><h3>Find the highest-value move</h3><p>We look at growth, customer experience and repeated admin before recommending a solution.</p></article>
          <article><span><Workflow size={20} /></span><h3>Build and connect it</h3><p>We deliver the website, automation or operating system and fit it into the way your team works.</p></article>
          <article><span><ShieldCheck size={20} /></span><h3>Learn and improve</h3><p>We measure what happens, support your team and keep improving the parts that create value.</p></article>
        </div>
      </section>

      <section className="marketing-section" id="services">
        <div className="marketing-section-heading"><p className="marketing-kicker">Ways we can help</p><h2>One partner from first impression to daily operation.</h2><p>Start with the outcome you need now. Every engagement is scoped after a focused business review.</p></div>
        <div className="plan-grid">
          {offers.map((offer) => (
            <article className={`plan-card ${offer.featured ? "featured" : ""}`} key={offer.name}>
              {offer.featured && <span className="plan-popular">A strong place to start</span>}
              <p className="plan-eyebrow">{offer.eyebrow}</p><h3>{offer.name}</h3>
              <div className="custom-price">Tailored proposal</div>
              <p>{offer.description}</p>
              <div className="plan-divider" />
              <small>Your engagement could include:</small>
              <ul>{offer.examples.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul>
              <Link href={`/discovery?plan=${offer.slug}`}>Discuss this service <ArrowRight size={15} /></Link>
            </article>
          ))}
        </div>
        <p className="plan-note">Services can stand alone or work together. Scope, measures, delivery stages and ongoing support are agreed after discovery.</p>
      </section>

      <section className="marketing-cta"><div><p className="marketing-kicker">Let’s find the next best move</p><h2>Tell us what you want the business to do better.</h2><p>We’ll review the opportunity and recommend a focused place to start.</p></div><Link href="/discovery" className="marketing-primary">Book a business review <ArrowRight size={17} /></Link></section>
      <footer className="marketing-footer"><span>© 2026 BDB</span><span>Business. Done. Better.</span></footer>
    </main>
  );
}

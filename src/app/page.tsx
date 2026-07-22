import Link from "next/link";
import { ArrowRight, Blocks, Check, ChevronRight, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

const plans = [
  {
    name: "Starter",
    eyebrow: "A calm first step",
    description: "Bring the essentials into one clear workspace and replace the daily patchwork of disconnected tools.",
    examples: ["A focused core workspace", "Your highest-priority workflows", "Guided setup and ongoing support"],
  },
  {
    name: "Growth",
    eyebrow: "For connected operations",
    description: "Connect more of the business, reduce repeated admin and give a growing team one reliable source of truth.",
    examples: ["Broader connected operations", "Team roles and approvals", "Reporting and helpful automation"],
  },
  {
    name: "Solo Operator",
    eyebrow: "For a business run by one",
    description: "Give recurring administration to a governed operator that prepares work, requests approval and records proof of what was completed.",
    examples: ["Diary, inbox, money and records in one plan", "Approval-gated and bounded workflows", "Verified time-saved and exception reporting"],
    featured: true,
  },
  {
    name: "Pro",
    eyebrow: "The complete foundation",
    description: "Build a deeply tailored operating system around a more complex business, team and client journey.",
    examples: ["The broadest module mix", "Advanced workflows and controls", "Deeper tailoring as you evolve"],
  },
];

export default function MarketingPage() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav">
        <BdbMonogram />
        <div className="marketing-links">
          <a href="#how-it-works">How it works</a>
          <a href="#plans">Plans</a>
          <Link href="/login">Login</Link>
          <Link href="/discovery" className="marketing-nav-cta">Start discovery <ArrowRight size={15} /></Link>
        </div>
      </nav>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-kicker"><Sparkles size={14} /> Business. Done. Better.</p>
          <h1>Your business, finally working as one.</h1>
          <p>BDB OS is a calm, connected operating system shaped around your sector and the way your business actually works—so routine administration is organised, governed and measurably reduced.</p>
          <div className="marketing-actions">
            <Link href="/discovery" className="marketing-primary">Get a custom quote <ArrowRight size={17} /></Link>
            <Link href="/login" className="marketing-secondary">Login to BDB OS</Link>
          </div>
          <div className="marketing-trust"><span><Check size={14} /> Sector-tailored workspace</span><span><Check size={14} /> Verified value evidence</span><span><Check size={14} /> 3 or 6 month commitment</span></div>
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
        <div className="marketing-section-heading"><p className="marketing-kicker">Built around you</p><h2>Software should fit the business—not the other way around.</h2><p>We start with discovery, shape the right workspace, then improve it with you over time.</p></div>
        <div className="marketing-value-grid">
          <article><span><Blocks size={20} /></span><h3>Start with your sector</h3><p>Healthcare, wellness, legal, accounting and general-service packs change the language, priorities and approved workflows without forking the product.</p></article>
          <article><span><Workflow size={20} /></span><h3>Give the operator complete outcomes</h3><p>Customers, money, bookings, messages and documents feed one governed queue instead of forty disconnected features.</p></article>
          <article><span><ShieldCheck size={20} /></span><h3>Prove the value</h3><p>Approvals, retries, failures and completed work stay auditable; simulated demos never inflate verified time or cash saved.</p></article>
        </div>
      </section>

      <section className="marketing-section" id="plans">
        <div className="marketing-section-heading"><p className="marketing-kicker">Flexible plans</p><h2>Four clear places to begin.</h2><p>Every business receives a tailored quote and final scope. The Solo Operator package is for owners who want recurring administration actively taken off their plate, with evidence.</p></div>
        <div className="plan-grid">
          {plans.map((plan) => (
            <article className={`plan-card ${plan.featured ? "featured" : ""}`} key={plan.name}>
              {plan.featured && <span className="plan-popular">Most popular starting point</span>}
              <p className="plan-eyebrow">{plan.eyebrow}</p><h3>{plan.name}</h3>
              <div className="custom-price">Custom quote</div>
              <p>{plan.description}</p>
              <div className="plan-divider" />
              <small>Your plan could include:</small>
              <ul>{plan.examples.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul>
              <Link href={`/discovery?plan=${plan.name.toLowerCase().replaceAll(" ", "-")}`}>Discuss {plan.name} <ArrowRight size={15} /></Link>
            </article>
          ))}
        </div>
        <p className="plan-note">Plans are starting points, not fixed feature lists. Final modules, monthly fee and contract scope are agreed after discovery. Minimum commitment: 3 or 6 months.</p>
      </section>

      <section className="marketing-cta"><div><p className="marketing-kicker">Let’s make work feel lighter</p><h2>Tell us what is slowing your business down.</h2><p>We’ll map the right starting plan and prepare a quote around the outcome you need.</p></div><Link href="/discovery" className="marketing-primary">Start discovery <ArrowRight size={17} /></Link></section>
      <footer className="marketing-footer"><span>© 2026 BDB OS</span><span>Calm, connected business operations.</span></footer>
    </main>
  );
}

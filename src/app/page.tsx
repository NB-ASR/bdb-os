import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  Check,
  LayoutDashboard,
  LockKeyhole,
  Smartphone,
} from "lucide-react";
import { BdbBrand } from "@/components/bdb-brand";
import { MarketingFooter, MarketingNav } from "@/components/marketing-chrome";
import { PricingGrid } from "@/components/pricing-grid";

export default function MarketingPage() {
  return (
    <div className="marketing-page">
      <MarketingNav />
      <main>
        <section className="marketing-hero">
          <div className="marketing-hero-copy">
            <p className="eyebrow">Your business. One calm workspace.</p>
            <h1>Less admin.<br /><span>More business.</span></h1>
            <p>BDB OS connects the work that normally lives across spreadsheets, inboxes, calendars and paperwork—then automates the repetitive parts around the way your business actually runs.</p>
            <div className="marketing-actions">
              <Link className="button button-primary" href="/pricing">Explore your options <ArrowRight size={17} /></Link>
              <Link className="button button-secondary" href="/login">Client sign in</Link>
            </div>
            <div className="trust-line"><LockKeyhole size={15} /> Every client receives a private, isolated workspace.</div>
          </div>
          <div className="product-window" aria-label="BDB OS product preview">
            <div className="product-window-top"><span /><span /><span /><small>Northstar Studio · BDB OS</small></div>
            <div className="product-window-body">
              <aside>
                <BdbBrand compact href="/" />
                {['Overview', 'Customers', 'Calendar', 'Communications', 'Reports'].map((item, index) => <i className={index === 0 ? "selected" : ""} key={item}>{item}</i>)}
              </aside>
              <div className="product-preview-main">
                <small>Tuesday · 14 July</small>
                <h2>Good morning, Nicholas.</h2>
                <p>Your business is in order.</p>
                <div className="preview-stats"><span><small>Received</small><strong>£18,420</strong></span><span><small>Appointments</small><strong>4 today</strong></span><span><small>Actions</small><strong>3</strong></span></div>
                <div className="preview-focus"><b><Bot size={16} /> BDB Assistant</b><p>Payment match ready for approval</p><button>Review</button></div>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-section" id="how-it-works">
          <div className="marketing-section-heading"><p className="eyebrow">Built around real working days</p><h2>Everything connected. Nothing overwhelming.</h2><p>Start with what you need today. Your BDB workspace can grow module by module as your business changes.</p></div>
          <div className="value-grid">
            <article><LayoutDashboard /><h3>One source of truth</h3><p>Customers, money, messages, files and appointments stay connected in one private workspace.</p></article>
            <article><Bot /><h3>Useful automation</h3><p>Repetitive work is handled quietly, with approval points wherever human judgement matters.</p></article>
            <article><Smartphone /><h3>Ready in your pocket</h3><p>Install BDB OS on a phone for appointments, priorities and business health at a glance.</p></article>
            <article><CalendarCheck2 /><h3>Built around you</h3><p>Your setup, modules and appearance are tailored to how your team actually works.</p></article>
          </div>
        </section>

        <section className="marketing-section plan-section">
          <div className="marketing-section-heading"><p className="eyebrow">Three clear starting points</p><h2>A plan to understand. A workspace made for you.</h2><p>Every proposal is tailored, so you only pay for the tools and automation your business needs. Choose a reference plan or build a bespoke mix with us.</p></div>
          <PricingGrid compact />
          <p className="plan-note"><Check size={15} /> Monthly billing · 3 or 6 month minimum commitment · Features can be added as your business grows</p>
        </section>

        <section className="marketing-cta">
          <BdbBrand />
          <h2>Business. Done. Better.</h2>
          <p>Tell us where time disappears in your business. We’ll show you what your BDB OS could look like.</p>
          <Link className="button button-primary" href="mailto:hello@bdb-os.co.uk?subject=BDB%20OS%20consultation">Start a conversation <ArrowRight size={17} /></Link>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

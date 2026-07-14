import Link from "next/link";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { MarketingFooter, MarketingNav } from "@/components/marketing-chrome";
import { PricingGrid } from "@/components/pricing-grid";

export default function PricingPage() {
  return (
    <div className="marketing-page">
      <MarketingNav />
      <main className="pricing-page">
        <div className="marketing-section-heading"><p className="eyebrow">BDB OS plans</p><h1>Clear starting points.<br />A price built around your business.</h1><p>There is no forced one-size-fits-all bundle. We agree the modules, automation and support you need, then set a monthly quote and a 3 or 6 month minimum term.</p></div>
        <PricingGrid />
        <section className="bespoke-banner"><SlidersHorizontal size={28} /><div><h2>Prefer a completely bespoke setup?</h2><p>Start with any combination of modules. We can add or remove capabilities as your operation evolves, with contract changes agreed before billing changes.</p></div><Link className="button button-primary" href="mailto:hello@bdb-os.co.uk?subject=Bespoke%20BDB%20OS%20quote">Build my workspace <ArrowRight size={16} /></Link></section>
      </main>
      <MarketingFooter />
    </div>
  );
}

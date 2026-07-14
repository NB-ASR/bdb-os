import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { featureCatalog, planCatalog } from "@/lib/saas/catalog";

export function PricingGrid({ compact = false }: { compact?: boolean }) {
  return (
    <div className="pricing-grid">
      {planCatalog.map((plan) => (
        <article className={`pricing-card ${plan.code === "growth" ? "pricing-featured" : ""}`} key={plan.code}>
          {plan.code === "growth" ? <span className="pricing-popular">Most flexible starting point</span> : null}
          <p className="eyebrow">{plan.strapline}</p>
          <h3>{plan.name}</h3>
          <div className="quote-price">Tailored quote<small>Monthly · 3 or 6 month commitment</small></div>
          <p>{plan.description}</p>
          <ul>
            {plan.features.slice(0, compact ? 5 : undefined).map((key) => <li key={key}><Check size={15} /> {featureCatalog.find((feature) => feature.key === key)?.name}</li>)}
          </ul>
          {compact && plan.features.length > 5 ? <small className="more-features">+ {plan.features.length - 5} more included capabilities</small> : null}
          <Link className={`button ${plan.code === "growth" ? "button-primary" : "button-secondary"}`} href={`mailto:hello@bdb-os.co.uk?subject=BDB%20OS%20${plan.name}%20plan`}>Discuss {plan.name} <ArrowRight size={16} /></Link>
        </article>
      ))}
    </div>
  );
}

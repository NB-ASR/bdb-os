import Link from "next/link";
import { BdbBrand } from "./bdb-brand";

export function MarketingNav() {
  return (
    <header className="marketing-nav">
      <BdbBrand />
      <nav aria-label="Public navigation"><Link href="/#how-it-works">How it works</Link><Link href="/pricing">Plans</Link><Link href="/login">Sign in</Link><Link className="button button-primary" href="mailto:hello@bdb-os.co.uk?subject=BDB%20OS%20consultation">Book a consultation</Link></nav>
    </header>
  );
}

export function MarketingFooter() {
  return <footer className="marketing-footer"><BdbBrand compact /><p>Private business workspaces, thoughtfully automated.</p><small>© 2026 BDB OS · Bianchini · Demicoli · Buontempo</small></footer>;
}

import Link from "next/link";
import type { MouseEventHandler } from "react";

export function BdbMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`bdb-mark ${compact ? "bdb-mark-compact" : ""}`} aria-hidden="true">
      <span>B</span><i>D</i><span>B</span>
    </span>
  );
}

export function BdbBrand({ href = "/", compact = false, onClick }: { href?: string; compact?: boolean; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link href={href} className={`bdb-brand ${compact ? "bdb-brand-compact" : ""}`} aria-label="BDB OS home" onClick={onClick}>
      <BdbMark compact={compact} />
      <span className="bdb-wordmark">
        <strong>BDB <em>OS</em></strong>
        <small>Bianchini · Demicoli · Buontempo</small>
      </span>
    </Link>
  );
}

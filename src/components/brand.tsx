import Link from "next/link";

export function BdbMonogram({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return <Link href={href} className={`bdb-identity ${compact ? "compact" : ""}`} aria-label="BDB OS home">
    <svg className="bdb-monogram" viewBox="0 0 76 76" aria-hidden="true">
      <rect x="1" y="1" width="74" height="74" rx="18" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".55" />
      <path d="M15 19h17c9 0 14 4 14 11 0 4-2 7-6 9 6 1 9 5 9 10 0 8-6 12-17 12H15V19Zm16 17c5 0 7-2 7-5s-2-5-7-5h-7v10h7Zm1 18c6 0 9-2 9-6s-3-6-9-6h-8v12h8Z" fill="currentColor" />
      <path d="M47 19h9c10 0 16 8 16 21S66 61 56 61h-9c6-3 9-10 9-21s-3-18-9-21Z" fill="currentColor" fillOpacity=".7" />
    </svg>
    <span className="bdb-wordmark"><strong>BDB OS</strong>{!compact && <small>Bianchini · Demicoli · Buontempo</small>}</span>
  </Link>;
}

export function PoweredByBdb() {
  return <span className="powered-by">Powered by <strong>BDB OS</strong></span>;
}

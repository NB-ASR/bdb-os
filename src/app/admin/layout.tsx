import Link from "next/link";
import type { ReactNode } from "react";
import { Bot, Building2, Inbox, Layers3 } from "lucide-react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <nav
        aria-label="Founder Admin sections"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 80,
          display: "flex",
          gap: 8,
          padding: 8,
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "color-mix(in srgb, var(--surface) 94%, transparent)",
          boxShadow: "0 16px 45px rgba(0,0,0,.28)",
          backdropFilter: "blur(16px)",
        }}
      >
        <Link className="button button-secondary" href="/admin"><Building2 size={15} /> Clients</Link>
        <Link className="button button-secondary" href="/admin/enquiries"><Inbox size={15} /> Sales</Link>
        <Link className="button button-secondary" href="/admin/sector-packs"><Layers3 size={15} /> Sector Packs</Link>
        <Link className="button button-secondary" href="/solo-operator-preview"><Bot size={15} /> Operator Preview</Link>
      </nav>
    </>
  );
}

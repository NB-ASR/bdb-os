"use client";

import Link from "next/link";
import { CalendarDays, FileText, ReceiptText, Search, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useBdb } from "@/lib/store";
import { Dialog, EmptyState } from "./ui";

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useBdb();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const customers = state.customers
      .filter((item) => [item.name, item.company, item.code, item.email].join(" ").toLowerCase().includes(term))
      .map((item) => ({ id: item.id, title: item.name, detail: `${item.code} · ${item.company}`, href: "/customers", type: "Customer", icon: <UserRound size={18} /> }));
    const invoices = state.invoices
      .filter((item) => [item.number, item.description, item.status].join(" ").toLowerCase().includes(term))
      .map((item) => ({ id: item.id, title: item.number, detail: item.description, href: "/accounts", type: "Invoice", icon: <ReceiptText size={18} /> }));
    const documents = state.documents
      .filter((item) => [item.name, item.linkedTo, item.type].join(" ").toLowerCase().includes(term))
      .map((item) => ({ id: item.id, title: item.name, detail: item.linkedTo, href: "/documents", type: "Document", icon: <FileText size={18} /> }));
    const bookings = state.bookings
      .filter((item) => [item.title, item.staff, item.date].join(" ").toLowerCase().includes(term))
      .map((item) => ({ id: item.id, title: item.title, detail: `${item.date} at ${item.time}`, href: "/calendar", type: "Booking", icon: <CalendarDays size={18} /> }));
    return [...customers, ...invoices, ...documents, ...bookings].slice(0, 10);
  }, [query, state]);

  return (
    <Dialog open={open} onClose={onClose} title="Search your business" description="Customers, invoices, bookings and documents in one place.">
      <div className="search-large">
        <Search size={20} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try ‘BDB-1042’ or ‘Amelia’"
          autoFocus
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-results">
        {!query ? (
          <p className="search-hint">Start typing to search across your connected workspace.</p>
        ) : results.length ? results.map((result) => (
          <Link key={`${result.type}-${result.id}`} href={result.href} className="search-result" onClick={onClose}>
            <span className="result-icon">{result.icon}</span>
            <span className="result-copy"><strong>{result.title}</strong><small>{result.detail}</small></span>
            <BadgeLabel>{result.type}</BadgeLabel>
          </Link>
        )) : (
          <EmptyState icon={<Search size={24} />} title="No results" description="Try a name, invoice number or document title." />
        )}
      </div>
    </Dialog>
  );
}

function BadgeLabel({ children }: { children: string }) {
  return <span className="result-type">{children}</span>;
}

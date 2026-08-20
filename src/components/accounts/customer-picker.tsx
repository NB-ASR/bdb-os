"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { CustomerOption } from "./composer-types";
import styles from "./accounts-composer.module.css";

export function CustomerPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedCustomerId = value?.id ?? "";

  useEffect(() => {
    if (!workspaceId || selectedCustomerId) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ workspaceId, resource: "customers" });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Customers could not be searched.");
        if (active) setCustomers(result.result?.customers ?? []);
      } catch (lookupError) {
        if (active) setError(lookupError instanceof Error ? lookupError.message : "Customers could not be searched.");
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, selectedCustomerId, workspaceId]);

  return (
    <div className={styles.lookup}>
      <label className={styles.searchField}>
        <span>Find Customer</span>
        <span className={styles.searchInput}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, code or company…" /></span>
      </label>
      {value ? <div className={styles.selectedRecord}><span><strong>{value.name}</strong><small>{value.code}{value.company ? ` · ${value.company}` : ""}</small></span><button type="button" onClick={() => { onChange(null); setQuery(""); }}>Change</button></div> : null}
      {!value ? <div className={styles.lookupResults} aria-live="polite">
        {customers.map((customer) => (
          <button type="button" key={customer.id} onClick={() => { onChange(customer); setQuery(customer.name); }}>
            <span><strong>{customer.name}</strong><small>{customer.code}{customer.company ? ` · ${customer.company}` : ""}</small></span>
          </button>
        ))}
        {!customers.length ? <span className={styles.lookupEmpty}>{loading ? "Searching Customers…" : error || "No matching Customers."}</span> : null}
      </div> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CircleDollarSign, CreditCard, FileText, Truck, Users } from "lucide-react";
import styles from "@/app/accounts/accounts-layout.module.css";

const entries = [
  { href: "/accounts", label: "Overview", icon: CircleDollarSign, match: (path: string) => path === "/accounts" },
  { href: "/accounts/sales", label: "Sales", icon: FileText, match: (path: string) => path.startsWith("/accounts/sales") },
  { href: "/accounts/payments", label: "Payments", icon: CreditCard, match: (path: string) => path.startsWith("/accounts/payments") },
  { href: "/accounts/customers", label: "Customer Balances", icon: Users, match: (path: string) => path.startsWith("/accounts/customers") },
  { href: "/accounts/payables", label: "Supplier Payables", icon: Truck, match: (path: string) => path.startsWith("/accounts/payables") },
] as const;

export function AccountsSectionNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.departmentNav} aria-label="Accounts workspace">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const active = entry.match(pathname);
        return (
          <Link key={entry.href} href={entry.href} data-active={active ? "true" : "false"}>
            <Icon size={16} /> {entry.label}
          </Link>
        );
      })}
      <span className={styles.departmentDivider} aria-hidden="true" />
      <Link href="/customers"><Building2 size={16} /> Customer profiles</Link>
    </nav>
  );
}

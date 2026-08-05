import Link from "next/link";
import type { ReactNode } from "react";
import { CircleDollarSign, Truck } from "lucide-react";
import styles from "./accounts-layout.module.css";

export default function AccountsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className={styles.departmentNav} aria-label="Accounts departments">
        <Link href="/accounts"><CircleDollarSign size={16} /> Customer Accounts</Link>
        <Link href="/accounts/payables"><Truck size={16} /> Supplier Payables</Link>
      </nav>
      {children}
    </>
  );
}

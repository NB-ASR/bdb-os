"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Link2, Package } from "lucide-react";
import styles from "./products-layout.module.css";

export default function ProductsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const catalogueActive = pathname === "/products";

  return (
    <>
      <nav className={styles.productNav} aria-label="Products workflows">
        <Link className={catalogueActive ? styles.active : ""} href="/products">
          <Package size={16} /> Catalogue
        </Link>
        <Link className={!catalogueActive ? styles.active : ""} href="/products/suppliers">
          <Link2 size={16} /> Supplier terms
        </Link>
      </nav>
      {children}
    </>
  );
}

import type { ReactNode } from "react";
import { AccountsSectionNav } from "@/components/accounts/accounts-section-nav";

export default function AccountsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountsSectionNav />
      {children}
    </>
  );
}

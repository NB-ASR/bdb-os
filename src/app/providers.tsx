"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SaasProvider } from "@/lib/saas/context";
import { BdbProvider } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SaasProvider>
      <BdbProvider>
        <RouteShell>{children}</RouteShell>
      </BdbProvider>
    </SaasProvider>
  );
}

function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicRoute = pathname === "/"
    || pathname === "/pricing"
    || pathname === "/login"
    || pathname === "/offline"
    || pathname === "/mfa"
    || pathname.startsWith("/auth/");

  if (publicRoute || pathname.startsWith("/admin")) return children;
  return <AppShell>{children}</AppShell>;
}

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSoloOperator = pathname.startsWith("/solo-operator");
  const isStandalone =
    pathname === "/" ||
    pathname.startsWith("/discovery") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/mfa") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/sector-packs-preview") ||
    pathname.startsWith("/activate") ||
    pathname.startsWith("/change-password") ||
    pathname.startsWith("/no-workspace") ||
    pathname.startsWith("/workspace-suspended") ||
    pathname.startsWith("/feature-unavailable");

  if (isStandalone) return children;

  if (isSoloOperator) {
    return (
      <BdbProvider>
        <ThemeRuntime />
        {children}
      </BdbProvider>
    );
  }

  return (
    <BdbProvider>
      <ThemeRuntime />
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

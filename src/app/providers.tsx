"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStandalone =
    pathname === "/" ||
    pathname.startsWith("/discovery") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/mfa") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/activate") ||
    pathname.startsWith("/change-password") ||
    pathname.startsWith("/no-workspace") ||
    pathname.startsWith("/workspace-suspended") ||
    pathname.startsWith("/feature-unavailable");

  if (isStandalone) return children;

  return (
    <BdbProvider>
      <ThemeRuntime />
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

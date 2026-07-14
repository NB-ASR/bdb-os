"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname === "/" || pathname.startsWith("/discovery") || pathname.startsWith("/login") || pathname.startsWith("/mfa") || pathname.startsWith("/admin") || pathname.startsWith("/no-workspace") || pathname.startsWith("/workspace-suspended") || pathname.startsWith("/feature-unavailable");

  if (isPublic) return children;

  return (
    <BdbProvider>
      <ThemeRuntime />
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

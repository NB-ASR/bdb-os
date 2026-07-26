"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { BdbProvider } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const isStandalone =
    pathname === "/" ||
    pathname.startsWith("/discovery") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/mfa") ||
    isAdmin ||
    pathname.startsWith("/dev-access") ||
    pathname.startsWith("/dev-password-setup") ||
    pathname.startsWith("/activate") ||
    pathname.startsWith("/change-password") ||
    pathname.startsWith("/no-workspace") ||
    pathname.startsWith("/workspace-suspended") ||
    pathname.startsWith("/feature-unavailable");

  if (isAdmin) {
    return (
      <>
        <div style={{ position: "fixed", top: 18, right: 22, zIndex: 1000 }}>
          <DevRoleSwitcher />
        </div>
        {children}
      </>
    );
  }

  if (isStandalone) return children;

  return (
    <BdbProvider>
      <ThemeRuntime />
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

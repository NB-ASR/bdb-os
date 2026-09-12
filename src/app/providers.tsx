"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

function isOfflineShellPath(pathname: string) {
  return pathname === "/accounts"
    || pathname.startsWith("/accounts/")
    || pathname === "/customers"
    || pathname.startsWith("/customers/");
}

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStandalone =
    pathname === "/" ||
    pathname.startsWith("/discovery") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/mfa") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/activate") ||
    pathname.startsWith("/change-password") ||
    pathname.startsWith("/no-workspace") ||
    pathname.startsWith("/workspace-suspended") ||
    pathname.startsWith("/feature-unavailable");

  useEffect(() => {
    if (!isOfflineShellPath(pathname) || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    const prepareOfflineShell = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const ready = await navigator.serviceWorker.ready;
        if (cancelled) return;
        (ready.active ?? registration.active)?.postMessage({
          type: "CACHE_OFFLINE_SHELL",
          path: pathname,
        });
      } catch {
        // Offline support is best-effort; normal connected navigation must remain available.
      }
    };

    void prepareOfflineShell();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (isStandalone) return children;

  return (
    <BdbProvider>
      <ThemeRuntime />
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

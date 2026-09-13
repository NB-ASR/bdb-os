"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider, useBdb } from "@/lib/store";
import { ThemeRuntime } from "@/components/theme-runtime";

function isOfflineShellPath(pathname: string) {
  return pathname === "/accounts"
    || pathname.startsWith("/accounts/")
    || pathname === "/customers"
    || pathname.startsWith("/customers/");
}

function isCustomerOfflinePath(pathname: string) {
  return pathname === "/customers" || pathname.startsWith("/customers/");
}

function RoutedShell({ children, offlineCapable }: { children: ReactNode; offlineCapable: boolean }) {
  const { syncStatus } = useBdb();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (offlineCapable && (!online || syncStatus === "offline")) return children;
  return <AppShell>{children}</AppShell>;
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
  const customerOfflineCapable = isCustomerOfflinePath(pathname);

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
    <BdbProvider allowOfflineShell={customerOfflineCapable}>
      <ThemeRuntime />
      <RoutedShell offlineCapable={customerOfflineCapable}>{children}</RoutedShell>
    </BdbProvider>
  );
}

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname === "/" || pathname.startsWith("/discovery") || pathname.startsWith("/login");

  if (isPublic) return children;

  return (
    <BdbProvider>
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

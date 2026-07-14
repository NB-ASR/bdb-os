"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { BdbProvider } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <BdbProvider>
      <AppShell>{children}</AppShell>
    </BdbProvider>
  );
}

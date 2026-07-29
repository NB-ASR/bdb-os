"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";

const items = [
  { href: "/calendar", label: "Appointments", icon: CalendarDays },
  { href: "/calendar/availability", label: "Availability", icon: Clock3 },
  { href: "/calendar/eligibility", label: "Service eligibility", icon: UserRoundCheck },
];

export default function CalendarLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <nav
        aria-label="Calendar operations"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 18,
          padding: 8,
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "var(--panel)",
        }}
      >
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 12,
                color: active ? "var(--gold)" : "var(--muted)",
                background: active ? "var(--gold-soft)" : "transparent",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              <Icon size={16} /> {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}

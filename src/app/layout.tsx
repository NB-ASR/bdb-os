import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import "./bdb-design-system.css";
import { Providers } from "./providers";

const bodyFont = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const displayFont = Manrope({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BDB OS · Business. Done. Better.",
    template: "%s · BDB OS",
  },
  description: "A calm, connected operating system for modern small businesses.",
  applicationName: "BDB OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BDB OS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0e0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

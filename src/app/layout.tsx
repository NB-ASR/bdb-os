import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import "./bdb-design-system.css";
import "./bdb-refinement-v2.css";
import { Providers } from "./providers";
import { getSiteUrl } from "@/lib/site-url";

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
  metadataBase: getSiteUrl(),
  title: {
    default: "BDB OS · Business. Done. Better.",
    template: "%s · BDB OS",
  },
  description: "Websites, practical AI automation and custom business systems for growing businesses.",
  applicationName: "BDB OS",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "BDB OS · Business. Done. Better.",
    description: "Websites, practical AI automation and custom business systems for growing businesses.",
    siteName: "BDB OS",
  },
  twitter: {
    card: "summary",
    title: "BDB OS · Business. Done. Better.",
    description: "Websites, practical AI automation and custom business systems for growing businesses.",
  },
  appleWebApp: {
    capable: true,
    title: "BDB OS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

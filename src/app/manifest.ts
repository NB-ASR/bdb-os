import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BDB OS · Business. Done. Better.",
    short_name: "BDB OS",
    description: "A calm, connected operating system for modern small businesses.",
    id: "/workspace",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    background_color: "#10100f",
    theme_color: "#11110f",
    icons: [
      { src: "/bdb-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Calendar", short_name: "Calendar", url: "/calendar", icons: [{ src: "/bdb-mark.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Customers", short_name: "Customers", url: "/customers", icons: [{ src: "/bdb-mark.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "New invoice", short_name: "Invoice", url: "/accounts", icons: [{ src: "/bdb-mark.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
  };
}

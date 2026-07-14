import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BDB OS · Business. Done. Better.",
    short_name: "BDB OS",
    description: "A calm, connected operating system for modern small businesses.",
    start_url: "/",
    display: "standalone",
    background_color: "#10100f",
    theme_color: "#11110f",
    icons: [
      { src: "/bdb-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

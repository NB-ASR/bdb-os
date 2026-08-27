import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/discovery"],
      disallow: [
        "/accounts",
        "/admin",
        "/api",
        "/calendar",
        "/customers",
        "/inventory",
        "/login",
        "/products",
        "/reports",
        "/sales",
        "/services",
        "/settings",
        "/suppliers",
        "/workspace",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}


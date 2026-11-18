import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Public pages are indexable; accounts, admin and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const site = env.APP_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/*/dashboard", "/*/admin", "/*/pay", "/*/auth", "/remote/"] }],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}

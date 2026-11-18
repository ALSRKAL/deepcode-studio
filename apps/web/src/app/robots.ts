import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

// Built per request: the site address comes from the host at run time.
export const dynamic = "force-dynamic";

/** Public pages are indexable; accounts, admin and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/*/dashboard", "/*/admin", "/*/pay", "/*/auth", "/remote/"] }],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}

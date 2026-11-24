import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

// Built per request: the site address comes from the host at run time.
export const dynamic = "force-dynamic";

/** Public pages are indexable; accounts, admin, billing and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  const host = new URL(site).host;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/remote/",
          "/*/dashboard",
          "/*/admin",
          "/*/pay",
          "/*/auth",
          "/*/sign-in",
          "/*/sign-up",
          "/*/forgot-password",
          "/*/reset-password",
          "/*/verify-email",
          "/*/mock-billing",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
    host,
  };
}

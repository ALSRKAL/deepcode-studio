import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

// Built per request: the site address comes from the host at run time.
export const dynamic = "force-dynamic";

const PAGES = [
  "",
  "/pricing",
  "/download",
  "/docs",
  "/changelog",
  "/contact",
  "/security",
  "/legal/terms",
  "/legal/privacy",
  "/legal/acceptable-use",
  "/legal/licenses",
];

/** Both languages of every public page, each linked to its counterpart. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();
  const lastModified = new Date();
  return PAGES.flatMap((path) =>
    (["ar", "en"] as const).map((locale) => ({
      url: `${site}/${locale}${path}`,
      lastModified,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : path === "/pricing" || path === "/download" ? 0.9 : 0.6,
      alternates: {
        languages: {
          ar: `${site}/ar${path}`,
          en: `${site}/en${path}`,
          "x-default": `${site}/ar${path}`,
        },
      },
    })),
  );
}

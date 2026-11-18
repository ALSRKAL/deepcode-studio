import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

const PAGES = ["", "/pricing", "/download", "/docs", "/changelog", "/legal/terms", "/legal/privacy"];

/** Both languages of every public page, each linked to its counterpart. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = env.APP_URL.replace(/\/$/, "");
  return PAGES.flatMap((path) =>
    (["ar", "en"] as const).map((locale) => ({
      url: `${site}/${locale}${path}`,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : 0.6,
      alternates: { languages: { ar: `${site}/ar${path}`, en: `${site}/en${path}` } },
    })),
  );
}

import type { Metadata } from "next";
import { siteUrl } from "./siteUrl";

export type SiteLocale = "ar" | "en";
export const SITE_NAME = "DeepCode Studio";
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Arabic cards are pre-rendered with Chromium: Satori shapes Arabic glyphs but
 * distributes RTL word spacing poorly. English cards stay dynamic per page.
 */
const ARABIC_CARDS: Record<string, string> = {
  "/": "/og/card-home-ar.png",
  "/pricing": "/og/card-pricing-ar.png",
  "/download": "/og/card-download-ar.png",
  "/docs": "/og/card-docs-ar.png",
  "/changelog": "/og/card-changelog-ar.png",
  "/contact": "/og/card-contact-ar.png",
  "/security": "/og/card-security-ar.png",
};

function cardFor(locale: SiteLocale, path: string): string | undefined {
  if (locale !== "ar") return undefined;
  return path.startsWith("/legal/") ? "/og/card-legal-ar.png" : ARABIC_CARDS[path];
}

/** `/${locale}` for the home page, `/${locale}/path` otherwise. */
export function pathWithLocale(locale: SiteLocale, path: string): string {
  const clean = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${clean}`;
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}

/** Keep SERP/social descriptions inside the usual 160-character budget. */
export function clampDescription(value: string, max = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Per-page metadata: unique title/description, self-referencing canonical,
 * ar/en/x-default alternates, Open Graph and Twitter cards. Every public page
 * must call this (or noindexMetadata) so child pages never inherit the home
 * page's canonical and preview.
 */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  image,
  noindex = false,
}: {
  locale: SiteLocale;
  path: string;
  title: string;
  description: string;
  /** Absolute URL or a site-relative path. */
  image?: string;
  noindex?: boolean;
}): Metadata {
  const canonical = absoluteUrl(pathWithLocale(locale, path));
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
  const imageUrl = absoluteUrl(image ?? cardFor(locale, path) ?? `/api/og?locale=${locale}&title=${encodeURIComponent(title)}`);
  const shortDescription = clampDescription(description);
  const other = locale === "ar" ? "en" : "ar";
  const languages = {
    ar: absoluteUrl(pathWithLocale("ar", path)),
    en: absoluteUrl(pathWithLocale("en", path)),
    "x-default": absoluteUrl(pathWithLocale("ar", path)),
  };

  const twitter: Metadata["twitter"] = {
    card: "summary_large_image",
    title: fullTitle,
    description: shortDescription,
    images: [imageUrl],
  };
  const twitterSite = process.env.NEXT_PUBLIC_TWITTER_SITE?.trim();
  const twitterCreator = process.env.NEXT_PUBLIC_TWITTER_CREATOR?.trim();
  if (twitterSite) twitter.site = twitterSite;
  if (twitterCreator) twitter.creator = twitterCreator;

  const openGraph: Metadata["openGraph"] = {
    type: "website",
    siteName: SITE_NAME,
    title: fullTitle,
    description: shortDescription,
    url: canonical,
    locale: locale === "ar" ? "ar" : "en_US",
    alternateLocale: [other === "ar" ? "ar" : "en_US"],
    images: [
      {
        url: imageUrl,
        width: OG_WIDTH,
        height: OG_HEIGHT,
        alt: title,
        type: "image/png",
      },
    ],
  };

  return {
    title: { absolute: fullTitle },
    description: shortDescription,
    alternates: { canonical, languages },
    openGraph,
    twitter,
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}

/** Auth, billing and utility pages: real title, never indexed. */
export function noindexMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: SiteLocale;
  path: string;
  title: string;
  description: string;
}): Metadata {
  return pageMetadata({ locale, path, title, description, noindex: true });
}

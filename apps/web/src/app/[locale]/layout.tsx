import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";
import { siteUrl } from "@/lib/siteUrl";
import { JsonLd } from "@/components/json-ld";
import arMessages from "../../i18n/messages/ar.json";
import enMessages from "../../i18n/messages/en.json";
import "../globals.css";

// Self-hosted via next/font; subsets split by script so an English visitor never
// downloads Arabic glyphs (docs/plan/03 §1.5).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans-arabic",
  display: "swap",
});

const LOCALES = ["ar", "en"] as const;
const MESSAGES: Record<(typeof LOCALES)[number], Record<string, unknown>> = { ar: arMessages, en: enMessages };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as (typeof LOCALES)[number])) notFound();
  // Lets next-intl read the locale from the segment instead of request headers,
  // so public pages under this layout can be cached (see i18n/request.ts).
  setRequestLocale(locale);
  const messages = MESSAGES[locale as (typeof LOCALES)[number]];
  const site = siteUrl();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: site,
      logo: absoluteUrl("/brand/icon-512.png"),
      sameAs: ["https://github.com/ALSRKAL/deepcode-desktop"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: site,
      inLanguage: ["ar", "en"],
    },
  ];
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plexArabic.variable} min-h-dvh bg-bg text-fg antialiased`}
        style={{ fontFamily: locale === "ar" ? "var(--font-ar)" : "var(--font-en)" }}
      >
        <JsonLd data={jsonLd} />
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}


/** Light theme is the only theme (owner decision 2026-11-15); browser UI matches. */
export const viewport: Viewport = {
  themeColor: "#f7f8fa",
  colorScheme: "light",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = (LOCALES as readonly string[]).includes(raw) ? (raw as (typeof LOCALES)[number]) : "ar";
  const metadata = MESSAGES[locale]["metadata"] as { title: string; description: string };
  const other = locale === "ar" ? "en" : "ar";
  const image = absoluteUrl(`/og/og-${locale}.png`);
  // Absolute URLs for link previews (WhatsApp, X, LinkedIn need an absolute og:image).
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: metadata.title, template: `%s · ${SITE_NAME}` },
    description: metadata.description,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "DeveloperApplication",
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ar: absoluteUrl("/ar"),
        en: absoluteUrl("/en"),
        "x-default": absoluteUrl("/ar"),
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: metadata.title,
      description: metadata.description,
      url: absoluteUrl(`/${locale}`),
      locale: locale === "ar" ? "ar" : "en_US",
      alternateLocale: [other === "ar" ? "ar" : "en_US"],
      images: [{ url: image, width: 1200, height: 630, alt: metadata.title, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
      images: [image],
    },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
    formatDetection: { telephone: false, email: false, address: false },
    robots: { index: true, follow: true },
  };
}

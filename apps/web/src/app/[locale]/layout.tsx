import { Inter, IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/siteUrl";
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
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

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
  const messages = MESSAGES[locale as (typeof LOCALES)[number]];
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plexArabic.variable} ${mono.variable} min-h-dvh bg-bg text-fg antialiased`}
        style={{ fontFamily: locale === "ar" ? "var(--font-ar)" : "var(--font-en)" }}
      >
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export async function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
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
  // Absolute URLs for link previews (WhatsApp, X, LinkedIn need an absolute og:image).
  const site = siteUrl();
  return {
    metadataBase: new URL(site),
    title: { default: metadata.title, template: `%s · DeepCode Studio` },
    description: metadata.description,
    applicationName: "DeepCode Studio",
    alternates: {
      canonical: `/${locale}`,
      languages: { ar: "/ar", en: "/en", "x-default": "/ar" },
    },
    openGraph: {
      type: "website",
      siteName: "DeepCode Studio",
      title: metadata.title,
      description: metadata.description,
      url: `/${locale}`,
      locale: locale === "ar" ? "ar_AR" : "en_US",
      alternateLocale: [other === "ar" ? "ar_AR" : "en_US"],
      images: [{ url: `/og/og-${locale}.png`, width: 1200, height: 630, alt: metadata.title, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
      images: [`/og/og-${locale}.png`],
    },
    robots: { index: true, follow: true },
  };
}

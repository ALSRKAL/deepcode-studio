import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card, EmptyState } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

/** Docs (docs/plan/03 §2 /docs/…): quick start, gateway API — Phase 2b stubs with real content. */
export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("keys");
  const p = await getTranslations("pricing");
  const nav = await getTranslations("nav");
  const gatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 grid gap-8">
        <h1 className="text-scale-lg font-semibold">{nav("docs")}</h1>

        <section className="grid gap-3">
          <h2 className="text-scale-md font-semibold">{t("quickstart")}</h2>
          <Card className="p-5">
            <LtrIsland className="block overflow-x-auto font-mono text-[12.5px] leading-6" as="pre" tabIndex={0}>
              {`# 1. create a key in the dashboard
# 2. call the gateway
curl ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer sk-dc-…" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepcode-default","stream":true,
       "messages":[{"role":"user","content":"hello"}]}'`}
            </LtrIsland>
          </Card>
        </section>

        <section className="grid gap-3">
          <h2 className="text-scale-md font-semibold">{p("perModelPrices")}</h2>
          <Card className="p-5">
            <EmptyState title={p("perModelPrices")} body="See packages/db/src/catalog.ts — served here once the admin price table page is live." />
          </Card>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

// Public, identical for every visitor: rendered on first request, then served from
// cache and refreshed at most every 60 s (2026-11-21: rendering per visit gave 11 req/s
// at 10 s latency under load). The empty list enables that runtime cache without
// prerendering at build time (the image build has no database).
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

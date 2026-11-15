import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { billingSessions, plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { completeMockCheckoutAction } from "@/actions/billing";
import { SubmitButton } from "@/components/ui/client";
import { Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

/**
 * Local test-mode checkout (owner decision 2): simulates the provider page. Only
 * the owning user, with a pending session, can press pay — which posts a signed
 * webhook through the same machinery as a real provider.
 */
export default async function MockBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { locale } = await params;
  const { session } = await searchParams;
  const t = await getTranslations("mockBilling");
  const p = await getTranslations("pricing");
  const user = await requireUser();

  const [row] = session
    ? await db()
        .db.select({ s: billingSessions, p: plans })
        .from(billingSessions)
        .innerJoin(plans, eq(plans.id, billingSessions.planId))
        .where(eq(billingSessions.id, session))
        .limit(1)
    : [];

  if (!row || row.s.userId !== user.id || row.s.provider !== "mock") {
    redirect(`/${locale}/dashboard/billing?error=bad_session`);
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-content-center gap-6 px-4">
      <Card className="p-6">
        <h1 className="text-scale-md font-semibold">{t("title")}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">{t("body")}</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-fg-subtle">{t("plan")}</dt>
          <dd className="font-medium">{locale === "ar" ? row.p.nameAr : row.p.nameEn}</dd>
          <dt className="text-fg-subtle">{t("price")}</dt>
          <dd>
            <Num>{(row.p.priceCents / 100).toFixed(2)}</Num> USD / {row.p.interval}
          </dd>
        </dl>
        <form action={completeMockCheckoutAction} className="mt-6 flex gap-2">
          <input type="hidden" name="session" value={row.s.id} />
          <SubmitButton pendingLabel="…">{t("pay")}</SubmitButton>
          <a
            href={`/${locale}/dashboard/billing`}
            className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-[14px] text-fg-muted hover:text-fg"
          >
            {t("cancel")}
          </a>
        </form>
        <p className="mt-4">
          <LtrIsland className="text-[11px] text-fg-subtle">{row.s.id}</LtrIsland>
        </p>
        <p className="mt-1 text-[12px] text-fg-subtle">{p("sub")}</p>
      </Card>
    </main>
  );
}

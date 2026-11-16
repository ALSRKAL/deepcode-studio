import { getTranslations } from "next-intl/server";

/** The 24-hour free trial offer, shown above plan cards. The model name never mirrors in Arabic. */
export async function TrialOffer() {
  const t = await getTranslations("pricing");
  return (
    <p
      role="note"
      className="mt-8 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-[14px] leading-7"
      data-testid="trial-offer"
    >
      <strong className="font-semibold">{t("trialOfferTitle")}</strong>{" "}
      {t.rich("trialOfferBody", { model: (chunks) => <bdi dir="ltr" className="font-medium">{chunks}</bdi> })}
    </p>
  );
}

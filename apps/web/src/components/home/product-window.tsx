import { getLocale, getTranslations } from "next-intl/server";

/**
 * The hero's product window: a faithful, static rendering of the DeepCode Studio
 * desktop app (dark, like the real app) in the page's language. Chat and lists follow
 * the locale's direction; code, paths and commands are LTR islands (the split line).
 * Decorative for assistive tech except its heading: the real content is the page copy.
 */
/** Isolate code tokens (paths, calls) so they keep LTR order inside Arabic text. */
function withCode(text: string) {
  return text.split(/([\w./-]+\(\)|[\w-]+\/[\w./-]+)/g).map((part, i) =>
    i % 2 === 1 ? (
      <bdi key={i} dir="ltr" className="font-mono text-[12px]">
        {part}
      </bdi>
    ) : (
      part
    ),
  );
}

export async function ProductWindow() {
  const t = await getTranslations("home");
  const locale = await getLocale();
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <figure
      dir={dir}
      aria-label={t("windowTitle")}
      className="relative overflow-hidden rounded-[14px] border border-ink-line bg-ink text-ink-fg shadow-stage"
      data-testid="ide-preview"
    >
      {/* Title bar */}
      <div className="flex h-10 items-center gap-2 border-b border-ink-line bg-ink-2 px-4" aria-hidden="true">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span dir="ltr" className="mx-auto font-mono text-[12px] text-ink-muted">
          {t("windowTitle")}
        </span>
      </div>

      <div className="grid min-h-[300px] grid-cols-1 md:min-h-[380px] md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]" aria-hidden="true">
        {/* Tasks */}
        <aside className="hidden border-e border-ink-line bg-ink-2/60 p-3 md:block">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">{t("winTasks")}</p>
          <ul className="grid gap-1 text-[13px]">
            <li className="flex items-center gap-2 rounded-md bg-ink-3 px-2 py-1.5 text-ink-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-glow" />
              {t("winTask1")}
            </li>
            <li className="flex items-center gap-2 px-2 py-1.5 text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-line" />
              {t("winTask2")}
            </li>
            <li className="flex items-center gap-2 px-2 py-1.5 text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-line" />
              {t("winTask3")}
            </li>
          </ul>
        </aside>

        {/* Conversation */}
        <section className="flex min-w-0 flex-col border-e border-ink-line p-4">
          <div className="ms-auto max-w-[90%] rounded-xl rounded-ee-sm bg-ink-3 px-3.5 py-2.5 text-[13.5px] leading-6">
            {t("winPrompt")}
          </div>
          <div className="mt-4 rounded-xl border border-ink-line p-3.5">
            <p className="text-[12px] font-medium text-accent-glow">{t("winPlan")}</p>
            <ol className="mt-2 grid gap-1.5 text-[13px] text-ink-fg/90">
              {[t("winStep1"), t("winStep2"), t("winStep3")].map((step, i) => (
                <li key={step} className="flex items-start gap-2">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#34d399]/15 text-[10px] text-[#34d399]">✓</span>
                  <span className={i === 2 ? "text-ink-fg" : ""}>{withCode(step)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-auto pt-4">
            <div className="flex items-center gap-2 rounded-xl border border-ink-line bg-ink-2 px-3 py-2.5">
              <span className="flex-1 truncate text-[13px] text-ink-muted">{t("winAsk")}</span>
              <span dir="ltr" className="hidden items-center gap-1.5 rounded-md bg-ink-3 px-2 py-1 text-[11.5px] sm:flex">
                <span className="font-medium text-ink-fg">GLM-5.3-Flash</span>
                <span className="text-ink-muted">Zhipu GLM 5.3 Flash</span>
              </span>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-glow text-ink">↑</span>
            </div>
          </div>
        </section>

        {/* Diff + terminal: always LTR */}
        <section className="ltr-island hidden min-w-0 flex-col lg:flex" dir="ltr">
          <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2 font-mono text-[11.5px] text-ink-muted">
            <span className="text-ink-fg">signup.tsx</span>
            <span className="text-[#34d399]">+9</span>
            <span className="text-[#f87171]">−2</span>
          </div>
          <pre className="flex-1 overflow-hidden px-4 py-3 font-mono text-[12px] leading-6">
            <code>
              <span className="block text-ink-muted">{"  const [email, setEmail] = useState(\"\");"}</span>
              <span className="block bg-[#f87171]/10 text-[#fca5a5]">{"- if (!email) return;"}</span>
              <span className="block bg-[#34d399]/10 text-[#6ee7b7]">{"+ if (!isEmail(email)) {"}</span>
              <span className="block bg-[#34d399]/10 text-[#6ee7b7]">{"+   setError(t(\"invalidEmail\"));"}</span>
              <span className="block bg-[#34d399]/10 text-[#6ee7b7]">{"+   return;"}</span>
              <span className="block bg-[#34d399]/10 text-[#6ee7b7]">{"+ }"}</span>
              <span className="block text-ink-muted">{"  await submit({ email });"}</span>
            </code>
          </pre>
          <div className="border-t border-ink-line bg-[#060a14] px-4 py-3 font-mono text-[11.5px] leading-5">
            <p className="text-ink-muted">$ pnpm test signup</p>
            <p className="text-[#34d399]">✓ 12 passed <span className="text-ink-muted">(1.4s)</span></p>
          </div>
        </section>
      </div>
    </figure>
  );
}

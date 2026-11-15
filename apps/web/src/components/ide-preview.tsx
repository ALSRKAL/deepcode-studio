"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's interactive IDE preview (docs/plan/03 §3): a real React mock of the
 * shell — sidebar, chat, diff — with a scripted agent run. The locale toggle flips
 * Arabic/English live. Pauses off-screen; static frame under reduced motion.
 * The bilingual split line (§1.6): a 1px cyan rule separates the RTL chat pane
 * from the LTR code pane.
 */
export function IdePreview() {
  const [dir, setDir] = useState<"rtl" | "ltr">("rtl");
  const [typed, setTyped] = useState(0);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const prompt = "أضف دالة تحقق للبريد الإلكتروني في utils.ts";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!visible || reduced) return;
    if (typed >= prompt.length) return;
    const id = setTimeout(() => setTyped((n) => n + 1), 70);
    return () => clearTimeout(id);
  }, [typed, visible, prompt.length]);

  return (
    <div ref={ref} className="rounded-lg border border-border bg-surface overflow-hidden" data-testid="ide-preview">
      <div className="flex items-center gap-1.5 border-b border-border px-3 h-9">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span aria-hidden="true" className="ms-3 text-[12px] text-fg-subtle">
          deepcode — workspace
        </span>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "rtl" ? "ltr" : "rtl"))}
          className="ms-auto rounded-sm border border-border px-2 h-6 text-[11px] text-fg-muted hover:text-fg"
        >
          {dir === "rtl" ? "RTL → LTR" : "LTR → RTL"}
        </button>
      </div>
      <div dir={dir} className="grid md:grid-cols-[180px_1fr_1fr] min-h-[300px]">
        <aside className="border-e border-border p-3 text-[12px] text-fg-muted hidden md:block">
          <p className="text-fg font-medium mb-2">{dir === "rtl" ? "المستكشف" : "Explorer"}</p>
          <ul className="grid gap-1">
            {["src/", "utils.ts", "main.tsx", "README.md"].map((f) => (
              <li key={f} dir="ltr" className="truncate font-mono text-[11px]">
                {f}
              </li>
            ))}
          </ul>
        </aside>
        <section dir={dir} className="p-4 border-e border-border">
          <p className="text-[12px] text-fg-subtle mb-2">{dir === "rtl" ? "الدردشة" : "Chat"}</p>
          <div className="rounded-sm bg-bg border border-border p-3 text-[13px] leading-6" dir={dir}>
            {prompt.slice(0, typed)}
            {typed < prompt.length ? <span className="text-primary">▌</span> : null}
          </div>
          <p className="mt-2 text-[11px] text-fg-subtle">{dir === "rtl" ? "الوكيل: خطة من خطوتين" : "Agent: 2-step plan"}</p>
          <ol dir={dir} className="mt-1 list-inside list-decimal text-[12px] text-fg-muted">
            <li>{dir === "rtl" ? "قراءة utils.ts" : "read utils.ts"}</li>
            <li>{dir === "rtl" ? "إضافة isEmail" : "add isEmail"}</li>
          </ol>
        </section>
        <section className="p-4">
          <p className="text-[12px] text-fg-subtle mb-2">{dir === "rtl" ? "الفروقات" : "Diff"}</p>
          {/* The bilingual split line: the code pane is always LTR. */}
          <div className="border-s-2 border-primary ps-3 font-mono text-[12px] leading-6 ltr-island" dir="ltr">
            <p className="text-danger">- export const name = (s) =&gt; s</p>
            <p className="text-success">+ export const isEmail = (s: string) =&gt;</p>
            <p className="text-success">+ &nbsp;&nbsp;/^[^@]+@[^@]+$/.test(s);</p>
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * OS-detecting download block (docs/plan/03 §3.2). Detection is client-side;
 * macOS always shows both arch buttons (Apple Silicon first) since Safari cannot
 * report the architecture reliably.
 */
type OS = "win" | "mac" | "linux" | "unknown";

export function DownloadDetector({
  builds,
}: {
  builds: Array<{ platform: string; arch: string; fileKind: string; version: string; url: string; sizeBytes: number }>;
}) {
  const t = useTranslations("download");
  const [os, setOs] = useState<OS>("unknown");

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("windows")) setOs("win");
    else if (ua.includes("mac")) setOs("mac");
    else if (ua.includes("linux")) setOs("linux");
  }, []);

  const primary = builds.filter((b) => {
    if (os === "win") return b.platform === "win" && b.arch === "x64" && b.fileKind === "exe";
    if (os === "mac") return b.platform === "mac" && b.fileKind === "dmg" && b.arch === "arm64";
    if (os === "linux") return b.platform === "linux" && b.arch === "x64" && b.fileKind === "AppImage";
    return false;
  });
  const primaryBuild = primary[0];

  return (
    <div className="grid gap-6">
      <div className="rounded-lg border border-primary/40 bg-surface p-6">
        <p className="text-fg-subtle text-[13px]">{t("detected")}</p>
        {primaryBuild ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href={primaryBuild.url}
              className="inline-flex h-11 items-center rounded-sm bg-primary px-5 text-[15px] text-primary-fg font-medium hover:bg-primary-hover"
            >
              {os === "win" ? "Windows" : os === "mac" ? "macOS" : "Linux"} — {primaryBuild.fileKind} x64
            </a>
            <span className="text-[13px] text-fg-muted font-mono tabular" dir="ltr">
              v{primaryBuild.version} · {(primaryBuild.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-fg-muted">{os === "unknown" ? t("sub") : t("noReleases")}</p>
        )}
      </div>
    </div>
  );
}

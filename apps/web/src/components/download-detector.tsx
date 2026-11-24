"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { detectOS, findBuild, isRecommended, type DetectedOS, type DownloadBuild } from "@/lib/download";

type Build = DownloadBuild;
type OS = DetectedOS;

function sizeLabel(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The download choices are in the initial HTML; client-side detection only marks
 * the matching build as recommended. That keeps the primary action usable without
 * JavaScript and avoids the hydration reflow of the old single-button detector.
 */
export function DownloadDetector({ builds }: { builds: Build[] }) {
  const t = useTranslations("download");
  const [os, setOs] = useState<OS>("unknown");

  useEffect(() => {
    setOs(detectOS(navigator.userAgent));
  }, []);

  const wanted = [
    { key: "win-x64-exe", platform: "win", arch: "x64", kind: "exe", label: t("windows"), detail: `${t("x64")} · .exe` },
    { key: "mac-arm64-dmg", platform: "mac", arch: "arm64", kind: "dmg", label: t("macos"), detail: `${t("appleSilicon")} · .dmg` },
    { key: "mac-x64-dmg", platform: "mac", arch: "x64", kind: "dmg", label: t("macos"), detail: `${t("intel")} · .dmg` },
    { key: "linux-x64-appimage", platform: "linux", arch: "x64", kind: "AppImage", label: t("linux"), detail: `${t("x64")} · .AppImage` },
    { key: "linux-arm64-appimage", platform: "linux", arch: "arm64", kind: "AppImage", label: t("linux"), detail: `${t("arm64")} · .AppImage` },
  ]
    .map((option) => ({ ...option, build: findBuild(builds, option.platform, option.arch, option.kind) }))
    .filter((option): option is typeof option & { build: Build } => Boolean(option.build));

  // The build matrix below owns the single empty state.
  if (builds.length === 0) return null;

  return (
    <div className="grid gap-4">
      {os === "mobile" ? (
        <p className="rounded-sm border border-border bg-surface-2 px-4 py-3 text-[13px] leading-6 text-fg-muted">{t("mobileNote")}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {wanted.map((option) => {
          const recommended = isRecommended(os, option.platform, option.arch);
          return (
            <a
              key={option.key}
              href={option.build.url}
              className={`flex min-h-16 items-center justify-between gap-4 rounded-lg border px-5 py-4 transition-colors ${
                recommended ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              <span>
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-fg">
                  {option.label}
                  <span className="text-[13px] font-normal text-fg-subtle">{option.detail}</span>
                  {recommended ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-hover">{t("recommended")}</span>
                  ) : null}
                </span>
                <span className="mt-1 block text-[12px] text-fg-subtle tabular" dir="ltr">
                  v{option.build.version} · {sizeLabel(option.build.sizeBytes)}
                </span>
              </span>
              <span aria-hidden="true" className="text-fg-muted">↓</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

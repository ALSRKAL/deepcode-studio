import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 86400;

/**
 * Per-page Open Graph card. The Arabic face is bundled so Satori shapes Arabic
 * correctly; the route is cached for a day and uses only the page title, so a
 * new marketing page gets a correct preview without a new PNG.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ar = searchParams.get("locale") === "ar";
  const title = (searchParams.get("title") || "DeepCode Studio").slice(0, 120);
  const font = await readFile(join(process.cwd(), "public/fonts/IBMPlexSansArabic-SemiBold.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f7f8fa",
          color: "#111827",
          padding: "64px",
          fontFamily: "PlexArabic",
          direction: ar ? "rtl" : "ltr",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexDirection: ar ? "row-reverse" : "row" }}>
          <div style={{ width: "14px", height: "44px", backgroundColor: "#0e7490", borderRadius: "4px" }} />
          <div style={{ fontSize: "28px", fontWeight: 600 }}>DeepCode Studio</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: ar ? "flex-end" : "flex-start" }}>
          <div
            style={{
              fontSize: ar ? "52px" : "62px",
              fontWeight: 600,
              lineHeight: 1.18,
              letterSpacing: ar ? 0 : "-0.02em",
              maxWidth: "960px",
              textAlign: ar ? "right" : "left",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: "26px", color: "#4b5563" }}>
            {ar ? "وكيل برمجة بالعربية والإنجليزية" : "An AI coding agent in Arabic and English"}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "22px",
            color: "#636b78",
            flexDirection: ar ? "row-reverse" : "row",
          }}
        >
          <span>Windows · macOS · Linux</span>
          <span>OpenCode Go</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "PlexArabic", data: font, weight: 600, style: "normal" }],
      headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
  );
}

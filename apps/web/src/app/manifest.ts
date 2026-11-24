import type { MetadataRoute } from "next";

/** Installable web app metadata; the desktop app remains the primary product. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DeepCode Studio",
    short_name: "DeepCode",
    description:
      "An AI coding agent that reads your repository, writes reviewable diffs and runs your tests, in Arabic and English.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
    lang: "ar",
    dir: "rtl",
    categories: ["developer", "productivity"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

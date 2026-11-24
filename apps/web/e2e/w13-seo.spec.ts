import { expect, test } from "@playwright/test";

const PUBLIC_PAGES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/download", name: "download" },
  { path: "/docs", name: "docs" },
  { path: "/changelog", name: "changelog" },
  { path: "/contact", name: "contact" },
  { path: "/security", name: "security" },
  { path: "/legal/terms", name: "terms" },
] as const;

const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/reset-password"];

test.beforeEach(({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "ar-desktop", "metadata is independent of viewport; run once");
});

for (const locale of ["ar", "en"] as const) {
  for (const target of PUBLIC_PAGES) {
    test(`metadata: ${locale}${target.path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/${locale}${target.path}`, { waitUntil: "networkidle" });
      const expectedPath = `/${locale}${target.path === "/" ? "" : target.path}`;
      const title = await page.title();
      expect(title).toContain("DeepCode Studio");
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.length ?? 0).toBeGreaterThan(40);
      expect(description?.length ?? 0).toBeLessThanOrEqual(170);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical).toContain(expectedPath);
      const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
      expect(ogUrl).toContain(expectedPath);
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
      expect(ogImage).toMatch(/\/api\/og|\/og\/card-/);
      for (const lang of ["ar", "en", "x-default"]) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveCount(1);
      }
      expect(errors, `console/page errors on ${locale}${target.path}`).toEqual([]);
    });
  }
}

for (const locale of ["ar", "en"] as const) {
  for (const path of AUTH_PAGES) {
    test(`auth noindex: ${locale}${path}`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots).toContain("noindex");
      expect(robots).toContain("nofollow");
    });
  }
}

test("landing JSON-LD is valid and contains the site, app and FAQ", async ({ page }) => {
  await page.goto("/en");
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(blocks.length).toBeGreaterThanOrEqual(2);
  const parsed = blocks.flatMap((text) => {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value : [value];
  }) as Array<{ "@type": string }>;
  const types = parsed.map((item) => item["@type"]);
  expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]));
});

test("sitemap and robots expose the public perimeter and hide auth", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const text = await sitemap.text();
  for (const path of ["/pricing", "/download", "/docs", "/changelog", "/contact", "/security", "/legal/privacy"]) {
    expect(text).toContain(`/ar${path}`);
    expect(text).toContain(`/en${path}`);
  }
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain("Disallow: /*/dashboard");
  expect(robotsText).toContain("Disallow: /*/sign-in");
  expect(robotsText).toContain("Sitemap:");
});

test("unknown legal slugs and unknown routes return a real 404", async ({ request }) => {
  expect((await request.get("/en/legal/not-a-real-policy")).status()).toBe(404);
  expect((await request.get("/en/not-a-real-page")).status()).toBe(404);
});

test("every internal link on the landing and footer resolves", async ({ page, request }) => {
  await page.goto("/en");
  const hrefs = await page.locator('a[href^="/"]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")).filter((href): href is string => Boolean(href)))],
  );
  for (const href of hrefs) {
    if (href.startsWith("/api/")) continue;
    const response = await request.get(href.split("#")[0]!);
    expect(response.status(), `link ${href}`).toBeLessThan(400);
  }
});

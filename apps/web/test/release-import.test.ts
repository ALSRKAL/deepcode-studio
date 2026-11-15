/** Desktop release import: GitHub release (dotted asset names) + SHA256SUMS (spaced names) → rows. */
import { describe, expect, it } from "vitest";
import { buildsFromRelease, fetchGithubRelease, parseSha256Sums, ReleaseImportError } from "../src/lib/releaseImport";

const h = (c: string) => c.repeat(64);
const DL = "https://github.com/ALSRKAL/deepcode-desktop/releases/download/v0.1.0";
// electron-builder writes "DeepCode Studio-…"; GitHub stores it as "DeepCode.Studio-…".
const files = [
  ["DeepCode Studio-0.1.0-win-x64.exe", "a", 253],
  ["DeepCode Studio-0.1.0-mac-arm64.dmg", "b", 300],
  ["DeepCode Studio-0.1.0-mac-arm64.zip", "c", 290],
  ["DeepCode Studio-0.1.0-mac-x64.dmg", "d", 305],
  ["DeepCode Studio-0.1.0-linux-x86_64.AppImage", "e", 200],
  ["DeepCode Studio-0.1.0-linux-amd64.deb", "f", 150],
  ["DeepCode Studio-0.1.0-linux-aarch64.rpm", "1", 140],
  ["DeepCode Studio-0.1.0-linux-x64.pkg.tar.zst", "2", 130],
] as const;
const sums = files.map(([n, c]) => `${h(c)}  ${n}`).join("\n") + "\n";
const release = {
  tag_name: "v0.1.0",
  assets: [
    ...files.map(([n, , mb]) => ({ name: n.replace(/ /g, "."), size: mb * 1048576, browser_download_url: `${DL}/${n.replace(/ /g, ".")}` })),
    { name: "SHA256SUMS.txt", size: 900, browser_download_url: `${DL}/SHA256SUMS.txt` },
  ],
};

describe("desktop release import", () => {
  it("maps every installer with its checksum, normalising arch aliases", () => {
    const builds = buildsFromRelease(release, parseSha256Sums(sums));
    const key = (b: { platform: string; arch: string; fileKind: string }) => `${b.platform}-${b.arch}.${b.fileKind}`;
    expect(builds.map(key)).toEqual([
      "win-x64.exe",
      "mac-arm64.dmg",
      "mac-arm64.zip",
      "mac-x64.dmg",
      "linux-x64.AppImage",
      "linux-x64.deb",
      "linux-arm64.rpm",
    ]); // pkg.tar.zst is not offered on the download page
    const win = builds[0]!;
    expect(win).toMatchObject({ version: "0.1.0", sha256: h("a"), sizeBytes: 253 * 1048576 });
    expect(win.url).toBe(`${DL}/DeepCode.Studio-0.1.0-win-x64.exe`);
  });

  it("skips installers that have no checksum (never publishes an unverifiable file)", () => {
    const builds = buildsFromRelease(release, parseSha256Sums(`${h("a")}  DeepCode Studio-0.1.0-win-x64.exe`));
    expect(builds).toHaveLength(1);
  });

  it("fetches the tag from GitHub and reports missing pieces with codes", async () => {
    const calls: string[] = [];
    const ok = (async (url: string) => {
      calls.push(String(url));
      return String(url).endsWith("SHA256SUMS.txt") ? new Response(sums) : Response.json(release);
    }) as unknown as typeof fetch;
    const res = await fetchGithubRelease("ALSRKAL/deepcode-desktop", "v0.1.0", ok);
    expect(calls[0]).toBe("https://api.github.com/repos/ALSRKAL/deepcode-desktop/releases/tags/v0.1.0");
    expect(res.tag).toBe("v0.1.0");
    expect(res.builds).toHaveLength(7);

    const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchGithubRelease("x/y", null, missing)).rejects.toEqual(new ReleaseImportError("not_found"));
    const noSums = (async () => Response.json({ ...release, assets: release.assets.slice(0, -1) })) as unknown as typeof fetch;
    await expect(fetchGithubRelease("x/y", null, noSums)).rejects.toMatchObject({ code: "no_checksums" });
  });
});

/**
 * Import a desktop release published by the desktop CI (GitHub Release with the
 * installers + SHA256SUMS.txt) into the `releases` table, so the download page
 * and the auto-update manifest fill themselves instead of hand-typing ~10 rows.
 *
 * Asset names come from electron-builder: `${productName}-${version}-${platform}-${arch}.${ext}`.
 * GitHub replaces spaces in uploaded asset names with dots, while SHA256SUMS.txt
 * keeps the original names, so both sides are normalised before matching.
 */
export const DEFAULT_DESKTOP_RELEASE_REPO = "ALSRKAL/deepcode-desktop";

export type ImportedBuild = {
  version: string;
  platform: "win" | "mac" | "linux";
  arch: "x64" | "arm64";
  fileKind: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

type GithubAsset = { name: string; size: number; browser_download_url: string };
type GithubRelease = { tag_name: string; draft?: boolean; assets: GithubAsset[] };

const ASSET = /^(.+)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(win|mac|linux)-(x64|arm64|amd64|x86_64|aarch64)\.(exe|dmg|zip|AppImage|deb|rpm)$/;
const ARCH: Record<string, "x64" | "arm64"> = { x64: "x64", amd64: "x64", x86_64: "x64", arm64: "arm64", aarch64: "arm64" };

const normalise = (name: string) => name.trim().replace(/\s+/g, ".");

/** `sha256  name` lines (sha256sum format, optional `*` binary marker). */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) out.set(normalise(m[2]!), m[1]!.toLowerCase());
  }
  return out;
}

/** Pure mapping, exported for tests: assets + checksums → rows (skips anything unrecognised or unchecksummed). */
export function buildsFromRelease(release: GithubRelease, sums: Map<string, string>): ImportedBuild[] {
  const builds: ImportedBuild[] = [];
  for (const asset of release.assets) {
    const m = ASSET.exec(asset.name);
    if (!m) continue;
    const sha256 = sums.get(normalise(asset.name));
    if (!sha256) continue;
    builds.push({
      version: m[2]!,
      platform: m[3] as ImportedBuild["platform"],
      arch: ARCH[m[4]!]!,
      fileKind: m[5]!,
      url: asset.browser_download_url,
      sha256,
      sizeBytes: asset.size,
    });
  }
  return builds;
}

export class ReleaseImportError extends Error {
  constructor(public readonly code: "not_found" | "no_checksums" | "no_installers" | "github_error") {
    super(code);
  }
}

/** Fetch a release (tag, or the latest when empty) from a public GitHub repo. */
export async function fetchGithubRelease(
  repo: string,
  tag: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ tag: string; builds: ImportedBuild[] }> {
  const api = `https://api.github.com/repos/${repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : "latest"}`;
  const res = await fetchImpl(api, {
    headers: { accept: "application/vnd.github+json", "user-agent": "deepcode-studio-admin" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new ReleaseImportError("not_found");
  if (!res.ok) throw new ReleaseImportError("github_error");
  const release = (await res.json()) as GithubRelease;
  const sumsAsset = release.assets.find((a) => a.name === "SHA256SUMS.txt");
  if (!sumsAsset) throw new ReleaseImportError("no_checksums");
  const sumsRes = await fetchImpl(sumsAsset.browser_download_url, { signal: AbortSignal.timeout(20_000) });
  if (!sumsRes.ok) throw new ReleaseImportError("github_error");
  const builds = buildsFromRelease(release, parseSha256Sums(await sumsRes.text()));
  if (builds.length === 0) throw new ReleaseImportError("no_installers");
  return { tag: release.tag_name, builds };
}

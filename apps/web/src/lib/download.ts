export type DownloadBuild = {
  platform: string;
  arch: string;
  fileKind: string;
  version: string;
  url: string;
  sizeBytes: number;
};

export type DetectedOS = "win" | "mac" | "linux" | "mobile" | "unknown";

/** Pure UA detection so the branch can be tested without a browser. */
export function detectOS(userAgent: string): DetectedOS {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(ua)) return "mobile";
  if (ua.includes("windows")) return "win";
  if (ua.includes("mac")) return "mac";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function findBuild(builds: DownloadBuild[], platform: string, arch: string, fileKind: string): DownloadBuild | undefined {
  return builds.find((build) => build.platform === platform && build.arch === arch && build.fileKind === fileKind);
}

/** One recommendation per OS: Apple Silicon for macOS, x64 for Windows/Linux. */
export function isRecommended(os: DetectedOS, platform: string, arch: string): boolean {
  if (os === "win") return platform === "win" && arch === "x64";
  if (os === "mac") return platform === "mac" && arch === "arm64";
  if (os === "linux") return platform === "linux" && arch === "x64";
  return false;
}

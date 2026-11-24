import { describe, expect, it } from "vitest";
import { detectOS, findBuild, isRecommended, type DownloadBuild } from "../src/lib/download";

const builds: DownloadBuild[] = [
  { platform: "win", arch: "x64", fileKind: "exe", version: "1.0.0", url: "https://example.test/app.exe", sizeBytes: 1 },
  { platform: "mac", arch: "arm64", fileKind: "dmg", version: "1.0.0", url: "https://example.test/app-arm64.dmg", sizeBytes: 1 },
  { platform: "mac", arch: "x64", fileKind: "dmg", version: "1.0.0", url: "https://example.test/app-x64.dmg", sizeBytes: 1 },
  { platform: "linux", arch: "x64", fileKind: "AppImage", version: "1.0.0", url: "https://example.test/app.AppImage", sizeBytes: 1 },
];

describe("download detection", () => {
  it("maps the three desktop user agents and leaves mobile alone", () => {
    expect(detectOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win");
    expect(detectOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOS("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(detectOS("Mozilla/5.0")).toBe("unknown");
  });

  it("selects the exact architecture instead of labelling arm64 as x64", () => {
    expect(findBuild(builds, "mac", "arm64", "dmg")?.url).toContain("arm64");
    expect(findBuild(builds, "mac", "x64", "dmg")?.url).toContain("x64");
    expect(findBuild(builds, "win", "x64", "exe")?.url).toContain(".exe");
  });

  it("recommends exactly one build per desktop platform", () => {
    expect(isRecommended("win", "win", "x64")).toBe(true);
    expect(isRecommended("mac", "mac", "arm64")).toBe(true);
    expect(isRecommended("mac", "mac", "x64")).toBe(false);
    expect(isRecommended("linux", "linux", "x64")).toBe(true);
    expect(isRecommended("linux", "linux", "arm64")).toBe(false);
    expect(isRecommended("win", "mac", "x64")).toBe(false);
    expect(isRecommended("mobile", "linux", "x64")).toBe(false);
    expect(isRecommended("unknown", "win", "x64")).toBe(false);
  });
});

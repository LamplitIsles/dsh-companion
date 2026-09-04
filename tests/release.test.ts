import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseCheck } from "../scripts/release-check.js";
import { npmDistTag, versionFromTag } from "../scripts/release-shared.js";

const fixtures: string[] = [];

async function fixture(version = "0.1.0"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-companion-release-"));
  fixtures.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@lamplitisles/dsh-companion",
    version,
    repository: { type: "git", url: "https://github.com/LamplitIsles/dsh-companion.git" },
    publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release preflight", () => {
  it("accepts matching stable and prerelease tags and chooses their npm channels", async () => {
    const root = await fixture();
    expect(releaseCheck(root, "v0.1.0", false)).toEqual([]);
    expect(versionFromTag("v0.1.0-beta.1")).toBe("0.1.0-beta.1");
    expect(npmDistTag("v0.1.0")).toBe("latest");
    expect(npmDistTag("v0.1.0-beta.1")).toBe("beta");
  });

  it("enforces strict prerelease identifiers and accepts build metadata", () => {
    expect(() => versionFromTag("v1.2.3-01")).toThrow("v<semver>");
    expect(() => versionFromTag("v1.2.3-alpha.01")).toThrow("v<semver>");
    expect(versionFromTag("v1.2.3-0")).toBe("1.2.3-0");
    expect(versionFromTag("v1.2.3-alpha01")).toBe("1.2.3-alpha01");
    expect(versionFromTag("v1.2.3+build.1")).toBe("1.2.3+build.1");
    expect(versionFromTag("v1.2.3-alpha01+build.1")).toBe("1.2.3-alpha01+build.1");
    expect(npmDistTag("v1.2.3+build.1")).toBe("latest");
  });

  it("rejects malformed tags before reading package metadata", () => {
    expect(() => versionFromTag("release-0.1.0")).toThrow("v<semver>");
    expect(() => versionFromTag("v01.0.0")).toThrow("v<semver>");
    expect(() => versionFromTag("v0.1")).toThrow("v<semver>");
  });

  it("rejects a package version that does not match the tag", async () => {
    const root = await fixture("0.1.1");
    expect(releaseCheck(root, "v0.1.0", false)).toContain(
      "@lamplitisles/dsh-companion version does not match v0.1.0.",
    );
  });

  it("rejects metadata that would publish the wrong package or channel", async () => {
    const root = await fixture();
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "@lamplitisles/not-companion",
      version: "0.1.0",
      repository: { type: "git", url: "https://example.invalid/repository.git" },
      publishConfig: { access: "restricted" },
    }));
    expect(releaseCheck(root, "v0.1.0", false)).toEqual([
      "package name must be @lamplitisles/dsh-companion.",
      "@lamplitisles/dsh-companion has the wrong repository metadata.",
      "@lamplitisles/dsh-companion must publish publicly to npm.",
    ]);
  });
});

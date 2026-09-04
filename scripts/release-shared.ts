import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PACKAGE_NAME = "@lamplitisles/dsh-companion" as const;
export const REPOSITORY_URL = "https://github.com/LamplitIsles/dsh-companion.git" as const;
export const REQUIRED_PACKED_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/client.js",
  "dist/client.d.ts",
  "cordis.patch.yml",
  "README.md",
  "LICENSE",
] as const;

const numericIdentifier = "(?:0|[1-9]\\d*)";
const prereleaseIdentifier = "[0-9A-Za-z-]+";
const buildIdentifier = "[0-9A-Za-z-]+";
const tagPattern = new RegExp(
  `^v${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}`
    + `(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?`
    + `(?:\\+${buildIdentifier}(?:\\.${buildIdentifier})*)?$`,
  "u",
);

/** Return the exact package version encoded by a release tag. */
export function versionFromTag(tag: string): string {
  const match = tagPattern.exec(tag);
  // A standalone numeric prerelease identifier may be exactly `0`, but the
  // first identifier cannot have a leading zero. Mixed identifiers such as
  // `alpha.01` remain supported by the release tag contract.
  if (!match || /^0\d+$/.test(match[1]?.split(".", 1)[0] ?? "")) {
    throw new Error(
      "Release tags must use v<semver>, for example v0.1.0 or v0.1.0-beta.1.",
    );
  }
  return tag.slice(1);
}

/** Map stable releases to latest and prereleases to the beta channel. */
export function npmDistTag(tag: string): "latest" | "beta" {
  versionFromTag(tag);
  return tag.includes("-") ? "beta" : "latest";
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

type PackedPackage = {
  name?: string;
  version?: string;
  filename?: string;
  files?: Array<{ path?: string }>;
};

/** npm 10 emits an array while newer npm versions may emit an object map. */
export type PackedManifest = PackedPackage[] | Record<string, PackedPackage>;

export function packedManifest(
  packed: PackedManifest,
): PackedPackage | undefined {
  return Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
}

export function packedFilePaths(packed: PackedManifest): Set<string> {
  const manifest = packedManifest(packed);
  const paths = manifest?.files?.flatMap((file) =>
    file.path === undefined ? [] : [file.path],
  );
  return new Set(paths);
}

/** Check immutable package metadata immediately before publication. */
export function checkReleaseManifest(root: string, tag: string): string[] {
  const errors: string[] = [];
  let version: string;
  try {
    version = versionFromTag(tag);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid release tag.");
    return errors;
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = readJson(join(root, "package.json"));
  } catch {
    return ["package.json could not be read before release."];
  }

  if (manifest.name !== PACKAGE_NAME) errors.push(`package name must be ${PACKAGE_NAME}.`);
  if (manifest.version !== version) errors.push(`${PACKAGE_NAME} version does not match ${tag}.`);
  if (manifest.private === true) errors.push(`${PACKAGE_NAME} must be publishable.`);
  const repository = manifest.repository as { type?: unknown; url?: unknown } | undefined;
  if (repository?.type !== "git" || repository.url !== REPOSITORY_URL) {
    errors.push(`${PACKAGE_NAME} has the wrong repository metadata.`);
  }
  const publishConfig = manifest.publishConfig as { registry?: unknown; access?: unknown } | undefined;
  if (publishConfig?.registry !== "https://registry.npmjs.org" || publishConfig.access !== "public") {
    errors.push(`${PACKAGE_NAME} must publish publicly to npm.`);
  }
  if (JSON.stringify(manifest).includes("workspace:")) errors.push(`${PACKAGE_NAME} leaks a workspace protocol.`);
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  if (["install", "preinstall", "postinstall"].some((name) => name in scripts)) {
    errors.push(`${PACKAGE_NAME} must not have install hooks.`);
  }
  return errors;
}

/** Ensure the already-built artifact contains only safe, publishable files. */
export function checkPackedManifest(root: string): string[] {
  const errors: string[] = [];
  if (REQUIRED_PACKED_FILES.some((file) => !existsSync(join(root, file)))) {
    errors.push(`${PACKAGE_NAME} is not built before release preflight.`);
    return errors;
  }

  let packed: PackedManifest;
  try {
    packed = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--dry-run"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as PackedManifest;
  } catch {
    errors.push(`${PACKAGE_NAME} could not produce a packed manifest.`);
    return errors;
  }
  const entry = packedManifest(packed);
  if (entry?.name !== PACKAGE_NAME) errors.push(`${PACKAGE_NAME} packed manifest has the wrong name.`);
  const manifest = readJson(join(root, "package.json"));
  if (entry?.version !== manifest.version) errors.push(`${PACKAGE_NAME} packed manifest has the wrong version.`);
  const files = packedFilePaths(packed);
  for (const required of REQUIRED_PACKED_FILES) {
    if (!files.has(required)) errors.push(`${PACKAGE_NAME} packed manifest omits ${required}.`);
  }
  if ([...files].some((file) => file.includes("node_modules") || file.endsWith(".tgz"))) {
    errors.push(`${PACKAGE_NAME} packed manifest contains an unsafe build artifact.`);
  }
  return errors;
}

/** Create the exact tarball that the publish job uploads and later publishes. */
export function packRelease(root: string, destination: string): string {
  mkdirSync(resolve(destination), { recursive: true });
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", resolve(destination)], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = packedManifest(JSON.parse(output) as PackedManifest);
  if (!entry?.filename || entry.name !== PACKAGE_NAME) {
    throw new Error(`${PACKAGE_NAME} did not produce the expected release tarball.`);
  }
  return join(resolve(destination), entry.filename);
}

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { versionFromTag } from "./release-shared.js";

export async function synchronizeReleaseVersion(root: string, tag: string): Promise<void> {
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.version = versionFromTag(tag);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("GITHUB_REF_NAME must contain the release tag.");
  await synchronizeReleaseVersion(process.cwd(), tag);
}

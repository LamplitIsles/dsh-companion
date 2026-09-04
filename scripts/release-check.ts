import { npmDistTag, checkPackedManifests, checkReleaseManifests } from "./release-shared.js";

export { npmDistTag, versionFromTag } from "./release-shared.js";

export function releaseCheck(root: string, tag: string, checkPacked = true): string[] {
  const errors = checkReleaseManifests(root, tag);
  if (checkPacked) errors.push(...checkPackedManifests(root));
  return errors;
}

const tag = process.env.GITHUB_REF_NAME;
if (import.meta.main) {
  if (!tag) throw new Error("GITHUB_REF_NAME must contain the release tag.");
  const errors = releaseCheck(process.cwd(), tag);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(`Release preflight passed (${npmDistTag(tag)}).`);
}

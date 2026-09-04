import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { packRelease } from "./release-shared.js";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = process.env.RELEASE_ARTIFACT_DIR ?? ".release-artifacts";
  console.log(packRelease(process.cwd(), destination));
}

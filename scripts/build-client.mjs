import { readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const packageId = "@lamplitisles/dsh-companion";
const esmPath = "dist/client.esm.js";
const cjsPath = "dist/.client.cjs.js";
const outputPath = "dist/client.js";

// DSH's browser module system intentionally loads every plugin artifact as a
// classic script. Vite is still the right compiler for this mixed Svelte/React
// entry, so convert its already-bundled ESM output to CJS and place it inside
// the same lazy factory hand-off emitted by DSH's own client packages.
await build({
  entryPoints: [esmPath],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["react", "react-dom"],
  outfile: cjsPath,
  sourcemap: false,
  legalComments: "none",
});

const cjs = (await readFile(cjsPath, "utf8")).replace(/^"use strict";\s*/u, "");
const indented = cjs.split("\n").map((line) => `    ${line}`).join("\n");
const classic = [
  "window.__ModuleLoader__.load({",
  `  id: ${JSON.stringify(packageId)},`,
  "  factory: (require) => {",
  "    var module = { exports: {} };",
  "    var exports = module.exports;",
  indented,
  "    return module.exports;",
  "  },",
  "});",
  "",
].join("\n");

await writeFile(outputPath, classic);
await rm(cjsPath, { force: true });
await rm(esmPath, { force: true });
await rm(`${esmPath}.map`, { force: true });
await rm(`${outputPath}.map`, { force: true });

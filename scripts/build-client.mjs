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
let esm = await readFile(esmPath, "utf8");
const daisyMarker = "/*! tailwindcss";
const daisyStart = esm.indexOf(daisyMarker);
if (daisyStart < 0) throw new Error("Expected the processed daisyUI stylesheet in the client bundle.");
const literalStart = esm.lastIndexOf("`", daisyStart);
const literalEnd = esm.indexOf("`", daisyStart);
if (literalStart < 0 || literalEnd < daisyStart) throw new Error("Could not scope the processed daisyUI stylesheet.");
// Tailwind/daisyUI compile before this step. Its primitives are deliberately
// injected only under the Companion root, including generated utility
// selectors, so the host's document receives neither Preflight nor CSS leaks.
// Custom daisyUI themes normally emit a document-root theme-controller branch;
// the Companion has no controller and must not alter the stock DSH root. Keep
// the useful data-theme branch while rewriting root selectors to the scope root.
let generatedStyles = esm.slice(literalStart + 1, literalEnd)
  .replace(/:root:has\(input\.theme-controller\[value=[^)]+\]:checked\),?/gu, "")
  .replace(/:root\b/gu, ":scope")
  .replace(/\[data-theme=["']?(sticker-messenger|night-voyage)["']?\]/gu, ":scope[data-theme=$1]");
esm = `${esm.slice(0, literalStart + 1)}@scope (#dsh-companion){${generatedStyles}}${esm.slice(literalEnd)}`;
await writeFile(esmPath, esm);

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
await rm("dist/client.css", { force: true });

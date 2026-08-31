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
// Tailwind/daisyUI compile before this step. Its primitives are deliberately
// injected only under the Companion root, including generated utility
// selectors, so the host's document receives neither Preflight nor CSS leaks.
// Custom daisyUI themes normally emit a document-root theme-controller branch;
// the Companion has no controller and must not alter the stock DSH root. Keep
// the useful data-theme branch while rewriting root selectors to the scope root.
let scopedStyles = 0;
let searchFrom = 0;
while (true) {
  const daisyStart = esm.indexOf(daisyMarker, searchFrom);
  if (daisyStart < 0) break;
  const quote = esm[daisyStart - 1];
  if (quote !== "`" && quote !== '"' && quote !== "'") throw new Error("Could not scope the processed daisyUI stylesheet.");
  let literalEnd = daisyStart;
  while (literalEnd < esm.length) {
    if (esm[literalEnd] === quote) {
      let slashes = 0;
      for (let index = literalEnd - 1; index >= 0 && esm[index] === "\\"; index -= 1) slashes += 1;
      if (slashes % 2 === 0) break;
    }
    literalEnd += 1;
  }
  if (literalEnd >= esm.length) throw new Error("Could not scope the processed daisyUI stylesheet.");
  const generatedStyles = esm.slice(daisyStart, literalEnd)
    .replace(/:root:has\(input\.theme-controller\[value=[^)]+\]:checked\),?/gu, "")
    .replace(/:root\b/gu, ":scope")
    .replace(/\[data-theme=["']?(sticker-messenger|night-voyage)["']?\]/gu, ":scope[data-theme=$1]");
  const scoped = `@scope (#dsh-companion){${generatedStyles}}`;
  esm = `${esm.slice(0, daisyStart)}${scoped}${esm.slice(literalEnd)}`;
  searchFrom = daisyStart + scoped.length;
  scopedStyles += 1;
}
if (scopedStyles === 0) throw new Error("Expected the processed daisyUI stylesheet in the client bundle.");
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

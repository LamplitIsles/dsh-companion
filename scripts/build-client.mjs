import { readFile, rm, writeFile } from "node:fs/promises";
import { wrapClientBundle } from "./client-wrapper.mjs";

const packageId = "@lamplitisles/dsh-companion";
const cjsPath = "dist/client.cjs";
const outputPath = "dist/client.js";

// DSH's browser module system intentionally loads every plugin artifact as a
// classic script. Place Vite's CommonJS output inside the same lazy factory
// hand-off emitted by DSH's own client packages.
let cjs = await readFile(cjsPath, "utf8");
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
  const daisyStart = cjs.indexOf(daisyMarker, searchFrom);
  if (daisyStart < 0) break;
  const quote = cjs[daisyStart - 1];
  if (quote !== "`" && quote !== '"' && quote !== "'") throw new Error("Could not scope the processed daisyUI stylesheet.");
  let literalEnd = daisyStart;
  while (literalEnd < cjs.length) {
    if (cjs[literalEnd] === quote) {
      let slashes = 0;
      for (let index = literalEnd - 1; index >= 0 && cjs[index] === "\\"; index -= 1) slashes += 1;
      if (slashes % 2 === 0) break;
    }
    literalEnd += 1;
  }
  if (literalEnd >= cjs.length) throw new Error("Could not scope the processed daisyUI stylesheet.");
  const generatedStyles = cjs.slice(daisyStart, literalEnd)
    .replace(/:root:has\(input\.theme-controller\[value=[^)]+\]:checked\),?/gu, "")
    .replace(/:root\b/gu, ":scope")
    .replace(/\[data-theme=["']?(sticker-messenger|night-voyage)["']?\]/gu, ":scope[data-theme=$1]");
  const scoped = `@scope (#dsh-companion){${generatedStyles}}`;
  cjs = `${cjs.slice(0, daisyStart)}${scoped}${cjs.slice(literalEnd)}`;
  searchFrom = daisyStart + scoped.length;
  scopedStyles += 1;
}
if (scopedStyles === 0) throw new Error("Expected the processed daisyUI stylesheet in the client bundle.");
cjs = cjs.replace(/^"use strict";\s*/u, "");
const classic = wrapClientBundle(packageId, cjs);

await writeFile(outputPath, classic);
await rm(cjsPath, { force: true });
await rm("dist/client.css", { force: true });

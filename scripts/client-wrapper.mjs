export function wrapClientBundle(packageId, cjs) {
  return [
    "window.__ModuleLoader__.load({",
    `  id: ${JSON.stringify(packageId)},`,
    "  factory: (require) => {",
    "    var module = { exports: {} };",
    "    var exports = module.exports;",
    cjs,
    "    return module.exports;",
    "  },",
    "});",
    "",
  ].join("\n");
}

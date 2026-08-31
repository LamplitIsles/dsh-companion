import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", domain: "src/domain.ts", media: "src/media.ts", projection: "src/projection.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-host-apiproxy/api", "@deepseek-ai/schemastery", /^node:/],
});

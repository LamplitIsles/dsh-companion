import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", domain: "src/domain.ts", media: "src/media.ts", projection: "src/projection.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: [
    "@deepseek-ai/cordis", "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-fs", "@deepseek-ai/dsh-session/types", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-token-meter/client", "@deepseek-ai/schemastery",
    /^@deepseek-ai\//, "react", "react-dom", "svelte", /^node:/,
  ],
});

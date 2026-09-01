import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [tailwindcss(), react(), svelte({ preprocess: vitePreprocess() })],
  build: {
    // Host entries and browser entries share the publishable dist directory.
    // Keep the files emitted by tsup when Vite writes client.js/client.css.
    emptyOutDir: false,
    // Vite handles Svelte/React compilation. The following build step wraps
    // this ESM artifact in DSH's lazy CommonJS module-loader registration;
    // the web shell executes plugin bundles as classic scripts.
    lib: { entry: "src/client.ts", formats: ["es"], fileName: () => "client.esm.js" },
    rollupOptions: {
      external: [
        "@deepseek-ai/cordis", "@deepseek-ai/dsh-api-remotes/client", "@deepseek-ai/dsh-api-session-controller/client", "@deepseek-ai/dsh-api-workspace-controller/client", "@deepseek-ai/dsh-client-connection/client",
        "@deepseek-ai/dsh-client-ui-chat/client", "@deepseek-ai/dsh-client-ui-conversation/client", "@deepseek-ai/dsh-client-ui-renderer/client", "@deepseek-ai/dsh-client-ui-settings/client", "@deepseek-ai/dsh-client-ui-settings-plugins/client", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-theme/client",
        "@deepseek-ai/dsh-attachment", "@deepseek-ai/dsh-fs", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-session/types", "@deepseek-ai/dsh-token-meter/client",
        "react", "react-dom",
      ],
      output: { assetFileNames: "client.[ext]" },
    },
    sourcemap: true,
  },
});

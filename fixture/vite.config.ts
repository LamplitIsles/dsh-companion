import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({ root: "fixture", plugins: [svelte({ preprocess: vitePreprocess() })], server: { port: 4178, strictPort: true } });

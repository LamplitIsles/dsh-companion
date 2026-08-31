import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// A tiny generated tone keeps the browser fixture fully local while exercising
// the same-origin route shape that Kepos TTS returns to the Companion.
const fixtureAudio = Buffer.from("SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAwAAAAAAAAAAAAAAD/4xjEAAyABt5ZQQACkkkIo22AGD4Pg/ggCDpcHz+CAIfYD4Pn+CBz/lwQ1AmfxOCDqgTD+TBDUAz+kMcv7uk4bDYd/xqIo8P/4xjECQ6I9qABh9AAb/B8Og9Ab/xJ3i4QISh05d3yWWGCOD0Ki/F8hFQXddlMZjNampsTv8qIgqCoiPf+Cqr/////9ZiTrBr/4xjECQ4w5kAB1kgAkBgLAcBgRE4Bg3DkBh3BEBhTHYBllKwB/bhaBnMKyBieA6IEAwFgWCgBw+UAwHiW/////+gmkTBcJYD/4xjECw2o6kABVkgAJASAgSYGBELoGIcM4GKwgAGSYYQH6QvwGZkYoDwXAYGgIAYGAHCbSkyaEmXZiI2HRT/UcG5ISfd2cbD/4xjEDxBpHqABh9AARBGCzpbjjZhDCFkFPIWvPSm6YYCyjX44/3PXOf/PnJFOxm5XzvaV/SFRQ0Em/+syFRRCaq8zPqZn1Wv/4xjECA0I/bQBxhgBz5nKqvJxJLTSMsSyq8zMsaAQmAYBEnIgQEKMKAiYBEjoroILkNiv//4N6blVTEFNRTMuMTAwVVVVVVU=", "base64");
const fixtureAudioPlugin: Plugin = {
  name: "dsh-companion-fixture-audio",
  configureServer(server) {
    server.middlewares.use("/kepos-tts/audio/fixture.mp3", (_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "audio/mpeg");
      response.setHeader("content-length", String(fixtureAudio.byteLength));
      response.end(fixtureAudio);
    });
  },
};

export default defineConfig({ root: "fixture", plugins: [fixtureAudioPlugin, tailwindcss(), svelte({ preprocess: vitePreprocess() })], server: { port: 4178, strictPort: true } });

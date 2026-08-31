import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";

const audio = Buffer.from("SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAwAAAAAAAAAAAAAAD/4xjEAAyABt5ZQQACkkkIo22AGD4Pg/ggCDpcHz+CAIfYD4Pn+CBz/lwQ1AmfxOCDqgTD+TBDUAz+kMcv7uk4bDYd/xqIo8P/4xjECQ6I9qABh9AAb/B8Og9Ab/xJ3i4QISh05d3yWWGCOD0Ki/F8hFQXddlMZjNampsTv8qIgqCoiPf+Cqr/////9ZiTrBr/4xjECQ4w5kAB1kgAkBgLAcBgRE4Bg3DkBh3BEBhTHYBllKwB/bhaBnMKyBieA6IEAwFgWCgBw+UAwHiW/////+gmkTBcJYD/4xjECw2o6kABVkgAJASAgSYGBELoGIcM4GKwgAGSYYQH6QvwGZkYoDwXAYGgIAYGAHCbSkyaEmXZiI2HRT/UcG5ISfd2cbD/4xjEDxBpHqABh9AARBGCzpbjjZhDCFkFPIWvPSm6YYCyjX44/3PXOf/PnJFOxm5XzvaV/SFRQ0Em/+syFRRCaq8zPqZn1Wv/4xjECA0I/bQBxhgBz5nKqvJxJLTSMsSyq8zMsaAQmAYBEnIgQEKMKAiYBEjoroILkNiv//4N6blVTEFNRTMuMTAwVVVVVVU=", "base64");

export const name = "dsh-companion-assembled-browser-fixture";
export const inject = ["workspaceRegistry", "sessions", "settings", "connection", "webServer"];

async function configureCompanion(settings, workspaceId) {
  let failure;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await settings.update("dsh-companion", {
        workspaceId,
        companionName: "Smoke Companion",
        userName: "Smoke User",
        preferredAddress: "Smoke User",
        defaultAffinity: 50,
      });
      return;
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw failure;
}

export async function* apply(ctx) {
  const workspacePath = process.env.DSH_COMPANION_ASSEMBLED_SMOKE_WORKSPACE;
  if (!workspacePath) throw new Error("assembled browser smoke workspace is required");

  const workspace = await ctx.workspaceRegistry.create(workspacePath, "Companion assembled smoke");
  await configureCompanion(ctx.settings, workspace.id);

  const earlierSession = ctx.sessions.create("companion-assembled-browser-earlier", { meta: { cwd: workspace.path } });
  earlierSession.append("user/message", createUserMessage({
    content: [{ type: "text", text: "Earlier packed conversation" }],
    source: { kind: "user" },
  }), { surfaceOp: "append" });
  await ctx.sessions.flush(earlierSession);
  await workspace.attachSession(earlierSession.id);

  const session = ctx.sessions.create("companion-assembled-browser-smoke", { meta: { cwd: workspace.path } });
  session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "Packed runtime outgoing message" }],
    source: { kind: "user" },
  }), { surfaceOp: "append" });
  session.append("assistant/message", {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: "text", text: "Packed runtime **incoming** message.\n\n- Markdown item\n\n[[tts:text]]Packed runtime voice message.[[/tts:text]]" }],
      source: { provider: "assembled-smoke", model: "assembled-smoke" },
    }),
  }, { surfaceOp: "append" });
  await ctx.sessions.flush(session);
  await workspace.attachSession(session.id);

  const disposeRpc = ctx.connection.rpc.handle("/kepos-tts", async (endpoint, payload) => {
    if (endpoint !== "synthesize" || typeof payload !== "object" || payload === null) {
      return { ok: false, error: { code: "bad-request", message: "invalid assembled TTS request", details: {} } };
    }
    return { ok: true, value: { mediaType: "audio/mpeg", url: "/companion-assembled-smoke/voice.mp3", bytes: audio.byteLength } };
  }, { authority: "trusted-host" });
  const disposeRoute = ctx.webServer.register({
    kind: "exact",
    path: "/companion-assembled-smoke/voice.mp3",
    handler: (_request, response) => {
      response.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "cache-control": "no-store" });
      response.end(audio);
    },
  });

  yield async () => {
    disposeRoute();
    await disposeRpc();
  };
}

import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";

const audio = Buffer.from("SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAwAAAAAAAAAAAAAAD/4xjEAAyABt5ZQQACkkkIo22AGD4Pg/ggCDpcHz+CAIfYD4Pn+CBz/lwQ1AmfxOCDqgTD+TBDUAz+kMcv7uk4bDYd/xqIo8P/4xjECQ6I9qABh9AAb/B8Og9Ab/xJ3i4QISh05d3yWWGCOD0Ki/F8hFQXddlMZjNampsTv8qIgqCoiPf+Cqr/////9ZiTrBr/4xjECQ4w5kAB1kgAkBgLAcBgRE4Bg3DkBh3BEBhTHYBllKwB/bhaBnMKyBieA6IEAwFgWCgBw+UAwHiW/////+gmkTBcJYD/4xjECw2o6kABVkgAJASAgSYGBELoGIcM4GKwgAGSYYQH6QvwGZkYoDwXAYGgIAYGAHCbSkyaEmXZiI2HRT/UcG5ISfd2cbD/4xjEDxBpHqABh9AARBGCzpbjjZhDCFkFPIWvPSm6YYCyjX44/3PXOf/PnJFOxm5XzvaV/SFRQ0Em/+syFRRCaq8zPqZn1Wv/4xjECA0I/bQBxhgBz5nKqvJxJLTSMsSyq8zMsaAQmAYBEnIgQEKMKAiYBEjoroILkNiv//4N6blVTEFNRTMuMTAwVVVVVVU=", "base64");

export const name = "dsh-companion-assembled-browser-fixture";
export const inject = ["workspaceRegistry", "sessions", "sessionController", "settings", "connection", "webServer"];

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

  const earlierId = (await ctx.sessionController.create({ sessionId: "companion-assembled-browser-earlier", workspaceId: workspace.id })).sessionId;
  const earlierResult = await ctx.sessionController.resolveAgent(earlierId);
  if (!("agent" in earlierResult)) throw new Error("failed to resolve earlier smoke session");
  const earlierSession = earlierResult.agent.session;
  earlierSession.append("user/message", createUserMessage({
    content: [{ type: "text", text: "Earlier packed conversation" }],
    source: { kind: "user" },
  }), { surfaceOp: "append" });
  await ctx.sessions.flush(earlierSession);
  await workspace.attachSession(earlierSession.id);

  const sessionId = (await ctx.sessionController.create({ sessionId: "companion-assembled-browser-smoke", workspaceId: workspace.id })).sessionId;
  const result = await ctx.sessionController.resolveAgent(sessionId);
  if (!("agent" in result)) throw new Error("failed to resolve assembled smoke session");
  const session = result.agent.session;
  session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "Packed runtime outgoing message" }],
    source: { kind: "user" },
  }), { surfaceOp: "append" });
  session.append("assistant/message", {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: "text", text: "Packed runtime **incoming** message.\n\n- Markdown item\n\n[[tts:text]]Packed runtime first voice message.[[/tts:text]]" }],
      source: { provider: "assembled-smoke", model: "assembled-smoke" },
    }),
  }, { surfaceOp: "append" });
  session.append("assistant/message", {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: "text", text: "[[tts:text]]Packed runtime second voice message.[[/tts:text]]" }],
      source: { provider: "assembled-smoke", model: "assembled-smoke" },
    }),
  }, { surfaceOp: "append" });
  await ctx.sessions.flush(session);
  await workspace.attachSession(session.id);
  // Publish the configured Workspace only after its two fixture Sessions are
  // attached, so Companion never races its own blank-session creation.
  await configureCompanion(ctx.settings, workspace.id);

  const disposeRpc = ctx.connection.rpc.handle("/kepos-tts", async (endpoint, payload) => {
    if (endpoint !== "synthesize" || typeof payload !== "object" || payload === null) {
      return { ok: false, error: { code: "bad-request", message: "invalid assembled TTS request", details: {} } };
    }
    const text = typeof payload.text === "string" ? payload.text : "";
    if (text.includes("first")) await new Promise((resolve) => setTimeout(resolve, 30));
    const name = text.includes("second") ? "second" : "first";
    return { ok: true, value: { mediaType: "audio/mpeg", url: `/companion-assembled-smoke/${name}.mp3`, bytes: audio.byteLength } };
  });
  const disposeFirstRoute = ctx.webServer.register({
    kind: "exact",
    path: "/companion-assembled-smoke/first.mp3",
    handler: (_request, response) => {
      response.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "cache-control": "no-store" });
      response.end(audio);
    },
  });
  const disposeSecondRoute = ctx.webServer.register({
    kind: "exact",
    path: "/companion-assembled-smoke/second.mp3",
    handler: (_request, response) => {
      response.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "cache-control": "no-store" });
      response.end(audio);
    },
  });
  yield async () => {
    disposeFirstRoute();
    disposeSecondRoute();
    await disposeRpc();
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionHostController, VOICE_CAPABILITY_ENDPOINT, VOICE_TRANSCRIBE_ENDPOINT } from "../src/host.js";
import { maxVoiceAudioBytesForMediaType } from "../src/voice-contract.js";

const signal = new AbortController().signal;
const workspace = { id: "workspace-a", path: "/tmp/companion", sessionIds: ["session-a"] };

function hostWith(service: unknown) {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;
  const scope = { get: () => ({ workspaceId: workspace.id, companionName: "Companion", userName: "你", preferredAddress: "你", defaultAffinity: 50 }), update: async () => undefined, watch: () => () => undefined };
  const ctx = {
    fs: {},
    settings: { register: () => scope },
    systemPrompt: { context: () => () => undefined },
    tools: { register: () => undefined },
    connection: { rpc: { handle: (_channel: string, next: typeof handler) => { handler = next; return () => undefined; } } },
    workspaceRegistry: { get: (id: string) => id === workspace.id ? workspace : undefined, list: () => [workspace] },
    llm: {},
    webServer: { port: 1, register: () => () => undefined },
    on: () => () => undefined,
    get: (name: string) => name === "keposTts" ? service : undefined,
  };
  const host = new CompanionHostController(ctx as never, scope);
  host.register();
  return { host, handler: () => handler! };
}

afterEach(() => vi.restoreAllMocks());

describe("Companion voice Host RPC", () => {
  it("authorizes the configured workspace/session and passes only decoded audio to optional Kepos", async () => {
    const transcribe = vi.fn(async (request: { sessionId: string; mediaType: string; data: Uint8Array }) => ({
      text: "你好",
      sentences: [{ startMs: 1, endMs: 2, text: "你好", expression: "sad", confidence: 0.2 }],
      provider_private_field: "must not escape",
    }));
    const { host, handler } = hostWith({ transcribe });
    await expect(handler()(VOICE_CAPABILITY_ENDPOINT, { workspaceId: workspace.id }, signal)).resolves.toEqual({ ok: true, value: { available: true } });
    await expect(handler()(VOICE_TRANSCRIBE_ENDPOINT, { workspaceId: workspace.id, sessionId: "session-a", mediaType: "audio/webm;codecs=opus", data: "AQID" }, signal)).resolves.toEqual({ ok: true, value: { text: "你好", expression: "sad" } });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(transcribe.mock.calls[0]?.[0]).toMatchObject({ sessionId: "session-a", mediaType: "audio/webm;codecs=opus", data: new Uint8Array([1, 2, 3]) });
    await host.dispose();
  });

  it("rejects non-canonical/unsupported/foreign requests before calling Kepos", async () => {
    const transcribe = vi.fn(async () => ({ text: "never" }));
    const { host, handler } = hostWith({ transcribe });
    for (const payload of [
      { workspaceId: workspace.id, sessionId: "session-a", mediaType: "audio/webm", data: "AQI" },
      { workspaceId: workspace.id, sessionId: "session-a", mediaType: "text/plain", data: "AQID" },
      { workspaceId: workspace.id, sessionId: "foreign", mediaType: "audio/webm", data: "AQID" },
      { workspaceId: workspace.id, sessionId: "session-a", mediaType: "audio/webm", data: "AQID", extra: true },
    ]) {
      await expect(handler()(VOICE_TRANSCRIBE_ENDPOINT, payload, signal)).resolves.toMatchObject({ ok: false });
    }
    expect(transcribe).not.toHaveBeenCalled();
    await host.dispose();
  });

  it("uses the complete parameterized Data URL boundary for decoded RPC audio", async () => {
    const transcribe = vi.fn(async () => ({ text: "边界" }));
    const { host, handler } = hostWith({ transcribe });
    const mediaType = "audio/webm;codecs=opus";
    const maxRawBytes = maxVoiceAudioBytesForMediaType(mediaType)!;
    const exact = Buffer.alloc(maxRawBytes).toString("base64");
    const next = Buffer.alloc(maxRawBytes + 1).toString("base64");
    await expect(handler()(VOICE_TRANSCRIBE_ENDPOINT, { workspaceId: workspace.id, sessionId: "session-a", mediaType, data: exact }, signal)).resolves.toMatchObject({ ok: true, value: { text: "边界" } });
    await expect(handler()(VOICE_TRANSCRIBE_ENDPOINT, { workspaceId: workspace.id, sessionId: "session-a", mediaType, data: next }, signal)).resolves.toMatchObject({ ok: false });
    expect(transcribe).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it("reports optional capability absence and hides provider failures", async () => {
    const { host, handler } = hostWith(undefined);
    await expect(handler()(VOICE_CAPABILITY_ENDPOINT, { workspaceId: workspace.id }, signal)).resolves.toEqual({ ok: true, value: { available: false } });
    await expect(handler()(VOICE_TRANSCRIBE_ENDPOINT, { workspaceId: workspace.id, sessionId: "session-a", mediaType: "audio/webm", data: "AQID" }, signal)).resolves.toMatchObject({ ok: false, error: { code: "transcription-unavailable" } });
    await host.dispose();

    const failing = hostWith({ transcribe: async () => { throw new Error("provider secret"); } });
    const result = await failing.handler()(VOICE_TRANSCRIBE_ENDPOINT, { workspaceId: workspace.id, sessionId: "session-a", mediaType: "audio/webm", data: "AQID" }, signal);
    expect(result).toMatchObject({ ok: false, error: { code: "transcription-failed" } });
    expect(JSON.stringify(result)).not.toContain("provider secret");
    await failing.host.dispose();
  });
});

import { describe, expect, it } from "vitest";
import { imageGenProjectionId, parseTtsPassage, recognizeImageGenResult, resolveImageDisplaySize, ttsProjectionId } from "../src/media.js";
import { TtsPreparationCache, validateTtsPayload } from "../src/client/voice-cache.js";

describe("companion media", () => {
  it("matches the installed Kepos Speech tag grammar for finalized passages", () => {
    const parsed = parseTtsPassage("正文 [[tts:text]] 你好，世界  [[/tts:text]]", true)!;
    expect(parsed.text).toBe("你好，世界");
    expect(parseTtsPassage("```[[tts:text]]假的[[/tts:text]]```", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]a[[/tts:text]] [[tts:text]]b[[/tts:text]]", true)?.text).toBe("a");
    expect(parseTtsPassage("[[tts:text]][[错误]][[/tts:text]] [[tts:text]]b[[/tts:text]]", true)?.text).toBe("b");
    expect(parseTtsPassage("````md\n[[tts:text]]假的[[/tts:text]]\n```", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]][[tts:text]]嵌套[[/tts:text]][[/tts:text]]", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]未完成", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]a[[/tts:text]]", false)).toBeUndefined();
  });

  it("allowlists ImageGen and keeps IDs stable", () => {
    expect(recognizeImageGenResult({ kind: "tool-result", name: "other", content: [] })).toBeUndefined();
    expect(recognizeImageGenResult({ kind: "tool-call", name: "kepos_image_generate", callId: "c1" }, "n")).toMatchObject({ id: "c1", state: "running" });
    expect(imageGenProjectionId("c1", "a1")).toBe("imagegen:c1:a1");
    expect(ttsProjectionId("n", { start: 1, digest: "abc" })).toBe("tts:n:1:abc");
  });

  it("bounds ordinary single-image display without upscaling and clamps extreme ratios", () => {
    expect(resolveImageDisplaySize(120, 80)).toMatchObject({ width: 120, height: 80, cropped: false });
    expect(resolveImageDisplaySize(640, 320)).toMatchObject({ width: 240, height: 120, cropped: false });
    expect(resolveImageDisplaySize(20, 200)).toMatchObject({ width: 50, height: 200, cropped: true });
    expect(resolveImageDisplaySize(200, 20)).toMatchObject({ width: 200, height: 50, cropped: true });
    expect(resolveImageDisplaySize(20, 20)).toMatchObject({ width: 20, height: 20, cropped: false });
  });
});

describe("Kepos Speech browser contract", () => {
  it("accepts the real bounded same-origin route payload and caches it once", async () => {
    const payload = { mediaType: "audio/mpeg", url: "/kepos-speech/audio/abc", bytes: 2401 };
    expect(validateTtsPayload(payload)).toEqual(payload);
    let calls = 0;
    const cache = new TtsPreparationCache();
    const prepared = await Promise.all([
      cache.prepare("s1", "你好", { synthesize: async () => { calls += 1; return payload; } }),
      cache.prepare("s1", "你好", { synthesize: async () => { calls += 1; return payload; } }),
    ]);
    expect(prepared).toEqual([prepared[0], prepared[0]]);
    expect(prepared[0]?.url).toBe("/kepos-speech/audio/abc");
    expect(calls).toBe(1);
  });

  it("rejects cross-origin, wrong media type, and unbounded route payloads", () => {
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "https://elsewhere.invalid/audio", bytes: 1 }, "http://localhost")).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/ogg", url: "/kepos-speech/audio/a", bytes: 1 })).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "/kepos-speech/audio/a", bytes: 0 })).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "/kepos-tts/audio/a", bytes: 1 })).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "/other/audio/a", bytes: 1 })).toThrow("audio-invalid");
  });

  it("evicts a rejected preparation so a voice retry calls Kepos again", async () => {
    const payload = { mediaType: "audio/mpeg", url: "/kepos-speech/audio/retry", bytes: 2401 };
    let calls = 0;
    const cache = new TtsPreparationCache();
    const rpc = {
      synthesize: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary failure");
        return payload;
      },
    };
    await expect(cache.prepare("s1", "请再试一次", rpc)).rejects.toThrow("temporary failure");
    await expect(cache.prepare("s1", "请再试一次", rpc)).resolves.toMatchObject({ url: payload.url });
    expect(calls).toBe(2);
  });

});

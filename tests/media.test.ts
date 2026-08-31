import { describe, expect, it, vi } from "vitest";
import { imageGenProjectionId, parseTtsPassage, recognizeImageGenResult, ttsProjectionId } from "../src/media.js";
import { TTS_PREPARATION_TIMEOUT_MS, TtsPreparationCache, validateTtsPayload } from "../src/client/voice-cache.js";

describe("companion media", () => {
  it("parses one finalized bounded passage and ignores fenced code", () => {
    const parsed = parseTtsPassage("正文 [[tts:text]] 你好，世界  [[/tts:text]]", true)!;
    expect(parsed.text).toBe("你好，世界");
    expect(parseTtsPassage("```[[tts:text]]假的[[/tts:text]]```", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]a[[/tts:text]] [[tts:text]]b[[/tts:text]]", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]未完成", true)).toBeUndefined();
    expect(parseTtsPassage("[[tts:text]]a[[/tts:text]]", false)).toBeUndefined();
  });

  it("allowlists ImageGen and keeps IDs stable", () => {
    expect(recognizeImageGenResult({ kind: "tool-result", name: "other", content: [] })).toBeUndefined();
    expect(recognizeImageGenResult({ kind: "tool-call", name: "kepos_image_generate", callId: "c1" }, "n")).toMatchObject({ id: "c1", state: "running" });
    expect(imageGenProjectionId("c1", "a1")).toBe("imagegen:c1:a1");
    expect(ttsProjectionId("n", { start: 1, digest: "abc" })).toBe("tts:n:1:abc");
  });
});

describe("Kepos TTS browser contract", () => {
  it("accepts the real bounded same-origin route payload and caches it once", async () => {
    const payload = { mediaType: "audio/mpeg", url: "/kepos-tts/audio/abc", bytes: 2401 };
    expect(validateTtsPayload(payload)).toEqual(payload);
    let calls = 0;
    const cache = new TtsPreparationCache();
    const prepared = await Promise.all([
      cache.prepare("s1", "你好", { synthesize: async () => { calls += 1; return payload; } }),
      cache.prepare("s1", "你好", { synthesize: async () => { calls += 1; return payload; } }),
    ]);
    expect(prepared).toEqual([prepared[0], prepared[0]]);
    expect(prepared[0]?.url).toBe("/kepos-tts/audio/abc");
    expect(calls).toBe(1);
  });

  it("rejects cross-origin, wrong media type, and unbounded route payloads", () => {
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "https://elsewhere.invalid/audio", bytes: 1 }, "http://localhost")).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/ogg", url: "/kepos-tts/audio/a", bytes: 1 })).toThrow("audio-invalid");
    expect(() => validateTtsPayload({ mediaType: "audio/mpeg", url: "/kepos-tts/audio/a", bytes: 0 })).toThrow("audio-invalid");
  });

  it("bounds a stalled preparation and removes it so the voice can retry", async () => {
    vi.useFakeTimers();
    try {
      const payload = { mediaType: "audio/mpeg", url: "/kepos-tts/audio/retry", bytes: 2401 };
      const cache = new TtsPreparationCache();
      let calls = 0;
      let settled = false;
      const first = cache.prepare("s1", "稍等", {
        synthesize: async (_text, _sessionId, signal) => {
          calls += 1;
          if (calls === 1) {
            return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
          }
          return payload;
        }
      });
      void first.catch(() => undefined).finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(TTS_PREPARATION_TIMEOUT_MS);
      expect(settled).toBe(true);

      await expect(cache.prepare("s1", "稍等", { synthesize: async () => { calls += 1; return payload; } })).resolves.toMatchObject({ url: payload.url });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

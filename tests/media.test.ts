import { describe, expect, it } from "vitest";
import { imageGenProjectionId, parseTtsPassage, recognizeImageGenResult, ttsProjectionId } from "../src/media.js";

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

import { describe, expect, it, vi } from "vitest";
import {
  VoiceRecordingController,
  VoiceRecordingError,
  formatVoiceTurn,
  isCanonicalBase64,
  normalizeVoiceTranscription,
  selectVoiceMimeType,
  validateVoiceRecording,
  voiceBlobToBase64,
} from "../src/client/voice-input.js";
import {
  MAX_VOICE_DATA_URL_BYTES,
  isVoiceAudioWithinDataUrlLimit,
  maxVoiceAudioBytesForMediaType,
  voiceDataUrlByteLength,
} from "../src/voice-contract.js";

class FakeTrack {
  stopped = 0;
  stop(): void { this.stopped += 1; }
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks(): FakeTrack[] { return [this.track]; }
}

class FakeRecorder {
  static isTypeSupported = (value: string): boolean => value === "audio/webm;codecs=opus";
  readonly mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data?: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error?: unknown }) => void) | null = null;
  started = false;
  constructor(readonly stream: FakeStream) {}
  start(): void { this.started = true; }
  stop(): void {
    this.ondataavailable?.({ data: new Blob(["hello"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe("Companion voice admission", () => {
  it("derives exact raw boundaries from a parameterized Data URL prefix", () => {
    const mediaType = "audio/webm;codecs=opus";
    const maxRawBytes = maxVoiceAudioBytesForMediaType(mediaType);
    expect(maxRawBytes).toBeDefined();
    expect(voiceDataUrlByteLength(mediaType, maxRawBytes!)).toBeLessThanOrEqual(MAX_VOICE_DATA_URL_BYTES);
    expect(isVoiceAudioWithinDataUrlLimit(mediaType, maxRawBytes!)).toBe(true);
    expect(voiceDataUrlByteLength(mediaType, maxRawBytes! + 1)).toBeGreaterThan(MAX_VOICE_DATA_URL_BYTES);
    expect(isVoiceAudioWithinDataUrlLimit(mediaType, maxRawBytes! + 1)).toBe(false);
  });

  it("applies the same boundary to a browser Blob", () => {
    const mediaType = "audio/webm;codecs=opus";
    const maxRawBytes = maxVoiceAudioBytesForMediaType(mediaType)!;
    const exact = new Blob([new Uint8Array(maxRawBytes)], { type: mediaType });
    expect(validateVoiceRecording(exact)).toMatchObject({ mediaType, bytes: maxRawBytes });
    const next = new Blob([new Uint8Array(maxRawBytes + 1)], { type: mediaType });
    expect(() => validateVoiceRecording(next)).toThrowError(VoiceRecordingError);
  });

  it("chooses only a provider-compatible advertised MIME type", () => {
    expect(selectVoiceMimeType(FakeRecorder as never)).toBe("audio/webm;codecs=opus");
    expect(selectVoiceMimeType(undefined)).toBeUndefined();
  });

  it("records once, stops tracks, and returns an ephemeral bounded Blob", async () => {
    const stream = new FakeStream();
    const controller = new VoiceRecordingController({
      isSecureContext: true,
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      mediaRecorder: FakeRecorder as never,
    });
    await expect(controller.start()).resolves.toBe(true);
    await expect(controller.start()).resolves.toBe(false);
    const recording = await controller.stopAndGet();
    expect(recording).toMatchObject({ mediaType: "audio/webm;codecs=opus", bytes: 5 });
    expect(stream.track.stopped).toBe(1);
    expect(controller.status).toBe("idle");
  });

  it("rejects secure-context, duration, and cumulative byte failures", async () => {
    const stream = new FakeStream();
    const timers: Array<() => void> = [];
    const errors: VoiceRecordingError[] = [];
    class LargeRecorder extends FakeRecorder {
      stop(): void {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(11)], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    const unavailable = new VoiceRecordingController({ isSecureContext: false, mediaDevices: { getUserMedia: async () => stream }, mediaRecorder: FakeRecorder as never });
    await expect(unavailable.start()).rejects.toMatchObject({ code: "insecure-context" });
    const tooLarge = new VoiceRecordingController({ isSecureContext: true, mediaDevices: { getUserMedia: async () => stream }, mediaRecorder: LargeRecorder as never, maxBytes: 10 });
    await tooLarge.start();
    await expect(tooLarge.stopAndGet()).rejects.toMatchObject({ code: "size-limit" });

    const duration = new VoiceRecordingController({
      isSecureContext: true,
      mediaDevices: { getUserMedia: async () => stream },
      mediaRecorder: FakeRecorder as never,
      maxDurationMs: 10,
      setTimeout: ((callback: () => void) => { timers.push(callback); return timers.length as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
      clearTimeout: (() => undefined) as typeof clearTimeout,
      onError: (error) => errors.push(error),
    });
    await duration.start();
    timers[0]?.();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "duration-limit" });
  });

  it("keeps only the transcript and raw bracketed expression label", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    expect(isCanonicalBase64(await voiceBlobToBase64(blob))).toBe(true);
    expect(normalizeVoiceTranscription({ text: "  你好 ", sentences: [{ expression: "sad", startMs: 0, endMs: 2, text: "你好" }] })).toEqual({ text: "你好", expression: "sad" });
    expect(formatVoiceTurn({ text: "你好", expression: "sad" })).toBe("你好 [sad]");
    expect(formatVoiceTurn({ text: "你好" })).toBe("你好");
    expect(() => normalizeVoiceTranscription({ text: "" })).toThrowError(VoiceRecordingError);
    expect(normalizeVoiceTranscription({ text: "你好", expression: "unknown" })).toEqual({ text: "你好" });
  });
});

import { digestText, normalizeTtsText } from "../media.js";

export interface TtsRpc {
  synthesize(text: string, sessionId: string, signal?: AbortSignal): Promise<unknown>;
}

export interface PreparedAudio {
  key: string;
  url: string;
}

export interface TtsPayload {
  mediaType?: unknown;
  url?: unknown;
  bytes?: unknown;
}

export const MAX_TTS_BYTES = 8 * 1024 * 1024;

/** Validate the browser-facing Kepos payload without trusting arbitrary URLs. */
export function validateTtsPayload(raw: unknown, origin?: string): { url: string; mediaType: "audio/mpeg"; bytes: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("audio-invalid");
  const payload = raw as TtsPayload;
  if (payload.mediaType !== "audio/mpeg" || typeof payload.bytes !== "number" || !Number.isSafeInteger(payload.bytes) || payload.bytes <= 0 || payload.bytes > MAX_TTS_BYTES) {
    throw new Error("audio-invalid");
  }
  if (typeof payload.url !== "string" || !payload.url.trim()) throw new Error("audio-invalid");
  const value = payload.url.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return { url: value, mediaType: "audio/mpeg", bytes: payload.bytes };
  const currentOrigin = origin ?? (typeof location === "object" && location ? location.origin : undefined);
  if (!currentOrigin) throw new Error("audio-invalid");
  try {
    const parsed = new URL(value, currentOrigin);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== currentOrigin || !parsed.pathname.startsWith("/")) throw new Error("audio-invalid");
    return { url: parsed.href, mediaType: "audio/mpeg", bytes: payload.bytes };
  } catch {
    throw new Error("audio-invalid");
  }
}

interface Entry {
  promise: Promise<PreparedAudio>;
  value?: PreparedAudio;
}

/** Page-local preparation cache. Disposal intentionally does not cancel host synthesis. */
export class TtsPreparationCache {
  private readonly entries = new Map<string, Entry>();

  prepare(sessionId: string, text: string, rpc: TtsRpc, signal?: AbortSignal): Promise<PreparedAudio> {
    const normalized = normalizeTtsText(text);
    const key = `${sessionId}:${digestText(normalized)}`;
    const existing = this.entries.get(key);
    if (existing) return existing.promise;
    const entry: Entry = { promise: Promise.resolve(undefined as never) };
    entry.promise = rpc.synthesize(normalized, sessionId, signal).then((raw) => {
      const payload = validateTtsPayload(raw);
      const url = payload.url;
      const value = { key, url };
      entry.value = value;
      return value;
    }).catch((error) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }

  get(sessionId: string, text: string): PreparedAudio | undefined {
    return this.entries.get(`${sessionId}:${digestText(normalizeTtsText(text))}`)?.value;
  }

  dispose(revoke = true): void {
    if (revoke) {
      for (const entry of this.entries.values()) if (entry.value?.url.startsWith("blob:")) URL.revokeObjectURL(entry.value.url);
    }
    this.entries.clear();
  }
}

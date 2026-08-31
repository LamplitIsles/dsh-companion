import { digestText, normalizeTtsText } from "../media.js";

export interface TtsRpc {
  synthesize(text: string, sessionId: string, signal?: AbortSignal): Promise<unknown>;
}

export interface PreparedAudio {
  key: string;
  url: string;
  duration?: number;
}

export interface TtsPayload {
  audioBase64?: string;
  mimeType?: string;
  url?: string;
}

interface Entry {
  promise: Promise<PreparedAudio>;
  value?: PreparedAudio;
  settled: boolean;
}

/** Page-local preparation cache. Disposal intentionally does not cancel host synthesis. */
export class TtsPreparationCache {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly makeUrl: (bytes: Uint8Array, mimeType: string) => string = (bytes, mime) => URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: mime }))) {}

  prepare(sessionId: string, text: string, rpc: TtsRpc, signal?: AbortSignal): Promise<PreparedAudio> {
    const normalized = normalizeTtsText(text);
    const key = `${sessionId}:${digestText(normalized)}`;
    const existing = this.entries.get(key);
    if (existing) return existing.promise;
    const entry: Entry = { settled: false, promise: Promise.resolve(undefined as never) };
    entry.promise = rpc.synthesize(normalized, sessionId, signal).then((raw) => {
      const payload = raw as TtsPayload;
      let url: string;
      if (typeof payload?.url === "string" && /^https?:|^blob:/u.test(payload.url)) url = payload.url;
      else if (typeof payload?.audioBase64 === "string") {
        const mime = typeof payload.mimeType === "string" && /^audio\//u.test(payload.mimeType) ? payload.mimeType : "audio/mpeg";
        const bytes = decodeBase64(payload.audioBase64);
        if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) throw new Error("audio-invalid");
        url = this.makeUrl(bytes, mime);
      } else throw new Error("audio-invalid");
      const value = { key, url };
      entry.value = value;
      entry.settled = true;
      return value;
    }).catch((error) => {
      entry.settled = true;
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

function decodeBase64(value: string): Uint8Array {
  if (!/^[a-z0-9+/]*={0,2}$/iu.test(value) || value.length % 4 === 1) throw new Error("audio-invalid");
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

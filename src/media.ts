/** Media recognition and identity helpers shared by the browser projection. */

import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";

export interface TtsPassage {
  text: string;
  start: number;
  end: number;
  digest: string;
}

const OPEN_TAG = "[[tts:text]]";
const CLOSE_TAG = "[[/tts:text]]";
const FENCE_PATTERN = /```[\s\S]*?```|~~~[\s\S]*?~~~/gu;

/** Normalize the installed Kepos grammar's text payload without mutating chat text. */
export function normalizeTtsText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Small deterministic digest; cryptography is unnecessary for DOM identity. */
export function digestText(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Parse one finalized assistant block. Fenced code is deliberately ignored,
 * malformed marker pairs are rejected, and a second passage is rejected so a
 * single assistant node always maps to at most one voice row.
 */
export function parseTtsPassage(value: unknown, finalized: boolean): TtsPassage | undefined {
  if (!finalized || typeof value !== "string" || value.length === 0) return undefined;
  const masked = value.replace(FENCE_PATTERN, (match) => " ".repeat(match.length));
  const opens = [...masked.matchAll(/\[\[tts:text\]\]/gu)];
  const closes = [...masked.matchAll(/\[\[\/tts:text\]\]/gu)];
  if (opens.length !== 1 || closes.length !== 1) return undefined;
  const start = opens[0]!.index!;
  const closeStart = closes[0]!.index!;
  if (closeStart <= start + OPEN_TAG.length) return undefined;
  if (value.slice(start, closeStart).includes("```") || value.slice(start, closeStart).includes("~~~")) return undefined;
  const raw = value.slice(start + OPEN_TAG.length, closeStart);
  const text = normalizeTtsText(raw);
  if (!text || Array.from(text).length > 240) return undefined;
  // Any other tag-like marker in the payload would be surprising to the TTS
  // backend and is treated as malformed rather than synthesized.
  if (/\[\[\/?tts(?::[^\]]*)?\]\]/iu.test(text)) return undefined;
  const end = closeStart + CLOSE_TAG.length;
  return { text, start, end, digest: digestText(text) };
}

export interface ImageRefLike {
  attachmentId: string;
  mediaType: string;
  name?: string;
  width?: number;
  height?: number;
}

export function isImageAttachment(value: unknown): value is ImageRefLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.attachmentId === "string" && record.attachmentId.length > 0
    && typeof record.mediaType === "string" && record.mediaType.startsWith("image/");
}

/** Extract an assistant structured image content block. */
export function imageFromContent(content: unknown): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if ((record.type === "image" || record.kind === "image") && isImageAttachment(record.attachment)) {
      return record.attachment as ImageAttachmentRef;
    }
  }
  return undefined;
}

export interface ImageGenProjection {
  id: string;
  state: "running" | "ready" | "failed";
  attachment?: ImageAttachmentRef;
  alt: string;
  error?: string;
}

/**
 * Recognize only the allowlisted durable ImageGen result. Generic Tool
 * content never reaches this projection.
 */
export function recognizeImageGenResult(block: unknown, fallbackId = "imagegen"): ImageGenProjection | undefined {
  if (typeof block !== "object" || block === null) return undefined;
  const record = block as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : typeof record.toolName === "string" ? record.toolName : undefined;
  const isImageGen = name === "kepos_image_generate" || record.kind === "tool-result" && record.tool === "kepos_image_generate";
  if (!isImageGen) return undefined;
  const id = typeof record.callId === "string" ? record.callId : typeof record.id === "string" ? record.id : fallbackId;
  if (record.kind === "tool-call" || record.running === true || record.state === "running") {
    return { id, state: "running", alt: "正在生成的图片" };
  }
  if (record.isError === true || record.state === "failed" || record.error !== undefined) {
    return { id, state: "failed", alt: "图片生成失败", error: safeError(record.error) };
  }
  const attachment = imageFromContent(record.content);
  if (!attachment) return { id, state: "failed", alt: "图片生成失败", error: "未找到图片附件" };
  const nameHint = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name.trim() : "生成的图片";
  return { id, state: "ready", attachment, alt: nameHint };
}

function safeError(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string") {
    return String((value as { message: string }).message).slice(0, 160);
  }
  return "图片生成没有完成。";
}

export function imageProjectionId(nodeId: string, blockIndex: number): string {
  return `image:${nodeId}:${blockIndex}`;
}

export function imageGenProjectionId(callId: string, attachmentId: string): string {
  return `imagegen:${callId}:${attachmentId}`;
}

export function ttsProjectionId(nodeId: string, passage: Pick<TtsPassage, "start" | "digest">): string {
  return `tts:${nodeId}:${passage.start}:${passage.digest}`;
}

export interface ObjectUrlRegistry {
  add(url: string): void;
  revokeAll(): void;
}

export function createObjectUrlRegistry(): ObjectUrlRegistry {
  const urls = new Set<string>();
  return {
    add(url) { urls.add(url); },
    revokeAll() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

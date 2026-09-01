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

function fencedRanges(input: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const marker = /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gm;
  let open: { character: string; length: number; start: number } | undefined;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(input))) {
    const token = match[1];
    if (!token) continue;
    const suffix = match[2] ?? "";
    if (!open) {
      open = { character: token[0]!, length: token.length, start: match.index };
      continue;
    }
    if (open.character === token[0] && token.length >= open.length && /^[ \t]*$/.test(suffix)) {
      ranges.push([open.start, marker.lastIndex]);
      open = undefined;
    }
  }
  if (open) ranges.push([open.start, input.length]);
  return ranges;
}

function overlapsFence(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([from, to]) => start < to && end > from);
}

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
  const fences = fencedRanges(value);
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(OPEN_TAG, cursor);
    if (start < 0) break;
    const closeStart = value.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
    if (closeStart < 0) break;
    const end = closeStart + CLOSE_TAG.length;
    const raw = value.slice(start + OPEN_TAG.length, closeStart);
    const text = normalizeTtsText(raw);
    const valid = text && !raw.includes("[[") && !raw.includes("]]") && Array.from(text).length <= 240;
    if (!overlapsFence(start, end, fences) && valid) {
      return { text, start, end, digest: digestText(text) };
    }
    cursor = end;
  }
  return undefined;
}

export interface ImageRefLike {
  attachmentId: string;
  mediaType: string;
  name?: string;
  width?: number;
  height?: number;
}

export interface ImageDisplaySize {
  /** CSS-pixel width of the ordinary in-conversation image box. */
  width: number;
  /** CSS-pixel height of the ordinary in-conversation image box. */
  height: number;
  /** The source aspect ratio before the ordinary-display clamp. */
  sourceAspectRatio?: number;
  /** True when an extreme source ratio requires intentional cover cropping. */
  cropped: boolean;
}

/**
 * Translate an intrinsic image size into the official ordinary-display shape.
 * The long edge is bounded, small images are never upscaled, and only extreme
 * aspect ratios are widened/narrowed into the scan-friendly [0.25, 4] range.
 */
export function resolveImageDisplaySize(
  width: number | undefined,
  height: number | undefined,
  maxLongEdge = 240,
): ImageDisplaySize {
  const validWidth = typeof width === "number" && Number.isFinite(width) && width > 0;
  const validHeight = typeof height === "number" && Number.isFinite(height) && height > 0;
  const cap = Number.isFinite(maxLongEdge) && maxLongEdge > 0 ? maxLongEdge : 240;
  if (!validWidth || !validHeight) return { width: cap, height: Math.round(cap * 0.75), cropped: false };

  const sourceWidth = width!;
  const sourceHeight = height!;
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const scale = Math.min(1, cap / Math.max(sourceWidth, sourceHeight));
  let displayWidth = Math.max(1, Math.round(sourceWidth * scale));
  let displayHeight = Math.max(1, Math.round(sourceHeight * scale));
  let cropped = false;
  const ratio = displayWidth / displayHeight;
  if (ratio < 0.25) {
    displayWidth = Math.max(1, Math.round(displayHeight * 0.25));
    cropped = true;
  } else if (ratio > 4) {
    displayHeight = Math.max(1, Math.round(displayWidth / 4));
    cropped = true;
  }
  return { width: displayWidth, height: displayHeight, sourceAspectRatio, cropped };
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

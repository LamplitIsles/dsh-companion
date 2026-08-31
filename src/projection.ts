import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import {
  imageFromContent,
  imageGenProjectionId,
  imageProjectionId,
  parseTtsPassage,
  recognizeImageGenResult,
  ttsProjectionId,
} from "./media.js";
import { projectContinuityRecords, type CompanionContinuitySnapshot, type ContinuityRecord } from "./continuity.js";

export type MessageSide = "incoming" | "outgoing";

export interface TimelineText {
  id: string;
  projectionKey?: string;
  kind: "text";
  side: MessageSide;
  text: string;
  pending?: boolean;
  failed?: boolean;
  time?: number;
  replyTo?: string;
}

export interface TimelineImage {
  id: string;
  /** Stable source key used when a durable ImageGen call settles into its attachment. */
  projectionKey?: string;
  kind: "image";
  side: MessageSide;
  state: "loading" | "ready" | "failed" | "running";
  attachment?: ImageAttachmentRef;
  alt: string;
  error?: string;
  time?: number;
}

export interface TimelineVoice {
  id: string;
  projectionKey?: string;
  kind: "voice";
  side: "incoming";
  text: string;
  status: "preparing";
  time?: number;
}

export interface TimelineNotice {
  id: string;
  projectionKey?: string;
  kind: "notice";
  side: "incoming";
  tone: "info" | "error";
  text: string;
  time?: number;
}

/** A quiet, durable completion marker for automatic conversation organization. */
export interface TimelineContinuityRecord extends ContinuityRecord {}

export type TimelineItem = TimelineText | TimelineImage | TimelineVoice | TimelineNotice | TimelineContinuityRecord;

export interface CompanionProjection {
  items: readonly TimelineItem[];
  pendingCount: number;
  running: boolean;
  status: "ready" | "working" | "reconnecting";
  openState: "cold" | "loading" | "open" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  promptError?: string;
  lastAgentError?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nodeId(node: Record<string, unknown>, fallback: string): string {
  for (const key of ["key", "id", "seq", "messageId", "callId"]) {
    const value = node[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return fallback;
}

function nodeTime(node: Record<string, unknown>): number | undefined {
  for (const key of ["time", "createdAt", "timestamp"]) {
    if (typeof node[key] === "number") return node[key] as number;
  }
  return undefined;
}

function textFromValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textFromValue).filter((part): part is string => part !== undefined);
    return parts.length ? parts.join("") : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["text", "content", "preview", "message"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  if (Array.isArray(record.content)) {
    const parts = record.content.map(textFromValue).filter((part): part is string => part !== undefined);
    if (parts.length) return parts.join("");
  }
  return undefined;
}

function contentOf(node: Record<string, unknown>): readonly unknown[] {
  if (Array.isArray(node.blocks)) return node.blocks;
  if (Array.isArray(node.content)) return node.content;
  if (Array.isArray(node.message)) return node.message;
  return [];
}

function kindOf(node: Record<string, unknown>): string {
  return typeof node.kind === "string" ? node.kind : typeof node.role === "string" ? node.role : "";
}

function isUserNode(node: Record<string, unknown>): boolean {
  const kind = kindOf(node).toLowerCase();
  return kind.includes("user") || kind.includes("human") || node.role === "user";
}

function isAssistantNode(node: Record<string, unknown>): boolean {
  const kind = kindOf(node).toLowerCase();
  return kind.includes("assistant") || kind === "model" || node.role === "assistant";
}

function isSteeringNode(node: Record<string, unknown>): boolean {
  return kindOf(node).toLowerCase() === "steering";
}

function isFinalized(node: Record<string, unknown>): boolean {
  if (node.finalized === false || node.streaming === true || node.partial === true) return false;
  if (node.status === "streaming" || node.status === "running") return false;
  return true;
}

function assistantText(node: Record<string, unknown>): string {
  const direct = textFromValue(node.text);
  if (direct !== undefined) return direct;
  const parts = contentOf(node)
    .map((block) => {
      const record = asRecord(block);
      if (!record) return undefined;
      const blockKind = typeof record.kind === "string" ? record.kind : record.type;
      return blockKind === "text" ? textFromValue(record) : undefined;
    })
    .filter((part): part is string => part !== undefined);
  return parts.join("");
}

function nodeMedia(node: Record<string, unknown>, id: string, side: MessageSide, time?: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const blocks = contentOf(node);
  let imageIndex = 0;
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    const attachment = imageFromContent([record]);
    if (attachment) {
      items.push({
        id: imageProjectionId(id, imageIndex++),
        kind: "image",
        side,
        state: "ready",
        attachment,
        alt: attachment.name ?? (side === "incoming" ? "Companion 图片" : "图片"),
        time,
      });
    }
  }
  // A node may use a single attachment property rather than content[].
  if (items.length === 0 && node.attachment && imageFromContent([{ type: "image", attachment: node.attachment }])) {
    const attachment = imageFromContent([{ type: "image", attachment: node.attachment }])!;
    items.push({ id: imageProjectionId(id, 0), kind: "image", side, state: "ready", attachment, alt: attachment.name ?? "图片", time });
  }
  return items;
}

function orderedNodes(snapshot: unknown): readonly unknown[] {
  const root = asRecord(snapshot);
  if (!root) return [];
  const chat = asRecord(root.chat);
  if (chat) {
    const legacy = asRecord(chat.legacy);
    if (legacy && Array.isArray(legacy.nodes)) return legacy.nodes;
    if (Array.isArray(chat.nodes)) return chat.nodes;
    const store = asRecord(chat.nodes);
    const order = Array.isArray(chat.order) ? chat.order : [];
    if (store && typeof store.get === "function" && order.length) {
      return order.map((key) => (store.get as (key: string) => unknown).call(store, String(key))).filter(Boolean);
    }
  }
  if (Array.isArray(root.nodes)) return root.nodes;
  return [];
}

/** Flatten DSH's keyed Chat view node while retaining its render-stable key. */
function normalizeChatNode(value: unknown): Record<string, unknown> | undefined {
  const wrapper = asRecord(value);
  if (!wrapper) return undefined;
  const data = asRecord(wrapper.data);
  if (!data || typeof wrapper.key !== "string" || typeof wrapper.kind !== "string") return wrapper;
  if (wrapper.visibility === "hidden") return undefined;
  return {
    ...data,
    key: wrapper.key,
    kind: wrapper.kind,
    ...(typeof wrapper.id === "string" ? { id: wrapper.id } : {}),
  };
}

function pendingNodes(snapshot: unknown): readonly unknown[] {
  const root = asRecord(snapshot);
  return root && Array.isArray(root.queue) ? root.queue : [];
}

/** Project only Companion-visible rows; ordinary Tool/reasoning nodes disappear. */
export function projectConversation(snapshot: unknown, connected = true, continuity?: CompanionContinuitySnapshot | unknown): CompanionProjection {
  const root = asRecord(snapshot) ?? {};
  const items: TimelineItem[] = [];
  const admittedQueueIds = new Set<string>();
  const nodes = orderedNodes(snapshot);
  const normalizedNodes = nodes.map(normalizeChatNode);
  const continuityValue = continuity ?? root.continuity;
  const continuityRecords = projectContinuityRecords(continuityValue, normalizedNodes.filter((node): node is Record<string, unknown> => node !== undefined));
  const emittedRecords = new Set<string>();
  const emitContinuityRecords = (predicate: (anchorSeq: number) => boolean): void => {
    for (const record of continuityRecords) {
      if (!emittedRecords.has(record.id) && predicate(record.anchorSeq)) {
        items.push(record);
        emittedRecords.add(record.id);
      }
    }
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = normalizedNodes[index];
    if (!node) continue;
    const sequence = typeof node.seq === "number" && Number.isSafeInteger(node.seq) ? node.seq : undefined;
    if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq < sequence);
    const id = nodeId(node, `node-${index}`);
    const time = nodeTime(node);
    if (isUserNode(node)) {
      const text = textFromValue(node.text) ?? textFromValue(node.content) ?? "";
      if (text) items.push({ id, kind: "text", side: "outgoing", text, time });
      items.push(...nodeMedia(node, id, "outgoing", time));
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    if (isAssistantNode(node)) {
      if (!isFinalized(node)) {
        if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
        continue;
      }
      const text = assistantText(node);
      const passage = parseTtsPassage(text, true);
      const visibleText = passage ? `${text.slice(0, passage.start)}${text.slice(passage.end)}`.trim() : text;
      if (visibleText) items.push({ id, kind: "text", side: "incoming", text: visibleText, time });
      items.push(...nodeMedia(node, id, "incoming", time));
      if (passage) items.push({ id: ttsProjectionId(id, passage), kind: "voice", side: "incoming", text: passage.text, status: "preparing", time });
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    if (isSteeringNode(node)) {
      const text = textFromValue(node.text) ?? textFromValue(node.content) ?? "";
      const messageId = typeof node.messageId === "string" ? node.messageId : undefined;
      if (messageId) admittedQueueIds.add(messageId);
      if (text) items.push({ id, projectionKey: id, kind: "text", side: "outgoing", text, time });
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    const call = asRecord(node.call);
    const image = recognizeImageGenResult({ ...node, name: node.name ?? node.toolName ?? call?.name, callId: node.callId ?? nodeId(node, id) }, id);
    if (image) {
      const projectionId = image.attachment ? imageGenProjectionId(image.id, image.attachment.attachmentId) : `imagegen:${image.id}`;
      items.push({ id: projectionId, projectionKey: `imagegen:${image.id}`, kind: "image", side: "incoming", state: image.state, attachment: image.attachment, alt: image.alt, error: image.error, time });
    }
    if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
  }
  for (const record of continuityRecords) if (!emittedRecords.has(record.id)) items.push(record);
  const pending = pendingNodes(snapshot);
  for (let index = 0; index < pending.length; index += 1) {
    const row = asRecord(pending[index]);
    if (!row) continue;
    const identity = typeof row.messageId === "string" ? row.messageId : typeof row.id === "string" ? row.id : `pending-${index}`;
    if (admittedQueueIds.has(identity)) continue;
    const text = typeof row.text === "string" ? row.text : textFromValue(row.content) ?? "";
    if (text) items.push({ id: `pending:${identity}`, kind: "text", side: "outgoing", text, pending: true });
  }
  const promptError = asRecord(root.promptError);
  const error = asRecord(promptError?.error);
  const promptErrorNotice = promptError?.op === "stop"
    ? "暂时无法停止当前回复，请重试。"
    : typeof error?.message === "string"
      ? error.message
      : "这条消息没有发送成功，可以重试。";
  const promptErrorAnnouncement = promptError?.op === "stop"
    ? "暂时无法停止当前回复，请重试。"
    : promptError ? "这条消息没有发送成功，可以重试。" : undefined;
  if (promptError) {
    items.push({ id: "prompt-error", kind: "notice", side: "incoming", tone: "error", text: promptErrorNotice });
  }
  const lastError = typeof root.lastAgentError === "string" ? root.lastAgentError : undefined;
  if (lastError) items.push({ id: "agent-error", kind: "notice", side: "incoming", tone: "error", text: lastError });
  const openState = root.openState === "error" ? "error" : root.openState === "loading" ? "loading" : root.openState === "cold" ? "cold" : "open";
  const running = root.running === true;
  const timeline = dedupeTimeline(items);
  return {
    items: timeline,
    pendingCount: timeline.filter((item) => item.kind === "text" && item.pending).length,
    running,
    status: deriveStatus({ connected, running, openState }),
    openState,
    hasMore: root.hasMore === true,
    loadingOlder: root.loadingOlder === true,
    ...(promptErrorAnnouncement ? { promptError: promptErrorAnnouncement } : {}),
    ...(lastError ? { lastAgentError: lastError } : {}),
  };
}

function dedupeTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  const positions = new Map<string, number>();
  for (const item of items) {
    const key = ("projectionKey" in item && item.projectionKey) ? item.projectionKey : item.id;
    const position = positions.get(key);
    if (position !== undefined) {
      if (timelineRank(item) > timelineRank(result[position]!)) result[position] = item;
      continue;
    }
    positions.set(key, result.length);
    result.push(item);
  }
  return result;
}

function timelineRank(item: TimelineItem): number {
  if (item.kind === "image") return item.state === "ready" || item.state === "failed" ? 2 : 1;
  if (item.kind === "text") return item.pending ? 1 : 2;
  return 2;
}

export function deriveStatus(input: { connected: boolean; running: boolean; openState?: string }): "ready" | "working" | "reconnecting" {
  if (!input.connected || input.openState === "error" || input.openState === "loading") return "reconnecting";
  return input.running ? "working" : "ready";
}

export interface ScrollPlan {
  follow: boolean;
  preserveAnchor: boolean;
  showNewMessageAffordance: boolean;
  previousHeight?: number;
}

export function scrollPlan(input: { scrollTop: number; scrollHeight: number; clientHeight: number; nearBottomPx?: number; prepending?: boolean; previousHeight?: number }): ScrollPlan {
  const threshold = input.nearBottomPx ?? 96;
  const distance = input.scrollHeight - input.clientHeight - input.scrollTop;
  if (input.prepending) {
    return { follow: false, preserveAnchor: true, showNewMessageAffordance: false, ...(input.previousHeight === undefined ? {} : { previousHeight: input.previousHeight }) };
  }
  const nearBottom = distance <= threshold;
  return { follow: nearBottom, preserveAnchor: !nearBottom, showNewMessageAffordance: !nearBottom };
}

export function reconcilePending(items: readonly TimelineItem[], durableIds: ReadonlySet<string>): TimelineItem[] {
  return items.filter((item) => !(item.kind === "text" && item.pending && durableIds.has(item.id.replace(/^pending:/u, ""))));
}

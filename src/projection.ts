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
  /** Stable source contribution key used to form one 消息单元. */
  messageKey: string;
  kind: "text";
  side: MessageSide;
  /** Durable source kind used by the Chat target. */
  origin?: "user" | "steering";
  text: string;
  pending?: boolean;
  time?: number;
  replyTo?: string;
}

export interface TimelineImage {
  id: string;
  /** Stable source key used when a durable ImageGen call settles into its attachment. */
  projectionKey?: string;
  /** Stable source contribution key used to form one 消息单元. */
  messageKey: string;
  kind: "image";
  side: MessageSide;
  /** Durable source kind used by the Chat target. */
  origin?: "user" | "steering";
  state: "loading" | "ready" | "failed" | "running";
  attachment?: ImageAttachmentRef;
  /** Page-local preview owned by the Session submission controller. */
  previewUrl?: string;
  alt: string;
  error?: string;
  time?: number;
}

export interface TimelineVoice {
  id: string;
  projectionKey?: string;
  /** Stable source contribution key used to form one 消息单元. */
  messageKey: string;
  kind: "voice";
  side: "incoming";
  text: string;
  status: "preparing";
  time?: number;
}

export interface TimelineNotice {
  id: string;
  projectionKey?: string;
  /** Stable source contribution key; notices normally remain standalone. */
  messageKey: string;
  kind: "notice";
  side: "incoming";
  tone: "info" | "error";
  text: string;
  time?: number;
}

/** A quiet, durable completion marker for automatic conversation organization. */
export interface TimelineContinuityRecord extends ContinuityRecord {}

export type TimelineItem = TimelineText | TimelineImage | TimelineVoice | TimelineNotice | TimelineContinuityRecord;

/** One speaker contribution as presented in the Companion transcript. */
export interface TimelineMessageUnit {
  /** Stable render identity. */
  id: string;
  side: MessageSide;
  /** Source-order content; consecutive images are collapsed by the view. */
  items: readonly TimelineItem[];
  pending?: boolean;
  origin?: "user" | "steering";
  time?: number;
}

export interface CompanionProjection {
  items: readonly TimelineItem[];
  /** Canonical grouped presentation projection for the Companion transcript. */
  messageUnits: readonly TimelineMessageUnit[];
  pendingCount: number;
  running: boolean;
  status: "ready" | "working" | "reconnecting";
  openState: "cold" | "loading" | "open" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  promptError?: string;
  /** Stable identity for a prompt result, used to distinguish a new rejection. */
  promptErrorKey?: string;
  /** Original prompt operation, when the runtime provides it. */
  promptErrorOp?: string;
  /** Public prompt error code, retained so admission failures can be distinguished from carrier internals. */
  promptErrorCode?: string;
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

function rpcIdOf(node: Record<string, unknown>): string | undefined {
  const direct = node.rpcId;
  if (typeof direct === "string") return direct;
  const source = asRecord(node.source);
  return typeof source?.rpcId === "string" ? source.rpcId : undefined;
}

/** Keep the render identity of a correlated outgoing contribution across its handoff. */
function messageKeyFor(authoritativeId: string, rpcId?: string): string {
  return rpcId ? `submission:${rpcId}` : authoritativeId;
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

function visibleAssistantText(value: string, passage = parseTtsPassage(value, true)): string {
  return passage ? `${value.slice(0, passage.start)}${value.slice(passage.end)}`.trim() : value;
}

/** Preserve structured assistant text/image order while keeping one source key. */
function assistantContentItems(node: Record<string, unknown>, id: string, time?: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const blocks = contentOf(node);
  if (blocks.length === 0) {
    const text = assistantText(node);
    const passage = parseTtsPassage(text, true);
    const visible = visibleAssistantText(text, passage);
    if (visible) items.push({ id, messageKey: id, kind: "text", side: "incoming", text: visible, time });
    if (passage) items.push({ id: ttsProjectionId(id, passage), projectionKey: ttsProjectionId(id, passage), messageKey: id, kind: "voice", side: "incoming", text: passage.text, status: "preparing", time });
    if (!items.some((item) => item.kind === "image")) items.push(...nodeMedia(node, id, "incoming", time, undefined, id));
    return items;
  }

  let voice: TimelineVoice | undefined;
  let textIndex = 0;
  const textBlockCount = blocks.filter((value) => {
    const record = asRecord(value);
    return record && (record.kind === "text" || record.type === "text");
  }).length;
  // Some Chat snapshots carry a direct text field alongside structured image
  // blocks. Keep that text instead of silently dropping it; the field is the
  // source contribution's leading text when no structured text block exists.
  const directText = textFromValue(node.text);
  if (directText && textBlockCount === 0) {
    const passage = parseTtsPassage(directText, true);
    const visible = visibleAssistantText(directText, passage);
    if (visible) {
      items.push({ id, messageKey: id, kind: "text", side: "incoming", text: visible, time });
      textIndex += 1;
    }
    if (passage) voice = { id: ttsProjectionId(id, passage), projectionKey: ttsProjectionId(id, passage), messageKey: id, kind: "voice", side: "incoming", text: passage.text, status: "preparing", time };
  }
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    const blockKind = typeof record.kind === "string" ? record.kind : record.type;
    const attachment = imageFromContent([record]);
    if (attachment) {
      const imageIndex = items.filter((item): item is TimelineImage => item.kind === "image").length;
      items.push({
        id: imageProjectionId(id, imageIndex),
        messageKey: id,
        kind: "image",
        side: "incoming",
        state: "ready",
        attachment,
        alt: attachment.name ?? "Companion 图片",
        time,
      });
      continue;
    }
    if (blockKind !== "text") continue;
    const text = textFromValue(record) ?? "";
    if (!text) continue;
    const passage = parseTtsPassage(text, true);
    const visible = visibleAssistantText(text, passage);
    if (visible) {
      const textId = textIndex === 0 && textBlockCount === 1 ? id : `${id}:text:${textIndex}`;
      items.push({ id: textId, messageKey: id, kind: "text", side: "incoming", text: visible, time });
      textIndex += 1;
    }
    if (passage && !voice) voice = { id: ttsProjectionId(id, passage), projectionKey: ttsProjectionId(id, passage), messageKey: id, kind: "voice", side: "incoming", text: passage.text, status: "preparing", time };
  }
  if (voice) items.push(voice);
  if (!items.some((item) => item.kind === "image")) items.push(...nodeMedia(node, id, "incoming", time, undefined, id));
  return items;
}

function nodeMedia(node: Record<string, unknown>, id: string, side: MessageSide, time?: number, origin?: "user" | "steering", messageKey = id): TimelineItem[] {
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
        messageKey,
        kind: "image",
        side,
        ...(origin ? { origin } : {}),
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
    items.push({ id: imageProjectionId(id, 0), messageKey, kind: "image", side, ...(origin ? { origin } : {}), state: "ready", attachment, alt: attachment.name ?? "图片", time });
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
  const observedRpcIds = new Set<string>();
  const durableRpcIds = new Set<string>();
  for (const node of normalizedNodes) {
    if (!node || (!isUserNode(node) && !isSteeringNode(node))) continue;
    const rpcId = rpcIdOf(node);
    if (rpcId) {
      observedRpcIds.add(rpcId);
      durableRpcIds.add(rpcId);
    }
  }
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
      const messageKey = messageKeyFor(id, rpcIdOf(node));
      if (text) items.push({ id, messageKey, kind: "text", side: "outgoing", origin: "user", text, time });
      items.push(...nodeMedia(node, id, "outgoing", time, "user", messageKey));
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    if (isAssistantNode(node)) {
      if (!isFinalized(node)) {
        if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
        continue;
      }
      items.push(...assistantContentItems(node, id, time));
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    if (isSteeringNode(node)) {
      const text = textFromValue(node.text) ?? textFromValue(node.content) ?? "";
      const messageId = typeof node.messageId === "string" ? node.messageId : undefined;
      if (messageId) admittedQueueIds.add(messageId);
      const messageKey = messageKeyFor(id, rpcIdOf(node));
      if (text) items.push({ id, projectionKey: id, messageKey, kind: "text", side: "outgoing", origin: "steering", text, time });
      items.push(...nodeMedia(node, id, "outgoing", time, "steering", messageKey));
      if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
      continue;
    }
    const call = asRecord(node.call);
    const image = recognizeImageGenResult({ ...node, name: node.name ?? node.toolName ?? call?.name, callId: node.callId ?? nodeId(node, id) }, id);
    if (image) {
      const projectionId = image.attachment ? imageGenProjectionId(image.id, image.attachment.attachmentId) : `imagegen:${image.id}`;
      items.push({ id: projectionId, projectionKey: `imagegen:${image.id}`, messageKey: `imagegen:${image.id}`, kind: "image", side: "incoming", state: image.state, attachment: image.attachment, alt: image.alt, error: image.error, time });
    }
    if (sequence !== undefined) emitContinuityRecords((anchorSeq) => anchorSeq === sequence);
  }
  for (const record of continuityRecords) if (!emittedRecords.has(record.id)) items.push(record);
  const pending = pendingNodes(snapshot);
  for (const value of pending) {
    const row = asRecord(value);
    if (typeof row?.rpcId === "string") observedRpcIds.add(row.rpcId);
  }
  const pendingSubmissions = Array.isArray(root.pendingSubmissions) ? root.pendingSubmissions : [];
  for (const value of pendingSubmissions) {
    const submission = asRecord(value);
    if (!submission || typeof submission.requestId !== "string" || observedRpcIds.has(submission.requestId)) continue;
    const text = typeof submission.text === "string" ? submission.text : "";
    const time = typeof submission.time === "number" ? submission.time : undefined;
    const baseId = `submission:${submission.requestId}`;
    if (text) items.push({ id: `${baseId}:text`, messageKey: baseId, kind: "text", side: "outgoing", origin: "user", text, time });
    const images = Array.isArray(submission.images) ? submission.images : [];
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = asRecord(images[imageIndex]);
      if (!image || typeof image.previewUrl !== "string") continue;
      items.push({
        id: `${baseId}:image:${imageIndex}`,
        messageKey: baseId,
        kind: "image",
        side: "outgoing",
        origin: "user",
        state: "ready",
        previewUrl: image.previewUrl,
        alt: typeof image.name === "string" && image.name ? image.name : "图片",
        time,
      });
    }
  }
  for (let index = 0; index < pending.length; index += 1) {
    const row = asRecord(pending[index]);
    if (!row) continue;
    const identity = typeof row.messageId === "string" ? row.messageId : typeof row.id === "string" ? row.id : `pending-${index}`;
    if (admittedQueueIds.has(identity)) continue;
    const rpcId = typeof row.rpcId === "string" ? row.rpcId : undefined;
    if (rpcId && durableRpcIds.has(rpcId)) continue;
    const text = typeof row.text === "string" ? row.text : textFromValue(row.content) ?? "";
    const pendingKey = `pending:${identity}`;
    const messageKey = messageKeyFor(pendingKey, rpcId);
    if (text) items.push({ id: pendingKey, messageKey, kind: "text", side: "outgoing", text, pending: true });
    const content = Array.isArray(row.content) ? row.content : [];
    items.push(...nodeMedia({ id: identity, content }, identity, "outgoing", undefined, undefined, messageKey));
  }
  const promptError = asRecord(root.promptError);
  const promptErrorKey = promptError ? stableValueKey(root.promptError) : undefined;
  const error = asRecord(promptError?.error);
  const promptErrorCode = typeof error?.code === "string" ? error.code : undefined;
  const promptErrorNotice = promptError?.op === "stop"
    ? "暂时停不下来，请再试一次。"
    : "这条消息没发出去，可以再试一次。";
  const promptErrorAnnouncement = promptError?.op === "stop"
    ? "暂时停不下来，请再试一次。"
    : promptError ? "这条消息没发出去，可以再试一次。" : undefined;
  if (promptError) {
    items.push({ id: "prompt-error", messageKey: "prompt-error", kind: "notice", side: "incoming", tone: "error", text: promptErrorNotice });
  }
  const lastError = typeof root.lastAgentError === "string" ? root.lastAgentError : undefined;
  if (lastError) items.push({ id: "agent-error", messageKey: "agent-error", kind: "notice", side: "incoming", tone: "error", text: lastError });
  const openState = root.openState === "error" ? "error" : root.openState === "loading" ? "loading" : root.openState === "cold" ? "cold" : "open";
  const running = root.running === true;
  const timeline = dedupeTimeline(items);
  return {
    items: timeline,
    messageUnits: groupTimelineItems(timeline),
    pendingCount: timeline.filter((item) => item.kind === "text" && item.pending).length,
    running,
    status: deriveStatus({ connected, running, openState }),
    openState,
    hasMore: root.hasMore === true,
    loadingOlder: root.loadingOlder === true,
    ...(promptErrorAnnouncement ? { promptError: promptErrorAnnouncement } : {}),
    ...(promptErrorKey ? { promptErrorKey } : {}),
    ...(typeof promptError?.op === "string" ? { promptErrorOp: promptError.op } : {}),
    ...(promptErrorCode ? { promptErrorCode } : {}),
    ...(lastError ? { lastAgentError: lastError } : {}),
  };
}

/** Group a canonical flat projection into stable speaker contributions. */
export function groupTimelineItems(items: readonly TimelineItem[]): TimelineMessageUnit[] {
  const groups: TimelineMessageUnit[] = [];
  const positions = new Map<string, number>();
  for (const item of items) {
    const key = item.messageKey;
    const position = positions.get(key);
    if (position === undefined) {
      const unit: TimelineMessageUnit = {
        id: key,
        side: item.side,
        items: [item],
        ...(item.kind === "text" && item.pending ? { pending: true } : {}),
        ...(item.kind === "text" && item.origin ? { origin: item.origin } : {}),
        ...(item.time === undefined ? {} : { time: item.time }),
      };
      positions.set(key, groups.length);
      groups.push(unit);
      continue;
    }
    const current = groups[position]!;
    const nextItems = [...current.items, item];
    groups[position] = {
      ...current,
      items: nextItems,
      ...(current.pending || (item.kind === "text" && item.pending) ? { pending: true } : {}),
    };
  }
  return groups;
}

function stableValueKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
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

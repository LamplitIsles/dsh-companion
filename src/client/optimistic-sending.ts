import type { CompanionProjection, TimelineImage, TimelineItem, TimelineText } from "../projection.js";
import type { CompanionImageDraft } from "./image-drafts.js";

/**
 * The local unit for one ordinary Companion submission.  Image drafts stay
 * owned by this object until a durable echo replaces it or the batch is
 * restored to the composer.
 */
export interface SendingBatch {
  id: string;
  sessionId?: string;
  text: string;
  restoreText: string;
  images: readonly CompanionImageDraft[];
  baselineIds: ReadonlySet<string>;
  baselinePromptError?: string;
  baselinePromptErrorKey?: string;
  baselinePromptErrorCode?: string;
  admission: "sending" | "accepted" | "transport-ambiguous";
  sawReconnect: boolean;
  lastStatus?: CompanionProjection["status"];
}

export interface SendingBatchInput {
  sessionId?: string;
  text: string;
  restoreText?: string;
  images: readonly CompanionImageDraft[];
  projection: CompanionProjection;
}

export type SendingBatchDecision = "keep" | "confirm" | "reject";

export interface SendingBatchObservation {
  batch: SendingBatch;
  decision: SendingBatchDecision;
  reason?: "durable-echo" | "prompt-rejection" | "authoritative-absence";
}

let batchSequence = 0;

function nextBatchId(): string {
  const cryptoApi = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto : undefined;
  return cryptoApi?.randomUUID() ?? `sending-${Date.now().toString(36)}-${(++batchSequence).toString(36)}`;
}

export function createSendingBatch(input: SendingBatchInput): SendingBatch {
  return {
    id: nextBatchId(),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    text: input.text,
    restoreText: input.restoreText ?? input.text,
    images: [...input.images],
    baselineIds: new Set(input.projection.items.map((item) => item.id)),
    ...(input.projection.promptError === undefined ? {} : { baselinePromptError: input.projection.promptError }),
    ...(input.projection.promptErrorKey === undefined ? {} : { baselinePromptErrorKey: input.projection.promptErrorKey }),
    ...(input.projection.promptErrorCode === undefined ? {} : { baselinePromptErrorCode: input.projection.promptErrorCode }),
    admission: "sending",
    sawReconnect: false,
    lastStatus: input.projection.status,
  };
}

export function markSendingBatchAccepted(batch: SendingBatch): SendingBatch {
  return { ...batch, admission: "accepted" };
}

export function markSendingBatchTransportAmbiguous(batch: SendingBatch): SendingBatch {
  return { ...batch, admission: "transport-ambiguous" };
}

function optimisticId(batch: SendingBatch, suffix: string): string {
  return `optimistic:${batch.id}:${suffix}`;
}

/** Project the batch into the same outgoing row vocabulary as durable chat. */
export function projectSendingBatch(batch: SendingBatch): TimelineItem[] {
  const items: TimelineItem[] = [];
  if (batch.text) {
    const text: TimelineText = {
      id: optimisticId(batch, "text"),
      projectionKey: optimisticId(batch, "text"),
      kind: "text",
      side: "outgoing",
      text: batch.text,
      optimistic: true,
    };
    items.push(text);
  }
  batch.images.forEach((draft, index) => {
    const image: TimelineImage = {
      id: optimisticId(batch, `image:${index}`),
      projectionKey: optimisticId(batch, `image:${index}`),
      kind: "image",
      side: "outgoing",
      optimistic: true,
      state: "ready",
      previewUrl: draft.previewUrl,
      alt: draft.file.name || "图片",
    };
    items.push(image);
  });
  return items;
}

export function mergeSendingBatch(projection: CompanionProjection, batch: SendingBatch | undefined): CompanionProjection {
  if (!batch) return projection;
  const items = projection.items.filter((item) => !(item.kind === "text" && item.pending && item.text === batch.text && !batch.baselineIds.has(item.id)));
  return { ...projection, items: [...items, ...projectSendingBatch(batch)] };
}

function durableOutgoing(item: TimelineItem): item is TimelineText | TimelineImage {
  if (item.side !== "outgoing" || item.optimistic) return false;
  if (item.kind === "text") return !item.pending && item.origin !== "steering";
  return item.state === "ready" && item.origin !== "steering" && Boolean(item.attachment);
}

function imageMatches(item: TimelineImage, draft: CompanionImageDraft): boolean {
  const attachment = item.attachment;
  if (!attachment || attachment.mediaType !== draft.file.type) return false;
  // Attachment names are optional at the Host boundary. Compare them only
  // when both sides carry one, while media type/order still form the shape.
  return !attachment.name || !draft.file.name || attachment.name === draft.file.name;
}

/**
 * Match only durable outgoing rows that were not present when the batch was
 * sent. This prevents an old identical message from confirming a new batch.
 */
export function matchesDurableSendingBatch(projection: CompanionProjection, batch: SendingBatch): boolean {
  const candidates = projection.items.filter((item) => !batch.baselineIds.has(item.id) && durableOutgoing(item));
  const texts = candidates.filter((item): item is TimelineText => item.kind === "text");
  const images = candidates.filter((item): item is TimelineImage => item.kind === "image");
  if (batch.text ? texts.length !== 1 || texts[0]?.text !== batch.text : texts.length !== 0) return false;
  if (images.length !== batch.images.length) return false;
  return batch.images.every((draft, index) => imageMatches(images[index]!, draft));
}

export function hasNewPromptError(projection: CompanionProjection, batch: SendingBatch): boolean {
  const currentKey = projection.promptErrorKey;
  return currentKey !== undefined
    ? currentKey !== batch.baselinePromptErrorKey
    : (projection.promptError !== undefined && projection.promptError !== batch.baselinePromptError)
      || projection.promptErrorCode !== batch.baselinePromptErrorCode;
}

function hasNewPromptRejection(projection: CompanionProjection, batch: SendingBatch): boolean {
  // Session folds carrier exceptions into a public `internal` prompt error.
  // That result is ambiguous even though its operation is still `send`.
  if (projection.promptErrorCode === "internal") return false;
  if (!hasNewPromptError(projection, batch)) return false;
  // The Session runtime projects ordinary admission failures as op:"send".
  // Stop failures share the same error slot but must never roll a batch back.
  return projection.promptErrorOp === "send";
}

/**
 * Observe one authoritative projection and classify the batch. Transport
 * ambiguity is resolved only after a reconnecting→open refresh with no echo.
 */
export function observeSendingBatch(projection: CompanionProjection, input: SendingBatch): SendingBatchObservation {
  if (matchesDurableSendingBatch(projection, input)) {
    return { batch: { ...input, lastStatus: projection.status }, decision: "confirm", reason: "durable-echo" };
  }
  if (hasNewPromptRejection(projection, input)) {
    return { batch: { ...input, lastStatus: projection.status }, decision: "reject", reason: "prompt-rejection" };
  }
  const sawReconnect = input.sawReconnect || projection.status === "reconnecting";
  const refreshed = input.admission === "transport-ambiguous"
    && input.sawReconnect
    && input.lastStatus === "reconnecting"
    && projection.status !== "reconnecting"
    && projection.openState === "open";
  return {
    batch: { ...input, sawReconnect, lastStatus: projection.status },
    decision: refreshed ? "reject" : "keep",
    ...(refreshed ? { reason: "authoritative-absence" } : {}),
  };
}

import { describe, expect, it } from "vitest";
import type { CompanionProjection } from "../src/projection.js";
import {
  createSendingBatch,
  markSendingBatchTransportAmbiguous,
  matchesDurableSendingBatch,
  mergeSendingBatch,
  observeSendingBatch,
  projectSendingBatch,
} from "../src/client/optimistic-sending.js";

const base = (patch: Partial<CompanionProjection> = {}): CompanionProjection => ({
  items: [], pendingCount: 0, running: false, status: "ready", openState: "open", hasMore: false, loadingOlder: false, ...patch,
});
function draft(name: string, type = "image/png") {
  return { id: name, file: { name, type, size: 1 } as File, previewUrl: `blob:${name}` };
}

describe("optimistic sending batches", () => {
  it("matches only newly projected durable text and image shape", () => {
    const before = base({ items: [{ id: "old", kind: "text", side: "outgoing", text: "看这里" }] });
    const batch = createSendingBatch({ sessionId: "session-a", text: "看这里", images: [draft("one.png"), draft("two.png")], projection: before });
    expect(matchesDurableSendingBatch(base({ items: [
      { id: "old", kind: "text", side: "outgoing", text: "看这里" },
      { id: "new", kind: "text", side: "outgoing", origin: "user", text: "看这里" },
      { id: "image:new:0", kind: "image", side: "outgoing", origin: "user", state: "ready", attachment: { attachmentId: "a" as never, mediaType: "image/png", bytes: 1, width: 1, height: 1, name: "one.png" }, alt: "one.png" },
      { id: "image:new:1", kind: "image", side: "outgoing", origin: "user", state: "ready", attachment: { attachmentId: "b" as never, mediaType: "image/png", bytes: 1, width: 1, height: 1, name: "two.png" }, alt: "two.png" },
    ] }), batch)).toBe(true);
    expect(projectSendingBatch(batch).map((item) => ({ kind: item.kind, pending: item.kind === "text" ? item.pending : undefined }))).toEqual([
      { kind: "text", pending: undefined }, { kind: "image", pending: undefined }, { kind: "image", pending: undefined },
    ]);
  });

  it("does not confirm an old or mismatched durable row", () => {
    const before = base({ items: [{ id: "old", kind: "text", side: "outgoing", text: "相同内容" }] });
    const batch = createSendingBatch({ text: "相同内容", images: [], projection: before });
    expect(matchesDurableSendingBatch(before, batch)).toBe(false);
    expect(matchesDurableSendingBatch(base({ items: [{ id: "new", kind: "text", side: "outgoing", origin: "user", text: "另一条" }] }), batch)).toBe(false);
    expect(matchesDurableSendingBatch(base({ items: [{ id: "new", kind: "text", side: "outgoing", origin: "steering", text: "相同内容" }] }), batch)).toBe(false);
  });

  it("keeps transport ambiguity through reconnecting and restores only after refresh", () => {
    const batch = markSendingBatchTransportAmbiguous(createSendingBatch({ text: "不确定", images: [], projection: base() }));
    const reconnecting = observeSendingBatch({ ...base(), status: "reconnecting" }, batch);
    expect(reconnecting.decision).toBe("keep");
    expect(reconnecting.batch.sawReconnect).toBe(true);
    const refreshed = observeSendingBatch(base(), reconnecting.batch);
    expect(refreshed).toMatchObject({ decision: "reject", reason: "authoritative-absence" });
  });

  it("recognizes a new explicit prompt rejection", () => {
    const batch = createSendingBatch({ text: "会失败", images: [], projection: base({ promptErrorKey: "old" }) });
    expect(observeSendingBatch(base({ promptErrorKey: "new", promptErrorOp: "prompt", promptError: "失败" }), batch)).toMatchObject({ decision: "reject", reason: "prompt-rejection" });
    expect(observeSendingBatch(base({ promptErrorKey: "stop", promptErrorOp: "stop", promptError: "停止失败" }), batch).decision).toBe("keep");
  });

  it("merges the overlay without changing the Host pending count", () => {
    const projection = base({ pendingCount: 2 });
    const batch = createSendingBatch({ text: "立即出现", images: [], projection });
    expect(mergeSendingBatch(projection, batch)).toMatchObject({ pendingCount: 2, items: [expect.objectContaining({ text: "立即出现", optimistic: true })] });
  });
});

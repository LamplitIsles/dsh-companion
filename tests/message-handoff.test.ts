import { describe, expect, it } from "vitest";
import { SubmissionHandoff } from "../src/client/submission-handoff.js";
import { projectConversation } from "../src/projection.js";

const chat = (entries: readonly [string, string, string][] = []) => ({
  order: entries.map(([key]) => key),
  nodes: new Map(entries.map(([key, rpcId, text], index) => [key, {
    key,
    kind: "user",
    visibility: "visible",
    data: { seq: index + 1, source: { kind: "user", rpcId }, content: [{ type: "text", text }] },
  }])),
});

function outgoingCount(snapshot: unknown): number {
  return projectConversation(snapshot).items.filter((item) => item.kind === "text" && item.side === "outgoing").length;
}

describe("SubmissionHandoff", () => {
  it("keeps an idle transcript echo until Chat publishes its durable node", () => {
    const handoff = new SubmissionHandoff();
    const pending = [{ requestId: "req-idle", placement: "transcript", time: 10, text: "直接发送", images: [] }];

    const optimistic = handoff.merge({ sessionId: "session-1", pendingSubmissions: pending, queue: [] }, chat());
    handoff.retire("req-idle", "observed");
    const betweenStores = handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: [] }, chat());
    const durable = handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: [] }, chat([["durable-idle", "req-idle", "直接发送"]]));

    expect([optimistic, betweenStores, durable].map(outgoingCount)).toEqual([1, 1, 1]);
  });

  it("keeps a submission visible while separately published Session and Chat snapshots hand it off", () => {
    const handoff = new SubmissionHandoff();
    const pending = [{ requestId: "req-1", placement: "transcript", time: 10, text: "不要闪", images: [] }];
    const queued = [{ id: "queue-1", messageId: "queue-1", placement: "queued", rpcId: "req-1", content: [{ type: "text", text: "不要闪" }], preview: "不要闪", text: "不要闪" }];

    const projected = [
      handoff.merge({ sessionId: "session-1", pendingSubmissions: pending, queue: [] }, chat()),
      handoff.merge({ sessionId: "session-1", pendingSubmissions: pending, queue: queued }, chat()),
      handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: queued }, chat()),
      handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: [] }, chat()),
      handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: [] }, chat([["durable-1", "req-1", "不要闪"]])),
    ];

    expect(projected.map(outgoingCount)).toEqual([1, 1, 1, 1, 1]);
    expect(projected.map((snapshot) => projectConversation(snapshot).messageUnits.map((unit) => unit.id))).toEqual([
      ["submission:req-1"],
      ["submission:req-1"],
      ["submission:req-1"],
      ["submission:req-1"],
      ["submission:req-1"],
    ]);
    expect(projected.map((snapshot) => {
      const item = projectConversation(snapshot).items.find((candidate) => candidate.kind === "text" && candidate.messageKey === "submission:req-1");
      return item?.kind === "text" ? item.waitsForCurrentReply : undefined;
    })).toEqual([
      false,
      false,
      false,
      false,
      undefined,
    ]);
  });

  it("retains queued admission through queue handoff after the local echo retires", () => {
    const handoff = new SubmissionHandoff();
    const pending = [{ requestId: "req-active", placement: "queued", time: 10, text: "等我说完", images: [] }];
    const queued = [{ id: "queue-active", messageId: "queue-active", placement: "queued", rpcId: "req-active", content: [{ type: "text", text: "等我说完" }], preview: "等我说完", text: "等我说完" }];

    const beforeRetirement = handoff.merge({ sessionId: "session-1", pendingSubmissions: pending, queue: queued }, chat());
    handoff.retire("req-active", "observed");
    const afterRetirement = handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: queued }, chat());

    for (const snapshot of [beforeRetirement, afterRetirement]) {
      const item = projectConversation(snapshot).items.find((candidate) => candidate.kind === "text" && candidate.messageKey === "submission:req-active");
      expect(item?.kind === "text" ? item.waitsForCurrentReply : undefined).toBe(true);
    }
  });

  it("drops a failed echo instead of retaining it as an unobserved handoff", () => {
    const handoff = new SubmissionHandoff();
    handoff.merge({
      sessionId: "session-1",
      pendingSubmissions: [{ requestId: "req-failed", placement: "transcript", time: 10, text: "失败消息", images: [] }],
      queue: [],
    }, chat());

    handoff.retire("req-failed", "failed");
    const failed = handoff.merge({ sessionId: "session-1", pendingSubmissions: [], queue: [] }, chat());

    expect(outgoingCount(failed)).toBe(0);
  });
});

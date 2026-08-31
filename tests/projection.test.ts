import { describe, expect, it } from "vitest";
import { projectConversation, reconcilePending, scrollPlan } from "../src/projection.js";

describe("chat projection", () => {
  it("shows human text, assistant text/media/voice and pending rows while hiding tools", () => {
    const result = projectConversation({ nodes: [
      { kind: "user", seq: 1, time: 1, content: [{ type: "text", text: "你好" }] },
      { kind: "assistant", seq: 2, time: 2, blocks: [{ kind: "text", text: "[[tts:text]]慢慢说[[/tts:text]]" }] },
      { kind: "tool-result", seq: 3, time: 3, callId: "x", call: { name: "shell", argsRaw: "{}" }, content: [], isError: false },
    ], queue: [{ id: "q", messageId: "m", text: "排队" }], running: true, openState: "open" }, true);
    expect(result.items.map((item) => item.kind)).toEqual(["text", "voice", "text"]);
    expect(result.items.find((item) => item.kind === "voice")).toMatchObject({ text: "慢慢说" });
    expect(result.pendingCount).toBe(1);
  });

  it("preserves a reader anchor and offers new-message affordance", () => {
    expect(scrollPlan({ scrollTop: 20, scrollHeight: 1000, clientHeight: 600 })).toMatchObject({ follow: false, preserveAnchor: true, showNewMessageAffordance: true });
    expect(scrollPlan({ scrollTop: 395, scrollHeight: 1000, clientHeight: 600 })).toMatchObject({ follow: true });
    expect(scrollPlan({ scrollTop: 0, scrollHeight: 500, clientHeight: 300, prepending: true, previousHeight: 500 })).toMatchObject({ preserveAnchor: true, follow: false });
  });

  it("reconciles a pending identity only after its durable message arrives", () => {
    expect(reconcilePending([{ id: "pending:m", kind: "text", side: "outgoing", text: "x", pending: true }], new Set(["m"]))).toEqual([]);
  });

  it("keeps one keyed ImageGen row while a call settles", () => {
    const running = projectConversation({ nodes: [{ kind: "tool-call", seq: 1, callId: "call-1", name: "kepos_image_generate", state: "running" }] });
    const ready = projectConversation({ nodes: [{ kind: "tool-result", seq: 1, callId: "call-1", name: "kepos_image_generate", content: [{ type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } }] }] });
    const replay = projectConversation({ nodes: [
      { kind: "tool-call", seq: 1, callId: "call-1", name: "kepos_image_generate", state: "running" },
      { kind: "tool-result", seq: 2, callId: "call-1", name: "kepos_image_generate", content: [{ type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } }] },
    ] });
    expect(running.items[0]).toMatchObject({ id: "imagegen:call-1", projectionKey: "imagegen:call-1", state: "running" });
    expect(ready.items[0]).toMatchObject({ id: "imagegen:call-1:att-1", projectionKey: "imagegen:call-1", state: "ready" });
    expect(replay.items).toHaveLength(1);
    expect(replay.items[0]).toMatchObject({ id: "imagegen:call-1:att-1", state: "ready" });
  });

  it("normalizes keyed DSH Chat nodes, including admitted steering and invisible compaction", () => {
    const image = { attachmentId: "att-1", mediaType: "image/png", name: "海边的灯" };
    const nodes = new Map<string, unknown>([
      ["user-key", { key: "user-key", kind: "user", visibility: "visible", data: { seq: 1, time: 1, content: [{ type: "text", text: "你好" }] } }],
      ["assistant-key", { key: "assistant-key", kind: "assistant", visibility: "visible", data: { seq: 2, time: 2, blocks: [{ kind: "text", text: "收到" }, { kind: "image", attachment: image }] } }],
      ["imagegen-key", { key: "imagegen-key", kind: "tool-result", visibility: "visible", data: { seq: 3, time: 3, callId: "call-1", call: { name: "kepos_image_generate", argsRaw: "{}" }, content: [{ type: "image", attachment: image }], isError: false } }],
      ["steering-key", { key: "steering-key", kind: "steering", visibility: "visible", data: { seq: 4, time: 4, messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] } }],
      ["compaction-key", { key: "compaction-key", kind: "compaction", visibility: "visible", data: { seq: 5, time: 5, summary: "模型专用摘要" } }],
    ]);
    const result = projectConversation({ chat: { order: ["user-key", "assistant-key", "imagegen-key", "steering-key", "compaction-key"], nodes }, queue: [{ messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] }] });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "user-key", kind: "text", side: "outgoing", text: "你好" }),
      expect.objectContaining({ id: "assistant-key", kind: "text", side: "incoming", text: "收到" }),
      expect.objectContaining({ id: "image:assistant-key:0", kind: "image", attachment: image }),
      expect.objectContaining({ id: "imagegen:call-1:att-1", projectionKey: "imagegen:call-1", kind: "image", attachment: image }),
      expect.objectContaining({ id: "steering-key", projectionKey: "steering-key", kind: "text", side: "outgoing", text: "补充一句" }),
    ]));
    expect(result.items.some((item) => item.id === "pending:queued-1" || (item.kind === "text" && item.text === "模型专用摘要"))).toBe(false);
    expect(result.pendingCount).toBe(0);
  });

  it("hides a compaction marker between visible user and assistant messages without reordering either", () => {
    const result = projectConversation({ nodes: [
      { kind: "user", seq: 1, time: 1, content: [{ type: "text", text: "我今天有点累" }] },
      { kind: "compaction", seq: 2, time: 2, summary: "internal continuity checkpoint" },
      { kind: "assistant", seq: 3, time: 3, blocks: [{ kind: "text", text: "那我们慢一点。" }] },
    ] });
    expect(result.items.map((item) => item.kind === "text" ? [item.side, item.text] : item.kind)).toEqual([
      ["outgoing", "我今天有点累"],
      ["incoming", "那我们慢一点。"],
    ]);
  });

  it("hides reasoning blocks from finalized and streaming assistant messages", () => {
    const finalized = projectConversation({ nodes: [{
      kind: "assistant",
      seq: 1,
      blocks: [
        { kind: "reasoning", text: "先分析用户真正想问什么" },
        { kind: "text", text: "我在这里。" },
      ],
    }] });
    const streaming = projectConversation({ partial: {
      turn: 2,
      blocks: [
        { kind: "reasoning", text: "继续在内部推理" },
        { kind: "text", text: "慢慢说" },
      ],
    } });

    expect(finalized.items).toEqual([
      expect.objectContaining({ kind: "text", text: "我在这里。", streaming: false }),
    ]);
    expect(streaming.items).toEqual([
      expect.objectContaining({ kind: "text", text: "慢慢说", streaming: true }),
    ]);
  });

  it("keeps a queue row only until its keyed steering node arrives", () => {
    const queued = { chat: { order: [], nodes: new Map() }, queue: [{ messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] }] };
    const admitted = { chat: { order: ["steering-key"], nodes: new Map([["steering-key", { key: "steering-key", kind: "steering", visibility: "visible", data: { seq: 1, time: 1, messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] } }]]) }, queue: queued.queue };
    expect(projectConversation(queued).items).toContainEqual(expect.objectContaining({ id: "pending:queued-1", pending: true }));
    expect(projectConversation(admitted).items).toContainEqual(expect.objectContaining({ id: "steering-key", text: "补充一句" }));
    expect(projectConversation(admitted).items.some((item) => item.id === "pending:queued-1")).toBe(false);
  });

  it("uses the live connection observable even while a Session snapshot remains mounted", () => {
    const sessionSnapshot = { nodes: [{ kind: "assistant", seq: 1, text: "仍在这里" }], openState: "open", running: false };
    expect(projectConversation(sessionSnapshot, false).status).toBe("reconnecting");
    expect(projectConversation(sessionSnapshot, true).status).toBe("ready");
  });
});

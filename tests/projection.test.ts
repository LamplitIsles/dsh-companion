import { describe, expect, it } from "vitest";
import { projectConversation, scrollPlan } from "../src/projection.js";

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

  it("projects durable user image attachments onto the outgoing side", () => {
    const image = { attachmentId: "user-image", mediaType: "image/jpeg", name: "傍晚.jpg", bytes: 1, width: 1, height: 1 };
    const result = projectConversation({ nodes: [{ kind: "user", seq: 1, content: [{ type: "image", attachment: image }, { type: "text", text: "看这里" }] }] });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", side: "outgoing", text: "看这里" }),
      expect.objectContaining({ kind: "image", side: "outgoing", attachment: image, alt: "傍晚.jpg" }),
    ]));
  });

  it("projects one stable message unit for ordered text and image contributions", () => {
    const first = { attachmentId: "first", mediaType: "image/png", name: "first.png" };
    const second = { attachmentId: "second", mediaType: "image/png", name: "second.png" };
    const result = projectConversation({ nodes: [{ kind: "user", seq: 1, content: [
      { type: "text", text: "一起看看" },
      { type: "image", attachment: first },
      { type: "image", attachment: second },
    ] }] });
    expect(result.messageUnits).toHaveLength(1);
    expect(result.messageUnits?.[0]).toMatchObject({ id: "1", side: "outgoing", images: [
      expect.objectContaining({ attachment: first }),
      expect.objectContaining({ attachment: second }),
    ] });
    expect(result.messageUnits?.[0]?.items.map((item) => item.kind)).toEqual(["text", "image", "image"]);
  });

  it("keeps finalized assistant structured content in source order inside one unit", () => {
    const result = projectConversation({ nodes: [{ kind: "assistant", seq: 1, blocks: [
      { kind: "text", text: "先说一句" },
      { kind: "image", attachment: { attachmentId: "a", mediaType: "image/png" } },
      { kind: "text", text: "再补一句" },
      { kind: "image", attachment: { attachmentId: "b", mediaType: "image/png" } },
    ] }] });
    expect(result.messageUnits).toHaveLength(1);
    expect(result.messageUnits?.[0]?.items.map((item) => item.kind)).toEqual(["text", "image", "text", "image"]);
  });

  it("keeps direct assistant text when an image block shares the contribution", () => {
    const result = projectConversation({ nodes: [{ kind: "assistant", seq: 1, text: "先说一句", blocks: [
      { kind: "image", attachment: { attachmentId: "a", mediaType: "image/png" } },
    ] }] });
    expect(result.messageUnits?.[0]?.items.map((item) => item.kind)).toEqual(["text", "image"]);
    expect(result.messageUnits?.[0]?.items[0]).toMatchObject({ kind: "text", text: "先说一句" });
  });

  it("preserves a reader anchor and offers new-message affordance", () => {
    expect(scrollPlan({ scrollTop: 20, scrollHeight: 1000, clientHeight: 600 })).toMatchObject({ follow: false, preserveAnchor: true, showNewMessageAffordance: true });
    expect(scrollPlan({ scrollTop: 395, scrollHeight: 1000, clientHeight: 600 })).toMatchObject({ follow: true });
    expect(scrollPlan({ scrollTop: 0, scrollHeight: 500, clientHeight: 300, prepending: true, previousHeight: 500 })).toMatchObject({ preserveAnchor: true, follow: false });
  });

  it("projects alpha pending submissions as normal outgoing rows and atomically swaps by request id", () => {
    const pending = projectConversation({
      chat: { order: [], nodes: new Map() },
      pendingSubmissions: [{ requestId: "req-1", placement: "transcript", time: 10, text: "立即显示", images: [{ previewUrl: "blob:one", name: "one.png" }, { previewUrl: "blob:two", name: "two.png" }] }],
    });
    expect(pending.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "submission:req-1:text", side: "outgoing", text: "立即显示" }),
      expect.objectContaining({ id: "submission:req-1:image:0", side: "outgoing", previewUrl: "blob:one" }),
      expect.objectContaining({ id: "submission:req-1:image:1", side: "outgoing", previewUrl: "blob:two" }),
    ]));
    const durable = projectConversation({
      chat: { order: ["durable"], nodes: new Map([["durable", { key: "durable", kind: "user", visibility: "visible", data: { seq: 1, source: { kind: "user", rpcId: "req-1" }, content: [{ type: "text", text: "立即显示" }] } }]]) },
      pendingSubmissions: [{ requestId: "req-1", placement: "transcript", time: 10, text: "立即显示", images: [] }],
    });
    expect(durable.items.filter((item) => item.kind === "text" && item.side === "outgoing")).toHaveLength(1);
    expect(durable.items.some((item) => item.id.startsWith("submission:req-1"))).toBe(false);
  });

  it("hands a pending submission to its observed queue row without duplicate images", () => {
    const image = { attachmentId: "queued-image", mediaType: "image/png", name: "queued.png" };
    const result = projectConversation({
      pendingSubmissions: [{ requestId: "req-queued", placement: "queued", time: 10, text: "稍后发送", images: [{ previewUrl: "blob:queued", name: "queued.png" }] }],
      queue: [{ id: "queue-1", rpcId: "req-queued", content: [{ type: "image", attachment: image }, { type: "text", text: "稍后发送" }] }],
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pending:queue-1", kind: "text", side: "outgoing", text: "稍后发送", pending: true }),
      expect.objectContaining({ id: "image:queue-1:0", kind: "image", side: "outgoing", attachment: image }),
    ]));
    expect(result.items.some((item) => item.id.startsWith("submission:req-queued"))).toBe(false);
    expect(result.items.filter((item) => item.kind === "image" && item.side === "outgoing")).toHaveLength(1);
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

  it("shows only finalized assistant text and always hides reasoning", () => {
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

    const streamingNode = projectConversation({ nodes: [{ kind: "assistant", seq: 3, streaming: true, blocks: [{ kind: "text", text: "还没说完" }] }] });

    expect(finalized.items).toEqual([expect.objectContaining({ kind: "text", text: "我在这里。" })]);
    expect(streaming.items).toEqual([]);
    expect(streamingNode.items).toEqual([]);
  });

  it("keeps a queue row only until its keyed steering node arrives", () => {
    const queued = { chat: { order: [], nodes: new Map() }, queue: [{ messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] }] };
    const admitted = { chat: { order: ["steering-key"], nodes: new Map([["steering-key", { key: "steering-key", kind: "steering", visibility: "visible", data: { seq: 1, time: 1, messageId: "queued-1", content: [{ type: "text", text: "补充一句" }] } }]]) }, queue: queued.queue };
    expect(projectConversation(queued).items).toContainEqual(expect.objectContaining({ id: "pending:queued-1", pending: true }));
    expect(projectConversation(admitted).items).toContainEqual(expect.objectContaining({ id: "steering-key", text: "补充一句" }));
    expect(projectConversation(admitted).items.some((item) => item.id === "pending:queued-1")).toBe(false);
  });

  it("reports a rejected stop as a stop failure instead of a send failure", () => {
    const result = projectConversation({
      promptError: { op: "stop", error: { message: "cancel-rejected" } },
    });

    expect(result.promptError).toBe("暂时停不下来，请再试一次。");
    expect(result.items).toContainEqual(expect.objectContaining({
      id: "prompt-error",
      text: "暂时停不下来，请再试一次。",
    }));

    const rejectedSend = projectConversation({
      promptError: { op: "send", error: { code: "attachment-error", message: "host-send-rejected", details: { reason: "fixture" } } },
    });
    expect(rejectedSend.promptErrorOp).toBe("send");
    expect(rejectedSend.promptErrorCode).toBe("attachment-error");
    expect(rejectedSend.items).toContainEqual(expect.objectContaining({ text: "这条消息没发出去，可以再试一次。" }));

    const carrierFailure = projectConversation({
      promptError: { op: "send", error: { code: "internal", message: "carrier unavailable", details: {} } },
    });
    expect(carrierFailure.promptErrorOp).toBe("send");
    expect(carrierFailure.promptErrorCode).toBe("internal");
  });

  it("uses the live connection observable even while a Session snapshot remains mounted", () => {
    const sessionSnapshot = { nodes: [{ kind: "assistant", seq: 1, text: "仍在这里" }], openState: "open", running: false };
    expect(projectConversation(sessionSnapshot, false).status).toBe("reconnecting");
    expect(projectConversation(sessionSnapshot, true).status).toBe("ready");
  });
});

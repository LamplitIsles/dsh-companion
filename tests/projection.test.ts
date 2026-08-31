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
    expect(running.items[0]).toMatchObject({ id: "imagegen:call-1", projectionKey: "imagegen:call-1", state: "running" });
    expect(ready.items[0]).toMatchObject({ id: "imagegen:call-1:att-1", projectionKey: "imagegen:call-1", state: "ready" });
  });
});

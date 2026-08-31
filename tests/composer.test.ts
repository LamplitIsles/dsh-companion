import { describe, expect, it } from "vitest";
import { createComposerState, reduceComposer, shouldSubmitEnter } from "../src/client/composer.js";
import { queueCompanionPrompt } from "../src/client/admission.js";
import { relationshipControlsWritable } from "../src/client/settings.js";

describe("IME composer", () => {
  it("does not submit while composing and submits once after composition", () => {
    let state = createComposerState("你好");
    state = reduceComposer(state, { type: "compositionstart" });
    expect(shouldSubmitEnter({ key: "Enter", isComposing: true }, state.composing)).toBe(false);
    state = reduceComposer(state, { type: "compositionend", value: "你好呀" });
    expect(shouldSubmitEnter({ key: "Enter" }, state.composing)).toBe(true);
    state = reduceComposer(state, { type: "submit" });
    expect(state).toMatchObject({ draft: "", lastSubmitted: "你好呀" });
  });
});

it("keeps relationship recovery controls writable only for an idle writable settings scope", () => {
  expect(relationshipControlsWritable(false, false)).toBe(true);
  expect(relationshipControlsWritable(true, false)).toBe(false);
  expect(relationshipControlsWritable(false, true)).toBe(false);
});

describe("Companion admission", () => {
  it.each([false, true])("queues a text message while session running=%s", async (running) => {
    const calls: unknown[][] = [];
    await queueCompanionPrompt({ prompt: async (...args) => { calls.push(args); return { ok: true }; } }, `消息-${running}`);
    expect(calls).toEqual([[[{ type: "text", text: `消息-${running}` }], "queue"]]);
  });

  it("surfaces rejection so the Svelte caller retains the draft", async () => {
    await expect(queueCompanionPrompt({ prompt: async () => ({ ok: false, error: { message: "rejected" } }) }, "保留我")).rejects.toThrow("rejected");
  });
});

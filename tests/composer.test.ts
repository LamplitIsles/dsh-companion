import { describe, expect, it } from "vitest";
import { createComposerState, reduceComposer, shouldSubmitEnter } from "../src/client/composer.js";

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

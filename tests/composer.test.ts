import { describe, expect, it } from "vitest";
import { createComposerState, findComposerCommand, reduceComposer, shouldSubmitEnter } from "../src/client/composer.js";
import { queueCompanionPrompt, submitCompanionInput } from "../src/client/admission.js";
import { changedSettingsPayload, mergeCleanSettingsDraft, relationshipControlsWritable } from "../src/client/settings.js";
import { companionSessionOpenPlan } from "../src/client/session-opening.js";

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

describe("Companion command completion", () => {
  it("offers /compact only for a non-whitespace slash prefix", () => {
    expect(findComposerCommand("/")).toMatchObject({ command: "/compact", label: "整理当前对话", description: "整理记忆，让下一段对话自然接续" });
    expect(findComposerCommand("/comp")).toMatchObject({ command: "/compact" });
    expect(findComposerCommand("/compact ")).toBeUndefined();
    expect(findComposerCommand("/unknown")).toBeUndefined();
    expect(findComposerCommand("普通消息")).toBeUndefined();
  });
});

it("keeps relationship recovery controls writable only for an idle writable settings scope", () => {
  expect(relationshipControlsWritable(false, false)).toBe(true);
  expect(relationshipControlsWritable(true, false)).toBe(false);
  expect(relationshipControlsWritable(false, true)).toBe(false);
});

it("retains staged settings while clean fields follow a refreshed Host baseline", () => {
  const before = { workspaceId: "one", companionName: "Mio", userName: "Neil", preferredAddress: "你", defaultAffinity: 50 };
  const draft = { ...before, companionName: "Mio!" };
  const refreshed = { ...before, workspaceId: "two", userName: "N" };
  expect(mergeCleanSettingsDraft(draft, before, refreshed)).toEqual({ ...refreshed, companionName: "Mio!" });
  expect(changedSettingsPayload(draft, before)).toEqual({ companionName: "Mio!" });
});

describe("Companion admission", () => {
  it.each([false, true])("queues a text message while session running=%s", async (running) => {
    const calls: unknown[][] = [];
    await queueCompanionPrompt({ prompt: async (...args) => { calls.push(args); return { ok: true }; } }, [{ type: "text", text: `消息-${running}` }]);
    expect(calls).toEqual([[[{ type: "text", text: `消息-${running}` }], "queue"]]);
  });

  it("surfaces rejection so the Svelte caller retains the draft", async () => {
    await expect(queueCompanionPrompt({ prompt: async () => ({ ok: false, error: { message: "rejected" } }) }, [{ type: "text", text: "保留我" }])).rejects.toThrow("rejected");
  });

  it("routes exact /compact input through the session command channel", async () => {
    const prompts: unknown[][] = [];
    const commands: string[] = [];
    await submitCompanionInput({
      prompt: async (...args) => { prompts.push(args); return { ok: true }; },
      command: async (line) => { commands.push(line); return { ok: true, value: { matched: true } }; },
    }, "/compact");
    expect(commands).toEqual(["/compact"]);
    expect(prompts).toEqual([]);
  });

  it("keeps other slash-prefixed text on the ordinary prompt path", async () => {
    const prompts: unknown[][] = [];
    const commands: string[] = [];
    await submitCompanionInput({
      prompt: async (...args) => { prompts.push(args); return { ok: true }; },
      command: async (line) => { commands.push(line); return { ok: true, value: { matched: true } }; },
    }, "/不是命令");
    expect(commands).toEqual([]);
    expect(prompts).toEqual([[[{ type: "text", text: "/不是命令" }], "queue"]]);
  });

  it("sends image blocks before the accompanying text", async () => {
    const prompts: unknown[][] = [];
    await submitCompanionInput({
      prompt: async (...args) => { prompts.push(args); return { ok: true }; },
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "看这张", [{ type: "image", mediaType: "image/png", data: "AQ==", name: "sea.png" }]);
    expect(prompts).toEqual([[[
      { type: "image", mediaType: "image/png", data: "AQ==", name: "sea.png" },
      { type: "text", text: "看这张" },
    ], "queue"]]);
  });

  it("does not let /compact carry images", async () => {
    await expect(submitCompanionInput({
      prompt: async () => ({ ok: true }),
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "/compact", [{ type: "image", mediaType: "image/png", data: "AQ==" }])).rejects.toThrow("compact-with-images");
  });

  it("surfaces an unavailable compact command so the draft is retained", async () => {
    await expect(submitCompanionInput({
      prompt: async () => ({ ok: true }),
      command: async () => ({ ok: true, value: { matched: false } }),
    }, "/compact")).rejects.toThrow("compact-command-unavailable");
  });
});

describe("Companion session opening", () => {
  it("opens a remembered selected session once baselines are ready", () => {
    expect(companionSessionOpenPlan(true, "workspace-a", "remembered-session")).toEqual({ kind: "open", sessionId: "remembered-session" });
  });

  it("opens a recent selected session and connects only without a selection", () => {
    expect(companionSessionOpenPlan(true, "workspace-a", "recent-session")).toEqual({ kind: "open", sessionId: "recent-session" });
    expect(companionSessionOpenPlan(true, "workspace-a", undefined)).toEqual({ kind: "connect", workspaceId: "workspace-a" });
  });
});

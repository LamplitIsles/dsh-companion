import { describe, expect, it, vi } from "vitest";
import { COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT, createComposerState, findComposerCommand, reduceComposer, resolveComposerHeight, shouldSubmitEnter } from "../src/client/composer.js";
import { CompanionAdmissionError, CompanionPreControllerError, submitCompanionInput } from "../src/client/admission.js";
import { changedSettingsPayload, mergeCleanSettingsDraft, relationshipControlsWritable } from "../src/client/settings.js";
import { companionSessionOpenPlan } from "../src/client/session-opening.js";

describe("IME composer", () => {
  it("keeps a one-line minimum, caps long drafts, and enables only internal overflow at the cap", () => {
    expect(resolveComposerHeight(12)).toEqual({ height: COMPOSER_MIN_HEIGHT, scrollable: false });
    expect(resolveComposerHeight(90)).toEqual({ height: 90, scrollable: false });
    expect(resolveComposerHeight(COMPOSER_MAX_HEIGHT + 1)).toEqual({ height: COMPOSER_MAX_HEIGHT, scrollable: true });
    expect(resolveComposerHeight(0, 40, 120)).toEqual({ height: 40, scrollable: false });
  });

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

describe("Companion alpha Session admission", () => {
  it("registers an echo before prompt and propagates its exact request id", async () => {
    const begins: unknown[] = [];
    const calls: unknown[][] = [];
    await submitCompanionInput({
      beginSubmission: (input) => { begins.push(input); return { requestId: "request-1" as never, abandon: () => undefined }; },
      prompt: async (...args) => { calls.push(args); return { ok: true, value: { accepted: true } }; },
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "消息");
    expect(begins).toEqual([expect.objectContaining({ mode: "queue", text: "消息", images: [] })]);
    expect(calls).toEqual([[ [{ type: "text", text: "消息" }], "queue", undefined, "request-1" ]]);
  });

  it("surfaces an identified Host rejection while preserving retirement ownership", async () => {
    let retirement: unknown;
    const error = await submitCompanionInput({
      beginSubmission: (input) => { retirement = input.onRetire; return { requestId: "request-2" as never, abandon: () => undefined }; },
      prompt: async () => ({ ok: false, error: { code: "attachment-error", message: "rejected", details: {} } as never }),
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "保留我", [], () => undefined).catch((value: unknown) => value);
    expect(error).toMatchObject({ name: "CompanionAdmissionError", code: "attachment-error" });
    expect(typeof retirement).toBe("function");
    expect(error).toBeInstanceOf(CompanionAdmissionError);
  });

  it("keeps a runtime-shaped internal result's public code", async () => {
    const error = await submitCompanionInput({
      beginSubmission: () => ({ requestId: "request-3" as never, abandon: () => undefined }),
      prompt: async () => ({ ok: false, error: { code: "internal", message: "carrier unavailable", details: {} } as never }),
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "等待确认").catch((value: unknown) => value);
    expect(error).toMatchObject({ name: "CompanionAdmissionError", code: "internal" });
  });

  it("routes exact /compact input through the Session command channel", async () => {
    const prompts: unknown[][] = [];
    const commands: string[] = [];
    await submitCompanionInput({
      beginSubmission: () => ({ requestId: "unused" as never, abandon: () => undefined }),
      prompt: async (...args) => { prompts.push(args); return { ok: true, value: { accepted: true } }; },
      command: async (line) => { commands.push(line); return { ok: true, value: { matched: true } }; },
    }, "/compact");
    expect(commands).toEqual(["/compact"]);
    expect(prompts).toEqual([]);
  });

  it("keeps other slash-prefixed text on the ordinary prompt path", async () => {
    const prompts: unknown[][] = [];
    await submitCompanionInput({
      beginSubmission: () => ({ requestId: "unused" as never, abandon: () => undefined }),
      prompt: async (...args) => { prompts.push(args); return { ok: true, value: { accepted: true } }; },
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "/不是命令");
    expect(prompts).toEqual([[ [{ type: "text", text: "/不是命令" }], "queue", undefined, "unused" ]]);
  });

  it("does not let /compact carry images", async () => {
    const abandon = vi.fn();
    await expect(submitCompanionInput({
      beginSubmission: () => ({ requestId: "unused" as never, abandon }),
      prompt: async () => ({ ok: true, value: { accepted: true } }),
      command: async () => ({ ok: true, value: { matched: true } }),
    }, "/compact", [{ id: "image", file: { name: "a.png", type: "image/png" } as File, previewUrl: "blob:image" }])).rejects.toBeInstanceOf(CompanionPreControllerError);
    expect(abandon).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable compact command so the draft can be retained", async () => {
    await expect(submitCompanionInput({
      beginSubmission: () => ({ requestId: "unused" as never, abandon: () => undefined }),
      prompt: async () => ({ ok: true, value: { accepted: true } }),
      command: async () => ({ ok: true, value: { matched: false } }),
    }, "/compact")).rejects.toBeInstanceOf(CompanionPreControllerError);
  });
});

describe("Companion session opening", () => {
  it("opens a remembered selected session once the alpha list is ready", () => {
    expect(companionSessionOpenPlan(true, "workspace-a", "remembered-session")).toEqual({ kind: "open", sessionId: "remembered-session" });
  });

  it("waits for the workspace list before creating a session", () => {
    expect(companionSessionOpenPlan(false, "workspace-a", undefined)).toBeUndefined();
    expect(companionSessionOpenPlan(true, "workspace-a", undefined)).toEqual({ kind: "create", workspaceId: "workspace-a" });
  });
});

import { createUserMessage, type GenerateOptions, type Message } from "@deepseek-ai/dsh-llm";
import { describe, expect, it } from "vitest";
import {
  CompanionCompactionIntegrationError,
  rewriteCompanionCompactionRequest,
} from "../src/compaction.js";

function basicTail(text = "Summarize the conversation."): Message {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "dsh-compaction-basic" },
  });
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  const prefix = createUserMessage({
    content: [{ type: "text", text: "Please remember that I prefer 小灯." }],
    source: { kind: "user" },
  });
  return {
    provider: "pinned-provider",
    model: "pinned-model",
    reasoningEffort: "balanced" as GenerateOptions["reasoningEffort"],
    messages: [prefix, basicTail()],
    system: "<companion-context>live metadata</companion-context>",
    tools: [{ name: "companion_update_relationship", description: "fake schema", parameters: { type: "object" } }],
    temperature: 0.2,
    maxTokens: 777,
    stop: ["<done>"],
    signal: new AbortController().signal,
    sessionId: "session-a" as GenerateOptions["sessionId"],
    purpose: "compaction",
    ...overrides,
  };
}

describe("companion compaction request rewrite", () => {
  it("replaces only the known basic tail with the ordered companion checkpoint", () => {
    const original = request();
    const originalMessages = original.messages;
    const rewritten = rewriteCompanionCompactionRequest(original, ["session-a"]);

    expect(rewritten).not.toBe(original);
    for (const field of ["provider", "model", "reasoningEffort", "system", "tools", "temperature", "maxTokens", "stop", "signal", "sessionId", "purpose"] as const) {
      expect(rewritten[field]).toBe(original[field]);
    }
    expect(original.messages).toBe(originalMessages);
    expect(original.messages.at(-1)).toBe(originalMessages.at(-1));
    expect(rewritten.messages).not.toBe(originalMessages);
    expect(rewritten.messages).toHaveLength(originalMessages.length);
    rewritten.messages.slice(0, -1).forEach((message, index) => expect(message).toBe(originalMessages[index]));

    const tail = rewritten.messages.at(-1)!;
    expect(tail).toMatchObject({ role: "user", source: { kind: "plugin", plugin: "dsh-companion" } });
    expect(tail.content).toHaveLength(1);
    expect(tail.content[0]).toMatchObject({ type: "text" });
    const text = tail.content[0]?.type === "text" ? tail.content[0].text : "";

    const headings = [
      "## The User",
      "## Our Relationship",
      "## Emotional Continuity",
      "## Shared Moments",
      "## Preferences and Boundaries",
      "## Commitments and Open Threads",
      "## Current Moment",
      "## Continue Naturally",
    ];
    let previous = -1;
    for (const heading of headings) {
      const position = text.indexOf(heading);
      expect(position).toBeGreaterThan(previous);
      expect(text.indexOf(heading, position + heading.length)).toBe(-1);
      previous = position;
    }
    expect(text).toContain("terse bullets");
    expect(text).toContain("`(none)`");
    expect(text).toContain("dominant conversational language");
    expect(text).toContain("checkpoint text only");
    expect(text).toContain("Do not call Tools, take actions, or mention compaction");
    expect(text).toContain("<compacted-summary>");
    expect(text).toContain("<companion-context>");
    expect(text).toContain("Never diagnose");
    expect(text).toContain("never invent shared history");
  });

  it("passes every unqualified request through by reference", () => {
    const cases = [
      request({ purpose: undefined }),
      request({ purpose: "session-title" }),
      request({ sessionId: undefined }),
      request({ sessionId: "different-session" as GenerateOptions["sessionId"] }),
    ];
    for (const options of cases) expect(rewriteCompanionCompactionRequest(options, ["session-a"])).toBe(options);
    const matching = request();
    expect(rewriteCompanionCompactionRequest(matching, undefined)).toBe(matching);
  });

  it.each([
    ["role", { ...basicTail(), role: "assistant", source: { kind: "model", provider: "p", model: "m" } }],
    ["source", { ...basicTail(), source: { kind: "plugin", plugin: "another-backend" } }],
    ["content", { ...basicTail(), content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }],
    ["empty content", { ...basicTail(), content: [{ type: "text", text: "   " }] }],
  ] as const)("fails visibly when the basic compaction tail has an unexpected %s", (_kind, tail) => {
    const options = request({ messages: [request().messages[0]!, tail as Message] });
    expect(() => rewriteCompanionCompactionRequest(options, ["session-a"])).toThrow(CompanionCompactionIntegrationError);
    expect(() => rewriteCompanionCompactionRequest(options, ["session-a"])).toThrow(/final dsh-compaction-basic user instruction/i);
  });
});

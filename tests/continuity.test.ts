import { describe, expect, it } from "vitest";
import {
  compactionLifecycleDefinition,
  continuityViewDefinition,
  formatApproximateTokens,
  projectContinuityRecords,
  registerCompanionContinuity,
  resolveContextCapacity,
  roundTokenEstimate,
  type CompanionContinuitySnapshot,
  type CompactionLifecycleNode,
  type CompactionLifecycleState,
} from "../src/continuity.js";
import { projectConversation } from "../src/projection.js";

const timeline = { turnOrder: [], turns: new Map() };

function event(type: "compaction/start" | "compaction/end", seq: number, compactionId = "compact-1", data: Record<string, unknown> = {}) {
  return { type, seq, time: seq * 100, data: { compactionId, turn: null, ...data } } as never;
}

function match(raw: unknown, role: "start" | "update") { return { event: raw, role, location: { kind: "session" } } as never; }

describe("Companion context capacity", () => {
  it("prefers projected pressure and caps a rounded percentage", () => {
    expect(resolveContextCapacity({ pressureTokens: 40, projectedTokens: 123, contextWindow: 100 })).toEqual({ usedTokens: 123, contextWindow: 100, percentage: 100 });
  });

  it("falls back to the provider anchor only when projected pressure is absent", () => {
    expect(resolveContextCapacity({ pressureTokens: 51, contextWindow: 100 })).toMatchObject({ usedTokens: 51, percentage: 51 });
    expect(resolveContextCapacity({ pressureTokens: 51, projectedTokens: undefined, contextWindow: 100 })).toMatchObject({ usedTokens: 51, percentage: 51 });
  });

  it("hides incomplete or non-positive telemetry", () => {
    expect(resolveContextCapacity({ pressureTokens: 0, contextWindow: 100 })).toBeUndefined();
    expect(resolveContextCapacity({ pressureTokens: 20, projectedTokens: 0, contextWindow: 100 })).toBeUndefined();
    expect(resolveContextCapacity({ pressureTokens: 20, contextWindow: 0 })).toBeUndefined();
    expect(resolveContextCapacity({ pressureTokens: Number.NaN, contextWindow: 100 })).toBeUndefined();
  });

  it("rounds release estimates to quiet human-scale copy", () => {
    expect(roundTokenEstimate(18_432)).toBe(18_000);
    expect(formatApproximateTokens(18_432)).toBe("18k tokens");
    expect(formatApproximateTokens(432)).toBe("400 tokens");
  });
});

describe("Companion compaction lifecycle", () => {
  it("disposes both registry contributions so a fresh registration can reuse their keys", () => {
    const eventDefinitions = new Map<string, unknown>();
    const viewDefinitions = new Map<string, unknown>();
    const events = {
      register(definition: { kind: string }) {
        if (eventDefinitions.has(definition.kind)) throw new Error("duplicate event key");
        eventDefinitions.set(definition.kind, definition);
        return () => {
          if (eventDefinitions.get(definition.kind) === definition) eventDefinitions.delete(definition.kind);
        };
      },
    };
    const views = {
      register(definition: { target: string }) {
        if (viewDefinitions.has(definition.target)) throw new Error("duplicate view key");
        viewDefinitions.set(definition.target, definition);
        return () => {
          if (viewDefinitions.get(definition.target) === definition) viewDefinitions.delete(definition.target);
        };
      },
    };
    const ctx = { conversationEvents: events, conversationViews: views } as never;

    const dispose = registerCompanionContinuity(ctx);
    expect(eventDefinitions.has("dsh-companion:compaction-lifecycle")).toBe(true);
    expect(viewDefinitions.has("dsh-companion:continuity")).toBe(true);
    dispose();
    dispose();
    expect(eventDefinitions.size).toBe(0);
    expect(viewDefinitions.size).toBe(0);

    const disposeFresh = registerCompanionContinuity(ctx);
    expect(eventDefinitions.size).toBe(1);
    expect(viewDefinitions.size).toBe(1);
    disposeFresh();
  });

  it("turns a public start/end pair into one ordered view node", () => {
    const start = event("compaction/start", 10);
    const startMatch = compactionLifecycleDefinition.match(start);
    expect(startMatch).toEqual({ id: "compact-1", role: "start" });
    const state = compactionLifecycleDefinition.start({} as never, match(start, "start"), {} as never);
    const end = event("compaction/end", 12);
    const next = compactionLifecycleDefinition.update({ state } as never, match(end, "update"));
    expect(next).toMatchObject({ compactionId: "compact-1", status: "complete", startSeq: 10, endSeq: 12 });
    const node = compactionLifecycleDefinition.buildViewNode!({ key: "dsh-companion:compaction-lifecycle:compact-1", kind: compactionLifecycleDefinition.kind, id: "compact-1", matches: [], start: undefined, state: next, current: new Map() });
    expect(node).toMatchObject({ target: "dsh-companion:continuity", kind: "compaction-lifecycle", data: next });

    const builder = continuityViewDefinition.create();
    const first = builder.replace({ nodes: [node as CompactionLifecycleNode], timeline });
    const replay = builder.apply({ upserts: [node as CompactionLifecycleNode], timeline });
    expect(first.lifecycles).toHaveLength(1);
    expect(replay.lifecycles).toHaveLength(1);
    expect(replay.latest?.status).toBe("complete");
    expect(compactionLifecycleDefinition.buildViewNode!({ state: undefined } as never)).toBeNull();
  });


  it("keeps failed wording technical-detail free and ignores private summaries", () => {
    const startState = compactionLifecycleDefinition.start({} as never, match(event("compaction/start", 1, "failed"), "start"), {} as never);
    const failed = compactionLifecycleDefinition.update({ state: startState } as never, match(event("compaction/end", 2, "failed", { error: "private stack trace" }), "update"));
    expect(failed.status).toBe("failed");
    const completed: CompactionLifecycleState = { compactionId: "safe", status: "complete", startSeq: 3, startedAt: 300, endSeq: 5, endedAt: 500 };
    const records = projectContinuityRecords({ lifecycles: [completed, completed] }, [{ kind: "compaction", id: "safe", seq: 5, shadowedTokenCount: 18_432, summary: "PRIVATE CONTINUITY SUMMARY" }]);
    expect(records).toEqual([expect.objectContaining({ text: "已整理对话 · 收纳约 18k tokens" })]);
    expect(JSON.stringify(records)).not.toContain("PRIVATE CONTINUITY SUMMARY");
    expect(projectContinuityRecords({ lifecycles: [completed] }, [{ kind: "compaction", id: "safe", data: { seq: 5, shadowedTokenCount: 18_432, summary: "PRIVATE" } }])).toEqual([expect.objectContaining({ text: "已整理对话 · 收纳约 18k tokens" })]);
    expect(projectContinuityRecords({ lifecycles: [failed] }, [])).toEqual([]);
  });

  it("inserts one durable completion record at its compaction anchor", () => {
    const lifecycle: CompanionContinuitySnapshot = { lifecycles: [{ compactionId: "one", status: "complete", startSeq: 1, startedAt: 1, endSeq: 3, endedAt: 3 }] };
    const snapshot = { nodes: [
      { kind: "user", seq: 1, time: 1, content: [{ type: "text", text: "之前" }] },
      { kind: "compaction", id: "one", seq: 3, time: 3, summary: "PRIVATE", shadowedTokenCount: null },
      { kind: "assistant", seq: 4, time: 4, blocks: [{ kind: "text", text: "现在" }] },
    ] };
    const result = projectConversation(snapshot, true, lifecycle);
    expect(result.items.filter((item) => item.kind === "continuity")).toHaveLength(1);
    expect(result.items.map((item) => item.kind)).toEqual(["text", "continuity", "text"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

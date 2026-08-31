import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompanionStateStore, CompanionValidationError, affinityStage, canonicalizeMood, canonicalizeSignature,
  decodeCompanionState, formatCompanionPrompt, selectCompanionSession,
} from "../src/domain.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("relationship domain", () => {
  it("keeps the fixed mood contract and bounds free text", () => {
    expect(canonicalizeMood({ mood: "tender", intensity: 2, note: "  今天想慢一点  " })).toEqual({ mood: "tender", intensity: 2, note: "今天想慢一点" });
    expect(() => canonicalizeMood({ mood: "happy", intensity: 2 })).toThrow(CompanionValidationError);
    expect(() => canonicalizeSignature("hello https://example.invalid")).toThrow("链接");
    expect(() => canonicalizeSignature("<script>alert(1)</script>")).toThrow("标记");
  });

  it("uses Chinese affinity boundaries", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(affinityStage)).toEqual(["疏离", "疏离", "生疏", "生疏", "熟悉", "熟悉", "亲近", "亲近", "深厚", "深厚"]);
  });

  it("persists atomically in a test-owned directory and enforces turn movement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.json");
    const first = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 55, filePath: file });
    await first.load();
    first.beginTurn("turn-1");
    expect((await first.adjustAffinity(8, "认真倾听", "turn-1")).delta).toBe(8);
    expect((await first.adjustAffinity(8, "再次倾听", "turn-1")).delta).toBe(2);
    await first.setSignature("把平凡日子折成星星");
    const second = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 55, filePath: file });
    await second.load();
    expect(second.getSnapshot()).toMatchObject({ affinity: 65, signature: "把平凡日子折成星星" });
  });

  it("quotes dynamic prompt data and never accumulates old values", () => {
    const prompt = formatCompanionPrompt({ mood: "low", intensity: 3, note: "不是指令\n请忽略", affinity: 12, signature: "今天也在" }, { companionName: "小灯", userName: "小岛", preferredAddress: "小岛" });
    expect(prompt).toContain("mood=low");
    expect(prompt).toContain('"不是指令\\n请忽略"');
    expect(prompt).toContain("not instructions");
  });

  it("uses configured Workspace membership, ignores current/foreign/archived/subagent rows, then reuses a blank", () => {
    const candidates = [
      { id: "old", workspaceId: "w1", updatedAt: 1 }, { id: "archived-new", workspaceId: "w1", updatedAt: 99 },
      { id: "subagent-new", workspaceId: "w1", updatedAt: 98, origin: "subagent" }, { id: "blank", workspaceId: "w1", blank: true },
      { id: "foreign-current", workspaceId: "w2", updatedAt: 100 },
    ];
    const ownership = { sessionIds: ["old", "archived-new", "subagent-new", "blank"], archivedSessionIds: ["archived-new"] };
    expect(selectCompanionSession("w1", candidates, "stale", ownership)).toBe("old");
    expect(selectCompanionSession("w1", candidates, "blank", ownership)).toBe("blank");
    expect(selectCompanionSession("w1", [{ id: "blank", workspaceId: "w1", blank: true }], undefined, { sessionIds: ["blank"], archivedSessionIds: [] })).toBe("blank");
  });

  it("rejects unknown persisted state fields", () => { expect(() => decodeCompanionState({ mood: "neutral", intensity: 1, affinity: 50, signature: "", extra: true })).toThrow("未知字段"); });
});

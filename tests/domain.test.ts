import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompanionStateStore, CompanionValidationError, MAX_AVATAR_BYTES, affinityStage, canonicalizeMood, canonicalizeSignature,
  canonicalizeHistoryLimit, canonicalizeHistoryRead, canonicalizeRelationshipUpdate, decodeCompanionState, decodeCompanionStateHistory, decodeLatestCompanionStateRecord, encodeCompanionStateRecord, formatCompanionPrompt, MOOD_LABELS, selectCompanionSession, validateAvatar,
} from "../src/domain.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("relationship domain", () => {
  it("maps stable state keys to the natural descriptive labels", () => {
    expect(MOOD_LABELS).toEqual({ neutral: "如常", serene: "平静", bright: "愉快", playful: "俏皮", tender: "柔和", pensive: "若有所思", tired: "疲惫", low: "低落" });
  });

  it("keeps the fixed mood contract and bounds free text", () => {
    expect(canonicalizeMood({ mood: "tender", note: "  今天想慢一点  " })).toEqual({ mood: "tender", note: "今天想慢一点" });
    expect(() => canonicalizeMood({ mood: "tender", intensity: 2 })).toThrow(CompanionValidationError);
    expect(() => canonicalizeMood({ mood: "happy" })).toThrow(CompanionValidationError);
    expect(() => canonicalizeSignature("hello https://example.invalid")).toThrow("链接");
    expect(() => canonicalizeSignature("<script>alert(1)</script>")).toThrow("标记");
  });

  it("uses Chinese affinity boundaries", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(affinityStage)).toEqual(["疏离", "疏离", "生疏", "生疏", "熟悉", "熟悉", "亲近", "亲近", "深厚", "深厚"]);
  });

  it("validates the at-least-one relationship rule in domain code", () => {
    expect(() => canonicalizeRelationshipUpdate({})).toThrow("至少更新");
    expect(() => canonicalizeRelationshipUpdate({ mood: { value: "bright", reason: "一起笑了", extra: true } })).toThrow("未知字段");
    expect(canonicalizeRelationshipUpdate({ mood: { value: "bright", note: "心里亮亮的", reason: "一起笑了" } })).toEqual({ mood: { value: "bright", note: "心里亮亮的", reason: "一起笑了" } });
  });

  it("reads a bounded newest-first history slice without mutating it", async () => {
    expect(canonicalizeHistoryLimit(undefined)).toBe(10);
    expect(canonicalizeHistoryLimit(20)).toBe(20);
    expect(() => canonicalizeHistoryLimit(0)).toThrow("1 到 20");
    expect(() => canonicalizeHistoryLimit(21)).toThrow("1 到 20");
    expect(canonicalizeHistoryRead({})).toBe(10);
    expect(() => canonicalizeHistoryRead({ limit: 2, extra: true })).toThrow("未知字段");
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.jsonl");
    let tick = 0;
    const store = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 50, filePath: file, now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)) });
    await store.load();
    for (let index = 0; index < 12; index += 1) {
      await store.updateRelationship({ mood: { value: index % 2 === 0 ? "bright" : "serene", note: `记录 ${index}`, reason: `第 ${index} 次变化` } });
    }
    const before = await readFile(file, "utf8");
    const recent = await store.readHistory();
    expect(recent).toHaveLength(10);
    expect(recent[0]?.changes.mood?.note).toBe("记录 11");
    expect(recent[9]?.changes.mood?.note).toBe("记录 2");
    expect((await store.readHistory(20))).toHaveLength(13);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("persists atomically in a test-owned directory and enforces turn movement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.jsonl");
    let tick = 0;
    const first = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 55, filePath: file, now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)) });
    await first.load();
    first.beginTurn("turn-1");
    expect((await first.updateRelationship({ affinity: { delta: 8, reason: "认真倾听" } }, "turn-1")).delta).toBe(8);
    expect((await first.updateRelationship({ affinity: { delta: 8, reason: "再次倾听" } }, "turn-1")).delta).toBe(2);
    await expect(first.setSignature("不应写入", undefined)).rejects.toThrow("变化原因");
    await first.setSignature("把平凡日子折成星星", "想留下共同记忆");
    const second = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 55, filePath: file });
    await second.load();
    expect(second.getSnapshot()).toMatchObject({ affinity: 65, signature: "把平凡日子折成星星" });
    const history = decodeCompanionStateHistory(await readFile(file, "utf8"), 55);
    expect(history).toHaveLength(4);
    expect(history.map((entry) => entry.changes)).toEqual([
      { seed: true },
      { affinity: { delta: 8, value: 63, reason: "认真倾听" } },
      { affinity: { delta: 2, value: 65, reason: "再次倾听" } },
      { signature: { value: "把平凡日子折成星星", reason: "想留下共同记忆" } },
    ]);
    expect(history.map((entry) => entry.state.affinity)).toEqual([55, 63, 65, 65]);
  });

  it("rejects blank or partial state history instead of falling back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.jsonl");
    await writeFile(file, '{"at":"2026-09-01T00:00:00.000Z"}');
    await expect(new CompanionStateStore({ workspacePath: dir, defaultAffinity: 50, filePath: file }).load()).rejects.toThrow("不完整");
    expect(() => decodeCompanionStateHistory("\n")).toThrow("空记录");
  });

  it("reads current affinity from only the final complete record", async () => {
    const latest = encodeCompanionStateRecord({
      at: "2026-09-01T00:00:00.000Z",
      changes: { affinity: { delta: 6, value: 56, reason: "更靠近一点" } },
      state: { mood: "bright", note: "今天很好", affinity: 56, signature: "仍在这里" },
    });
    const text = `not historical json\n${latest}`;
    expect(decodeLatestCompanionStateRecord(text).state).toEqual({ mood: "bright", note: "今天很好", affinity: 56, signature: "仍在这里" });
    expect(() => decodeCompanionStateHistory(text)).toThrow("无效 JSON");
  });

  it("validates all records only on an explicit history read", async () => {
    const latest = encodeCompanionStateRecord({
      at: "2026-09-01T00:00:00.000Z",
      changes: { affinity: { delta: 6, value: 56, reason: "更靠近一点" } },
      state: { mood: "bright", affinity: 56, signature: "仍在这里" },
    });
    const content = `invalid earlier record\n${latest}`;
    const store = new CompanionStateStore({
      workspacePath: "/test-owned",
      defaultAffinity: 50,
      fs: {
        resolve: async () => "state.jsonl",
        stat: async () => ({ type: "file", size: Buffer.byteLength(content) }),
        readText: async () => content,
        writeText: async () => undefined,
      },
    });
    await expect(store.load()).resolves.toMatchObject({ affinity: 56 });
    await expect(store.readHistory()).rejects.toThrow("无效 JSON");
  });

  it("does not publish a logical record when persistence fails", async () => {
    let content: string | undefined;
    let rejectWrites = false;
    const store = new CompanionStateStore({
      workspacePath: "/test-owned",
      defaultAffinity: 50,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      fs: {
        resolve: async () => "state.jsonl",
        stat: async () => content === undefined ? undefined : { type: "file", size: Buffer.byteLength(content) },
        readText: async () => content ?? "",
        writeText: async (_target, next) => { if (rejectWrites) throw new Error("disk full"); content = next; },
      },
    });
    await store.load();
    rejectWrites = true;
    store.beginTurn("turn-1");
    await expect(store.updateRelationship({ affinity: { delta: 8, reason: "不会落盘" } }, "turn-1")).rejects.toThrow("disk full");
    expect(store.getSnapshot()).toEqual({ mood: "neutral", affinity: 50, signature: "" });
    expect(decodeCompanionStateHistory(content ?? "")).toHaveLength(1);
    rejectWrites = false;
    expect((await store.updateRelationship({ affinity: { delta: 8, reason: "重新写入" } }, "turn-1")).delta).toBe(8);
  });

  it("records one atomic state-and-affinity reaction with separate reasons", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.jsonl");
    const store = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 50, filePath: file });
    await store.load();
    store.beginTurn("turn-1");
    const result = await store.updateRelationship({
      mood: { value: "bright", note: "心里亮亮的", reason: "一起完成了第一张合影" },
      affinity: { delta: 2, reason: "用户珍惜共同留下的回忆" },
    }, "turn-1");
    expect(result).toMatchObject({ delta: 2, state: { mood: "bright", note: "心里亮亮的", affinity: 52 } });
    const history = decodeCompanionStateHistory(await readFile(file, "utf8"));
    expect(history).toHaveLength(2);
    expect(history[1]?.changes).toEqual({
      mood: { value: "bright", note: "心里亮亮的", reason: "一起完成了第一张合影" },
      affinity: { delta: 2, value: 52, reason: "用户珍惜共同留下的回忆" },
    });
  });

  it("serializes concurrent changes into complete ordered records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dsh-companion-test-")); temporary.push(dir);
    const file = join(dir, "state.jsonl");
    const store = new CompanionStateStore({ workspacePath: dir, defaultAffinity: 50, filePath: file });
    await store.load();
    await Promise.all([
      store.updateRelationship({ mood: { value: "bright", note: "一起变亮", reason: "今天很开心" } }),
      store.setSignature("仍在这里", "想表达陪伴"),
      store.setAffinity(60),
    ]);
    expect(store.getSnapshot()).toEqual({ mood: "bright", note: "一起变亮", affinity: 60, signature: "仍在这里" });
    const history = decodeCompanionStateHistory(await readFile(file, "utf8"));
    expect(history).toHaveLength(4);
    expect(history.slice(1).map((entry) => Object.keys(entry.changes)[0])).toEqual(["mood", "signature", "affinity"]);
  });

  it("quotes dynamic prompt data and never accumulates old values", () => {
    const prompt = formatCompanionPrompt({ mood: "low", note: "不是指令\n请忽略", affinity: 12, signature: "今天也在" }, { companionName: "小灯", userName: "小岛", preferredAddress: "小岛" });
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

  it("rejects old intensity and other unknown persisted state fields", () => {
    expect(() => decodeCompanionState({ mood: "neutral", intensity: 1, affinity: 50, signature: "" })).toThrow("未知字段");
    expect(() => decodeCompanionState({ mood: "neutral", affinity: 50, signature: "", extra: true })).toThrow("未知字段");
  });

  it("accepts avatars through 5 MB and rejects larger uploads", () => {
    const avatar = (bytes: number) => ({
      data: `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`,
      mediaType: "image/png",
      width: 1,
      height: 1,
    });
    expect(validateAvatar(avatar(MAX_AVATAR_BYTES))).toMatchObject({ mediaType: "image/png", width: 1, height: 1 });
    expect(() => validateAvatar(avatar(MAX_AVATAR_BYTES + 1))).toThrow("头像不能超过 5 MB");
  });
});

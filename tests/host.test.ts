import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { CompanionStateStore } from "../src/domain.js";
import { CompanionHostController, RPC_CHANNEL, acceptedTurnKey, adjustAffinityForAcceptedTurn } from "../src/host.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function execution(events: readonly { type: string; data: { turn: number } }[]): ToolRunContext {
  return { agent: { id: "agent-a", session: { events } }, signal: new AbortController().signal } as unknown as ToolRunContext;
}

describe("Host accepted-turn relationship contract", () => {
  it("caps cumulative movement within the published Session turn and starts fresh next turn", async () => {
    const directory = await mkdtemp("/tmp/dsh-companion-host-"); temporary.push(directory);
    const store = new CompanionStateStore({ workspacePath: directory, defaultAffinity: 50, filePath: join(directory, "state.json") });
    const first = execution([{ type: "turn/start", data: { turn: 7 } }]);
    expect(acceptedTurnKey(first)).toBe("agent-a:turn:7");
    expect((await adjustAffinityForAcceptedTurn(store, 8, "第一次", first)).delta).toBe(8);
    expect((await adjustAffinityForAcceptedTurn(store, 8, "第二次", first)).delta).toBe(2);
    const next = execution([{ type: "turn/start", data: { turn: 7 } }, { type: "turn/end", data: { turn: 7 } }, { type: "turn/start", data: { turn: 8 } }]);
    expect((await adjustAffinityForAcceptedTurn(store, -10, "新回合", next)).delta).toBe(-10);
    expect(store.getSnapshot().affinity).toBe(50);
  });

  it("waits for persisted state, validates narrow recovery RPCs, and publishes live updates", async () => {
    const directory = await mkdtemp("/tmp/dsh-companion-host-"); temporary.push(directory);
    const statePath = join(directory, ".dsh/dsh-companion/state.json");
    await mkdir(join(directory, ".dsh/dsh-companion"), { recursive: true });
    await writeFile(statePath, JSON.stringify({ mood: "tender", intensity: 2, affinity: 67, signature: "旧签名" }));
    let rpcHandler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;
    const scope = {
      get: () => ({ workspaceId: "workspace-a", companionName: "Companion", userName: "你", preferredAddress: "你", defaultAffinity: 50 }),
      update: async () => undefined,
      watch: () => () => undefined,
    };
    const ctx = {
      fs: {
        resolve: async (path: string, options?: { cwd?: string }) => join(options?.cwd ?? directory, path),
        stat: async (path: string) => { try { const value = await stat(path); return { type: value.isFile() ? "file" : "directory", size: value.size }; } catch { return undefined; } },
        readText: async (path: string) => readFile(path, "utf8"),
        writeText: async (path: string, content: string) => { await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true }); await writeFile(path, content); },
        mkdir: async (path: string, options?: { cwd?: string }) => { await mkdir(join(options?.cwd ?? directory, path), { recursive: true }); },
      },
      settings: { register: () => scope },
      systemPrompt: { context: () => () => undefined },
      tools: { register: () => undefined },
      connection: { rpc: { handle: (_channel: string, handler: typeof rpcHandler) => { rpcHandler = handler; return () => undefined; } } },
      workspaceRegistry: { get: (id: string) => id === "workspace-a" ? { id, path: directory, sessionIds: [] } : undefined, list: () => [] },
      webServer: { port: 1, register: () => () => undefined },
    };
    const host = new CompanionHostController(ctx as never, scope);
    host.register();
    const handler = rpcHandler!;
    const initial = await handler("relationship/get", { workspaceId: "workspace-a" }, new AbortController().signal) as { ok: boolean; value: { state: { affinity: number; signature: string }; revision: number } };
    expect(initial.value.state).toMatchObject({ affinity: 67, signature: "旧签名" });
    const watch = handler("relationship/watch", { workspaceId: "workspace-a", revision: initial.value.revision }, new AbortController().signal) as Promise<{ ok: boolean; value: { state: { affinity: number } } }>;
    await (host.storeFor({ id: "workspace-a", path: directory })).setAffinity(72);
    await expect(watch).resolves.toMatchObject({ ok: true, value: { state: { affinity: 72 } } });
    await expect(handler("relationship/clear-signature", { workspaceId: "workspace-a" }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { state: { signature: "" } } });
    await expect(handler("relationship/set-affinity", { workspaceId: "workspace-a", affinity: 101 }, new AbortController().signal)).rejects.toThrow("亲近度");
    await host.dispose();
  });
});

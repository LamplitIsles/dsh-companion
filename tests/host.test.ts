import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { join } from "node:path";
import { createUserMessage, type GenerateOptions, type StreamChunk } from "@deepseek-ai/dsh-llm";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { CompanionStateStore } from "../src/domain.js";
import { CompanionHostController, RPC_CHANNEL, acceptedTurnKey, adjustAffinityForAcceptedTurn, apply, companionAliasHandler } from "../src/host.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function execution(events: readonly { type: string; data: { turn: number } }[]): ToolRunContext {
  return { agent: { id: "agent-a", session: { events } }, signal: new AbortController().signal } as unknown as ToolRunContext;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not expose a TCP port");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function get(port: number, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: "/companion/", headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

describe("Host accepted-turn relationship contract", () => {
  it("preserves the external authority while proxying the authenticated Companion root", async () => {
    let upstreamHost: string | undefined;
    let upstreamCookie: string | undefined;
    const upstream = createServer((request, response) => {
      upstreamHost = request.headers.host;
      upstreamCookie = request.headers.cookie;
      response.end("root document");
    });
    const upstreamPort = await listen(upstream);
    const alias = createServer((request, response) => {
      void companionAliasHandler({ port: upstreamPort } as never, request, response);
    });
    const aliasPort = await listen(alias);
    try {
      const authority = "127.0.0.1:13080";
      const response = await get(aliasPort, { host: authority, cookie: "dsh-auth-test=authenticated" });
      expect(response.status).toBe(200);
      expect(response.body).toBe("root document");
      expect(upstreamHost).toBe(authority);
      expect(upstreamCookie).toBe("dsh-auth-test=authenticated");
    } finally {
      await Promise.all([close(alias), close(upstream)]);
    }
  });

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
      llm: {},
      on: () => () => undefined,
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

  it("preloads persisted relationship state before the first prompt callback is registered", async () => {
    const directory = await mkdtemp("/tmp/dsh-companion-host-"); temporary.push(directory);
    await mkdir(join(directory, ".dsh/dsh-companion"), { recursive: true });
    await writeFile(join(directory, ".dsh/dsh-companion/state.json"), JSON.stringify({ mood: "tender", intensity: 2, affinity: 67, signature: "旧签名" }));
    let prompt: ((context: { agent?: { session?: { header?: { cwd?: string } } } }) => string) | undefined;
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
      systemPrompt: { context: ({ text }: { text: typeof prompt }) => { prompt = text; return () => undefined; } },
      tools: { register: () => undefined },
      connection: { rpc: { handle: () => () => undefined } },
      workspaceRegistry: { get: (id: string) => id === "workspace-a" ? { id, path: directory, sessionIds: [] } : undefined, list: () => [] },
      llm: {},
      on: () => () => undefined,
      webServer: { port: 1, register: () => () => undefined },
    };
    const lifecycle = apply(ctx as never);
    const loaded = await lifecycle.next();
    expect(prompt?.({ agent: { session: { header: { cwd: directory } } } })).toContain("affinity=67");
    expect(prompt?.({ agent: { session: { header: { cwd: directory } } } })).toContain('signature="旧签名"');
    await loaded.value?.();
    await lifecycle.next();
  });

  it("registers a global compaction waterfall that reads live scope, delegates once, and disposes", async () => {
    let configured = { workspaceId: "workspace-a", companionName: "Companion", userName: "你", preferredAddress: "你", defaultAffinity: 50 };
    const workspace = { id: "workspace-a", path: "/test-workspace", sessionIds: ["session-a"] as string[] };
    const scope = { get: () => configured, update: async () => undefined, watch: () => () => undefined };
    let listener: ((options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>) | undefined;
    let listenerOptions: unknown;
    let listenerDisposed = 0;
    const ctx = {
      fs: {},
      settings: { register: () => scope },
      systemPrompt: { context: () => () => undefined },
      tools: { register: () => undefined },
      connection: { rpc: { handle: () => () => undefined } },
      workspaceRegistry: { get: (id: string) => id === workspace.id ? workspace : undefined, list: () => [workspace] },
      llm: {},
      on: (_name: string, callback: typeof listener, options: unknown) => { listener = callback; listenerOptions = options; return () => { listenerDisposed += 1; }; },
      webServer: { port: 1, register: () => () => undefined },
    };
    const host = new CompanionHostController(ctx as never, scope);
    host.register();
    expect(listenerOptions).toEqual({ global: true });

    const basicTail = createUserMessage({ content: [{ type: "text", text: "standard basic prompt" }], source: { kind: "plugin", plugin: "dsh-compaction-basic" } });
    const prefix = createUserMessage({ content: [{ type: "text", text: "hello" }], source: { kind: "user" } });
    const qualified: GenerateOptions = { provider: "fake", model: "fake", messages: [prefix, basicTail], sessionId: "session-a" as GenerateOptions["sessionId"], purpose: "compaction" };
    const downstream = (options: GenerateOptions) => {
      let calls = 0;
      const stream = (async function* (): AsyncGenerator<StreamChunk> { yield { type: "finish", reason: { kind: "stop" } }; })();
      const next = () => { calls += 1; return stream; };
      return { result: listener!(options, next), calls: () => calls, stream };
    };
    const changed = downstream(qualified);
    expect(changed.result).toBe(changed.stream);
    expect(changed.calls()).toBe(1);
    expect(qualified.messages[0]).toBe(prefix);
    expect(qualified.messages.at(-1)).toMatchObject({ source: { kind: "plugin", plugin: "dsh-companion" } });

    const malformed = { ...qualified, messages: [prefix, createUserMessage({ content: [{ type: "text", text: "unknown backend" }], source: { kind: "plugin", plugin: "different-backend" } })] };
    let malformedNextCalls = 0;
    expect(() => listener!(malformed, () => { malformedNextCalls += 1; return changed.stream; })).toThrow(/dsh-compaction-basic/i);
    expect(malformedNextCalls).toBe(0);

    configured = { ...configured, workspaceId: "" };
    const disabled = { ...qualified, messages: [prefix, basicTail] };
    const unchangedForSettings = downstream(disabled);
    expect(unchangedForSettings.calls()).toBe(1);
    expect(disabled.messages.at(-1)).toBe(basicTail);

    configured = { ...configured, workspaceId: "workspace-a" };
    workspace.sessionIds = [];
    const missingMembership = { ...qualified, messages: [prefix, basicTail] };
    const unchangedForMembership = downstream(missingMembership);
    expect(unchangedForMembership.calls()).toBe(1);
    expect(missingMembership.messages.at(-1)).toBe(basicTail);

    await host.dispose();
    expect(listenerDisposed).toBe(1);
  });
});

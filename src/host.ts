import { basename, normalize, resolve as resolvePath } from "node:path";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import z from "@deepseek-ai/schemastery";
import { defineTool, type ToolDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { RpcResult } from "@deepseek-ai/dsh-host-apiproxy/api";
import {
  CompanionStateStore,
  type CompanionFileSystem,
  type CompanionIdentitySettings,
  type CompanionState,
  CompanionValidationError,
  affinityStage,
  canonicalizeMood,
  canonicalizeSignature,
  clampAffinity,
  defaultCompanionState,
  formatCompanionPrompt,
  validateIdentitySettings,
} from "./domain.js";

export const SETTINGS_NAMESPACE = "dsh-companion" as const;
export const RPC_CHANNEL = "/dsh-companion" as const;
export const SANDBOX_POSTURE = "workspace-write" as const;
export const ESCALATION_ENABLED = false as const;

export interface CompanionSettings extends Omit<CompanionIdentitySettings, "workspaceId"> {
  workspaceId: string;
}

/** Schema remains serializable for native DSH settings surfaces. Cross-field and avatar bounds live in validate. */
export const SettingsSchema = z.object({
  workspaceId: z.string().default(""),
  companionName: z.string().default("Companion"),
  companionAvatar: z.any(),
  userName: z.string().default("你"),
  userAvatar: z.any(),
  preferredAddress: z.string().default("你"),
  defaultAffinity: z.number().step(1).min(0).max(100).default(50),
}).loose();

interface SettingsScopeLike<T> {
  get(): T;
  update(patch: object): Promise<void>;
  watch(callback: (next: T, previous: T) => void | Promise<void>): () => void;
}

interface DshFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>;
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number } | undefined>;
  readText(target: unknown, signal?: AbortSignal): Promise<string>;
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>;
  mkdir?(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<void>;
}

interface WorkspaceRecord {
  id: string;
  path: string;
  sessionIds?: readonly string[];
}

interface WorkspaceRegistryLike {
  get(id: string): WorkspaceRecord | undefined;
  list(): readonly WorkspaceRecord[];
}

interface RpcLike {
  handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>, options: { authority: "trusted-host" | "loopback" }): () => Promise<void>;
}

interface WebServerLike {
  register(route: { kind: "prefix"; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
  readonly port: number;
}

interface HostContextLike {
  fs: DshFileSystem;
  settings: { register<T>(namespace: string, schema: unknown, options?: { base?: Partial<T>; applies?: "live"; validate?: (value: T) => void }): SettingsScopeLike<T> };
  systemPrompt: { context(input: { name: string; order: number; text: (context: { agent?: { session?: { header?: { cwd?: string } } } }) => string }): () => void };
  tools: { register(definition: ToolDefinition): unknown };
  connection: { rpc: RpcLike };
  workspaceRegistry: WorkspaceRegistryLike;
  /** Required by this web plugin solely for the pinned static-server alias. */
  webServer: WebServerLike;
  effect?(effect: () => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>, name?: string): unknown;
}

export interface RelationshipView {
  identity: CompanionIdentitySettings | undefined;
  state: CompanionState | undefined;
  workspacePresent: boolean;
  sandboxPosture: typeof SANDBOX_POSTURE;
  escalationEnabled: false;
  revision: number;
}

function ok<T>(value: T): RpcResult<T> { return { ok: true, value }; }
function fail(message: string, code = "bad-request"): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } as never };
}

function asSettings(value: CompanionSettings): CompanionSettings {
  const candidate: Record<string, unknown> = value as unknown as Record<string, unknown>;
  const defaults = {
    workspaceId: typeof candidate.workspaceId === "string" ? candidate.workspaceId.trim() : "",
    companionName: typeof candidate.companionName === "string" && candidate.companionName.trim() ? candidate.companionName.trim() : "Companion",
    userName: typeof candidate.userName === "string" && candidate.userName.trim() ? candidate.userName.trim() : "你",
    preferredAddress: typeof candidate.preferredAddress === "string" && candidate.preferredAddress.trim() ? candidate.preferredAddress.trim() : "你",
    defaultAffinity: typeof candidate.defaultAffinity === "number" ? clampAffinity(candidate.defaultAffinity) : 50,
  } as CompanionSettings;
  if (candidate.companionAvatar !== undefined) defaults.companionAvatar = candidate.companionAvatar as CompanionSettings["companionAvatar"];
  if (candidate.userAvatar !== undefined) defaults.userAvatar = candidate.userAvatar as CompanionSettings["userAvatar"];
  return defaults;
}

function checkedSettings(value: CompanionSettings): CompanionSettings {
  if (!value.workspaceId.trim()) return asSettings(value);
  return validateIdentitySettings(value) as CompanionSettings;
}

function workspaceFor(registry: WorkspaceRegistryLike, settings: CompanionSettings, cwd?: string): WorkspaceRecord | undefined {
  const configured = settings.workspaceId.trim();
  if (!configured) return undefined;
  const workspace = registry.get(configured);
  if (!workspace) return undefined;
  if (cwd === undefined) return workspace;
  return resolvePath(normalize(cwd)) === resolvePath(normalize(workspace.path)) ? workspace : undefined;
}

function currentCwd(exec: ToolRunContext): string | undefined {
  return exec.agent?.session?.header?.cwd;
}

function adaptFs(fs: DshFileSystem): CompanionFileSystem {
  return {
    resolve: (path, options) => fs.resolve(path, options),
    stat: (target, signal) => fs.stat(target, signal),
    readText: (target, signal) => fs.readText(target, signal),
    writeText: (target, content, expected, signal) => fs.writeText(target, content, expected, signal),
    ...(fs.mkdir ? { mkdir: (path, options) => fs.mkdir!(path, options) } : {}),
  };
}

/** The published Agent session log is the only durable identity of an accepted turn. */
export function acceptedTurnKey(exec: ToolRunContext): string {
  const agent = exec.agent;
  if (!agent) throw new CompanionValidationError("Companion 只能在活动对话回合中更新亲近度。");
  let openTurn: number | undefined;
  for (const event of agent.session.events) {
    if (event.type === "turn/start") openTurn = event.data.turn;
    else if (event.type === "turn/end" && event.data.turn === openTurn) openTurn = undefined;
  }
  if (!Number.isSafeInteger(openTurn)) throw new CompanionValidationError("当前没有可更新亲近度的已接受用户回合。");
  return `${agent.id}:turn:${openTurn}`;
}

export async function adjustAffinityForAcceptedTurn(store: CompanionStateStore, delta: unknown, reason: unknown, exec: ToolRunContext): Promise<{ delta: number; affinity: number; reason: string }> {
  const turnId = acceptedTurnKey(exec);
  store.beginTurn(turnId);
  return store.adjustAffinity(delta, reason, turnId, exec.signal);
}

/**
 * The pinned web static service serves explicit files and otherwise returns
 * 404. Reuse its rendered root document for the Companion alias so the
 * browser receives the same boot payload and plugin manifest—there is no
 * second index or client transport. The pinned static service has no SPA
 * fallback, so this lifecycle-owned alias is required for this web plugin.
 */
function companionAliasHandler(webServer: WebServerLike, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://companion.local").pathname;
  if (pathname !== "/companion" && pathname !== "/companion/") {
    res.writeHead(404);
    res.end();
    return Promise.resolve();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const upstream = httpRequest({ host: "127.0.0.1", port: webServer.port, path: "/", method: req.method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const contentType = response.headers["content-type"];
        res.writeHead(response.statusCode ?? 502, contentType ? { "content-type": contentType } : undefined);
        if (req.method === "HEAD") res.end();
        else res.end(Buffer.concat(chunks));
        resolve();
      });
    });
    upstream.setTimeout(3000, () => {
      upstream.destroy();
      if (!res.headersSent) res.writeHead(504);
      res.end();
      resolve();
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
      resolve();
    });
    upstream.end();
  });
}

const moodTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_set_mood",
  description: "Set the Companion's current bounded mood for this Workspace. Use the fixed mood key, intensity 1-3, and an optional short note.",
  parameters: {
    mood: { type: "string", required: true, description: "neutral, serene, bright, playful, tender, pensive, tired, or low" },
    intensity: { type: "integer", required: true, description: "1 (轻微), 2 (明显), or 3 (强烈)" },
    note: { type: "string", description: "Optional 心情短句, at most 40 Unicode code points" },
  },
  output: {
    schema: {
      type: "object",
      properties: { mood: { type: "string", required: true }, intensity: { type: "integer", required: true }, note: { type: "string" }, message: { type: "string", required: true } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: String(value.message) }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中更新。");
    const mood = canonicalizeMood(args);
    const state = await owner.storeFor(workspace).setMood(mood, exec.signal);
    return { mood: state.mood, intensity: state.intensity, ...(state.note === undefined ? {} : { note: state.note }), message: `Companion 心情已更新为 ${state.mood} · ${state.intensity}。` };
  },
});

const affinityTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_adjust_affinity",
  description: "Move Companion affinity by -10 to +10 for a concrete conversational reason. Net movement per accepted user turn is bounded to ±10.",
  parameters: {
    delta: { type: "integer", required: true, description: "An integer from -10 through +10" },
    reason: { type: "string", required: true, description: "A concise reason, at most 160 characters" },
  },
  output: {
    schema: { type: "object", properties: { delta: { type: "integer", required: true }, affinity: { type: "integer", required: true }, stage: { type: "string", required: true }, message: { type: "string", required: true } }, additionalProperties: false },
    render: (_args, value) => [{ type: "text", text: String(value.message) }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中更新。");
    const result = await adjustAffinityForAcceptedTurn(owner.storeFor(workspace), (args as { delta?: unknown }).delta, (args as { reason?: unknown }).reason, exec);
    return { delta: result.delta, affinity: result.affinity, stage: affinityStage(result.affinity), message: `亲近度 ${result.delta >= 0 ? "增加" : "减少"} ${Math.abs(result.delta)}，现在是 ${result.affinity}（${affinityStage(result.affinity)}）。` };
  },
});

const signatureTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_set_signature",
  description: "Replace or clear the Companion's short plain-text personal signature for this Workspace.",
  parameters: { signature: { type: "string", required: true, description: "One plain Unicode line, at most 80 characters; an empty string clears it" } },
  output: {
    schema: { type: "object", properties: { signature: { type: "string", required: true }, message: { type: "string", required: true } }, additionalProperties: false },
    render: (_args, value) => [{ type: "text", text: String(value.message) }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中更新。");
    const signature = canonicalizeSignature((args as { signature?: unknown }).signature);
    const state = await owner.storeFor(workspace).setSignature(signature, exec.signal);
    return { signature: state.signature, message: state.signature ? "Companion 签名已更新。" : "Companion 签名已清除。" };
  },
});

export class CompanionHostController {
  readonly stores = new Map<string, CompanionStateStore>();
  readonly settingsScope: SettingsScopeLike<CompanionSettings>;
  private readonly fs: CompanionFileSystem;
  private readonly disposers: Array<() => void | Promise<void>> = [];

  constructor(readonly ctx: HostContextLike, settingsScope: SettingsScopeLike<CompanionSettings>) {
    this.settingsScope = settingsScope;
    this.fs = adaptFs(ctx.fs);
    this.disposers.push(settingsScope.watch((next) => {
      const defaultAffinity = asSettings(next).defaultAffinity;
      for (const store of this.stores.values()) store.setDefaultAffinity(defaultAffinity);
    }));
  }

  settings(): CompanionSettings { return asSettings(this.settingsScope.get()); }

  /** One authority check shared by tools, RPC, and prompt assembly. */
  configuredWorkspace(requestedId?: string, cwd?: string): { settings: CompanionSettings; workspace: WorkspaceRecord } | undefined {
    const settings = this.settings();
    if (!settings.workspaceId || (requestedId !== undefined && requestedId !== settings.workspaceId)) return undefined;
    const workspace = workspaceFor(this.ctx.workspaceRegistry, settings, cwd);
    return workspace ? { settings, workspace } : undefined;
  }

  storeFor(workspace: WorkspaceRecord): CompanionStateStore {
    const existing = this.stores.get(workspace.id);
    if (existing) return existing;
    const identity = this.settings();
    const store = new CompanionStateStore({ workspacePath: workspace.path, defaultAffinity: identity.defaultAffinity, fs: this.fs });
    this.stores.set(workspace.id, store);
    void store.load().catch(() => undefined);
    return store;
  }

  async relationship(workspaceId?: string, signal?: AbortSignal): Promise<RelationshipView> {
    const requested = typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : undefined;
    const configured = this.configuredWorkspace(requested);
    if (!configured) return { identity: undefined, state: undefined, workspacePresent: false, sandboxPosture: SANDBOX_POSTURE, escalationEnabled: false, revision: 0 };
    const store = this.storeFor(configured.workspace);
    await store.load(signal);
    return {
      identity: checkedSettings(configured.settings),
      state: store.getLoadedSnapshot(),
      workspacePresent: true,
      sandboxPosture: SANDBOX_POSTURE,
      escalationEnabled: false,
      revision: store.getRevision(),
    };
  }

  register(): void {
    this.ctx.tools.register(moodTool(this));
    this.ctx.tools.register(affinityTool(this));
    this.ctx.tools.register(signatureTool(this));
    this.disposers.push(this.ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload, signal) => {
      const record = typeof payload === "object" && payload !== null ? payload as { workspaceId?: unknown; affinity?: unknown; revision?: unknown } : {};
      const requested = typeof record.workspaceId === "string" ? record.workspaceId : undefined;
      const configured = this.configuredWorkspace(requested);
      if (!configured) return fail("找不到已配置的 Companion Workspace。", "workspace-not-found");
      const store = this.storeFor(configured.workspace);
      if (endpoint === "relationship/reset") return ok({ state: await store.resetAffinity(signal) });
      if (endpoint === "relationship/set-affinity") return ok({ state: await store.setAffinity(record.affinity, signal) });
      if (endpoint === "relationship/clear-signature") return ok({ state: await store.clearSignature(signal) });
      if (endpoint === "relationship/watch") {
        if (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0) return fail("relationship revision 无效。");
        const next = await store.waitForChange(record.revision, signal);
        return ok({ ...(await this.relationship(requested, signal)), revision: next.revision, state: next.state });
      }
      if (endpoint === "relationship/get") return ok(await this.relationship(requested, signal));
      return fail("未知的 Companion 请求。", "bad-request");
    }, { authority: "trusted-host" }));
    this.disposers.push(this.ctx.systemPrompt.context({
      name: "dsh-companion:relationship",
      order: 140,
      text: (context) => {
        const configured = this.configuredWorkspace(undefined, context.agent?.session?.header?.cwd);
        if (!configured) return "";
        const state = this.storeFor(configured.workspace).getLoadedSnapshot();
        return state ? formatCompanionPrompt(state, checkedSettings(configured.settings)) : "";
      },
    }));
    const webServer = this.ctx.webServer;
    this.disposers.push(webServer.register({ kind: "prefix", path: "/companion", handler: (req, res) => companionAliasHandler(webServer, req, res) }));
    if (this.ctx.effect) this.ctx.effect(() => () => { void this.dispose(); }, "dsh-companion: lifecycle");
  }

  async dispose(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) await dispose();
    this.stores.clear();
  }
}

export const name = "dsh-companion" as const;
export const inject = ["fs", "settings", "systemPrompt", "tools", "connection", "workspaceRegistry", "webServer"] as const;

export function apply(ctx: HostContextLike): CompanionHostController {
  const settingsScope = ctx.settings.register<CompanionSettings>(SETTINGS_NAMESPACE, SettingsSchema, {
    applies: "live",
    validate: (value) => {
      if (value.workspaceId.trim()) validateIdentitySettings(value);
      else if (!Number.isInteger(value.defaultAffinity) || value.defaultAffinity < 0 || value.defaultAffinity > 100) throw new CompanionValidationError("默认亲近度必须是 0 到 100 的整数。");
    },
  });
  const controller = new CompanionHostController(ctx, settingsScope);
  controller.register();
  return controller;
}

import { basename, normalize, resolve as resolvePath } from "node:path";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import z from "@deepseek-ai/schemastery";
import { defineTool, type ToolDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { RpcResult } from "@deepseek-ai/dsh-client-connection/client";
import type { FsInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from "@deepseek-ai/dsh-fs";
import type { GenerateOptions, LlmRuntime, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { AssembleContext, PromptAssembly } from "@deepseek-ai/dsh-system-prompt";
import {
  CompanionStateStore,
  type CompanionFileSystem,
  type CompanionIdentitySettings,
  type CompanionState,
  CompanionValidationError,
  affinityStage,
  canonicalizeHistoryRead,
  canonicalizeRelationshipUpdate,
  canonicalizeChangeReason,
  canonicalizeSignature,
  clampAffinity,
  defaultCompanionState,
  formatCompanionPrompt,
  MOOD_LABELS,
  validateIdentitySettings,
} from "./domain.js";
import { rewriteCompanionCompactionRequest } from "./compaction.js";
import {
  isVoiceAudioWithinDataUrlLimit,
  maxVoiceBase64CharsForMediaType,
  normalizeVoiceExpression,
  normalizeVoiceMediaType,
  isCanonicalBase64,
  VOICE_CAPABILITY_ENDPOINT,
  VOICE_TRANSCRIBE_ENDPOINT,
  type VoiceExpression,
} from "./voice-contract.js";

export const SETTINGS_NAMESPACE = "dsh-companion" as const;
export const RPC_CHANNEL = "/dsh-companion" as const;
export { VOICE_CAPABILITY_ENDPOINT, VOICE_TRANSCRIBE_ENDPOINT } from "./voice-contract.js";
export const SANDBOX_POSTURE = "workspace-write" as const;
export const ESCALATION_ENABLED = false as const;
const RELATIONSHIP_CONTEXT_NAME = "dsh-companion:relationship";

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
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>;
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
  writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>;
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
  handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>): () => Promise<void>;
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
  llm: LlmRuntime;
  /** Required by this web plugin solely for the pinned static-server alias. */
  webServer: WebServerLike;
  /** Optional Host services are resolved at call time so Companion stays loadable without Kepos Speech. */
  get?: (name: string) => unknown;
  on(name: "llm/stream", listener: (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>, options: { global: true }): () => void;
  on(name: "system-prompt/assemble", listener: (assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly>): () => void;
}

interface KeposSpeechTranscriptionServiceLike {
  transcribe(request: { sessionId: string; mediaType: string; data: Uint8Array }, signal?: AbortSignal): Promise<unknown>;
}

export interface CompanionVoiceTranscription {
  text: string;
  expression?: VoiceExpression;
}

interface CompanionVoiceRequest {
  workspaceId: string;
  sessionId: string;
  mediaType: string;
  data: Uint8Array;
}

const VOICE_TRANSCRIPT_MAX_CHARS = 20_000;

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

function workspaceOwnsSession(workspace: WorkspaceRecord, sessionId: string): boolean {
  return Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId);
}

function decodeVoiceBase64(value: unknown, mediaType: string): Uint8Array | undefined {
  const maxBase64Chars = maxVoiceBase64CharsForMediaType(mediaType);
  if (maxBase64Chars === undefined || !isCanonicalBase64(value, maxBase64Chars)) return undefined;
  try {
    const data = Buffer.from(value, "base64");
    if (data.byteLength === 0 || !isVoiceAudioWithinDataUrlLimit(mediaType, data.byteLength) || data.toString("base64") !== value) return undefined;
    return new Uint8Array(data);
  } catch {
    return undefined;
  }
}

function parseCompanionVoiceRequest(payload: unknown): CompanionVoiceRequest | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || keys.some((key) => !["workspaceId", "sessionId", "mediaType", "data"].includes(key))) return undefined;
  if (typeof record.workspaceId !== "string" || !record.workspaceId.trim()) return undefined;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return undefined;
  const mediaType = normalizeVoiceMediaType(record.mediaType);
  if (!mediaType) return undefined;
  const data = decodeVoiceBase64(record.data, mediaType);
  if (!data) return undefined;
  return { workspaceId: record.workspaceId.trim(), sessionId: record.sessionId, mediaType, data };
}

function normalizeCompanionVoiceTranscription(raw: unknown): CompanionVoiceTranscription | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text || Array.from(text).length > VOICE_TRANSCRIPT_MAX_CHARS) return undefined;
  const expressionCandidates: unknown[] = [record.expression, record.speechExpression, record.speech_expression, record.expressions];
  if (Array.isArray(record.sentences)) expressionCandidates.push(...record.sentences);
  let expression: VoiceExpression | undefined;
  for (const candidate of expressionCandidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const normalized = normalizeVoiceExpression(typeof item === "object" && item !== null
          ? (item as Record<string, unknown>).expression ?? (item as Record<string, unknown>).speechExpression ?? (item as Record<string, unknown>).speech_expression ?? (item as Record<string, unknown>).emotion
          : item);
        if (normalized) { expression = normalized; break; }
      }
    } else {
      const normalized = normalizeVoiceExpression(typeof candidate === "object" && candidate !== null
        ? (candidate as Record<string, unknown>).expression ?? (candidate as Record<string, unknown>).speechExpression ?? (candidate as Record<string, unknown>).speech_expression ?? (candidate as Record<string, unknown>).emotion
        : candidate);
      if (normalized) expression = normalized;
    }
    if (expression) break;
  }
  return expression ? { text, expression } : { text };
}

function optionalKeposSpeech(ctx: HostContextLike): KeposSpeechTranscriptionServiceLike | undefined {
  let service: unknown;
  try { service = ctx.get?.("keposSpeech"); }
  catch { return undefined; }
  if (typeof service !== "object" || service === null || typeof (service as { transcribe?: unknown }).transcribe !== "function") return undefined;
  return service as KeposSpeechTranscriptionServiceLike;
}

function currentCwd(exec: ToolRunContext): string | undefined {
  return exec.agent?.session?.header?.cwd;
}

function adaptFs(fs: DshFileSystem): CompanionFileSystem {
  return {
    resolve: (path, options) => fs.resolve(path, options),
    stat: (target, signal) => fs.stat(target as FsTarget, signal),
    readText: (target, signal) => fs.readText(target as FsTarget, signal),
    writeText: (target, content, expected, signal) => fs.writeText(target as FsTarget, content, expected as FsWriteIntent | undefined, signal),
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

export async function updateRelationshipForAcceptedTurn(store: CompanionStateStore, input: unknown, exec: ToolRunContext): Promise<{ state: CompanionState; delta?: number }> {
  const update = canonicalizeRelationshipUpdate(input);
  const turnId = update.affinity === undefined ? "current" : acceptedTurnKey(exec);
  if (update.affinity !== undefined) store.beginTurn(turnId);
  return store.updateRelationship(input, turnId, exec.signal);
}

export const BOOTSTRAP_PATH = "/companion/bootstrap" as const;
const COMPANION_ROOT_PATH = "/companion/" as const;
const BOOTSTRAP_TOKEN_FIELD = "token" as const;
const BOOTSTRAP_MAX_BODY_BYTES = 4096;
const BOOTSTRAP_ERROR = "令牌无效或已过期，请检查后重试。";

const BOOTSTRAP_PAGE_STYLE = `
*{box-sizing:border-box}
:root{color-scheme:light;--cmp-bg:#fff8f1;--cmp-surface:rgba(255,255,255,.82);--cmp-ink:#292326;--cmp-muted:#786d70;--cmp-line:rgba(70,45,50,.16);--cmp-primary:#d86156;--cmp-primary-ink:#fffaf8;--cmp-glow:rgba(216,97,86,.2);--cmp-orbit:#f6c9a9}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--cmp-bg:#091326;--cmp-surface:rgba(17,31,55,.86);--cmp-ink:#eef3ff;--cmp-muted:#a7b3cb;--cmp-line:rgba(201,215,243,.18);--cmp-primary:#8bc7ff;--cmp-primary-ink:#071426;--cmp-glow:rgba(139,199,255,.2);--cmp-orbit:#536ea5}}
html,body{min-height:100%}
body{margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 14% 10%,var(--cmp-orbit),transparent 34%),radial-gradient(circle at 90% 86%,var(--cmp-glow),transparent 32%),var(--cmp-bg);color:var(--cmp-ink);font-family:ui-rounded,"Noto Sans SC",system-ui,sans-serif;line-height:1.5}
.companion-bootstrap-shell{width:min(100%,420px)}
.companion-bootstrap-card{padding:clamp(24px,7vw,38px);border:1px solid var(--cmp-line);border-radius:28px;background:var(--cmp-surface);box-shadow:0 24px 64px rgba(25,20,28,.13);backdrop-filter:blur(18px)}
@media (prefers-color-scheme:dark){.companion-bootstrap-card{box-shadow:0 24px 68px rgba(0,0,0,.35)}}
.companion-bootstrap-mark{display:grid;width:50px;height:50px;place-items:center;margin-bottom:20px;border:1px solid var(--cmp-line);border-radius:18px;background:linear-gradient(145deg,var(--cmp-primary),var(--cmp-orbit));box-shadow:0 10px 24px var(--cmp-glow);color:var(--cmp-primary-ink);font-size:1.3rem;font-weight:800}
.companion-bootstrap-eyebrow{margin:0 0 7px;color:var(--cmp-primary);font-size:.72rem;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
h1{margin:0;font-size:clamp(1.45rem,5vw,1.8rem);letter-spacing:-.035em;line-height:1.15}
.companion-bootstrap-intro{margin:12px 0 24px;color:var(--cmp-muted);font-size:.9rem}
.companion-bootstrap-form{display:grid;gap:10px}
.companion-bootstrap-label{font-size:.8rem;font-weight:700}
.input{width:100%;min-height:46px;padding:11px 14px;border:1px solid var(--cmp-line);border-radius:15px;outline:0;background:color-mix(in srgb,var(--cmp-surface) 70%,transparent);color:inherit;font:inherit;letter-spacing:.04em}
.input:focus-visible{border-color:var(--cmp-primary);box-shadow:0 0 0 4px var(--cmp-glow)}
.btn{min-height:46px;margin-top:5px;padding:11px 16px;border:1px solid transparent;border-radius:15px;background:var(--cmp-primary);color:var(--cmp-primary-ink);font:inherit;font-weight:750;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,filter .16s ease}
.btn:hover{box-shadow:0 9px 22px var(--cmp-glow);filter:saturate(1.08);transform:translateY(-1px)}
.btn:focus-visible{outline:2px solid var(--cmp-primary);outline-offset:3px}
.companion-bootstrap-error{min-height:1.5em;margin:2px 0 0;color:var(--cmp-primary);font-size:.8rem}
.companion-bootstrap-note{margin:22px 0 0;color:var(--cmp-muted);font-size:.72rem}
@media (prefers-reduced-motion:reduce){.btn{transition:none}.btn:hover{transform:none}}
`;

/**
 * This document is intentionally independent of the authenticated DSH bundle.
 * It is only shown while BrowserAuth has not yet accepted a browser session.
 */
function bootstrapPage(hasError: boolean): string {
  const error = hasError ? BOOTSTRAP_ERROR : "";
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Companion · 继续</title>
    <style>${BOOTSTRAP_PAGE_STYLE}</style>
  </head>
  <body>
    <main class="companion-bootstrap-shell" data-testid="companion-bootstrap">
      <section class="card companion-bootstrap-card" aria-labelledby="companion-bootstrap-title">
        <div class="companion-bootstrap-mark" aria-hidden="true">✦</div>
        <p class="companion-bootstrap-eyebrow">Companion</p>
        <h1 id="companion-bootstrap-title">继续进入 Companion</h1>
        <p class="companion-bootstrap-intro">输入本次 DSH 启动令牌，完成一次安全验证。</p>
        <form class="companion-bootstrap-form" method="post" action="${BOOTSTRAP_PATH}" autocomplete="off">
          <label class="companion-bootstrap-label" for="companion-bootstrap-token">启动令牌</label>
          <input class="input" id="companion-bootstrap-token" name="${BOOTSTRAP_TOKEN_FIELD}" type="password" required maxlength="2048" autocomplete="off" spellcheck="false" aria-describedby="companion-bootstrap-error">
          <button class="btn btn-primary" type="submit">进入 Companion</button>
          <p class="companion-bootstrap-error" id="companion-bootstrap-error" role="alert" aria-live="polite">${error}</p>
        </form>
        <p class="companion-bootstrap-note">令牌仅用于这一次验证，不会保存在 Companion。</p>
      </section>
    </main>
  </body>
</html>`;
}

function writeBootstrap(res: ServerResponse, status: number, method: string | undefined, hasError: boolean): void {
  const body = bootstrapPage(hasError);
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (method === "HEAD") res.end();
  else res.end(body);
}

function writeBootstrapError(res: ServerResponse, status = 400): void {
  writeBootstrap(res, status, "POST", true);
}

function writePlainError(res: ServerResponse, status: 404 | 405, allow?: string): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    ...(allow ? { allow } : {}),
  });
  res.end();
}

type BootstrapTokenResult = { token: string } | { status: 400 | 413 };

function readBootstrapToken(req: IncomingMessage): Promise<BootstrapTokenResult> {
  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    req.resume();
    return Promise.resolve({ status: 400 });
  }
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined) {
    const declared = typeof contentLength === "string" ? Number(contentLength) : Number.NaN;
    if (!Number.isSafeInteger(declared) || declared < 0) {
      req.resume();
      return Promise.resolve({ status: 400 });
    }
    if (declared > BOOTSTRAP_MAX_BODY_BYTES) {
      req.resume();
      return Promise.resolve({ status: 413 });
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (result: BootstrapTokenResult): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("error", onError);
      resolve(result);
    };
    const rejectBody = (status: 400 | 413): void => {
      req.resume();
      finish({ status });
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > BOOTSTRAP_MAX_BODY_BYTES) {
        rejectBody(413);
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      const body = Buffer.concat(chunks).toString("utf8");
      const entries = [...new URLSearchParams(body).entries()];
      if (entries.length !== 1 || entries[0]?.[0] !== BOOTSTRAP_TOKEN_FIELD) {
        finish({ status: 400 });
        return;
      }
      const token = entries[0][1];
      if (!token.trim() || Buffer.byteLength(token, "utf8") > BOOTSTRAP_MAX_BODY_BYTES) {
        finish({ status: 400 });
        return;
      }
      finish({ token });
    };
    const onAborted = (): void => finish({ status: 400 });
    const onError = (): void => finish({ status: 400 });
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("aborted", onAborted);
    req.on("error", onError);
  });
}

function externalHeaders(req: IncomingMessage, includeCookie: boolean): Record<string, string> {
  return {
    ...(includeCookie && req.headers.cookie ? { cookie: req.headers.cookie } : {}),
    ...(req.headers.host ? { host: req.headers.host } : {}),
  };
}

function proxyCompanionRoot(webServer: WebServerLike, req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (status: 502 | 504): void => {
      if (!res.headersSent) res.writeHead(status, { "cache-control": "no-store", "referrer-policy": "no-referrer" });
      if (!res.writableEnded) res.end();
      finish();
    };
    let upstream;
    try {
      upstream = httpRequest({
        host: "127.0.0.1",
        port: webServer.port,
        path: "/",
        method: req.method,
        // BrowserAuth binds its cookie to the caller's external authority.
        headers: externalHeaders(req, true),
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("error", () => fail(502));
        response.on("end", () => {
          if (settled) return;
          if (response.statusCode === 401) {
            writeBootstrap(res, 200, req.method, false);
            finish();
            return;
          }
          const contentType = response.headers["content-type"];
          res.writeHead(response.statusCode ?? 502, contentType ? { "content-type": contentType } : undefined);
          if (req.method === "HEAD") res.end();
          else res.end(Buffer.concat(chunks));
          finish();
        });
      });
    } catch {
      fail(502);
      return;
    }
    upstream.setTimeout(3000, () => {
      upstream.destroy();
      fail(504);
    });
    upstream.on("error", () => fail(502));
    upstream.end();
  });
}

function setCookieHeaders(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length !== 1 || !value[0]) return undefined;
  return [value[0]];
}

function exchangeBootstrapToken(webServer: WebServerLike, req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (status = 502): void => {
      if (!res.headersSent) writeBootstrapError(res, status);
      else if (!res.writableEnded) res.end();
      finish();
    };
    let upstream;
    try {
      upstream = httpRequest({
        host: "127.0.0.1",
        port: webServer.port,
        method: "GET",
        path: `/?${BOOTSTRAP_TOKEN_FIELD}=${encodeURIComponent(token)}`,
        // Deliberately omit the form request's Cookie. BrowserAuth must see
        // only the submitted launch token during this root exchange.
        headers: externalHeaders(req, false),
      }, (response) => {
        response.resume();
        response.on("error", () => fail());
        response.on("end", () => {
          if (settled) return;
          const cookie = setCookieHeaders(response.headers["set-cookie"]);
          if (response.statusCode !== 303 || cookie === undefined) {
            writeBootstrapError(res, 400);
            finish();
            return;
          }
          res.writeHead(303, {
            "cache-control": "no-store",
            "content-length": "0",
            location: COMPANION_ROOT_PATH,
            "referrer-policy": "no-referrer",
            "set-cookie": cookie,
          });
          res.end();
          finish();
        });
      });
    } catch {
      fail();
      return;
    }
    upstream.setTimeout(3000, () => {
      upstream.destroy();
      fail(504);
    });
    upstream.on("error", () => fail());
    upstream.end();
  });
}

/**
 * The pinned web static service serves explicit files and otherwise returns
 * 404. Reuse its rendered root document for the Companion alias so the
 * browser receives the same boot payload and plugin manifest—there is no
 * second index or client transport. The pinned static service has no SPA
 * fallback, so this lifecycle-owned alias is required for this web plugin.
 */
export function companionAliasHandler(webServer: WebServerLike, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://companion.local").pathname;
  } catch {
    req.resume();
    writePlainError(res, 404);
    return Promise.resolve();
  }
  if (pathname === BOOTSTRAP_PATH) {
    if (req.method !== "POST") {
      req.resume();
      writePlainError(res, 405, "POST");
      return Promise.resolve();
    }
    return readBootstrapToken(req).then((parsed) => {
      if ("status" in parsed) {
        writeBootstrapError(res, parsed.status);
        return;
      }
      return exchangeBootstrapToken(webServer, req, res, parsed.token);
    });
  }
  if (pathname !== "/companion" && pathname !== COMPANION_ROOT_PATH) {
    req.resume();
    writePlainError(res, 404);
    return Promise.resolve();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.resume();
    writePlainError(res, 405, "GET, HEAD");
    return Promise.resolve();
  }
  return proxyCompanionRoot(webServer, req, res);
}

const relationshipTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_update_relationship",
  description: "Record one Companion relationship reaction for this Workspace. Supply mood, affinity, or both; at least one is required. When both change for the same conversational moment, include both so they persist atomically. Give each change its own concise factual reason, not hidden reasoning.",
  parameters: {
    mood: {
      type: "object",
      description: "Optional current-state change",
      properties: {
        value: { type: "string", required: true, enum: ["neutral", "serene", "bright", "playful", "tender", "pensive", "tired", "low"], description: "The new bounded current-state key" },
        note: { type: "string", description: "Optional user-facing 状态短句, at most 40 Unicode code points" },
        reason: { type: "string", required: true, description: "A concise factual reason for this mood change, at most 160 characters" },
      },
      additionalProperties: false,
    },
    affinity: {
      type: "object",
      description: "Optional affinity change; net movement per accepted user turn is bounded to ±10",
      properties: {
        delta: { type: "integer", required: true, description: "An integer from -10 through +10" },
        reason: { type: "string", required: true, description: "A concise factual reason for this affinity change, at most 160 characters" },
      },
      additionalProperties: false,
    },
  },
  output: {
    schema: {
      type: "object",
      properties: { mood: { type: "string" }, note: { type: "string" }, delta: { type: "integer" }, affinity: { type: "integer", required: true }, stage: { type: "string", required: true }, message: { type: "string", required: true } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: String(value.message) }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中更新。");
    const requested = canonicalizeRelationshipUpdate(args);
    const result = await updateRelationshipForAcceptedTurn(owner.storeFor(workspace), args, exec);
    const state = result.state;
    const message = requested.mood !== undefined && requested.affinity !== undefined
      ? `Companion 此刻状态已更新为 ${MOOD_LABELS[state.mood]}，亲近度现在是 ${state.affinity}（${affinityStage(state.affinity)}）。`
      : requested.mood !== undefined
        ? `Companion 此刻状态已更新为 ${MOOD_LABELS[state.mood]}。`
        : `亲近度 ${(result.delta ?? 0) >= 0 ? "增加" : "减少"} ${Math.abs(result.delta ?? 0)}，现在是 ${state.affinity}（${affinityStage(state.affinity)}）。`;
    return {
      ...(requested.mood === undefined ? {} : { mood: state.mood, ...(state.note === undefined ? {} : { note: state.note }) }),
      ...(requested.affinity === undefined ? {} : { delta: result.delta }),
      affinity: state.affinity,
      stage: affinityStage(state.affinity),
      message,
    };
  },
});

const historyTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_read_history",
  description: "Read a small recent slice of this Workspace's Companion relationship history when an earlier mood, note, affinity reason, or signature change is relevant. Records are newest first. This does not change current state; omit limit for 10 records, with a maximum of 20.",
  parameters: {
    limit: { type: "integer", description: "Optional number of newest records to return, from 1 through 20; defaults to 10" },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        records: {
          type: "array",
          required: true,
          items: {
            type: "object",
            properties: {
              at: { type: "string", required: true },
              changes: {
                type: "object",
                required: true,
                properties: {
                  seed: { type: "boolean" },
                  mood: { type: "object", properties: { value: { type: "string", required: true }, note: { type: "string" }, reason: { type: "string" } }, additionalProperties: false },
                  affinity: { type: "object", properties: { delta: { type: "integer", required: true }, value: { type: "integer", required: true }, reason: { type: "string" } }, additionalProperties: false },
                  signature: { type: "object", properties: { value: { type: "string", required: true }, reason: { type: "string" } }, additionalProperties: false },
                },
                additionalProperties: false,
              },
              state: {
                type: "object",
                required: true,
                properties: { mood: { type: "string", required: true }, note: { type: "string" }, affinity: { type: "integer", required: true }, signature: { type: "string", required: true } },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        message: { type: "string", required: true },
      },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: `${String(value.message)}\n${JSON.stringify(value.records, null, 2)}` }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中读取关系历史。");
    const limit = canonicalizeHistoryRead(args);
    const records = await owner.storeFor(workspace).readHistory(limit, exec.signal);
    return { records, message: `读取了最近 ${records.length} 条关系记录（由新到旧）。` };
  },
});

const signatureTool = (owner: CompanionHostController): ToolDefinition => defineTool({
  name: "companion_set_signature",
  description: "Replace or clear the Companion's relatively durable personal signature for this Workspace, with a concise factual reason for the change.",
  parameters: {
    signature: { type: "string", required: true, description: "One plain Unicode line, at most 80 characters; an empty string clears it" },
    reason: { type: "string", required: true, description: "A concise factual reason for this signature change, at most 160 characters" },
  },
  output: {
    schema: { type: "object", properties: { signature: { type: "string", required: true }, message: { type: "string", required: true } }, additionalProperties: false },
    render: (_args, value) => [{ type: "text", text: String(value.message) }],
  },
  async execute(args, exec) {
    const workspace = owner.configuredWorkspace(undefined, currentCwd(exec))?.workspace;
    if (!workspace) throw new CompanionValidationError("Companion 只能在已配置的 Workspace 中更新。");
    const signature = canonicalizeSignature((args as { signature?: unknown }).signature);
    const reason = canonicalizeChangeReason((args as { reason?: unknown }).reason);
    const state = await owner.storeFor(workspace).setSignature(signature, reason, exec.signal);
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
    return store;
  }

  /** Complete the configured store load before prompt registrations become available. */
  async initialize(): Promise<void> {
    const configured = this.configuredWorkspace();
    if (configured) await this.storeFor(configured.workspace).load();
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

  private voiceCapability(): boolean {
    return optionalKeposSpeech(this.ctx) !== undefined;
  }

  private async transcribeVoice(request: CompanionVoiceRequest, signal: AbortSignal): Promise<RpcResult<CompanionVoiceTranscription>> {
    const configured = this.configuredWorkspace(request.workspaceId);
    if (!configured) return fail("找不到已配置的 Companion Workspace。", "workspace-not-found");
    if (!workspaceOwnsSession(configured.workspace, request.sessionId)) return fail("所选对话不属于 Companion Workspace。", "session-not-found");
    const service = optionalKeposSpeech(this.ctx);
    if (!service) return fail("语音转写尚未配置，请安装并配置 Kepos Speech。", "transcription-unavailable");
    if (signal.aborted) return fail("语音转写已取消。", "cancelled");
    try {
      const raw = await service.transcribe({ sessionId: request.sessionId, mediaType: request.mediaType, data: request.data }, signal);
      if (signal.aborted) return fail("语音转写已取消。", "cancelled");
      const normalized = normalizeCompanionVoiceTranscription(raw);
      return normalized ? ok(normalized) : fail("语音转写结果无效，请再试一次。", "transcription-failed");
    } catch {
      if (signal.aborted) return fail("语音转写已取消。", "cancelled");
      return fail("语音转写暂时不可用，请稍后重试。", "transcription-failed");
    }
  }

  register(): void {
    this.ctx.tools.register(historyTool(this));
    this.ctx.tools.register(relationshipTool(this));
    this.ctx.tools.register(signatureTool(this));
    this.disposers.push(this.ctx.on("llm/stream", (options, next) => {
      const rewritten = rewriteCompanionCompactionRequest(options, this.configuredWorkspace()?.workspace.sessionIds);
      if (rewritten !== options) options.messages = rewritten.messages;
      return next();
    }, { global: true }));
    this.disposers.push(this.ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload, signal) => {
      const record = typeof payload === "object" && payload !== null ? payload as { workspaceId?: unknown; affinity?: unknown; revision?: unknown } : {};
      const requested = typeof record.workspaceId === "string" ? record.workspaceId : undefined;
      if (endpoint === VOICE_TRANSCRIBE_ENDPOINT) {
        const request = parseCompanionVoiceRequest(payload);
        if (!request) return fail("语音请求格式无效。", "invalid-input");
        return this.transcribeVoice(request, signal);
      }
      const configured = this.configuredWorkspace(requested);
      if (!configured) return fail("找不到已配置的 Companion Workspace。", "workspace-not-found");
      if (endpoint === VOICE_CAPABILITY_ENDPOINT) return ok({ available: this.voiceCapability() });
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
    }));
    this.disposers.push(this.ctx.systemPrompt.context({
      name: RELATIONSHIP_CONTEXT_NAME,
      order: 140,
      text: (context) => {
        const configured = this.configuredWorkspace(undefined, context.agent?.session?.header?.cwd);
        if (!configured) return "";
        const state = this.storeFor(configured.workspace).getLoadedSnapshot();
        return state ? formatCompanionPrompt(state, checkedSettings(configured.settings)) : "";
      },
    }));
    this.disposers.push(this.ctx.on("system-prompt/assemble", async (assembly, context, next) => {
      const contribution = assembly.contexts.find((entry) => entry.name === RELATIONSHIP_CONTEXT_NAME);
      if (!contribution) return next();
      const configured = this.configuredWorkspace(undefined, context.agent?.session?.header?.cwd);
      if (!configured) {
        contribution.text = "";
        return next();
      }
      const store = this.storeFor(configured.workspace);
      const state = store.getLoadedSnapshot() ?? await store.load(context.signal);
      contribution.text = formatCompanionPrompt(state, checkedSettings(configured.settings));
      return next();
    }));
    const webServer = this.ctx.webServer;
    this.disposers.push(webServer.register({ kind: "prefix", path: "/companion", handler: (req, res) => companionAliasHandler(webServer, req, res) }));
  }

  async dispose(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) await dispose();
    this.stores.clear();
  }
}

export const name = "dsh-companion" as const;
export const inject = ["fs", "settings", "systemPrompt", "tools", "connection", "workspaceRegistry", "llm", "webServer"] as const;

export async function* apply(ctx: HostContextLike): AsyncGenerator<() => Promise<void>> {
  const settingsScope = ctx.settings.register<CompanionSettings>(SETTINGS_NAMESPACE, SettingsSchema, {
    applies: "live",
    validate: (value) => {
      if (value.workspaceId.trim()) validateIdentitySettings(value);
      else if (!Number.isInteger(value.defaultAffinity) || value.defaultAffinity < 0 || value.defaultAffinity > 100) throw new CompanionValidationError("默认亲近度必须是 0 到 100 的整数。");
    },
  });
  const controller = new CompanionHostController(ctx, settingsScope);
  await controller.initialize();
  controller.register();
  yield () => controller.dispose();
}

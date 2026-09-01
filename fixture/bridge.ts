import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { ClientConnectionRpc, ConnectionRpcResult } from "@deepseek-ai/dsh-client-connection/client";
import type { SessionListState, SessionSnapshot } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot, WorkspaceView } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SettingsScope, SettingsScopeSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ClientSettings } from "../src/client/settings.js";
import { CompanionRoot } from "../src/client/CompanionRoot.js";

type Listener = () => void;

class FixtureStore<T> {
  private readonly listeners = new Set<Listener>();
  constructor(private value: T) {}
  getSnapshot = (): T => this.value;
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: T): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

type RelationshipMode = "pending" | "ready" | "missing" | "error";
type ReadinessMode = "pending" | "ready" | "missing" | "error";

interface PendingRelationshipCall {
  readonly endpoint: "relationship/get" | "relationship/watch";
  readonly resolve: (result: ConnectionRpcResult<unknown>) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
}

function ok<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value };
}

function failure(code: string, message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details: {} } };
}

const workspaceId = "workspace-a";
const sessionId = "session-a";
const workspace: WorkspaceView = {
  workspaceId: workspaceId as never,
  path: "/tmp/dsh-companion-fixture",
  title: "Companion fixture",
  sessionIds: [sessionId as never],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const settingsValue: ClientSettings = {
  workspaceId,
  companionName: "小灯",
  userName: "小岛",
  preferredAddress: "小岛",
  defaultAffinity: 67,
};
const settingsSnapshot: SettingsScopeSnapshot<ClientSettings> = {
  status: "ready" as const,
  value: settingsValue,
  base: settingsValue,
  user: settingsValue,
  revision: 1,
  writable: false,
  mode: "memory" as const,
};

const sessionSummary = {
  id: sessionId,
  displayTitle: "今晚的小星光",
  title: "今晚的小星光",
  running: false,
  blank: false,
  updatedAt: Date.now(),
};

function listSnapshot(mode: ReadinessMode): SessionListState {
  if (mode === "pending") return { ids: [], byId: {}, current: undefined, phase: "pending", subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined };
  return { ids: [sessionId as never], byId: { [sessionId]: sessionSummary } as unknown as SessionListState["byId"], current: undefined, phase: "ready", subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined };
}

function sessionSnapshot(openState: SessionSnapshot["openState"]): SessionSnapshot {
  const openError = { code: "gateway/internal", message: "fixture session failed", details: {} } as unknown as NonNullable<SessionSnapshot["openError"]>;
  return {
    sessionId: sessionId as never,
    queue: [],
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState,
    openError: openState === "error" ? openError : null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  };
}

function relationshipView(present: boolean, revision: number): Record<string, unknown> {
  return {
    identity: settingsValue,
    state: { mood: "tender", note: "今天想慢一点", affinity: 67, signature: "留一盏灯" },
    workspacePresent: present,
    revision,
  };
}

export function mountBridgeFixture(target: HTMLElement): void {
  const workspaceStore = new FixtureStore<WorkspaceSnapshot>({ items: [], archivedSessionIds: [], state: "loading", phase: "pending", error: null });
  const sessionListStore = new FixtureStore<SessionListState>(listSnapshot("pending"));
  const sessionStore = new FixtureStore<SessionSnapshot>(sessionSnapshot("cold"));
  const settingsStore = new FixtureStore<SettingsScopeSnapshot<ClientSettings>>(settingsSnapshot);
  const connectionStore = new FixtureStore<string>("connected");
  const chatStore = new FixtureStore<unknown>({ order: [], nodes: new Map() });
  const undefinedProjection = new FixtureStore<unknown>(undefined);
  let relationshipMode: RelationshipMode = "pending";
  let relationshipRevision = 0;
  const pendingRelationshipCalls = new Set<PendingRelationshipCall>();

  const relationshipResult = (): ConnectionRpcResult<unknown> => {
    relationshipRevision += 1;
    if (relationshipMode === "missing") return ok(relationshipView(false, relationshipRevision));
    return ok(relationshipView(true, relationshipRevision));
  };

  const settleRelationshipCalls = (): void => {
    for (const pending of [...pendingRelationshipCalls]) {
      pendingRelationshipCalls.delete(pending);
      if (relationshipMode === "error") pending.reject(new Error("fixture relationship unavailable"));
      else pending.resolve(relationshipResult());
    }
  };

  const rpc: ClientConnectionRpc = {
    call(_channel, endpoint, _payload, signal) {
      if (endpoint !== "relationship/get" && endpoint !== "relationship/watch") return Promise.resolve(ok({}));
      if (relationshipMode !== "pending" && endpoint === "relationship/get") {
        if (relationshipMode === "error") return Promise.reject(new Error("fixture relationship unavailable"));
        return Promise.resolve(relationshipResult());
      }
      return new Promise<ConnectionRpcResult<unknown>>((resolve, reject) => {
        const pending: PendingRelationshipCall = { endpoint, resolve, reject, signal };
        pendingRelationshipCalls.add(pending);
        const abort = (): void => {
          pendingRelationshipCalls.delete(pending);
          reject(new DOMException("aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
  };

  const fakeSession = {
    sessionId: sessionId as never,
    getSnapshot: sessionStore.getSnapshot,
    subscribe: sessionStore.subscribe,
    projections: { faceOf: () => undefinedProjection },
    beginSubmission: () => { throw new Error("bridge fixture does not submit"); },
    prompt: async () => ok({ accepted: true as const }),
    readAttachment: async () => failure("fixture-attachment", "fixture attachment unavailable"),
    updateQueue: async () => ok({ accepted: true as const }),
    cancel: async () => ok({ accepted: true as const }),
    rename: async (title: string) => ok({ title, seq: 1 }),
    loadOlder: async () => undefined,
    loadThrough: async () => undefined,
    command: async () => ok({ matched: false }),
  };

  const settings: SettingsScope<ClientSettings> = {
    getSnapshot: settingsStore.getSnapshot,
    subscribe: settingsStore.subscribe,
    mutate: async () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
  };
  const sessions = {
    list: sessionListStore,
    binding: (id: string) => id === sessionId ? { sessionId: sessionId as never, session: fakeSession } : undefined,
    open: (id: string) => { if (id === sessionId) sessionStore.set(sessionSnapshot("open")); },
    create: async () => sessionId as never,
  };
  const conversation = { target: (targetName: string) => targetName === "chat" ? chatStore : undefined };
  const ctx = {
    sessions,
    workspaces: { list: workspaceStore },
    uiConversation: { binding: () => conversation },
    connection: { state: connectionStore, rpc, isLoopback: true },
    theme: { getTheme: () => ({ active: { colorScheme: "light" } }) },
    on: () => () => undefined,
  } as unknown as ClientContext;
  const reactRoot = createRoot(target);
  reactRoot.render(createElement(CompanionRoot, { ctx, settings }));

  const setWorkspace = (mode: "ready" | "missing" | "error"): void => {
    if (mode === "ready") workspaceStore.set({ items: [workspace], archivedSessionIds: [], state: "idle", phase: "ready", error: null });
    else if (mode === "missing") workspaceStore.set({ items: [], archivedSessionIds: [], state: "idle", phase: "ready", error: null });
    else workspaceStore.set({ items: [], archivedSessionIds: [], state: "error", phase: "ready", error: { code: "gateway/internal", message: "fixture workspace unavailable", details: {} } as unknown as NonNullable<WorkspaceSnapshot["error"]> });
  };
  const setRelationship = (mode: Exclude<RelationshipMode, "pending">): void => {
    relationshipMode = mode;
    settleRelationshipCalls();
  };
  const setSession = (mode: "ready" | "error"): void => {
    sessionListStore.set(listSnapshot("ready"));
    sessionStore.set(sessionSnapshot(mode === "error" ? "error" : "cold"));
    if (mode === "ready") queueMicrotask(() => sessionStore.set(sessionSnapshot("open")));
  };
  const setSettingsUnavailable = (): void => { settingsStore.set({ ...settingsSnapshot, status: "unavailable", value: undefined }); };
  const dispose = (): void => { reactRoot.unmount(); };
  window.__companionBridgeFixture = { setWorkspace, setRelationship, setSession, setSettingsUnavailable, dispose };
}

declare global {
  interface Window {
    __companionBridgeFixture?: {
      setWorkspace(mode: "ready" | "missing" | "error"): void;
      setRelationship(mode: "ready" | "missing" | "error"): void;
      setSession(mode: "ready" | "error"): void;
      setSettingsUnavailable(): void;
      dispose(): void;
    };
  }
}

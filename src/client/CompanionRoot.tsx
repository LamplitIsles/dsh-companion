import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ClientContext, ISession, ConversationSnapshot, SessionListState, WorkspaceListState } from "@deepseek-ai/dsh-client-runtime/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import Companion from "./Companion.svelte";
import { affinityStage, MOOD_LABELS } from "./relationship.js";
import { projectConversation } from "../projection.js";
import { TtsPreparationCache } from "./voice-cache.js";
import type { ClientSettings } from "./settings.js";
import { RPC_CHANNEL as TTS_CHANNEL, RPC_ENDPOINT as TTS_ENDPOINT } from "./tts-contract.js";

export interface CompanionRootInjected {
  ctx: ClientContext;
  settings: SettingsScope<ClientSettings>;
}

interface RelationshipView {
  identity?: ClientSettings;
  state?: { mood: string; intensity: number; note?: string; affinity: number; signature: string };
  workspacePresent: boolean;
}

function useSnapshot<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void } | undefined, fallback: T): T {
  const subscribe = source?.subscribe?.bind(source) ?? (() => () => undefined);
  const getSnapshot = source?.getSnapshot?.bind(source) ?? (() => fallback);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function settingsValue(scope: SettingsScope<ClientSettings>): ClientSettings | undefined {
  const value = scope.getSnapshot().value;
  return value;
}

function workspaceFor(settings: ClientSettings | undefined, workspaceState: WorkspaceListState): { id: string; path?: string } | undefined {
  if (!settings?.workspaceId) return undefined;
  const item = workspaceState.items.find((candidate) => String((candidate as { workspaceId?: unknown }).workspaceId ?? (candidate as { id?: unknown }).id) === settings.workspaceId);
  if (!item) return undefined;
  return { id: settings.workspaceId, path: (item as { path?: string }).path };
}

function sessionBelongs(summary: { cwd?: string }, workspace: { path?: string }): boolean {
  if (!summary.cwd || !workspace.path) return false;
  const clean = (value: string) => value.replace(/[\\/]+$/u, "").replace(/\\/gu, "/");
  return clean(summary.cwd) === clean(workspace.path);
}

function sessionStorageKey(workspaceId: string): string {
  return `dsh-companion:session:${encodeURIComponent(workspaceId)}`;
}

function readRememberedSession(workspaceId: string, candidates: readonly { id: string }[]): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(sessionStorageKey(workspaceId));
    return value && candidates.some((candidate) => candidate.id === value) ? value : undefined;
  } catch { return undefined; }
}

function mostRecentSession(list: SessionListState, workspace: { id: string; path?: string }): string | undefined {
  const candidates = list.ids.map((id) => list.byId[id]).filter((summary) => summary && !summary.origin && sessionBelongs(summary, workspace));
  const remembered = readRememberedSession(workspace.id, candidates);
  if (remembered) return remembered;
  const current = list.current && candidates.some((candidate) => candidate.id === list.current) ? list.current : undefined;
  if (current) return current;
  const durable = candidates.filter((candidate) => !candidate.blank);
  return (durable.length > 0 ? durable : candidates)
    .sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))[0]?.id;
}

function imageUrl(session: ISession, attachment: unknown): Promise<string> {
  const id = typeof attachment === "object" && attachment !== null ? (attachment as { attachmentId?: unknown }).attachmentId : undefined;
  if (typeof id !== "string") return Promise.reject(new Error("attachment-invalid"));
  return session.readAttachment(id as never).then((result) => {
    if (!result.ok) throw new Error(result.error.message);
    const type = result.value.attachment.mediaType || "image/png";
    return URL.createObjectURL(new Blob([new Uint8Array(result.value.data).buffer as ArrayBuffer], { type }));
  });
}

export function CompanionRoot({ ctx, settings }: CompanionRootInjected): JSX.Element {
  const list = useSnapshot<SessionListState>(ctx.sessions.list, { ids: [], byId: {}, current: undefined, phase: "pending", subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined });
  const workspaceList = useSnapshot<WorkspaceListState>(ctx.workspaces.list, { items: [], archivedSessionIds: [], state: "loading", phase: "pending", error: null, baselinesReady: false, recentWorkspaceId: undefined });
  const settingsSubscribe = useMemo(() => settings.subscribe.bind(settings), [settings]);
  const settingsGetSnapshot = useMemo(() => settings.getSnapshot.bind(settings), [settings]);
  const settingsSnapshot = useSyncExternalStore(settingsSubscribe, settingsGetSnapshot, settingsGetSnapshot);
  const configured = settingsSnapshot.value;
  const workspace = workspaceFor(configured, workspaceList);
  const remembered = workspace ? mostRecentSession(list, workspace) : undefined;
  const [relationship, setRelationship] = useState<RelationshipView>({ workspacePresent: false });
  const themeRuntime = (ctx as unknown as { theme?: { getTheme?: () => { active?: { colorScheme?: string } } } }).theme;
  const [scheme, setScheme] = useState<"light" | "dark">(() => themeRuntime?.getTheme?.().active?.colorScheme === "dark" ? "dark" : "light");
  const [recoveryKey, setRecoveryKey] = useState(0);
  const session = remembered ? ctx.sessions.binding(remembered as never)?.session : undefined;
  const sessionSnapshot = useSnapshot<ConversationSnapshot>(session, session ? session.getSnapshot() : ({ sessionId: "", chat: { order: [], nodes: {}, locations: {}, timeline: {}, legacy: { nodes: [] } }, nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [], pending: [], queue: [], running: false, subagent: null, composerPhase: "ready", removed: false, openState: "cold", openError: null, hasMore: false, loadingOlder: false, promptError: null, blank: true, lastAgentError: null } as unknown as ConversationSnapshot));
  const ttsCache = useRef<TtsPreparationCache>();
  if (!ttsCache.current) ttsCache.current = new TtsPreparationCache();

  useEffect(() => {
    let cancelled = false;
    const connection = (ctx as unknown as { connection: { rpc: ClientConnectionRpc } }).connection;
    const refresh = () => {
      if (!configured?.workspaceId) { setRelationship({ workspacePresent: false }); return; }
      void connection.rpc.call("/dsh-companion", "relationship/get", { workspaceId: configured.workspaceId }).then((result) => {
        if (!cancelled && result.ok) setRelationship(result.value as RelationshipView);
      }).catch(() => { if (!cancelled) setRelationship({ workspacePresent: false }); });
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ctx, configured?.workspaceId, recoveryKey]);

  useEffect(() => {
    const listener = (snapshot: { active?: { colorScheme?: string } }) => setScheme(snapshot.active?.colorScheme === "dark" ? "dark" : "light");
    const dispose = ctx.on("theme/change", listener as never);
    return () => { if (typeof dispose === "function") dispose(); };
  }, [ctx]);

  useEffect(() => {
    if (!workspace || !remembered || typeof window === "undefined") return;
    try { window.localStorage.setItem(sessionStorageKey(workspace.id), remembered); } catch { /* storage may be unavailable in private browsing */ }
  }, [workspace?.id, remembered]);

  useEffect(() => {
    if (!workspace || !workspaceList.baselinesReady) return;
    if (remembered) return;
    let disposed = false;
    void ctx.workspaces.connectWorkspace(workspace.id as never).then((id) => { if (!disposed) ctx.sessions.open(id); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [ctx, workspace?.id, workspaceList.baselinesReady, remembered]);

  useEffect(() => () => { ttsCache.current?.dispose(); }, []);

  const projection = useMemo(() => projectConversation(sessionSnapshot, Boolean(session)), [sessionSnapshot, session]);
  const identity = useMemo(() => {
    const state = relationship.state;
    const settingsValue = relationship.identity ?? configured;
    return {
      companionName: settingsValue?.companionName ?? "Companion",
      companionAvatar: settingsValue?.companionAvatar?.data,
      userName: settingsValue?.userName ?? "你",
      userAvatar: settingsValue?.userAvatar?.data,
      preferredAddress: settingsValue?.preferredAddress ?? "你",
      signature: state?.signature ?? "",
      mood: state?.mood ?? "neutral",
      moodLabel: state ? (MOOD_LABELS as Record<string, string>)[state.mood] ?? state.mood : "如常",
      intensity: state?.intensity ?? 1,
      moodNote: state?.note,
      affinity: state?.affinity ?? settingsValue?.defaultAffinity ?? 50,
      affinityStage: affinityStage(state?.affinity ?? settingsValue?.defaultAffinity ?? 50),
    };
  }, [relationship, configured]);
  const actions = useMemo(() => {
    const rpc: ClientConnectionRpc = (ctx as unknown as { connection: { rpc: ClientConnectionRpc } }).connection.rpc;
    return {
      async send(text: string, mode: "queue" | "steer"): Promise<void> {
        if (!session) throw new Error("session-unavailable");
        const result = await session.prompt([{ type: "text", text }], mode);
        if (!result.ok) throw new Error(result.error.message);
      },
      async loadOlder(): Promise<void> { await session?.loadOlder(); },
      async attachmentUrl(attachment: unknown): Promise<string> { if (!session) throw new Error("session-unavailable"); return imageUrl(session, attachment); },
      async prepareVoice(text: string): Promise<string> {
        if (!session) throw new Error("session-unavailable");
        const prepared = await ttsCache.current!.prepare(String(session.sessionId), text, { synthesize: async (value, sessionId, signal) => {
          const result = await rpc.call(TTS_CHANNEL, TTS_ENDPOINT, { text: value, sessionId }, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        } });
        return prepared.url;
      },
    };
  }, [(ctx as unknown as { connection: { rpc: ClientConnectionRpc } }).connection.rpc, session]);

  const svelteProps = {
    projection,
    identity,
    scheme,
    actions,
    workspaceReady: Boolean(workspace && relationship.workspacePresent),
    sessionReady: Boolean(session),
    "on:advanced": () => { window.location.assign("/"); },
    "on:recovery": () => setRecoveryKey((value) => value + 1),
  };
  return createElement(SvelteMount, { props: svelteProps });
}

function SvelteMount({ props }: { props: Record<string, unknown> }): JSX.Element {
  const target = useRef<HTMLDivElement>(null);
  const instance = useRef<{ $set(next: Record<string, unknown>): void; $destroy(): void }>();
  useEffect(() => {
    if (!target.current) return undefined;
    const Component = Companion as unknown as new (options: { target: HTMLElement; props: Record<string, unknown> }) => { $set(next: Record<string, unknown>): void; $destroy(): void };
    instance.current = new Component({ target: target.current, props });
    return () => { instance.current?.$destroy(); instance.current = undefined; };
  }, []);
  useEffect(() => { instance.current?.$set(props); }, [props]);
  return createElement("div", { ref: target, style: { display: "contents" } });
}

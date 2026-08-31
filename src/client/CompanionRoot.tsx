import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";
import type { ClientContext, ISession, ConversationSnapshot, SessionListState, WorkspaceListState } from "@deepseek-ai/dsh-client-runtime/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import type { ClientConnectionRpc, ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import CompanionBridge from "./CompanionBridge.svelte";
import type { CompanionBridgeProps } from "./companion-bridge.js";
import { affinityStage, companionSessionList, MOOD_LABELS, selectCompanionSession } from "./relationship.js";
import { projectConversation } from "../projection.js";
import { TtsPreparationCache } from "./voice-cache.js";
import { submitCompanionInput } from "./admission.js";
import { companionSessionOpenPlan } from "./session-opening.js";
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
  revision: number;
}

function useSnapshot<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void } | undefined, fallback: T): T {
  const subscribe = source?.subscribe?.bind(source) ?? (() => () => undefined);
  const getSnapshot = source?.getSnapshot?.bind(source) ?? (() => fallback);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function workspaceFor(settings: ClientSettings | undefined, workspaceState: WorkspaceListState): { id: string; sessionIds: readonly string[] } | undefined {
  if (!settings?.workspaceId) return undefined;
  const item = workspaceState.items.find((candidate) => String((candidate as { workspaceId?: unknown }).workspaceId ?? (candidate as { id?: unknown }).id) === settings.workspaceId);
  if (!item) return undefined;
  return { id: settings.workspaceId, sessionIds: (item as { sessionIds?: readonly string[] }).sessionIds ?? [] };
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

function mostRecentSession(list: SessionListState, workspace: { id: string; sessionIds: readonly string[] }, archivedSessionIds: readonly string[]): string | undefined {
  const rows = list.byId as Record<string, (typeof list.byId)[keyof typeof list.byId] | undefined>;
  const candidates = workspace.sessionIds.map((id) => rows[id]).filter((summary): summary is NonNullable<typeof summary> => Boolean(summary));
  const remembered = readRememberedSession(workspace.id, candidates);
  return selectCompanionSession(workspace.id, candidates, remembered, {
    sessionIds: workspace.sessionIds,
    archivedSessionIds,
  });
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
  const connection = (ctx as unknown as { connection: ConnectionHandle }).connection;
  const hostDescription = useSnapshot(connection.hostDescription, undefined);
  const settingsSubscribe = useMemo(() => settings.subscribe.bind(settings), [settings]);
  const settingsGetSnapshot = useMemo(() => settings.getSnapshot.bind(settings), [settings]);
  const settingsSnapshot = useSyncExternalStore(settingsSubscribe, settingsGetSnapshot, settingsGetSnapshot);
  const configured = settingsSnapshot.value;
  const workspace = workspaceFor(configured, workspaceList);
  const remembered = workspace ? mostRecentSession(list, workspace, workspaceList.archivedSessionIds) : undefined;
  const workspaceRows = useMemo(() => {
    if (!workspace) return [];
    const rows = list.byId as Record<string, (typeof list.byId)[keyof typeof list.byId] | undefined>;
    return workspace.sessionIds.map((id) => rows[id]).filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [list.byId, workspace]);
  const availableSessions = useMemo(() => workspace ? companionSessionList(workspaceRows, undefined, {
    sessionIds: workspace.sessionIds,
    archivedSessionIds: workspaceList.archivedSessionIds,
  }) : [], [workspace, workspaceList.archivedSessionIds, workspaceRows]);
  const [selected, setSelected] = useState<{ workspaceId: string; sessionId: string }>();
  const selectedSessionId = workspace && selected?.workspaceId === workspace.id && availableSessions.some((item) => item.id === selected.sessionId)
    ? selected.sessionId
    : remembered;
  const [relationship, setRelationship] = useState<RelationshipView>({ workspacePresent: false, revision: 0 });
  const themeRuntime = (ctx as unknown as { theme?: { getTheme?: () => { active?: { colorScheme?: string } } } }).theme;
  const [scheme, setScheme] = useState<"light" | "dark">(() => themeRuntime?.getTheme?.().active?.colorScheme === "dark" ? "dark" : "light");
  const [recoveryKey, setRecoveryKey] = useState(0);
  const session = selectedSessionId ? ctx.sessions.binding(selectedSessionId as never)?.session : undefined;
  const sessionSnapshot = useSnapshot<ConversationSnapshot>(session, session ? session.getSnapshot() : ({ sessionId: "", chat: { order: [], nodes: {}, locations: {}, timeline: {}, legacy: { nodes: [] } }, nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [], pending: [], queue: [], running: false, subagent: null, composerPhase: "ready", removed: false, openState: "cold", openError: null, hasMore: false, loadingOlder: false, promptError: null, blank: true, lastAgentError: null } as unknown as ConversationSnapshot));
  const ttsCache = useRef<TtsPreparationCache>();
  if (!ttsCache.current) ttsCache.current = new TtsPreparationCache();

  useEffect(() => {
    const controller = new AbortController();
    const workspaceId = configured?.workspaceId;
    if (!workspaceId) { setRelationship({ workspacePresent: false, revision: 0 }); return () => controller.abort(); }
    const run = async (): Promise<void> => {
      try {
        let result = await connection.rpc.call("/dsh-companion", "relationship/get", { workspaceId }, controller.signal);
        while (!controller.signal.aborted) {
          if (!result.ok) throw new Error(result.error?.message ?? "relationship-unavailable");
          const next = result.value as RelationshipView;
          setRelationship(next);
          result = await connection.rpc.call("/dsh-companion", "relationship/watch", { workspaceId, revision: next.revision }, controller.signal);
        }
      } catch {
        if (!controller.signal.aborted) setRelationship({ workspacePresent: false, revision: 0 });
      }
    };
    void run();
    return () => controller.abort();
  }, [connection, configured?.workspaceId, hostDescription, recoveryKey]);

  useEffect(() => {
    const listener = (snapshot: { active?: { colorScheme?: string } }) => setScheme(snapshot.active?.colorScheme === "dark" ? "dark" : "light");
    const dispose = ctx.on("theme/change", listener as never);
    return () => { if (typeof dispose === "function") dispose(); };
  }, [ctx]);

  useEffect(() => {
    if (!workspace || !selectedSessionId || typeof window === "undefined") return;
    try { window.localStorage.setItem(sessionStorageKey(workspace.id), selectedSessionId); } catch { /* storage may be unavailable in private browsing */ }
  }, [workspace?.id, selectedSessionId]);

  useEffect(() => {
    const plan = companionSessionOpenPlan(workspaceList.baselinesReady, workspace?.id, selectedSessionId);
    if (!plan) return;
    if (plan.kind === "open") {
      ctx.sessions.open(plan.sessionId as never);
      return;
    }
    let disposed = false;
    void ctx.workspaces.connectWorkspace(plan.workspaceId as never).then((id) => { if (!disposed) ctx.sessions.open(id); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [ctx, workspace?.id, workspaceList.baselinesReady, selectedSessionId]);

  useEffect(() => () => { ttsCache.current?.dispose(); }, []);

  const projection = useMemo(() => projectConversation(sessionSnapshot, Boolean(hostDescription)), [sessionSnapshot, hostDescription]);
  const identity = useMemo(() => {
    const state = relationship.state;
    const source = relationship.identity ?? configured;
    return {
      companionName: source?.companionName ?? "Companion",
      companionAvatar: source?.companionAvatar?.data,
      userName: source?.userName ?? "你",
      userAvatar: source?.userAvatar?.data,
      preferredAddress: source?.preferredAddress ?? "你",
      signature: state?.signature ?? "",
      mood: state?.mood ?? "neutral",
      moodLabel: state ? (MOOD_LABELS as Record<string, string>)[state.mood] ?? state.mood : "如常",
      intensity: state?.intensity ?? 1,
      moodNote: state?.note,
      affinity: state?.affinity,
      affinityStage: state ? affinityStage(state.affinity) : undefined,
    };
  }, [relationship, configured]);
  const actions = useMemo(() => {
    const rpc: ClientConnectionRpc = connection.rpc;
    return {
      async send(text: string): Promise<void> {
        if (!session) throw new Error("session-unavailable");
        await submitCompanionInput(session, text);
      },
      async selectSession(sessionId: string): Promise<void> {
        if (!workspace || !workspace.sessionIds.includes(sessionId)) throw new Error("session-not-in-companion-workspace");
        setSelected({ workspaceId: workspace.id, sessionId });
        if (typeof window !== "undefined") {
          try { window.localStorage.setItem(sessionStorageKey(workspace.id), sessionId); } catch { /* storage may be unavailable */ }
        }
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
  }, [connection.rpc, session, workspace]);

  const sessions = useMemo(() => {
    return availableSessions.map((item) => ({ ...item, selected: item.id === selectedSessionId }));
  }, [availableSessions, selectedSessionId]);

  const svelteProps: CompanionBridgeProps = {
    projection,
    identity,
    scheme,
    actions,
    sessions,
    workspaceReady: Boolean(workspace && relationship.workspacePresent),
    sessionReady: Boolean(session),
    onAdvanced: () => { window.location.assign("/"); },
    onRecovery: () => setRecoveryKey((value) => value + 1),
  };
  return createElement(SvelteMount, { props: svelteProps });
}

function SvelteMount({ props }: { props: CompanionBridgeProps }): JSX.Element {
  const target = useRef<HTMLDivElement>(null);
  const propsStore = useRef<Writable<CompanionBridgeProps>>();
  if (!propsStore.current) propsStore.current = writable(props);

  useEffect(() => {
    if (!target.current) return undefined;
    const instance = mount(CompanionBridge, { target: target.current, props: { propsStore: propsStore.current! } });
    return () => { void unmount(instance); };
  }, []);
  useEffect(() => { propsStore.current?.set(props); }, [props]);
  return createElement("div", { ref: target, style: { display: "contents" } });
}

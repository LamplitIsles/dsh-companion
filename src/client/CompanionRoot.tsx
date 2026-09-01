import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mount, unmount } from "svelte";
import { writable, type Writable } from "svelte/store";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { ISession, SessionListState, SessionSnapshot, PendingSubmissionRetirement } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ClientConnectionRpc, ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import CompanionBridge from "./CompanionBridge.svelte";
import type { CompanionBridgeProps } from "./companion-bridge.js";
import { affinityStage, companionSessionList, MOOD_LABELS, selectCompanionSession } from "./relationship.js";
import { projectConversation } from "../projection.js";
import { TtsPreparationCache } from "./voice-cache.js";
import { CompanionPreControllerError, submitCompanionInput } from "./admission.js";
import { companionSessionOpenPlan } from "./session-opening.js";
import type { ClientSettings } from "./settings.js";
import { RPC_CHANNEL as TTS_CHANNEL, RPC_ENDPOINT as TTS_ENDPOINT } from "./tts-contract.js";
import { CONTINUITY_VIEW_TARGET, type CompanionContinuitySnapshot, type ContextPressureProjection } from "../continuity.js";
import type { ImageAttachmentLimits } from "@deepseek-ai/dsh-attachment";
import type { CompanionImageDraft } from "./image-drafts.js";
import { resolveSessionReadiness, resolveWorkspaceReadiness, type CompanionReadiness } from "./readiness.js";

export interface CompanionRootInjected {
  ctx: ClientContext;
  settings: SettingsScope<ClientSettings>;
}

interface RelationshipView {
  identity?: ClientSettings;
  state?: { mood: string; note?: string; affinity: number; signature: string };
  workspacePresent: boolean;
  revision: number;
}

function useSnapshot<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void } | undefined, fallback: T): T {
  const subscribe = source?.subscribe?.bind(source) ?? (() => () => undefined);
  const getSnapshot = source?.getSnapshot?.bind(source) ?? (() => fallback);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function workspaceFor(settings: ClientSettings | undefined, workspaceState: WorkspaceSnapshot): { id: string; sessionIds: readonly string[] } | undefined {
  if (!settings?.workspaceId) return undefined;
  const item = workspaceState.items.find((candidate) => candidate.workspaceId === settings.workspaceId);
  if (!item) return undefined;
  return { id: item.workspaceId, sessionIds: item.sessionIds };
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
  const workspaceList = useSnapshot<WorkspaceSnapshot>(ctx.workspaces.list, { items: [], archivedSessionIds: [], state: "loading", phase: "pending", error: null });
  const connection = (ctx as unknown as { connection: ConnectionHandle }).connection;
  const connectionState = useSnapshot(connection.state, undefined);
  const settingsSubscribe = useMemo(() => settings.subscribe.bind(settings), [settings]);
  const settingsGetSnapshot = useMemo(() => settings.getSnapshot.bind(settings), [settings]);
  const settingsSnapshot = useSyncExternalStore(settingsSubscribe, settingsGetSnapshot, settingsGetSnapshot);
  const configured = settingsSnapshot.value;
  const workspace = workspaceFor(configured, workspaceList);
  const workspaceReadiness: CompanionReadiness = settingsSnapshot.status === "loading"
    ? "loading"
    : resolveWorkspaceReadiness(configured?.workspaceId, workspaceList);
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
  const [relationshipReadiness, setRelationshipReadiness] = useState<CompanionReadiness>("loading");
  const [sessionCreateError, setSessionCreateError] = useState(false);
  const themeRuntime = (ctx as unknown as { theme?: { getTheme?: () => { active?: { colorScheme?: string } } } }).theme;
  const [scheme, setScheme] = useState<"light" | "dark">(() => themeRuntime?.getTheme?.().active?.colorScheme === "dark" ? "dark" : "light");
  const [recoveryKey, setRecoveryKey] = useState(0);
  const creatingWorkspace = useRef<string>();
  const session = selectedSessionId ? ctx.sessions.binding(selectedSessionId as never)?.session : undefined;
  const sessionSnapshot = useSnapshot<SessionSnapshot>(session, session ? session.getSnapshot() : ({ sessionId: "", queue: [], pendingSubmissions: [], running: false, subagent: null, removed: false, openState: "cold", openError: null, hasMore: false, loadingOlder: false, promptError: null, blank: true, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false } as unknown as SessionSnapshot));
  const conversationBinding = session ? ctx.uiConversation.binding(session.sessionId as never) : undefined;
  const chatSnapshot = useSnapshot(conversationBinding?.target("chat"), undefined);
  const contextPressureSource = session?.projections?.faceOf("contextPressure") as { getSnapshot(): ContextPressureProjection | undefined; subscribe(listener: () => void): () => void } | undefined;
  const contextPressure = useSnapshot<ContextPressureProjection | undefined>(contextPressureSource, undefined);
  const imageLimitsSource = session?.projections?.faceOf("imageLimits") as { getSnapshot(): ImageAttachmentLimits | undefined; subscribe(listener: () => void): () => void } | undefined;
  const imageLimits = useSnapshot<ImageAttachmentLimits | undefined>(imageLimitsSource, undefined);
  const continuityLifecycle = useSnapshot<CompanionContinuitySnapshot | undefined>(conversationBinding?.target(CONTINUITY_VIEW_TARGET), undefined);
  const ttsCache = useRef<TtsPreparationCache>();
  if (!ttsCache.current) ttsCache.current = new TtsPreparationCache();

  useEffect(() => {
    const controller = new AbortController();
    const workspaceId = configured?.workspaceId;
    if (settingsSnapshot.status === "loading") {
      setRelationshipReadiness("loading");
      return () => controller.abort();
    }
    if (!workspaceId) {
      setRelationship({ workspacePresent: false, revision: 0 });
      setRelationshipReadiness("missing");
      return () => controller.abort();
    }
    setRelationshipReadiness("loading");
    const run = async (): Promise<void> => {
      try {
        let result = await connection.rpc.call("/dsh-companion", "relationship/get", { workspaceId }, controller.signal);
        while (!controller.signal.aborted) {
          if (!result.ok) throw new Error(result.error?.message ?? "relationship-unavailable");
          const next = result.value as RelationshipView;
          setRelationship(next);
          setRelationshipReadiness(next.workspacePresent ? "ready" : "missing");
          result = await connection.rpc.call("/dsh-companion", "relationship/watch", { workspaceId, revision: next.revision }, controller.signal);
        }
      } catch {
        // A carrier/RPC failure is not evidence that the configured Workspace
        // disappeared. Keep the last identity and expose a neutral loading
        // surface until the next connection generation settles.
        if (!controller.signal.aborted) setRelationshipReadiness("error");
      }
    };
    void run();
    return () => controller.abort();
  }, [connection, configured?.workspaceId, connectionState, recoveryKey, settingsSnapshot.status]);

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
    setSessionCreateError(false);
    const plan = companionSessionOpenPlan(workspaceList.phase === "ready" && list.phase === "ready", workspace?.id, selectedSessionId);
    if (!plan) return;
    if (plan.kind === "open") {
      ctx.sessions.open(plan.sessionId as never);
      return;
    }
    if (creatingWorkspace.current === plan.workspaceId) return;
    creatingWorkspace.current = plan.workspaceId;
    let disposed = false;
    void ctx.sessions.create({ workspaceId: plan.workspaceId as never }).then((id) => { if (!disposed) ctx.sessions.open(id); }).catch(() => { if (!disposed) setSessionCreateError(true); }).finally(() => {
      if (creatingWorkspace.current === plan.workspaceId) creatingWorkspace.current = undefined;
    });
    return () => { disposed = true; };
  }, [ctx, workspace?.id, workspaceList.phase, list.phase, selectedSessionId, recoveryKey]);

  useEffect(() => () => { ttsCache.current?.dispose(); }, []);

  const continuity = useMemo(() => ({ contextPressure, lifecycle: continuityLifecycle }), [contextPressure, continuityLifecycle]);
  const projection = useMemo(() => projectConversation({ ...sessionSnapshot, chat: chatSnapshot }, connectionState === "connected", continuity.lifecycle), [sessionSnapshot, chatSnapshot, connectionState, continuity.lifecycle]);
  const resolvedSessionReadiness = resolveSessionReadiness({
    workspace: workspaceReadiness,
    listPhase: list.phase,
    selectedSessionId,
    session,
    snapshot: sessionSnapshot,
  });
  const sessionReadiness: CompanionReadiness = sessionCreateError ? "error" : resolvedSessionReadiness;
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
      moodNote: state?.note,
      affinity: state?.affinity,
      affinityStage: state ? affinityStage(state.affinity) : undefined,
    };
  }, [relationship, configured]);
  const actions = useMemo(() => {
    const rpc: ClientConnectionRpc = connection.rpc;
    return {
      async send(text: string, images: readonly CompanionImageDraft[], onRetire?: (retirement: PendingSubmissionRetirement) => void): Promise<void> {
        if (!session) throw new CompanionPreControllerError("session-unavailable");
        await submitCompanionInput(session, text, images, onRetire);
      },
      async stop(): Promise<void> {
        if (!session) throw new Error("session-unavailable");
        const result = await session.cancel();
        if (!result.ok) throw new Error(result.error?.message ?? "cancel-rejected");
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
    continuity,
    actions,
    sessions,
    workspaceReadiness,
    relationshipReadiness,
    sessionReadiness,
    sessionId: selectedSessionId,
    imageLimits,
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

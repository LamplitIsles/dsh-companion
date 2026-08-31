import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-compaction/types";
import type { ContextPressureProjection } from "@deepseek-ai/dsh-token-meter/client";
import type {
  ChatConversationViewNode,
  ConversationNodeDefinition,
  ConversationTimelineSnapshot,
  ConversationViewBuilder,
  ConversationViewDefinition,
  ConversationViewNode,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";

/** The private session view target used by Companion's continuity surface. */
export const CONTINUITY_VIEW_TARGET = "dsh-companion:continuity" as const;
export const COMPACTION_STATUS_DURATION_MS = 8_000;

/** A safe, provider-neutral capacity value suitable for Companion copy. */
export interface ContextCapacity {
  readonly usedTokens: number;
  readonly contextWindow: number;
  readonly percentage: number;
}

/** Lifecycle states intentionally contain no checkpoint, prompt, or summary text. */
export type CompactionLifecycleStatus = "running" | "complete" | "failed";

export interface CompactionLifecycleState {
  readonly compactionId: string;
  readonly status: CompactionLifecycleStatus;
  readonly startSeq: number;
  readonly startedAt: number;
  readonly endSeq?: number;
  readonly endedAt?: number;
}

export interface CompactionLifecycleNode extends ConversationViewNode {
  readonly target: typeof CONTINUITY_VIEW_TARGET;
  readonly kind: "compaction-lifecycle";
  readonly data: CompactionLifecycleState;
}

export interface CompanionContinuitySnapshot {
  readonly lifecycles: readonly CompactionLifecycleState[];
  readonly latest?: CompactionLifecycleState;
}

declare module "@deepseek-ai/dsh-client-runtime/client" {
  interface ConversationViewSnapshotMap {
    "dsh-companion:continuity": CompanionContinuitySnapshot;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the token-meter projection into the only capacity facts Companion
 * needs. A present projected value is authoritative; the provider anchor is
 * used only when projection is absent. Malformed telemetry is hidden rather
 * than guessed at.
 */
export function resolveContextCapacity(value: ContextPressureProjection | unknown): ContextCapacity | undefined {
  const record = asRecord(value);
  if (!record || !positiveFinite(record.contextWindow)) return undefined;
  const hasProjection = Object.hasOwn(record, "projectedTokens") && record.projectedTokens !== undefined;
  const selected = hasProjection ? record.projectedTokens : record.pressureTokens;
  if (!positiveFinite(selected)) return undefined;
  return {
    usedTokens: selected,
    contextWindow: record.contextWindow,
    percentage: Math.min(100, Math.max(0, Math.round((selected / record.contextWindow) * 100))),
  };
}

/** Round a token estimate to a quiet, human-scale value for Companion copy. */
export function roundTokenEstimate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const unit = value >= 1_000 ? 1_000 : 100;
  return Math.round(value / unit) * unit;
}

/** Format an already-validated token count for the compact capacity display. */
export function formatTokenCount(value: unknown): string | undefined {
  const rounded = roundTokenEstimate(value);
  if (rounded === undefined) return undefined;
  if (rounded >= 1_000) return `${Math.round(rounded / 1_000)}k`;
  return String(rounded);
}

function eventCompactionId(event: SessionEvent): string | undefined {
  if (event.type !== "compaction/start" && event.type !== "compaction/end") return undefined;
  const value = event.data.compactionId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventTime(event: SessionEvent): number {
  return typeof event.time === "number" && Number.isFinite(event.time) ? event.time : 0;
}

function eventSeq(event: SessionEvent): number {
  return Number.isSafeInteger(event.seq) && event.seq >= 0 ? event.seq : 0;
}

interface ContinuityContextState extends CompactionLifecycleState {}

/** Public DSH conversation Definition for the two log-only compaction edges. */
export const compactionLifecycleDefinition: ConversationNodeDefinition<ContinuityContextState> = {
  kind: "dsh-companion:compaction-lifecycle",
  target: CONTINUITY_VIEW_TARGET,
  match(event) {
    const compactionId = eventCompactionId(event);
    if (compactionId === undefined) return null;
    return {
      id: compactionId,
      role: event.type === "compaction/start" ? "start" : "update",
    };
  },
  start(_context, match) {
    if (match.event.type !== "compaction/start") throw new Error("compaction lifecycle start requires compaction/start");
    return {
      compactionId: String(match.event.data.compactionId),
      status: "running",
      startSeq: eventSeq(match.event),
      startedAt: eventTime(match.event),
    };
  },
  update(context, match) {
    if (match.event.type !== "compaction/end") throw new Error("compaction lifecycle update requires compaction/end");
    return {
      ...context.state,
      status: Object.hasOwn(match.event.data, "error") ? "failed" : "complete",
      endSeq: eventSeq(match.event),
      endedAt: eventTime(match.event),
    };
  },
  buildViewNode(context): CompactionLifecycleNode | null {
    if (context.state === undefined) return null;
    return {
      key: context.key,
      kind: "compaction-lifecycle",
      id: context.id,
      target: CONTINUITY_VIEW_TARGET,
      data: context.state,
    };
  },
};

function lifecycleSort(left: CompactionLifecycleState, right: CompactionLifecycleState): number {
  return (left.endSeq ?? left.startSeq) - (right.endSeq ?? right.startSeq) || left.startSeq - right.startSeq || left.compactionId.localeCompare(right.compactionId);
}

function continuitySnapshot(rows: Iterable<CompactionLifecycleState>): CompanionContinuitySnapshot {
  const lifecycles = [...rows].sort(lifecycleSort);
  return {
    lifecycles,
    ...(lifecycles.length > 0 ? { latest: lifecycles[ lifecycles.length - 1 ] } : {}),
  };
}

class ContinuityViewBuilder implements ConversationViewBuilder<CompactionLifecycleNode, CompanionContinuitySnapshot> {
  private readonly rows = new Map<string, CompactionLifecycleState>();
  readonly empty: CompanionContinuitySnapshot = { lifecycles: [] };

  replace(input: { readonly nodes: readonly CompactionLifecycleNode[]; readonly timeline: ConversationTimelineSnapshot }): CompanionContinuitySnapshot {
    this.rows.clear();
    for (const node of input.nodes) this.rows.set(node.key, node.data);
    return continuitySnapshot(this.rows.values());
  }

  apply(input: { readonly upserts: readonly CompactionLifecycleNode[]; readonly timeline: ConversationTimelineSnapshot }): CompanionContinuitySnapshot {
    for (const node of input.upserts) this.rows.set(node.key, node.data);
    return continuitySnapshot(this.rows.values());
  }
}

/** The target builder is intentionally a pure map: replay/upsert cannot duplicate records. */
export const continuityViewDefinition: ConversationViewDefinition<CompactionLifecycleNode, CompanionContinuitySnapshot> = {
  target: CONTINUITY_VIEW_TARGET,
  create: () => new ContinuityViewBuilder(),
};

/** Register both contributions and return one idempotent composite disposer. */
export function registerCompanionContinuity(ctx: Context): () => void {
  const disposeEvents = ctx.conversationEvents.register(compactionLifecycleDefinition);
  try {
    const disposeViews = ctx.conversationViews.register(continuityViewDefinition);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      disposeViews();
      disposeEvents();
    };
  }
  catch (error) {
    disposeEvents();
    throw error;
  }
}

function lifecycleRows(value: unknown): readonly CompactionLifecycleState[] {
  const record = asRecord(value);
  if (!record) return [];
  const rows = Array.isArray(record.lifecycles) ? record.lifecycles : record.latest ? [record.latest] : [];
  return rows.filter((row): row is CompactionLifecycleState => {
    const candidate = asRecord(row);
    return candidate !== undefined
      && typeof candidate.compactionId === "string"
      && candidate.compactionId.length > 0
      && (candidate.status === "running" || candidate.status === "complete" || candidate.status === "failed")
      && Number.isSafeInteger(candidate.startSeq)
      && Number(candidate.startSeq) >= 0
      && typeof candidate.startedAt === "number"
      && Number.isFinite(candidate.startedAt);
  });
}

function summaryNodeId(node: Record<string, unknown>): string | undefined {
  for (const key of ["id", "compactionId", "key"]) {
    const value = node[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

interface CompactionEvidence {
  readonly id?: string;
  readonly seq: number;
  readonly time?: number;
  readonly shadowedTokenCount?: number;
}

function evidenceFromNode(node: Record<string, unknown>): CompactionEvidence | undefined {
  const data = node.kind === "compaction" ? asRecord(node.data) : undefined;
  const candidate = data
    ? { ...data, ...(typeof node.id === "string" ? { id: node.id } : {}) }
    : node;
  if (candidate.kind !== "compaction" && node.kind !== "compaction") return undefined;
  const seq = typeof candidate.seq === "number" && Number.isSafeInteger(candidate.seq) && candidate.seq >= 0 ? candidate.seq : undefined;
  if (seq === undefined) return undefined;
  const count = Number.isSafeInteger(candidate.shadowedTokenCount) && Number(candidate.shadowedTokenCount) >= 0
    ? Number(candidate.shadowedTokenCount)
    : undefined;
  return {
    id: summaryNodeId(candidate),
    seq,
    ...(typeof candidate.time === "number" ? { time: candidate.time } : {}),
    ...(count === undefined ? {} : { shadowedTokenCount: count }),
  };
}

function completionText(): string { return "已整理对话"; }

export interface ContinuityRecord {
  readonly id: string;
  readonly kind: "continuity";
  readonly side: "incoming";
  readonly tone: "success";
  readonly compactionId: string;
  readonly text: string;
  readonly time?: number;
  readonly anchorSeq: number;
}

/** Build one safe completion record from a lifecycle and optional Chat evidence. */
export function completionRecordForLifecycle(lifecycle: CompactionLifecycleState, evidence?: CompactionEvidence): ContinuityRecord | undefined {
  if (lifecycle.status !== "complete") return undefined;
  const anchorSeq = evidence?.seq ?? lifecycle.endSeq ?? lifecycle.startSeq;
  return {
    id: `continuity:${lifecycle.compactionId}`,
    kind: "continuity",
    side: "incoming",
    tone: "success",
    compactionId: lifecycle.compactionId,
    text: completionText(),
    ...(lifecycle.endedAt === undefined ? {} : { time: lifecycle.endedAt }),
    anchorSeq,
  };
}

/**
 * Project successful lifecycle markers into visible timeline records. This
 * helper deliberately accepts only Chat node metadata, never a raw summary.
 */
export function projectContinuityRecords(
  lifecycleView: CompanionContinuitySnapshot | unknown,
  chatNodes: readonly (ChatConversationViewNode | Record<string, unknown>)[],
): readonly ContinuityRecord[] {
  const rows = lifecycleRows(lifecycleView);
  const evidence = chatNodes
    .map((node) => evidenceFromNode(asRecord(node) ?? {}))
    .filter((item): item is CompactionEvidence => item !== undefined);
  const usedEvidence = new Set<CompactionEvidence>();
  const usedLifecycleIds = new Set<string>();
  return rows
    .filter((row) => {
      if (row.status !== "complete" || usedLifecycleIds.has(row.compactionId)) return false;
      usedLifecycleIds.add(row.compactionId);
      return true;
    })
    .map((row) => {
      let match = evidence.find((candidate) => candidate.id === row.compactionId && !usedEvidence.has(candidate));
      if (match === undefined) {
        const endSeq = row.endSeq ?? Number.POSITIVE_INFINITY;
        match = evidence.filter((candidate) => candidate.seq <= endSeq && !usedEvidence.has(candidate)).sort((left, right) => right.seq - left.seq)[0];
      }
      if (match !== undefined) usedEvidence.add(match);
      return completionRecordForLifecycle(row, match);
    })
    .filter((item): item is ContinuityRecord => item !== undefined)
    .sort((left, right) => left.anchorSeq - right.anchorSeq || left.compactionId.localeCompare(right.compactionId));
}

export type { ContextPressureProjection };

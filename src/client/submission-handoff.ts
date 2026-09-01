interface PendingSubmissionLike {
  readonly requestId: string;
}

interface QueuedMessageLike {
  readonly rpcId?: string;
}

interface SubmissionSources {
  readonly sessionId: string;
  readonly pendingSubmissions: readonly PendingSubmissionLike[];
  readonly queue: readonly QueuedMessageLike[];
}

function collectRpcIds(value: unknown, result = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (value === null || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectRpcIds(item, result, seen);
    return result;
  }
  if (value instanceof Map) {
    for (const item of value.values()) collectRpcIds(item, result, seen);
    return result;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.rpcId === "string") result.add(record.rpcId);
  for (const item of Object.values(record)) collectRpcIds(item, result, seen);
  return result;
}

/** Keeps correlated client sources until the separately published Chat target observes them. */
export class SubmissionHandoff {
  private sessionId?: string;
  private readonly pending = new Map<string, PendingSubmissionLike>();
  private readonly queued = new Map<string, QueuedMessageLike>();
  private readonly failed = new Set<string>();

  retire(requestId: string, reason: "observed" | "failed"): void {
    if (reason !== "failed") return;
    this.pending.delete(requestId);
    this.queued.delete(requestId);
    this.failed.add(requestId);
  }

  merge<T extends SubmissionSources>(session: T, chat: unknown): T & { chat: unknown } {
    if (this.sessionId !== session.sessionId) {
      this.sessionId = session.sessionId;
      this.pending.clear();
      this.queued.clear();
      this.failed.clear();
    }

    const durable = collectRpcIds(chat);
    for (const requestId of durable) {
      this.pending.delete(requestId);
      this.queued.delete(requestId);
      this.failed.delete(requestId);
    }

    const currentPending = new Set<string>();
    for (const submission of session.pendingSubmissions) {
      currentPending.add(submission.requestId);
      if (!durable.has(submission.requestId) && !this.failed.has(submission.requestId)) this.pending.set(submission.requestId, submission);
    }

    const currentQueued = new Set<string>();
    for (const row of session.queue) {
      if (!row.rpcId) continue;
      currentQueued.add(row.rpcId);
      if (!durable.has(row.rpcId) && !this.failed.has(row.rpcId)) {
        this.queued.set(row.rpcId, row);
        this.pending.delete(row.rpcId);
      }
    }

    for (const requestId of [...this.failed]) {
      if (!currentPending.has(requestId) && !currentQueued.has(requestId)) this.failed.delete(requestId);
    }

    const pendingSubmissions = [
      ...session.pendingSubmissions,
      ...[...this.pending].flatMap(([requestId, submission]) => currentPending.has(requestId) || durable.has(requestId) || this.failed.has(requestId) ? [] : [submission]),
    ];
    const queue = [
      ...session.queue,
      ...[...this.queued].flatMap(([requestId, row]) => currentQueued.has(requestId) || durable.has(requestId) || this.failed.has(requestId) ? [] : [row]),
    ];

    return { ...session, pendingSubmissions, queue, chat };
  }
}

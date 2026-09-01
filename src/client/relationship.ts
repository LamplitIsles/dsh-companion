export function affinityStage(value: number): "疏离" | "生疏" | "熟悉" | "亲近" | "深厚" {
  const n = Math.max(0, Math.min(100, Math.trunc(value)));
  return n < 20 ? "疏离" : n < 40 ? "生疏" : n < 60 ? "熟悉" : n < 80 ? "亲近" : "深厚";
}

export interface CompanionSessionCandidate {
  id: string;
  displayTitle?: string;
  updatedAt?: number;
  running?: boolean;
  archived?: boolean;
  origin?: string;
  parentId?: string;
  blank?: boolean;
}

export interface CompanionSessionListItem {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
  selected: boolean;
}

/** Project only root sessions owned by the configured Workspace into sidebar rows. */
export function companionSessionList(
  sessions: readonly CompanionSessionCandidate[],
  selectedId: string | undefined,
  ownership: { sessionIds: readonly string[]; archivedSessionIds: readonly string[] },
): CompanionSessionListItem[] {
  const memberIds = new Set(ownership.sessionIds);
  const archivedIds = new Set(ownership.archivedSessionIds);
  return sessions
    .filter((session) => memberIds.has(session.id) && !archivedIds.has(session.id) && !session.archived && !session.parentId && session.origin !== "subagent")
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.id.localeCompare(right.id))
    .map((session) => ({
      id: session.id,
      title: session.displayTitle?.trim() || (session.blank ? "新对话" : "未命名对话"),
      updatedAt: session.updatedAt ?? 0,
      running: Boolean(session.running),
      selected: session.id === selectedId,
    }));
}

/** Workspace.sessionIds is authoritative; list.current and cwd never decide Companion ownership. */
export function selectCompanionSession(
  _workspaceId: string,
  sessions: readonly CompanionSessionCandidate[],
  rememberedId: string | undefined,
  ownership: { sessionIds: readonly string[]; archivedSessionIds: readonly string[] },
): string | undefined {
  const memberIds = new Set(ownership.sessionIds);
  const archivedIds = new Set(ownership.archivedSessionIds);
  const members = sessions.filter((session) => memberIds.has(session.id) && !archivedIds.has(session.id) && !session.archived && !session.parentId && session.origin !== "subagent");
  if (rememberedId && members.some((session) => session.id === rememberedId)) return rememberedId;
  const recent = members.filter((session) => !session.blank).sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.id.localeCompare(right.id))[0];
  return recent?.id ?? members.find((session) => session.blank)?.id;
}

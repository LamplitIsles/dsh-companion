import type { SessionSnapshot } from "@deepseek-ai/dsh-api-session-controller/client";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";

/** Presentation lifecycle for data whose absence is not known during startup. */
export type CompanionReadiness = "loading" | "ready" | "missing" | "error";

export function resolveWorkspaceReadiness(
  workspaceId: string | undefined,
  snapshot: Pick<WorkspaceSnapshot, "items" | "phase" | "state">,
): CompanionReadiness {
  if (!workspaceId) return "missing";
  if (snapshot.state === "error") return "error";
  if (snapshot.phase !== "ready" || snapshot.state === "loading") return "loading";
  return snapshot.items.some((item) => item.workspaceId === workspaceId) ? "ready" : "missing";
}
export function resolveSessionReadiness(input: {
  workspace: CompanionReadiness;
  listPhase: "pending" | "ready";
  selectedSessionId?: string;
  session?: unknown;
  snapshot?: Pick<SessionSnapshot, "openState">;
}): CompanionReadiness {
  if (input.workspace !== "ready") return input.workspace;
  if (input.listPhase !== "ready" || !input.selectedSessionId || !input.session) return "loading";
  if (input.snapshot?.openState === "error") return "error";
  if (input.snapshot?.openState === "open") return "ready";
  return "loading";
}

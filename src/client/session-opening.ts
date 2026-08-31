export function companionSessionOpenPlan(baselinesReady: boolean, workspaceId: string | undefined, selectedSessionId: string | undefined):
  | { kind: "open"; sessionId: string }
  | { kind: "connect"; workspaceId: string }
  | undefined {
  if (!baselinesReady || !workspaceId) return undefined;
  return selectedSessionId ? { kind: "open", sessionId: selectedSessionId } : { kind: "connect", workspaceId };
}

export function companionSessionOpenPlan(listReady: boolean, workspaceId: string | undefined, selectedSessionId: string | undefined):
  | { kind: "open"; sessionId: string }
  | { kind: "create"; workspaceId: string }
  | undefined {
  if (!listReady || !workspaceId) return undefined;
  return selectedSessionId ? { kind: "open", sessionId: selectedSessionId } : { kind: "create", workspaceId };
}

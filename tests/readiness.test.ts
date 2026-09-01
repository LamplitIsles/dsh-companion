import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@deepseek-ai/dsh-api-workspace-controller/client";
import { resolveSessionReadiness, resolveWorkspaceReadiness } from "../src/client/readiness.js";

const workspace = (phase: "pending" | "ready", state: "idle" | "loading" | "error", ids: string[] = []) => ({
  phase,
  state,
  items: ids.map((workspaceId) => ({ workspaceId })),
}) as unknown as Pick<WorkspaceSnapshot, "items" | "phase" | "state">;

describe("Companion startup readiness", () => {
  it("keeps Workspace absence unknown while its list is loading", () => {
    expect(resolveWorkspaceReadiness("workspace-a", workspace("pending", "loading"))).toBe("loading");
    expect(resolveWorkspaceReadiness("workspace-a", workspace("ready", "idle", ["workspace-a"]))).toBe("ready");
    expect(resolveWorkspaceReadiness("workspace-a", workspace("ready", "idle", ["workspace-b"]))).toBe("missing");
    expect(resolveWorkspaceReadiness("workspace-a", workspace("ready", "error"))).toBe("error");
  });

  it("does not expose a conversation failure before list and binding readiness", () => {
    expect(resolveSessionReadiness({ workspace: "ready", listPhase: "pending", selectedSessionId: undefined, session: undefined })).toBe("loading");
    expect(resolveSessionReadiness({ workspace: "ready", listPhase: "ready", selectedSessionId: "session-a", session: {}, snapshot: { openState: "cold" } })).toBe("loading");
    expect(resolveSessionReadiness({ workspace: "ready", listPhase: "ready", selectedSessionId: "session-a", session: {}, snapshot: { openState: "open" } })).toBe("ready");
    expect(resolveSessionReadiness({ workspace: "ready", listPhase: "ready", selectedSessionId: "session-a", session: {}, snapshot: { openState: "error" } })).toBe("error");
    expect(resolveSessionReadiness({ workspace: "missing", listPhase: "ready", selectedSessionId: undefined, session: undefined })).toBe("missing");
  });
});

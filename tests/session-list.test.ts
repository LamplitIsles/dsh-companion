import { describe, expect, it } from "vitest";
import { companionSessionList } from "../src/client/relationship.js";

describe("Companion session sidebar", () => {
  it("lists only selectable root sessions from the configured Workspace", () => {
    const rows = companionSessionList([
      { id: "older", displayTitle: "昨晚", updatedAt: 1, running: false },
      { id: "newer", displayTitle: "今天", updatedAt: 9, running: true },
      { id: "archived", displayTitle: "归档", updatedAt: 10 },
      { id: "child", displayTitle: "子代理", updatedAt: 11, origin: "subagent" },
      { id: "foreign", displayTitle: "别处", updatedAt: 12 },
    ], "newer", { sessionIds: ["older", "newer", "archived", "child"], archivedSessionIds: ["archived"] });

    expect(rows).toEqual([
      { id: "newer", title: "今天", updatedAt: 9, running: true, selected: true },
      { id: "older", title: "昨晚", updatedAt: 1, running: false, selected: false },
    ]);
  });
});

import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error Build helpers are plain Node ESM scripts, not package API.
import { wrapClientBundle } from "../scripts/client-wrapper.mjs";

type ClientRegistration = {
  id: string;
  factory: (require: (id: string) => unknown) => unknown;
};

describe("classic DSH client wrapper", () => {
  it("preserves multiline JavaScript literal values", () => {
    let registration: ClientRegistration | undefined;
    const classic = wrapClientBundle("fixture", "module.exports = `first\nsecond`;");
    runInNewContext(classic, {
      window: { __ModuleLoader__: { load: (value: ClientRegistration) => { registration = value; } } },
    });

    expect(registration?.id).toBe("fixture");
    expect(registration?.factory(() => undefined)).toBe("first\nsecond");
  });
});

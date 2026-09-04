import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = resolve(new URL("..", import.meta.url).pathname);
const DSH_RC_VERSION = "0.1.2-rc.1";

if (!existsSync(join(root, "dist", "index.js")) || !existsSync(join(root, "dist", "client.js"))) {
  throw new Error("DSH link smoke requires a fresh `bun run build`");
}

function resolveDshCli() {
  const cli = process.env.DSH_CLI;
  if (!cli || !existsSync(cli)) throw new Error("set DSH_CLI to the fixed local DSH rc.1 executable");
  return cli;
}

function run(cli, args, cwd, env) {
  return execFileSync(cli, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClientRegistration() {
  const source = readFileSync(join(root, "dist", "client.js"), "utf8");
  let registration;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(spec) { registration = spec; } } },
  });
  requireCondition(registration?.id === "@lamplitisles/dsh-companion" && typeof registration.factory === "function", "built Companion client did not register with the DSH module loader");
}

const cli = resolveDshCli();
const directory = mkdtempSync(join(tmpdir(), "dsh-companion-link-"));
try {
  const home = join(directory, "home");
  const dshHome = join(directory, "dsh-home");
  const workspace = join(directory, "workspace");
  await Promise.all([home, dshHome, workspace].map((path) => mkdir(path)));
  const env = {
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: "1",
    npm_config_cache: join(directory, "npm-cache"),
    npm_config_store_dir: join(directory, "pnpm-store"),
  };
  const profile = "companion-link-smoke";

  requireCondition(run(cli, ["--version"], workspace, env).trim() === DSH_RC_VERSION, `expected fixed DSH ${DSH_RC_VERSION}`);
  run(cli, ["plugin", "--profile", profile, "add", pathToFileURL(root).href], workspace, env);
  const dump = run(cli, ["--profile", profile, "--dump-config"], workspace, env);
  requireCondition(
    dump.includes("# == @lamplitisles/dsh-companion") &&
      dump.includes("name: '@lamplitisles/dsh-companion'") &&
      dump.includes("inject:\n    - fs\n    - settings\n    - systemPrompt\n    - tools\n    - connection\n    - workspaceRegistry\n    - llm\n    - webServer"),
    "fixed DSH CLI did not compose the linked Companion bundle",
  );
  assertClientRegistration();
  console.log("DSH link smoke passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

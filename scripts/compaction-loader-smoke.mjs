import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const DSH_ALPHA_VERSION = "0.1.2-alpha.5";

if (!existsSync(join(root, "dist", "index.js"))) throw new Error("compaction Loader smoke requires a fresh `bun run build`");

function dshEntry() {
  const configured = process.env.DSH_CLI;
  const cli = configured ?? execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
  if (!cli || !existsSync(cli)) throw new Error("set DSH_CLI to the installed dsh executable");
  return cli;
}

/**
 * The profile manager extracts a plugin without installing its peer graph.
 * Link this checkout's installed alpha.5 dependency tree into the disposable
 * profile so Node resolves the packed plugin against the exact lock graph,
 * without installing into the repository or a user's profile.
 */
function linkDshDependencies(temp) {
  symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
}

function resolvedDshPackages(roots) {
  const packages = [];
  const visited = new Set();

  function visit(candidate) {
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let stat;
    try {
      stat = statSync(real);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    let entries;
    try {
      entries = readdirSync(real, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(real, entry.name);
      if (entry.name === "package.json") {
        try {
          const manifest = JSON.parse(readFileSync(child, "utf8"));
          if (typeof manifest.name === "string" && manifest.name.startsWith("@deepseek-ai/dsh-")) {
            packages.push({ name: manifest.name, version: manifest.version, path: child });
          }
        } catch {
          // Ignore non-package JSON while walking the disposable installation.
        }
        continue;
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) visit(child);
    }
  }

  for (const root of roots) visit(root);
  return packages;
}

function lockedDshPackageNames() {
  return new Set([...readFileSync(join(root, "bun.lock"), "utf8").matchAll(/^\s+"(@deepseek-ai\/dsh-[^"]+)": \["/gmu)].map(([, name]) => name));
}

function assertResolvedDshGraph(roots) {
  const packages = resolvedDshPackages(roots);
  if (!packages.length) throw new Error("installed graph resolved no first-party DSH packages");
  const missing = [...lockedDshPackageNames()].filter((name) => !packages.some((pkg) => pkg.name === name));
  if (missing.length) throw new Error(`installed graph is missing locked first-party DSH packages: ${missing.join(", ")}`);
  const mismatches = packages.filter(({ version }) => version !== DSH_ALPHA_VERSION);
  if (mismatches.length) {
    throw new Error(`installed graph resolved non-alpha.5 DSH packages: ${mismatches.map(({ name, version }) => `${name}@${version}`).join(", ")}`);
  }
}

function isolatedEnvironment(temp, dshHome) {
  const inherited = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "SystemRoot", "WINDIR", "PATHEXT", "COMSPEC"]) if (process.env[name]) inherited[name] = process.env[name];
  const home = join(temp, "home");
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: "1",
    XDG_CACHE_HOME: join(temp, "cache"),
    XDG_CONFIG_HOME: join(temp, "config"),
    XDG_DATA_HOME: join(temp, "data"),
    XDG_STATE_HOME: join(temp, "state"),
    npm_config_cache: join(temp, "npm-cache"),
  };
}

function moduleUrl(specifier) {
  return pathToFileURL(require.resolve(specifier)).href;
}

function runnerSource({ activationUrl, cordisUrl, loaderUrl, llmUrl }) {
  return `
import assert from "node:assert/strict";
import { Context } from ${JSON.stringify(cordisUrl)};
import Loader from ${JSON.stringify(loaderUrl)};
import { createUserMessage } from ${JSON.stringify(llmUrl)};

const root = new Context();
const savedFiles = new Map();
const registeredTools = [];
const workspace = { id: "workspace-a", path: "/disposable/workspace", sessionIds: ["session-a"] };
const settingsScope = {
  get: () => ({ workspaceId: workspace.id, companionName: "Companion", userName: "You", preferredAddress: "You", defaultAffinity: 50 }),
  update: async () => undefined,
  watch: () => () => undefined,
};
root.provide("fs", {
  resolve: async (path, options = {}) => joinPath(options.cwd ?? "/", path),
  stat: async (path) => savedFiles.has(path) ? { type: "file", size: savedFiles.get(path).length } : undefined,
  readText: async (path) => savedFiles.get(path),
  writeText: async (path, text) => { savedFiles.set(path, text); },
  mkdir: async () => undefined,
});
root.provide("settings", { register: () => settingsScope });
root.provide("systemPrompt", { context: () => () => undefined });
root.provide("tools", { register: (tool) => { registeredTools.push(tool); return () => undefined; } });
root.provide("connection", { rpc: { handle: () => async () => undefined } });
root.provide("workspaceRegistry", { get: (id) => id === workspace.id ? workspace : undefined, list: () => [workspace] });
root.provide("webServer", { port: 1, register: () => () => undefined });

const delivered = [];
const fakeLlm = {
  [Context.filter]: () => false,
  stream(options) {
    return root.waterfall(fakeLlm, "llm/stream", options, () => {
      delivered.push(options);
      return (async function* () { yield { type: "finish", reason: { kind: "stop" } }; })();
    });
  },
};
root.provide("llm", fakeLlm);

function joinPath(cwd, path) { return cwd.replace(/\\/$/, "") + "/" + path; }
async function consume(stream) { for await (const _chunk of stream) {} }
function basicTail(text = "standard compaction") {
  return createUserMessage({ content: [{ type: "text", text }], source: { kind: "plugin", plugin: "dsh-compaction-basic" } });
}
function request(sessionId, purpose = "compaction") {
  return {
    provider: "fake-provider",
    model: "fake-model",
    messages: [createUserMessage({ content: [{ type: "text", text: "remember my exact name" }], source: { kind: "user" } }), basicTail()],
    system: "system stays untouched",
    tools: [{ name: "fake_tool", description: "fake", parameters: { type: "object" } }],
    temperature: 0.3,
    maxTokens: 99,
    signal: new AbortController().signal,
    sessionId,
    purpose,
  };
}

await root.plugin(Loader, { baseUrl: import.meta.url });
const entryId = await root.loader.create({ id: "dsh-companion", name: ${JSON.stringify(activationUrl)} });
await root.loader.await();

assert.deepEqual(registeredTools.map((tool) => tool.name), ["companion_read_history", "companion_update_relationship", "companion_set_signature"]);
const historyTool = registeredTools[0];
const relationshipTool = registeredTools[1];
const relationshipResult = await relationshipTool.execute({
  mood: { value: "bright", note: "A shared bright moment", reason: "The user celebrated a shared result" },
  affinity: { delta: 2, reason: "The user valued the shared result" },
}, {
  signal: new AbortController().signal,
  agent: { id: "agent-a", session: { header: { cwd: workspace.path }, snapshotEvents: () => [{ type: "turn/start", data: { turn: 1 } }] } },
});
assert.equal(relationshipResult.mood, "bright");
assert.equal(relationshipResult.affinity, 52);
const relationshipHistory = savedFiles.get("/disposable/workspace/.dsh/dsh-companion/state.jsonl");
assert.equal(relationshipHistory.trimEnd().split("\\n").length, 2);
const relationshipRecord = JSON.parse(relationshipHistory.trimEnd().split("\\n").at(-1));
assert.equal(relationshipRecord.changes.mood.reason, "The user celebrated a shared result");
assert.equal(relationshipRecord.changes.affinity.reason, "The user valued the shared result");
assert.equal(relationshipRecord.state.affinity, 52);
const historyResult = await historyTool.execute({ limit: 1 }, {
  signal: new AbortController().signal,
  agent: { id: "agent-a", session: { header: { cwd: workspace.path }, snapshotEvents: () => [{ type: "turn/start", data: { turn: 1 } }] } },
});
assert.equal(historyResult.records.length, 1);
assert.equal(historyResult.records[0].state.affinity, 52);
assert.equal(savedFiles.get("/disposable/workspace/.dsh/dsh-companion/state.jsonl"), relationshipHistory, "history reads must not mutate state");

const qualified = request("session-a");
const qualifiedPrefix = qualified.messages[0];
await consume(fakeLlm.stream(qualified));
assert.equal(delivered[0], qualified, "the waterfall must deliver the original request object");
assert.equal(qualified.messages[0], qualifiedPrefix, "the conversation prefix must remain reference-identical");
assert.equal(qualified.messages.at(-1).source.plugin, "dsh-companion");
assert.match(qualified.messages.at(-1).content[0].text, /## The User/);

const unrelated = request("other-session");
const unrelatedTail = unrelated.messages.at(-1);
await consume(fakeLlm.stream(unrelated));
assert.equal(delivered[1], unrelated, "unrelated calls must reach the fake adapter");
assert.equal(unrelated.messages.at(-1), unrelatedTail, "an unrelated Session must be unchanged");

await root.loader.remove(entryId);
const afterTeardown = request("session-a");
const afterTeardownTail = afterTeardown.messages.at(-1);
await consume(fakeLlm.stream(afterTeardown));
assert.equal(afterTeardown.messages.at(-1), afterTeardownTail, "Host teardown must dispose the waterfall listener");
console.log("compaction-loader: packed plugin activated through real Loader and verified against a fake LLM");
`;
}

const temp = mkdtempSync(join(tmpdir(), "dsh-companion-compaction-"));
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temp], { cwd: root, encoding: "utf8" }));
  const tarball = join(temp, packed[0].filename);
  const dshHome = join(temp, "dsh-home");
  const env = isolatedEnvironment(temp, dshHome);
  const entry = dshEntry();
  linkDshDependencies(temp);
  execFileSync(process.execPath, ["--expose-internals", entry, "plugin", "--profile", "web", "add", tarball, "--ignore-scripts"], { cwd: temp, env, stdio: "pipe" });

  const config = execFileSync(process.execPath, ["--expose-internals", entry, "--profile", "web", "--dump-config"], { cwd: temp, env, encoding: "utf8" });
  for (const expected of ["dsh-companion", "workspaceRegistry", "llm", "webServer"]) if (!config.includes(expected)) throw new Error(`composed disposable profile is missing ${expected}`);

  const packageDir = join(dshHome, "profiles", "web", "node_modules", "@lamplitisles", "dsh-companion");
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  assertResolvedDshGraph([join(temp, "node_modules"), join(dshHome, "profiles", "web", "node_modules")]);
  if (manifest.name !== "@lamplitisles/dsh-companion" || manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") throw new Error("packed manifest lost the existing single DSH bundle identity");
  for (const dependencySection of ["peerDependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(manifest[dependencySection] ?? {})) {
      if (name.startsWith("@deepseek-ai/dsh-") && version !== DSH_ALPHA_VERSION) throw new Error(`packed manifest mixes DSH contract versions in ${dependencySection}: ${name}@${version}`);
    }
  }
  const bundledDshDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@deepseek-ai/dsh-"));
  if (bundledDshDependencies.length) throw new Error(`packed manifest bundles DSH runtime dependencies: ${bundledDshDependencies.join(", ")}`);
  for (const dependencySection of ["peerDependencies", "devDependencies"]) {
    if (manifest[dependencySection]?.["@deepseek-ai/dsh-llm"] !== DSH_ALPHA_VERSION) throw new Error(`packed manifest lacks the exact alpha.5 LLM ${dependencySection} pin`);
  }
  const patch = readFileSync(join(packageDir, "cordis.patch.yml"), "utf8");
  if (!/inject:\s*\[[^\]]*\bllm\b[^\]]*\]/u.test(patch)) throw new Error("packed Cordis patch lacks hard llm injection");
  const packageEntry = join(packageDir, "dist", "index.js");
  if (!existsSync(packageEntry)) throw new Error("packed Host entry is missing");
  const clientEntry = join(packageDir, "dist", "client.js");
  const packedCode = `${readFileSync(packageEntry, "utf8")}\n${readFileSync(clientEntry, "utf8")}`;
  if (packedCode.includes("@deepseek-ai/dsh-client-runtime")) throw new Error("packed artifact still references the retired client Runtime");

  const activationPath = join(temp, "activate-companion.mjs");
  writeFileSync(activationPath, `import { apply, inject, name } from ${JSON.stringify(pathToFileURL(packageEntry).href)};\nif (name !== "dsh-companion" || typeof apply !== "function" || !inject.includes("llm")) throw new Error("packed Host entry lost its LLM contract");\nexport default { apply, inject, name };\n`);
  const runnerPath = join(temp, "loader-runner.mjs");
  writeFileSync(runnerPath, runnerSource({
    activationUrl: pathToFileURL(activationPath).href,
    cordisUrl: moduleUrl("@deepseek-ai/cordis"),
    loaderUrl: moduleUrl("@deepseek-ai/cordis-plugin-loader"),
    llmUrl: moduleUrl("@deepseek-ai/dsh-llm"),
  }));
  execFileSync(process.execPath, ["--expose-internals", runnerPath], { cwd: temp, env, stdio: "inherit" });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { chromium } from "playwright";

const root = resolve(new URL("..", import.meta.url).pathname);
if (!existsSync(join(root, "dist", "index.js")) || !existsSync(join(root, "dist", "client.js"))) {
  throw new Error("shipped-path smoke requires a fresh `bun run build`");
}

function dshEntry() {
  const configured = process.env.DSH_CLI;
  const cli = configured ?? execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
  if (!cli || !existsSync(cli)) throw new Error("set DSH_CLI to the installed dsh executable");
  return realpathSync(cli);
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

function startRuntime(entry, env, patch) {
  const args = ["--expose-internals", entry, "--profile", "web"];
  if (patch) args.push("--patch", patch);
  args.push("--host", "127.0.0.1", "--port", "0", "--no-open");
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  return new Promise((resolveRuntime, rejectRuntime) => {
    let settled = false;
    const finish = (error, baseUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectRuntime(error); else resolveRuntime({ child, baseUrl });
    };
    const read = (chunk) => {
      output += String(chunk);
      const match = output.match(/dsh web:\s+(https?:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) finish(undefined, match[1]);
    };
    child.stdout.on("data", read); child.stderr.on("data", read);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => finish(new Error(`DSH Web exited before ready (${code ?? "?"}/${signal ?? "?"}): ${output}`)));
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(new Error(`timed out starting DSH Web: ${output}`)); }, 30_000);
  });
}

async function stopRuntime(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolveStop(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolveStop(); });
    child.kill("SIGTERM");
  });
}

function bootFrom(html) {
  const start = html.indexOf('globalThis["__DSH_BOOT__"]');
  const end = start < 0 ? -1 : html.indexOf("</script>", start);
  const source = start < 0 || end < 0 ? "" : html.slice(start, end);
  const jsonStart = source.indexOf("{");
  const jsonEnd = source.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("DSH Web bootstrap did not expose __DSH_BOOT__");
  return JSON.parse(source.slice(jsonStart, jsonEnd + 1));
}

async function assertAlias(baseUrl) {
  const rootResponse = await fetch(`${baseUrl}/`);
  const companionResponse = await fetch(`${baseUrl}/companion/`);
  const companionBare = await fetch(`${baseUrl}/companion`);
  const head = await fetch(`${baseUrl}/companion/`, { method: "HEAD" });
  const missing = await fetch(`${baseUrl}/companion/not-root`);
  const post = await fetch(`${baseUrl}/companion/`, { method: "POST" });
  const rootHtml = await rootResponse.text();
  const companionHtml = await companionResponse.text();
  if (!rootResponse.ok || !companionResponse.ok || !companionBare.ok || !head.ok || head.headers.get("content-type") !== companionResponse.headers.get("content-type") || (await head.text()) || missing.status !== 404 || post.status !== 405) {
    throw new Error("Companion boot-document alias did not preserve exact GET/HEAD/path/method behavior");
  }
  if (!rootHtml.includes('globalThis["__DSH_BOOT__"]') || !companionHtml.includes('globalThis["__DSH_BOOT__"]')) throw new Error("Companion alias did not return the real DSH boot document");
  return bootFrom(rootHtml);
}

function assembledFixturePatch(temp) {
  const fixture = pathToFileURL(join(root, "scripts", "fixtures", "assembled-browser-host-fixture.mjs")).href;
  const patch = join(temp, "assembled-browser.patch.yml");
  writeFileSync(patch, `- insert:\n    - id: dsh-companion-assembled-browser-fixture\n      name: ${JSON.stringify(fixture)}\n      inject: [workspaceRegistry, sessions, settings, connection, webServer]\n`);
  return patch;
}

function observeBrowserFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack ?? error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`);
  });
  return failures;
}

const temp = mkdtempSync(join(tmpdir(), "dsh-companion-shipped-"));
let runtime;
let browser;
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temp], { cwd: root, encoding: "utf8" }));
  const tarball = join(temp, packed[0].filename);
  const dshHome = join(temp, "dsh-home");
  const env = isolatedEnvironment(temp, dshHome);
  const workspacePath = join(temp, "workspace");
  mkdirSync(workspacePath, { recursive: true });
  env.DSH_COMPANION_ASSEMBLED_SMOKE_WORKSPACE = workspacePath;
  const entry = dshEntry();
  execFileSync(process.execPath, ["--expose-internals", entry, "plugin", "--profile", "web", "add", tarball, "--ignore-scripts"], { cwd: temp, env, stdio: "pipe" });
  const patch = assembledFixturePatch(temp);
  const config = execFileSync(process.execPath, ["--expose-internals", entry, "--profile", "web", "--dump-config", "--patch", patch], { cwd: temp, env, encoding: "utf8" });
  if (!config.includes("dsh-companion") || !config.includes("workspaceRegistry") || !config.includes("webServer") || !config.includes("dsh-companion-assembled-browser-fixture")) throw new Error("composed disposable profile is missing the Companion browser slice");

  const packageDir = join(dshHome, "profiles", "web", "node_modules", "@lamplitisles", "dsh-companion");
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (manifest.name !== "@lamplitisles/dsh-companion" || manifest.dsh?.client?.platform !== "web") throw new Error("packed manifest is not the declared Web plugin");

  runtime = await startRuntime(entry, env, patch);
  const boot = await assertAlias(runtime.baseUrl);
  const clientEntry = boot.entries?.find((candidate) => candidate.id === manifest.name);
  if (!clientEntry?.url) throw new Error("Companion is absent from the real DSH bootstrap");
  const clientCode = await (await fetch(new URL(clientEntry.url, runtime.baseUrl))).text();
  let loaded;
  vm.runInNewContext(clientCode, { window: { __ModuleLoader__: { load(spec) { loaded = spec; } } } });
  if (loaded?.id !== manifest.name || typeof loaded.factory !== "function" || !clientCode.includes("@scope (#dsh-companion)") || !clientCode.includes(".cmp-btn") || clientCode.includes("@import") || clientCode.includes("theme-controller") || /(^|[,{])\s*(html|:root)\b/u.test(clientCode)) {
    throw new Error("packed client lacks a scoped, generated daisyUI bundle");
  }

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/run/current-system/sw/bin/chromium" });
  const page = await browser.newPage();
  const browserFailures = observeBrowserFailures(page);
  await page.goto(`${runtime.baseUrl}/`, { waitUntil: "domcontentloaded" });
  if (await page.locator("#dsh-companion").count() !== 0) throw new Error("stock DSH root unexpectedly mounted Companion");
  const settingsStyle = page.locator('style[data-plugin-css="dsh-companion-settings"]');
  if (await settingsStyle.count() !== 1 || !(await settingsStyle.textContent())?.includes("--dsw-alias")) throw new Error("packed stock root did not inject the Companion settings CSS Module");
  // Avoid aborting the stock root's normal boot transport while switching documents.
  await page.waitForTimeout(500);
  await page.goto(`${runtime.baseUrl}/companion/`, { waitUntil: "domcontentloaded" });
  const companion = page.locator("#dsh-companion");
  await companion.waitFor({ state: "attached", timeout: 20_000 });
  if (await companion.count() !== 1) throw new Error("Companion alias did not mount exactly one root");
  await page.getByText("Packed runtime outgoing message", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("Packed runtime incoming message.", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  const voice = page.locator('[data-testid^="voice-"]');
  await voice.locator("audio").waitFor({ state: "attached", timeout: 20_000 });
  const audio = voice.locator("audio");
  if (await audio.getAttribute("src") !== "/companion-assembled-smoke/voice.mp3") throw new Error("Companion TTS RPC did not prepare the test-owned audio route");
  const audioResponse = page.waitForResponse((response) => response.url().endsWith("/companion-assembled-smoke/voice.mp3") && response.ok());
  await voice.locator(".companion-voice-control").click();
  await audioResponse;
  if (browserFailures.length) throw new Error(`assembled browser failures:\n${browserFailures.join("\n")}`);
  await page.close();
  console.log(`shipped-path: packed profile, composed config, Loader, alias, assembled transcript, relationship RPC, TTS RPC, and browser verified on ${runtime.baseUrl}`);
} finally {
  if (browser) await browser.close();
  if (runtime) await stopRuntime(runtime.child);
  rmSync(temp, { recursive: true, force: true });
}

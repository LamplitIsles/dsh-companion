import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import CompanionBridge from "../src/client/CompanionBridge.svelte";
import type { CompanionBridgeProps } from "../src/client/companion-bridge.js";
import { companionStyles } from "../src/client/theme.js";
import daisyStyles from "../src/client/daisy.css?inline";
import tailwindStyles from "../src/client/tailwind.css?inline";
import type { CompanionProjection } from "../src/projection.js";
import type { TimelineItem } from "../src/projection.js";
import type { CompanionContinuityView } from "../src/client/companion-bridge.js";
import type { CompanionImageDraft } from "../src/client/image-drafts.js";
import { CompanionPromptRejectedError, queueCompanionPrompt } from "../src/client/admission.js";
import type { CompactionLifecycleState, ContextPressureProjection } from "../src/continuity.js";
import type { ImageAttachmentLimits } from "@deepseek-ai/dsh-attachment";

const fixtureDaisyStyles = `${daisyStyles}\n${tailwindStyles}`.replace(/:root:has\(input\.theme-controller\[value=[^)]+\]:checked\),?/gu, "").replace(/:root\b/gu, ":scope").replace(/\[data-theme=["']?(sticker-messenger|night-voyage)["']?\]/gu, ":scope[data-theme=$1]");
const style = document.createElement("style"); style.textContent = `@font-face{font-family:'Companion Noto Sans SC';src:url('/fonts/NotoSansSC-Companion.woff2') format('woff2');font-weight:100 900;font-display:block}@scope (#dsh-companion){${fixtureDaisyStyles}}${companionStyles.replace('ui-rounded, "SF Pro Rounded", system-ui, sans-serif', '"Companion Noto Sans SC", ui-rounded, "SF Pro Rounded", system-ui, sans-serif')}`; document.head.appendChild(style);
const svgDocument = "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420' viewBox='0 0 640 420'><rect width='640' height='420' rx='34' fill='#ffc857'/><circle cx='180' cy='190' r='86' fill='#f26d85'/><circle cx='460' cy='190' r='86' fill='#76c9bc'/></svg>";
const svg = `data:image/svg+xml,${encodeURIComponent(svgDocument)}`;
const query = new URLSearchParams(location.search);
const now = Date.now();
const moodViews = {
  tender: { mood: "tender", moodLabel: "温柔", intensity: 2, moodNote: "今天想慢一点" },
  bright: { mood: "bright", moodLabel: "明朗", intensity: 2, moodNote: "窗边有一束好光" },
  serene: { mood: "serene", moodLabel: "安宁", intensity: 1, moodNote: undefined },
} as const;
const mood = moodViews[query.get("mood") as keyof typeof moodViews] ?? moodViews.tender;
const projection: CompanionProjection = {
  items: [
    { id: "date:yesterday", kind: "notice", side: "incoming", tone: "info", text: "昨天 · 8月30日", time: now - 26 * 60 * 60 * 1000 },
    { id: "history-1", kind: "text", side: "incoming", text: "今天也见到你真好。**窗外的风**有一点点甜。\n\n- 收好今天的小星光\n- 慢慢讲给你听", time: now - 25 * 60 * 60 * 1000 },
    { id: "history-2", kind: "text", side: "outgoing", text: "我刚刚忙完，想听你说说今天。", time: now - 24 * 60 * 60 * 1000 },
    { id: "history-3", kind: "text", side: "incoming", text: "那我把今天收集到的小小星光，慢慢讲给你听。", time: now - 23 * 60 * 60 * 1000 },
    { id: "date:today", kind: "notice", side: "incoming", tone: "info", text: "今天 · 8月31日", time: now - 180000 },
    { id: "reply", kind: "text", side: "incoming", text: "我们可以把一整天的喧闹放在门外，只留下这一小段安静的时间。", time: now - 180000 },
    { id: "imagegen:demo:loading", kind: "image", side: "incoming", state: "loading", alt: "正在准备的海边图片", time: now - 165000 },
    { id: "imagegen:demo:img", kind: "image", side: "incoming", state: "ready", attachment: { attachmentId: "demo" as never, mediaType: "image/png", name: "今晚的海", bytes: 1200, width: 640, height: 420 }, alt: "今晚的海", time: now - 150000 },
    { id: "imagegen:demo:failed", kind: "image", side: "incoming", state: "failed", alt: "没有生成的图片", error: "这张图片没有完成，可以稍后再试。", time: now - 135000 },
    { id: "voice:demo:1:abc", kind: "voice", side: "incoming", text: "如果累了，就先把肩膀放松下来。", status: "preparing", time: now - 120000 },
    { id: "voice:demo:failed", kind: "voice", side: "incoming", text: "这段语音暂时失败，但文字稿还在。", status: "preparing", time: now - 105000 },
    { id: "notice:reconnect", kind: "notice", side: "incoming", tone: "info", text: "连接有一点不稳，正在重新连接……", time: now - 90000 },
    { id: "queued", kind: "text", side: "outgoing", text: "还有一件小事想告诉你", pending: true },
  ], pendingCount: 1, running: true, status: "working", openState: "open", hasMore: true, loadingOlder: false,
};

const root = document.getElementById("fixture")!;
let revokedImageUrls = 0;
let stopCalls = 0;
let sendCalls = 0;
let sendSequence = 0;
let promptErrorSequence = 0;
let deferredSends = false;
let internalSendFailure = false;
let healthyInternalSendFailure = false;
let pendingSends: Array<{
  text: string;
  images: readonly CompanionImageDraft[];
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];
let lastSend: { text: string; images: readonly CompanionImageDraft[] } | undefined;
const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url: string) => { revokedImageUrls += 1; revokeObjectUrl(url); };
const fixtureProps: CompanionBridgeProps = {
  projection,
  scheme: query.get("theme") === "dark" ? "dark" : "light",
  sessions: [
    { id: "quiet-evening", title: "今晚的小星光", updatedAt: now, running: true, selected: true },
    { id: "weekend-plan", title: "周末想去哪里", updatedAt: now - 86_400_000, running: false, selected: false },
    { id: "first-hello", title: "第一次说晚安", updatedAt: now - 172_800_000, running: false, selected: false },
  ],
  identity: { companionName: "小灯", companionAvatar: svg, userName: "小岛", userAvatar: svg, preferredAddress: "小岛", signature: query.get("signature") === "empty" ? "" : "把平凡日子折成星星，等风来时再写一行很长很长的晚安", ...mood, affinity: 67, affinityStage: "亲近" },
  actions: { send: async (text: string, images: readonly CompanionImageDraft[]) => {
    sendCalls += 1;
    lastSend = { text, images };
    if (internalSendFailure || healthyInternalSendFailure) {
      const reconnecting = internalSendFailure;
      internalSendFailure = false;
      healthyInternalSendFailure = false;
      propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status: reconnecting ? "reconnecting" : current.projection!.status, promptError: "fixture carrier unavailable", promptErrorKey: `fixture-internal-error-${++promptErrorSequence}`, promptErrorOp: "send", promptErrorCode: "internal" } }));
      await queueCompanionPrompt({
        prompt: async () => ({ ok: false, error: { code: "internal", message: "fixture carrier unavailable", details: {} } }),
      }, [{ type: "text", text }]);
      return;
    }
    if (!deferredSends) {
      appendDurableSend(text, images);
      return;
    }
    await new Promise<void>((resolve, reject) => { pendingSends.push({ text, images, resolve, reject }); });
  }, stop: async () => { stopCalls += 1; }, selectSession: async (sessionId: string) => { switchFixtureSession(sessionId); }, loadOlder: async () => undefined, attachmentUrl: async () => URL.createObjectURL(new Blob([svgDocument], { type: "image/svg+xml" })), prepareVoice: async (text: string) => { if (text.includes("失败")) throw new Error("fixture voice failure"); return "/kepos-tts/audio/fixture.mp3"; } },
  workspaceReady: true,
  sessionReady: true,
  sessionId: "quiet-evening",
  imageLimits: {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2_000,
    mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  } satisfies ImageAttachmentLimits,
};
const propsStore = writable(fixtureProps);

function appendDurableSend(text: string, images: readonly CompanionImageDraft[]): void {
  const sendId = `fixture-user-${++sendSequence}`;
  const additions: TimelineItem[] = [];
  if (text) additions.push({ id: sendId, kind: "text", side: "outgoing", origin: "user", text, time: Date.now() });
  images.forEach((draft, index) => {
    additions.push({
      id: `image:${sendId}:${index}`,
      kind: "image",
      side: "outgoing",
      origin: "user",
      state: "ready",
      attachment: { attachmentId: `fixture-att-${sendSequence}-${index}` as never, mediaType: draft.file.type as never, bytes: draft.file.size, width: 1, height: 1, ...(draft.file.name ? { name: draft.file.name } : {}) },
      alt: draft.file.name || "图片",
      time: Date.now(),
    });
  });
  propsStore.update((current) => ({ ...current, projection: { ...current.projection!, items: [...current.projection!.items, ...additions] } }));
}

function settlePendingSend(kind: "resolve" | "reject" | "transport", message = "host-send-rejected"): void {
  const pending = pendingSends.shift();
  if (!pending) return;
  if (kind === "resolve") pending.resolve();
  else if (kind === "reject") pending.reject(new CompanionPromptRejectedError(message));
  else {
    pending.reject(new Error(message));
    propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status: "reconnecting" } }));
  }
}

function confirmLastSend(): void {
  const pending = pendingSends[0];
  const send = pending ?? lastSend;
  if (!send) return;
  appendDurableSend(send.text, send.images);
  if (pending) pendingSends.shift()?.resolve();
  propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status: "ready" } }));
}

function switchFixtureSession(sessionId: string): void {
  propsStore.update((current) => ({
    ...current,
    sessionId,
    sessions: current.sessions.map((session) => ({ ...session, selected: session.id === sessionId })),
    projection: { ...current.projection!, items: [], pendingCount: 0, running: false, status: "ready", openState: "open" },
  }));
}

const component = mount(CompanionBridge, { target: root, props: { propsStore } });
const mountedCompanionRoot = document.getElementById("dsh-companion");

declare global {
  interface Window {
    __companionFixture?: {
      replaceImage(): void;
      removeImage(): void;
      setTheme(theme: "light" | "dark"): void;
      setStatus(status: CompanionProjection["status"]): void;
      setRunning(running: boolean): void;
      finishImageGeneration(): void;
      deferSend(): void;
      resolveSend(): void;
      rejectSend(message?: string): void;
      transportFail(message?: string): void;
      internalFail(): void;
      internalHealthyFail(): void;
      sendError(message?: string): void;
      confirmSend(): void;
      refreshAuthoritative(): void;
      switchSession(sessionId: string): void;
      setCapacity(value: ContextPressureProjection | undefined): void;
      startCompaction(id?: string): void;
      finishCompaction(id?: string): void;
      failCompaction(id?: string): void;
      sendCalls(): number;
      stopCalls(): number;
      setIdentity(patch: Partial<CompanionBridgeProps["identity"]>): void;
      revoked(): number;
      rootIsStable(): boolean;
      dispose(): void;
      unmountCalls(): number;
    };
  }
}
let disposed = false;
let unmountCount = 0;
let lifecycleSeq = 1000;
const lifecycleId = (id = "fixture-compaction"): string => id;
function updateLifecycle(current: CompanionBridgeProps, state: CompactionLifecycleState): CompanionBridgeProps {
  const rows = current.continuity?.lifecycle?.lifecycles ?? [];
  const lifecycles = [...rows.filter((row) => row.compactionId !== state.compactionId), state].sort((left, right) => (left.endSeq ?? left.startSeq) - (right.endSeq ?? right.startSeq));
  return { ...current, continuity: { ...current.continuity, lifecycle: { lifecycles, latest: lifecycles.at(-1) } } };
}
window.__companionFixture = {
  replaceImage() {
    propsStore.update((current) => ({ ...current, projection: { ...current.projection!, items: current.projection!.items.map((item) => item.kind === "image" && item.id === "imagegen:demo:img" ? { ...item, attachment: { ...item.attachment!, attachmentId: "demo-replacement" as never } } : item) } }));
  },
  removeImage() {
    propsStore.update((current) => ({ ...current, projection: { ...current.projection!, items: current.projection!.items.filter((item) => item.id !== "imagegen:demo:img") } }));
  },
  setTheme(theme) { propsStore.update((current) => ({ ...current, scheme: theme })); },
  setStatus(status) { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status } })); },
  setRunning(running) { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, running } })); },
  finishImageGeneration() { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, items: current.projection!.items.filter((item) => item.id !== "imagegen:demo:loading") } })); },
  deferSend() { deferredSends = true; },
  resolveSend() { settlePendingSend("resolve"); },
  rejectSend(message = "host-send-rejected") { settlePendingSend("reject", message); },
  transportFail(message = "transport-failed") { settlePendingSend("transport", message); },
  internalFail() { internalSendFailure = true; },
  internalHealthyFail() { healthyInternalSendFailure = true; },
  sendError(message = "host-send-rejected") {
    propsStore.update((current) => ({ ...current, projection: { ...current.projection!, promptError: message, promptErrorKey: `fixture-send-error-${++promptErrorSequence}`, promptErrorOp: "send", promptErrorCode: "attachment-error" } }));
    pendingSends.shift()?.resolve();
  },
  confirmSend() { confirmLastSend(); },
  refreshAuthoritative() { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status: "ready", openState: "open" } })); },
  switchSession(sessionId) { switchFixtureSession(sessionId); },
  setCapacity(value) { propsStore.update((current) => ({ ...current, continuity: { ...current.continuity, contextPressure: value } })); },
  startCompaction(id) {
    const compactionId = lifecycleId(id);
    propsStore.update((current) => updateLifecycle(current, { compactionId, status: "running", startSeq: ++lifecycleSeq, startedAt: Date.now() }));
  },
  finishCompaction(id) {
    const compactionId = lifecycleId(id);
    const endedAt = Date.now();
    propsStore.update((current) => {
      const existing = current.continuity?.lifecycle?.lifecycles.find((row) => row.compactionId === compactionId);
      const state: CompactionLifecycleState = { compactionId, status: "complete", startSeq: existing?.startSeq ?? ++lifecycleSeq, startedAt: existing?.startedAt ?? endedAt, endSeq: ++lifecycleSeq, endedAt };
      const next = updateLifecycle(current, state);
      const record = { id: `continuity:${compactionId}`, kind: "continuity" as const, side: "incoming" as const, tone: "success" as const, compactionId, text: "已整理对话", time: endedAt, anchorSeq: state.endSeq! };
      return { ...next, projection: { ...next.projection!, items: [...next.projection!.items.filter((item) => item.id !== record.id), record] } };
    });
  },
  failCompaction(id) {
    const compactionId = lifecycleId(id);
    const endedAt = Date.now();
    propsStore.update((current) => {
      const existing = current.continuity?.lifecycle?.lifecycles.find((row) => row.compactionId === compactionId);
      return updateLifecycle(current, { compactionId, status: "failed", startSeq: existing?.startSeq ?? ++lifecycleSeq, startedAt: existing?.startedAt ?? endedAt, endSeq: ++lifecycleSeq, endedAt });
    });
  },
  sendCalls: () => sendCalls,
  stopCalls: () => stopCalls,
  setIdentity(patch) { propsStore.update((current) => ({ ...current, identity: { ...current.identity!, ...patch } })); },
  revoked: () => revokedImageUrls,
  rootIsStable: () => document.getElementById("dsh-companion") === mountedCompanionRoot,
  dispose() { if (!disposed) { disposed = true; unmountCount += 1; void unmount(component); } },
  unmountCalls: () => unmountCount,
};

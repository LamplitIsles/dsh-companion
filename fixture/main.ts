import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { mountBridgeFixture } from "./bridge.js";
import CompanionBridge from "../src/client/CompanionBridge.svelte";
import type { CompanionBridgeProps } from "../src/client/companion-bridge.js";
import { companionStyles } from "../src/client/theme.js";
import daisyStyles from "../src/client/daisy.css?inline";
import { groupTimelineItems, type CompanionProjection } from "../src/projection.js";
import type { TimelineItem } from "../src/projection.js";
import type { CompanionContinuityView } from "../src/client/companion-bridge.js";
import type { CompanionImageDraft } from "../src/client/image-drafts.js";
import type { VoiceRecording } from "../src/client/voice-input.js";
import type { PendingSubmissionRetirement } from "@deepseek-ai/dsh-api-session-controller/client";
import type { CompactionLifecycleState, ContextPressureProjection } from "../src/continuity.js";
import type { ImageAttachmentLimits } from "@deepseek-ai/dsh-attachment";
import type { CompanionReadiness } from "../src/client/readiness.js";

const fixtureDaisyStyles = daisyStyles.replace(/:root:has\(input\.theme-controller\[value=[^)]+\]:checked\),?/gu, "").replace(/:root\b/gu, ":scope").replace(/\[data-theme=["']?(sticker-messenger|night-voyage)["']?\]/gu, ":scope[data-theme=$1]");
const style = document.createElement("style"); style.textContent = `@font-face{font-family:'Companion Noto Sans SC';src:url('/fonts/NotoSansSC-Companion.woff2') format('woff2');font-weight:100 900;font-display:block}@scope (#dsh-companion){${fixtureDaisyStyles}}${companionStyles.replace('ui-rounded, "SF Pro Rounded", system-ui, sans-serif', '"Companion Noto Sans SC", ui-rounded, "SF Pro Rounded", system-ui, sans-serif')}`; document.head.appendChild(style);
const svgDocument = "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420' viewBox='0 0 640 420'><rect width='640' height='420' rx='34' fill='#ffc857'/><circle cx='180' cy='190' r='86' fill='#f26d85'/><circle cx='460' cy='190' r='86' fill='#76c9bc'/></svg>";
const svg = `data:image/svg+xml,${encodeURIComponent(svgDocument)}`;
const query = new URLSearchParams(location.search);
const root = document.getElementById("fixture")!;
const bridgeMode = query.get("bridge") === "1";
if (bridgeMode) mountBridgeFixture(root);
const now = Date.now();
const readiness = (key: string): CompanionReadiness => {
  const value = query.get(key);
  return value === "loading" || value === "ready" || value === "missing" || value === "error" ? value : "ready";
};
const moodViews = {
  tender: { mood: "tender", moodLabel: "柔和", moodNote: "今天想慢一点" },
  bright: { mood: "bright", moodLabel: "愉快", moodNote: "窗边有一束好光" },
  serene: { mood: "serene", moodLabel: "平静", moodNote: undefined },
} as const;
const mood = moodViews[query.get("mood") as keyof typeof moodViews] ?? moodViews.tender;
const wideTableCell = "很长".repeat(100);
const orderedMarkdown = `问到点子上了，这正是最容易踩的坑。我跟你说清楚：

**别用你桌面端（Element）登进去的那个 token。** 那个 token 是"你这次登录会话"的，桌面端一退出登录，它就直接作废。所以它拿来当 bot 的凭证，等于把命根子绑在你会退出的东西上。

而且现在新版 Element **已经不开放"查看 access token"的入口了**（为了安全移掉了），所以也没有现成的 UI 让你点一下复制。可靠的来源就是 login API。

**正确的做法是：**

1. **给 bot 单独做一次登录**——用我刚才那个 curl（或别的登录请求），拿到 **它自己的** \`access_token\` + \`device_id\`。这个 token 跟你桌面端无关，你桌面登不登出，都不影响它。

2. **把 \`access_token\`、\`device_id\` 存到持久、安全的地方**——就是 DSH 的 credentials service（走 \`credentialRef()\`，启动时逐次解析），或者你的密码管理器。这样它就在"你随时能拿到"的地方安家了，不赖在聊天里。

3. **万一哪天真丢了、或被撤了**——不用慌，拿 bot 的**密码**再跑一次 login API，就重新生成一个新的 token + device。所以把 bot 的密码也存起来，就永远能"补"回来。这把锁钥匙在手，就不怕丢了。

一句话：**token 别从桌面会话拿，给 bot 独立登一次、存进 credentials、再留着密码兜底。** 这样桌面退出登录一点关系都没有。🩵

要不要我帮你确认一下你那个 homeserver 的登录端点、以及 DSH credentials 里怎么存这两个值？`;
const markdownEdgeItems: CompanionProjection["items"] = query.get("markdown") === "edge"
  ? [
    { id: "markdown-gfm", messageKey: "markdown-gfm", kind: "text", side: "incoming", text: `## 今天的小清单\n\n- [x] 写完信\n\n- 一层\n  - 二层\n\n| 时刻 | 心情 | 记录 | 提醒 | 天气 |\n| --- | --- | --- | --- | --- |\n| 此刻 | 安静 | ${wideTableCell} | 记得喝水 | 微风 |\n\n<img src=x onerror=alert(1)>`, time: now - 22 * 60 * 60 * 1000 },
  ]
  : query.get("markdown") === "ordered"
    ? [
      { id: "markdown-ordered", messageKey: "markdown-ordered", kind: "text", side: "incoming", text: orderedMarkdown, time: now - 22 * 60 * 60 * 1000 },
    ]
  : [];
const projection: CompanionProjection = {
  items: [
    { id: "date:yesterday", messageKey: "date:yesterday", kind: "notice", side: "incoming", tone: "info", text: "昨天 · 8月30日", time: now - 26 * 60 * 60 * 1000 },
    { id: "history-1", messageKey: "history-1", kind: "text", side: "incoming", text: "今天也见到你真好。**窗外的风**有一点点甜。\n\n- 收好今天的小星光\n- 慢慢讲给你听", time: now - 25 * 60 * 60 * 1000 },
    { id: "history-2", messageKey: "history-2", kind: "text", side: "outgoing", text: "我刚刚忙完，想听你说说今天。", time: now - 24 * 60 * 60 * 1000 },
    { id: "history-3", messageKey: "history-3", kind: "text", side: "incoming", text: "那我把今天收集到的小小星光，慢慢讲给你听。", time: now - 23 * 60 * 60 * 1000 },
    ...markdownEdgeItems,
    { id: "date:today", messageKey: "date:today", kind: "notice", side: "incoming", tone: "info", text: "今天 · 8月31日", time: now - 180000 },
    { id: "reply", messageKey: "reply", kind: "text", side: "incoming", text: "我们可以把一整天的喧闹放在门外，只留下这一小段安静的时间。", time: now - 180000 },
    { id: "imagegen:demo:loading", messageKey: "imagegen:demo:loading", kind: "image", side: "incoming", state: "loading", alt: "正在准备的海边图片", time: now - 165000 },
    { id: "imagegen:demo:img", messageKey: "imagegen:demo:img", kind: "image", side: "incoming", state: "ready", attachment: { attachmentId: "demo" as never, mediaType: "image/png", name: "今晚的海", bytes: 1200, width: 640, height: 420 }, alt: "今晚的海", time: now - 150000 },
    { id: "imagegen:demo:failed", messageKey: "imagegen:demo:failed", kind: "image", side: "incoming", state: "failed", alt: "没有生成的图片", error: "这张图片没有完成，可以稍后再试。", time: now - 135000 },
    { id: "voice:demo:1:abc", messageKey: "voice:demo:1:abc", kind: "voice", side: "incoming", text: "如果累了，就先把肩膀放松下来。", status: "preparing", time: now - 120000 },
    { id: "voice:demo:failed", messageKey: "voice:demo:failed", kind: "voice", side: "incoming", text: "这段语音暂时失败，但文字稿还在。", status: "preparing", time: now - 105000 },
    { id: "notice:reconnect", messageKey: "notice:reconnect", kind: "notice", side: "incoming", tone: "info", text: "连接有一点不稳，正在重新连接……", time: now - 90000 },
    { id: "queued", messageKey: "queued", kind: "text", side: "outgoing", text: "还有一件小事想告诉你", pending: true, waitsForCurrentReply: true },
  ], messageUnits: [], pendingCount: 1, running: true, status: "working", openState: "open", hasMore: true, loadingOlder: false,
};
projection.messageUnits = groupTimelineItems(projection.items);

function replaceProjectionItems(current: CompanionBridgeProps, items: readonly TimelineItem[]): CompanionBridgeProps {
  return { ...current, projection: { ...current.projection!, items, messageUnits: groupTimelineItems(items) } };
}

let revokedImageUrls = 0;
let stopCalls = 0;
let sendCalls = 0;
let sendSequence = 0;
let submissionSequence = 0;
let promptErrorSequence = 0;
let failedAttachmentLoads = 0;
let deferredSends = false;
let releaseVoiceTranscription: (() => void) | undefined;
const voiceTranscriptionGate = query.get("voice") === "1"
  ? new Promise<void>((resolve) => { releaseVoiceTranscription = resolve; })
  : undefined;
let pendingSends: Array<{
  text: string;
  images: readonly CompanionImageDraft[];
  echoId: string;
  onRetire?: (retirement: PendingSubmissionRetirement) => void;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];
let lastSend: { text: string; images: readonly CompanionImageDraft[]; echoId: string } | undefined;
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
  actions: { send: async (text: string, images: readonly CompanionImageDraft[], onRetire?: (retirement: PendingSubmissionRetirement) => void) => {
    sendCalls += 1;
    const echoId = appendSubmissionEcho(text, images);
    lastSend = { text, images, echoId };
    if (!deferredSends) {
      appendDurableSend(text, images, echoId);
      onRetire?.({ reason: "observed", attachments: [] });
      return;
    }
    await new Promise<void>((resolve, reject) => { pendingSends.push({ text, images, echoId, onRetire, resolve, reject }); });
  }, stop: async () => { stopCalls += 1; }, selectSession: async (sessionId: string) => { switchFixtureSession(sessionId); }, loadOlder: async () => undefined, attachmentUrl: async () => { if (failedAttachmentLoads > 0) { failedAttachmentLoads -= 1; throw new Error("fixture attachment failure"); } return URL.createObjectURL(new Blob([svgDocument], { type: "image/svg+xml" })); }, prepareVoice: async (text: string) => { if (text.includes("失败")) throw new Error("fixture voice failure"); return "/kepos-speech/audio/fixture.mp3"; }, transcribeVoice: async (_recording: VoiceRecording) => { if (query.get("voice") === "fail") throw new Error("语音转写暂时不可用，请稍后重试。"); if (voiceTranscriptionGate) await voiceTranscriptionGate; return { text: "来自麦克风的测试消息", expression: "sad" }; } },
  workspaceReadiness: readiness("workspace"),
  relationshipReadiness: readiness("relationship"),
  sessionReadiness: readiness("session"),
  sessionId: "quiet-evening",
  imageLimits: {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2_000,
    mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  } satisfies ImageAttachmentLimits,
  voiceCapability: "available",
};
const propsStore = writable(fixtureProps);

function appendDurableSend(text: string, images: readonly CompanionImageDraft[], echoId: string): void {
  const sendId = `fixture-user-${++sendSequence}`;
  const additions: TimelineItem[] = [];
  if (text) additions.push({ id: sendId, messageKey: echoId, kind: "text", side: "outgoing", origin: "user", text, time: Date.now() });
  images.forEach((draft, index) => {
    additions.push({
      id: `image:${sendId}:${index}`,
      messageKey: echoId,
      kind: "image",
      side: "outgoing",
      origin: "user",
      state: "ready",
      attachment: { attachmentId: `fixture-att-${sendSequence}-${index}` as never, mediaType: draft.file.type as never, bytes: draft.file.size, width: 1, height: 1, ...(draft.file.name ? { name: draft.file.name } : {}) },
      alt: draft.file.name || "图片",
      time: Date.now(),
    });
  });
  propsStore.update((current) => replaceProjectionItems(current, [
    ...current.projection!.items.filter((item) => !item.id.startsWith(`${echoId}:`)),
    ...additions,
  ]));
}

function appendSubmissionEcho(text: string, images: readonly CompanionImageDraft[]): string {
  const id = `submission:fixture-${++submissionSequence}`;
  const additions: TimelineItem[] = [];
  if (text) additions.push({ id: `${id}:text`, messageKey: id, kind: "text", side: "outgoing", origin: "user", text, time: Date.now() });
  images.forEach((draft, index) => additions.push({ id: `${id}:image:${index}`, messageKey: id, kind: "image", side: "outgoing", origin: "user", state: "ready", previewUrl: draft.previewUrl, alt: draft.file.name || "图片", time: Date.now() }));
  propsStore.update((current) => replaceProjectionItems(current, [...current.projection!.items, ...additions]));
  return id;
}

function removeSubmissionEcho(id: string): void {
  propsStore.update((current) => replaceProjectionItems(current, current.projection!.items.filter((item) => !item.id.startsWith(`${id}:`))));
}

function setPromptError(text: string, code: string, op: "send" | "stop" = "send", status?: CompanionProjection["status"]): void {
  propsStore.update((current) => {
    const items: TimelineItem[] = [
      ...current.projection!.items.filter((item) => item.id !== "prompt-error"),
      { id: "prompt-error", messageKey: "prompt-error", kind: "notice", side: "incoming", tone: "error", text, time: Date.now() },
    ];
    return {
      ...current,
      projection: {
        ...current.projection!,
        ...(status ? { status } : {}),
        promptError: text,
        promptErrorKey: `fixture-prompt-error-${++promptErrorSequence}`,
        promptErrorOp: op,
        promptErrorCode: code,
        items,
        messageUnits: groupTimelineItems(items),
      },
    };
  });
}

function settlePendingSend(kind: "resolve" | "reject", message = "host-send-rejected"): void {
  const pending = pendingSends.shift();
  if (!pending) return;
  if (kind === "resolve") {
    removeSubmissionEcho(pending.echoId);
    pending.onRetire?.({ reason: "observed", attachments: [] });
    pending.resolve();
  }
  else if (kind === "reject") {
    removeSubmissionEcho(pending.echoId);
    pending.onRetire?.({ reason: "failed" });
    pending.reject(new Error(message));
  }
}

function confirmLastSend(): void {
  const pending = pendingSends[0];
  const send = pending ?? lastSend;
  if (!send) return;
  appendDurableSend(send.text, send.images, send.echoId);
  if (pending) {
    const settled = pendingSends.shift()!;
    settled.onRetire?.({ reason: "observed", attachments: [] });
    settled.resolve();
  }
  propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status: "ready" } }));
}

function switchFixtureSession(sessionId: string): void {
  propsStore.update((current) => ({
    ...current,
    sessionId,
    sessions: current.sessions.map((session) => ({ ...session, selected: session.id === sessionId })),
    projection: { ...current.projection!, items: [], messageUnits: [], pendingCount: 0, running: false, status: "ready", openState: "open", promptError: undefined, promptErrorKey: undefined, promptErrorOp: undefined, promptErrorCode: undefined, lastAgentError: undefined },
  }));
}

const component = bridgeMode ? undefined : mount(CompanionBridge, { target: root, props: { propsStore } });
const mountedCompanionRoot = bridgeMode ? undefined : document.getElementById("dsh-companion");

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
      seedInternalPromptError(): void;
      sendError(message?: string): void;
      confirmSend(): void;
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
      setReadiness(next: { workspace?: CompanionReadiness; relationship?: CompanionReadiness; session?: CompanionReadiness }): void;
      failNextImageLoad(): void;
      resolveVoice(): void;
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
    propsStore.update((current) => replaceProjectionItems(current, current.projection!.items.map((item) => item.kind === "image" && item.id === "imagegen:demo:img" ? { ...item, attachment: { ...item.attachment!, attachmentId: "demo-replacement" as never } } : item)));
  },
  removeImage() {
    propsStore.update((current) => replaceProjectionItems(current, current.projection!.items.filter((item) => item.id !== "imagegen:demo:img")));
  },
  setTheme(theme) { propsStore.update((current) => ({ ...current, scheme: theme })); },
  setReadiness(next) {
    propsStore.update((current) => ({
      ...current,
      workspaceReadiness: next.workspace ?? current.workspaceReadiness,
      relationshipReadiness: next.relationship ?? current.relationshipReadiness,
      sessionReadiness: next.session ?? current.sessionReadiness,
    }));
  },
  failNextImageLoad() { failedAttachmentLoads += 1; },
  resolveVoice() { releaseVoiceTranscription?.(); releaseVoiceTranscription = undefined; },
  setStatus(status) { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, status } })); },
  setRunning(running) { propsStore.update((current) => ({ ...current, projection: { ...current.projection!, running } })); },
  finishImageGeneration() { propsStore.update((current) => replaceProjectionItems(current, current.projection!.items.filter((item) => item.id !== "imagegen:demo:loading"))); },
  deferSend() { deferredSends = true; },
  resolveSend() { settlePendingSend("resolve"); },
  rejectSend(message = "host-send-rejected") { settlePendingSend("reject", message); },
  seedInternalPromptError() {
    setPromptError("fixture existing carrier error", "internal");
  },
  sendError(message = "host-send-rejected") {
    setPromptError(message, "attachment-error");
    const pending = pendingSends.shift();
    if (pending) {
      removeSubmissionEcho(pending.echoId);
      pending.onRetire?.({ reason: "failed" });
      pending.reject(new Error(message));
    }
  },
  confirmSend() { confirmLastSend(); },
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
      const record = { id: `continuity:${compactionId}`, messageKey: `continuity:${compactionId}`, kind: "continuity" as const, side: "incoming" as const, tone: "success" as const, compactionId, text: "已整理对话", time: endedAt, anchorSeq: state.endSeq! };
      return replaceProjectionItems(next, [...next.projection!.items.filter((item) => item.id !== record.id), record]);
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
  rootIsStable: () => !bridgeMode && document.getElementById("dsh-companion") === mountedCompanionRoot,
  dispose() { if (!disposed) { disposed = true; unmountCount += 1; if (component) void unmount(component); } },
  unmountCalls: () => unmountCount,
};

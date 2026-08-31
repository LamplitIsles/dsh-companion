import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import CompanionBridge from "../src/client/CompanionBridge.svelte";
import type { CompanionBridgeProps } from "../src/client/companion-bridge.js";
import { companionStyles } from "../src/client/theme.js";
import daisyStyles from "../src/client/daisy.css?inline";
import tailwindStyles from "../src/client/tailwind.css?inline";
import type { CompanionProjection } from "../src/projection.js";

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
  actions: { send: async () => undefined, stop: async () => { stopCalls += 1; }, selectSession: async () => undefined, loadOlder: async () => undefined, attachmentUrl: async () => URL.createObjectURL(new Blob([svgDocument], { type: "image/svg+xml" })), prepareVoice: async (text: string) => { if (text.includes("失败")) throw new Error("fixture voice failure"); return "/kepos-tts/audio/fixture.mp3"; } },
  workspaceReady: true,
  sessionReady: true,
};
const propsStore = writable(fixtureProps);
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
  stopCalls: () => stopCalls,
  setIdentity(patch) { propsStore.update((current) => ({ ...current, identity: { ...current.identity!, ...patch } })); },
  revoked: () => revokedImageUrls,
  rootIsStable: () => document.getElementById("dsh-companion") === mountedCompanionRoot,
  dispose() { if (!disposed) { disposed = true; unmountCount += 1; void unmount(component); } },
  unmountCalls: () => unmountCount,
};

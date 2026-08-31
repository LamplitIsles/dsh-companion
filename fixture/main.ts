import Companion from "../src/client/Companion.svelte";
import { companionStyles } from "../src/client/theme.js";
import daisyStyles from "../src/client/daisy.css?inline";
import type { CompanionProjection } from "../src/projection.js";

const style = document.createElement("style"); style.textContent = `@font-face{font-family:'Companion Noto Sans SC';src:url('/fonts/NotoSansSC-Companion.woff2') format('woff2');font-weight:100 900;font-display:block}@scope (#dsh-companion){${daisyStyles}}${companionStyles.replace('ui-rounded, "SF Pro Rounded", system-ui, sans-serif', '"Companion Noto Sans SC", ui-rounded, "SF Pro Rounded", system-ui, sans-serif')}`; document.head.appendChild(style);
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
    { id: "history-1", kind: "text", side: "incoming", text: "今天也见到你真好。窗外的风有一点点甜。", time: now - 25 * 60 * 60 * 1000 },
    { id: "history-2", kind: "text", side: "outgoing", text: "我刚刚忙完，想听你说说今天。", time: now - 24 * 60 * 60 * 1000 },
    { id: "history-3", kind: "text", side: "incoming", text: "那我把今天收集到的小小星光，慢慢讲给你听。", streaming: false, time: now - 23 * 60 * 60 * 1000 },
    { id: "date:today", kind: "notice", side: "incoming", tone: "info", text: "今天 · 8月31日", time: now - 180000 },
    { id: "reply", kind: "text", side: "incoming", text: "我们可以把一整天的喧闹放在门外，只留下这一小段安静的时间。", streaming: false, time: now - 180000 },
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
const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url: string) => { revokedImageUrls += 1; revokeObjectUrl(url); };
const component = new Companion({ target: root, props: {
  projection,
  scheme: query.get("theme") === "dark" ? "dark" : "light",
  identity: { companionName: "小灯", companionAvatar: svg, userName: "小岛", userAvatar: svg, preferredAddress: "小岛", signature: query.get("signature") === "empty" ? "" : "把平凡日子折成星星，等风来时再写一行很长很长的晚安", ...mood, affinity: 67, affinityStage: "亲近" },
  actions: { send: async () => undefined, loadOlder: async () => undefined, attachmentUrl: async () => URL.createObjectURL(new Blob([svgDocument], { type: "image/svg+xml" })), prepareVoice: async (text: string) => { if (text.includes("失败")) throw new Error("fixture voice failure"); return "/kepos-tts/audio/fixture.mp3"; } },
}});

declare global { interface Window { __companionFixture?: { replaceImage(): void; removeImage(): void; revoked(): number }; } }
window.__companionFixture = {
  replaceImage() {
    component.$set({ projection: { ...projection, items: projection.items.map((item) => item.kind === "image" && item.id === "imagegen:demo:img" ? { ...item, attachment: { ...item.attachment!, attachmentId: "demo-replacement" as never } } : item) } });
  },
  removeImage() {
    component.$set({ projection: { ...projection, items: projection.items.filter((item) => item.id !== "imagegen:demo:img") } });
  },
  revoked: () => revokedImageUrls,
};

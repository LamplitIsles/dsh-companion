import Companion from "../src/client/Companion.svelte";
import { companionStyles } from "../src/client/theme.js";
import type { CompanionProjection } from "../src/projection.js";

const style = document.createElement("style"); style.textContent = companionStyles; document.head.appendChild(style);
const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='420' viewBox='0 0 640 420'%3E%3Crect width='640' height='420' rx='34' fill='%23ffc857'/%3E%3Ccircle cx='180' cy='190' r='86' fill='%23f26d85'/%3E%3Ccircle cx='460' cy='190' r='86' fill='%2376c9bc'/%3E%3Ctext x='320' y='345' text-anchor='middle' font-size='34' fill='%23322b38'%3E今晚去看海吧%3C/text%3E%3C/svg%3E";
const projection: CompanionProjection = {
  items: [
    { id: "hello", kind: "text", side: "incoming", text: "今天也见到你真好。窗外的风有一点点甜。", time: Date.now() - 420000 },
    { id: "you", kind: "text", side: "outgoing", text: "我刚刚忙完，想听你说说今天。", time: Date.now() - 300000 },
    { id: "reply", kind: "text", side: "incoming", text: "那我把今天收集到的小小星光，慢慢讲给你听。", streaming: false, time: Date.now() - 180000 },
    { id: "imagegen:demo:img", kind: "image", side: "incoming", state: "ready", attachment: { attachmentId: "demo" as never, mediaType: "image/png", name: "今晚的海", bytes: 1200, width: 640, height: 420 }, alt: "今晚的海", time: Date.now() - 120000 },
    { id: "voice:demo:1:abc", kind: "voice", side: "incoming", text: "如果累了，就先把肩膀放松下来。", status: "preparing", time: Date.now() - 60000 },
    { id: "queued", kind: "text", side: "outgoing", text: "还有一件小事想告诉你", pending: true },
  ], pendingCount: 1, running: true, status: "working", openState: "open", hasMore: true, loadingOlder: false,
};

const root = document.getElementById("fixture")!;
new Companion({ target: root, props: {
  projection,
  scheme: new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light",
  identity: { companionName: "小灯", companionAvatar: svg, userName: "小岛", userAvatar: svg, preferredAddress: "小岛", signature: "把平凡日子折成星星", mood: "tender", moodLabel: "温柔", intensity: 2, moodNote: "今天想慢一点", affinity: 67, affinityStage: "亲近" },
  actions: { send: async () => undefined, loadOlder: async () => undefined, attachmentUrl: async () => svg, prepareVoice: async () => "data:audio/mpeg;base64,SUQzBAAAAAAA" },
}});

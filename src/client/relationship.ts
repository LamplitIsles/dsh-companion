export const MOOD_LABELS: Readonly<Record<string, string>> = Object.freeze({ neutral: "如常", serene: "安宁", bright: "明朗", playful: "顽皮", tender: "温柔", pensive: "沉思", tired: "疲倦", low: "低落" });
export const INTENSITY_LABELS: Readonly<Record<number, string>> = Object.freeze({ 1: "轻微", 2: "明显", 3: "强烈" });
export function affinityStage(value: number): "疏离" | "生疏" | "熟悉" | "亲近" | "深厚" {
  const n = Math.max(0, Math.min(100, Math.trunc(value)));
  return n < 20 ? "疏离" : n < 40 ? "生疏" : n < 60 ? "熟悉" : n < 80 ? "亲近" : "深厚";
}

export interface ClientAvatar {
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  width: number;
  height: number;
}

export interface ClientSettings {
  workspaceId: string;
  companionName: string;
  companionAvatar?: ClientAvatar;
  userName: string;
  userAvatar?: ClientAvatar;
  preferredAddress: string;
  defaultAffinity: number;
}

export function relationshipControlsWritable(readOnly: boolean, saving: boolean): boolean {
  return !readOnly && !saving;
}

const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function decodeClientSettings(value: unknown): ClientSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: string, fallback: string): string => typeof record[key] === "string" && (record[key] as string).trim() ? (record[key] as string).trim().slice(0, 80) : fallback;
  const result: ClientSettings = {
    workspaceId: text("workspaceId", ""),
    companionName: text("companionName", "Companion"),
    userName: text("userName", "你"),
    preferredAddress: text("preferredAddress", "你"),
    defaultAffinity: typeof record.defaultAffinity === "number" && Number.isInteger(record.defaultAffinity) ? Math.max(0, Math.min(100, record.defaultAffinity)) : 50,
  };
  const companionAvatar = decodeAvatar(record.companionAvatar);
  const userAvatar = decodeAvatar(record.userAvatar);
  if (companionAvatar) result.companionAvatar = companionAvatar;
  if (userAvatar) result.userAvatar = userAvatar;
  return result;
}

function decodeAvatar(value: unknown): ClientAvatar | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.data !== "string" || typeof record.mediaType !== "string" || !MEDIA_TYPES.has(record.mediaType)) return undefined;
  if (!record.data.startsWith(`data:${record.mediaType};base64,`)) return undefined;
  if (typeof record.width !== "number" || typeof record.height !== "number" || !Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width < 1 || record.height < 1 || record.width > 4096 || record.height > 4096) return undefined;
  if (record.data.length > 1_400_000) return undefined;
  return { data: record.data, mediaType: record.mediaType as ClientAvatar["mediaType"], width: record.width, height: record.height };
}

export async function readAvatar(file: File): Promise<ClientAvatar> {
  if (!MEDIA_TYPES.has(file.type) || file.size > 1024 * 1024) throw new Error("头像必须是 1 MB 以内的 PNG、JPEG、WebP 或 GIF。");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("头像读取失败。"));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.width > 0 && image.height > 0 && image.width <= 4096 && image.height <= 4096 ? resolve({ width: image.width, height: image.height }) : reject(new Error("头像尺寸需要在 1 到 4096 像素之间。"));
    image.onerror = () => reject(new Error("头像解码失败。"));
    image.src = data;
  });
  return { data, mediaType: file.type as ClientAvatar["mediaType"], ...dimensions };
}

export function settingsPayload(settings: ClientSettings): Record<string, unknown> {
  return {
    workspaceId: settings.workspaceId.trim(), companionName: settings.companionName.trim(), userName: settings.userName.trim(), preferredAddress: settings.preferredAddress.trim(), defaultAffinity: settings.defaultAffinity,
    ...(settings.companionAvatar ? { companionAvatar: settings.companionAvatar } : {}),
    ...(settings.userAvatar ? { userAvatar: settings.userAvatar } : {}),
  };
}

function sameSettingValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Keep staged fields while clean fields follow a replacement Host snapshot. */
export function mergeCleanSettingsDraft(draft: ClientSettings, previous: ClientSettings, next: ClientSettings): ClientSettings {
  const merged = { ...draft };
  for (const key of Object.keys(settingsPayload(next)) as (keyof ClientSettings)[]) {
    if (sameSettingValue(draft[key], previous[key])) (merged as Record<keyof ClientSettings, unknown>)[key] = next[key];
  }
  return merged;
}

/** Return only values that differ from the last Host-accepted baseline. */
export function changedSettingsPayload(draft: ClientSettings, baseline: ClientSettings): Record<string, unknown> {
  const draftPayload = settingsPayload(draft);
  const baselinePayload = settingsPayload(baseline);
  return Object.fromEntries(Object.entries(draftPayload).filter(([key, value]) => !sameSettingValue(value, baselinePayload[key])));
}

/** Compare a planned write with the latest Host-accepted field value. */
export function settingValueAccepted(settings: ClientSettings | undefined, key: string, value: unknown): boolean {
  return settings !== undefined && sameSettingValue((settingsPayload(settings) as Record<string, unknown>)[key], value);
}

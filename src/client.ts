import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-theme/client";
import { CompanionRoot } from "./client/CompanionRoot.js";
import { CompanionSettingsCard } from "./client/CompanionSettingsCard.js";
import { decodeClientSettings } from "./client/settings.js";
import { companionStyles } from "./client/theme.js";

export const name = "dsh-companion" as const;
export const inject = ["connection", "locale", "sessions", "settingsScope", "slots", "theme", "workspaces"] as const;

const SETTINGS_NAMESPACE = "dsh-companion";

function onCompanionPath(pathname: string): boolean { return pathname === "/companion" || pathname.startsWith("/companion/"); }

export function installStyles(ctx: ClientContext): () => void {
  const id = "dsh-companion-styles";
  const existing = document.getElementById(id);
  if (existing) return () => undefined;
  const element = document.createElement("style");
  element.id = id;
  element.textContent = companionStyles;
  document.head.appendChild(element);
  const dispose = () => element.remove();
  if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-companion: styles");
  return dispose;
}

export function apply(ctx: ClientContext): void {
  const settings = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE, decode: decodeClientSettings });
  const connection = (ctx as unknown as { connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> } } }).connection;
  ctx.slots.inject("settings.plugin.item" as never, () => ctx.slots.register({
    name: "settings.plugin.item",
    key: SETTINGS_NAMESPACE,
    inject: () => ({
      scope: settings,
      currentAffinity: async () => {
        const current = settings.getSnapshot().value;
        if (!current?.workspaceId) return undefined;
        const result = await connection.rpc.call("/dsh-companion", "relationship/get", { workspaceId: current.workspaceId });
        return result.ok ? Number((result.value as { state?: { affinity?: unknown } }).state?.affinity) : undefined;
      },
      resetAffinity: async () => {
        const current = settings.getSnapshot().value;
        if (!current?.workspaceId) throw new Error("请先配置 Companion Workspace。");
        const result = await connection.rpc.call("/dsh-companion", "relationship/reset", { workspaceId: current.workspaceId });
        if (!result.ok) throw new Error(result.error?.message ?? "重置失败。");
      },
    }),
  } as never, CompanionSettingsCard as never));
  if (typeof window === "undefined" || !onCompanionPath(window.location.pathname)) return;
  installStyles(ctx);
  ctx.slots.inject("root" as never, () => ctx.slots.register({
    name: "root",
    priority: -20,
    inject: () => ({ ctx, settings }),
  } as never, CompanionRoot as never));
}

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
import daisyStyles from "./client/daisy.css?inline";
import settingsCardStyles from "./client/CompanionSettingsCard.module.css?inline";

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
  element.textContent = `${daisyStyles}\n${companionStyles}`;
  document.head.appendChild(element);
  const dispose = () => element.remove();
  if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-companion: styles");
  return dispose;
}

export function installSettingsStyles(ctx: ClientContext): () => void {
  const id = "dsh-companion-settings-styles";
  const existing = document.getElementById(id);
  if (existing) return () => undefined;
  const element = document.createElement("style");
  element.id = id;
  element.dataset.pluginCss = "dsh-companion-settings";
  element.textContent = settingsCardStyles;
  document.head.appendChild(element);
  const dispose = () => element.remove();
  if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-companion: settings styles");
  return dispose;
}

export function apply(ctx: ClientContext): void {
  installSettingsStyles(ctx);
  const settings = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE, decode: decodeClientSettings });
  const connection = (ctx as unknown as { connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> } } }).connection;
  const configuredWorkspace = (): string => {
    const workspaceId = settings.getSnapshot().value?.workspaceId;
    if (!workspaceId) throw new Error("请先配置 Companion Workspace。");
    return workspaceId;
  };
  const relationshipCall = async (endpoint: string, extra: object = {}): Promise<unknown> => {
    const result = await connection.rpc.call("/dsh-companion", endpoint, { workspaceId: configuredWorkspace(), ...extra });
    if (!result.ok) throw new Error(result.error?.message ?? "关系更新失败。");
    return result.value;
  };
  ctx.slots.inject("settings.plugin.item" as never, () => ctx.slots.register({
    name: "settings.plugin.item",
    key: SETTINGS_NAMESPACE,
    inject: () => ({
      scope: settings,
      workspaceSource: ctx.workspaces.list,
      currentAffinity: async () => {
        try {
          const affinity = (await relationshipCall("relationship/get") as { state?: { affinity?: unknown } }).state?.affinity;
          return typeof affinity === "number" && Number.isFinite(affinity) ? affinity : undefined;
        }
        catch { return undefined; }
      },
      resetAffinity: async () => { await relationshipCall("relationship/reset"); },
      setAffinity: async (affinity: number) => { await relationshipCall("relationship/set-affinity", { affinity }); },
      clearSignature: async () => { await relationshipCall("relationship/clear-signature"); },
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

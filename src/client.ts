import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
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
import { APPLICATION_STYLESHEET_ID, mountStyleSheet, SETTINGS_STYLESHEET_ID } from "./client/styles.js";
import { registerCompanionContinuity } from "./continuity.js";

export const name = "dsh-companion" as const;
export const inject = ["connection", "locale", "sessions", "settingsScope", "slots", "theme", "uiConversation", "workspaces"] as const;

const SETTINGS_NAMESPACE = "dsh-companion";

function onCompanionPath(pathname: string): boolean { return pathname === "/companion" || pathname.startsWith("/companion/"); }

export function installStyles(ctx: ClientContext): void {
  mountStyleSheet(ctx, `${daisyStyles}\n${companionStyles}`, APPLICATION_STYLESHEET_ID, "dsh-companion: application stylesheet");
}

export function installSettingsStyles(ctx: ClientContext): void {
  mountStyleSheet(ctx, settingsCardStyles, SETTINGS_STYLESHEET_ID, "dsh-companion: settings stylesheet");
}

export function apply(ctx: ClientContext): void {
  installSettingsStyles(ctx);
  const disposeContinuity = registerCompanionContinuity(ctx);
  ctx.effect(() => disposeContinuity, "dsh-companion: continuity registrations");
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

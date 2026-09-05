import type { Context as ClientContext } from "@deepseek-ai/cordis";

export const CLIENT_PLUGIN_ID = "@lamplitisles/dsh-companion" as const;
export const APPLICATION_STYLESHEET_ID = `${CLIENT_PLUGIN_ID}/application.css` as const;
export const SETTINGS_STYLESHEET_ID = `${CLIENT_PLUGIN_ID}/settings.css` as const;

type StyleContext = Pick<ClientContext, "effect">;

/** Mount one inline sheet for exactly the lifetime of its owning client effect. */
export function mountStyleSheet(ctx: StyleContext, css: string, sheetId: string, label: string): void {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const element = document.createElement("style");
    element.dataset.plugin = CLIENT_PLUGIN_ID;
    element.dataset.pluginCss = sheetId;
    element.textContent = css;
    document.head.appendChild(element);
    return () => element.remove();
  }, label);
}

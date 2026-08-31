export type CompanionScheme = "light" | "dark";
export const LIGHT_THEME = "sticker-messenger" as const;
export const DARK_THEME = "night-voyage" as const;

export function companionThemeForScheme(scheme: string): typeof LIGHT_THEME | typeof DARK_THEME {
  return scheme === "dark" ? DARK_THEME : LIGHT_THEME;
}

/**
 * Authored geometry layered over generated, prefixed daisyUI primitives. Both
 * sheets are injected under #dsh-companion; Tailwind Preflight is omitted.
 */
export const companionStyles = `
#dsh-companion {
  --color-base-100: #fffaf3; --color-base-200: #f6eadb; --color-base-300: #e5d2bd;
  --color-base-content: #322b38; --color-primary: #f26d85; --color-primary-content: #fff8f5;
  --color-secondary: #76c9bc; --color-secondary-content: #123d3c; --color-accent: #ffc857;
  --color-neutral: #3e3746; --color-neutral-content: #fffaf3; --radius-box: 1.35rem; --radius-field: .9rem;
  --cmp-shadow: 0 18px 55px rgb(70 45 39 / .14); min-height: 100%;
}
#dsh-companion[data-theme="night-voyage"] {
  --color-base-100: #111827; --color-base-200: #182338; --color-base-300: #2d3b59;
  --color-base-content: #edf2ff; --color-primary: #ff8c9e; --color-primary-content: #2d1722;
  --color-secondary: #71d6cf; --color-secondary-content: #0c3034; --color-accent: #f4c86e;
  --color-neutral: #24324c; --color-neutral-content: #edf2ff; --radius-box: 1.35rem; --radius-field: .9rem;
  --cmp-shadow: 0 18px 55px rgb(0 0 0 / .35);
}
#dsh-companion *, #dsh-companion *::before, #dsh-companion *::after { box-sizing: border-box; }
#dsh-companion button, #dsh-companion textarea, #dsh-companion input { font: inherit; }
#dsh-companion .cmp-btn { min-height: 44px; min-width: 44px; }
#dsh-companion .cmp-textarea { resize: none; }
#dsh-companion.companion-shell { min-height: 100dvh; color: var(--color-base-content); background: radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--color-secondary) 18%, transparent), transparent 35%), var(--color-base-100); font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; }
#dsh-companion .companion-app { width: min(960px, 100%); min-height: 100dvh; margin: 0 auto; }
#dsh-companion .companion-main { min-width: 0; display: flex; flex-direction: column; min-height: 100dvh; }
#dsh-companion .companion-header { display: flex; align-items: center; gap: 12px; padding: max(14px, env(safe-area-inset-top)) 22px 12px; border-bottom: 1px solid color-mix(in srgb, var(--color-base-content) 12%, transparent); background: color-mix(in srgb, var(--color-base-100) 90%, transparent); backdrop-filter: blur(18px); position: sticky; top: 0; z-index: 4; }
#dsh-companion .companion-avatar { flex: 0 0 auto; border: 2px solid color-mix(in srgb, var(--color-primary) 45%, transparent); box-shadow: 0 5px 16px color-mix(in srgb, var(--color-primary) 20%, transparent); cursor: pointer; }
#dsh-companion .companion-avatar img { width: 100%; height: 100%; object-fit: cover; }
#dsh-companion .companion-header-copy { min-width: 0; flex: 1; }
#dsh-companion .companion-name { font-weight: 760; letter-spacing: -.01em; }
#dsh-companion .companion-presence { display: inline-flex; align-items: center; gap: 6px; font-size: .75rem; color: color-mix(in srgb, var(--color-base-content) 65%, transparent); }
#dsh-companion .companion-presence .cmp-status { width: 8px; height: 8px; }
#dsh-companion .companion-timeline { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 24px clamp(14px, 4vw, 46px) 14px; scroll-behavior: smooth; }
#dsh-companion .companion-row { display: flex; gap: 9px; align-items: flex-end; margin: 8px 0; max-width: min(84%, 720px); }
#dsh-companion .companion-row.outgoing { margin-left: auto; flex-direction: row-reverse; }
#dsh-companion .companion-row .cmp-avatar { width: 32px; height: 32px; border-width: 1px; cursor: default; }
#dsh-companion .companion-bubble { border-radius: 20px 20px 20px 7px; padding: 11px 14px; line-height: 1.52; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 5px 20px color-mix(in srgb, var(--color-base-content) 7%, transparent); background: var(--color-base-200); }
#dsh-companion .outgoing .companion-bubble { border-radius: 20px 20px 7px 20px; background: color-mix(in srgb, var(--color-primary) 22%, var(--color-base-100)); }
#dsh-companion .companion-meta { font-size: .68rem; opacity: .55; margin-top: 4px; }
#dsh-companion .companion-media { width: min(100%, 480px); border-radius: 21px; overflow: hidden; background: var(--color-base-200); box-shadow: var(--cmp-shadow); }
#dsh-companion .companion-media img { display: block; width: 100%; max-height: 520px; object-fit: cover; cursor: zoom-in; }
#dsh-companion .companion-voice { min-width: min(280px, 72vw); display: flex; align-items: center; gap: 9px; }
#dsh-companion .companion-audio { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
#dsh-companion .companion-voice-control { flex: 0 0 auto; }
#dsh-companion .companion-voice-progress { display: grid; grid-template-columns: minmax(70px, 1fr) auto; align-items: center; gap: 7px; min-width: 112px; }
#dsh-companion .companion-voice-progress input[type="range"] { width: 100%; min-width: 70px; accent-color: var(--color-primary); }
#dsh-companion .companion-voice-state { color: color-mix(in srgb, var(--color-base-content) 62%, transparent); font-size: .72rem; white-space: nowrap; }
#dsh-companion .companion-composer { padding: 10px 18px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid color-mix(in srgb, var(--color-base-content) 12%, transparent); background: color-mix(in srgb, var(--color-base-100) 94%, transparent); position: sticky; bottom: 0; z-index: 3; }
#dsh-companion .companion-compose-row { display: flex; align-items: flex-end; gap: 8px; max-width: 820px; margin: auto; }
#dsh-companion .companion-compose-row .cmp-textarea { flex: 1; min-height: 46px; max-height: 150px; padding: 12px 15px; line-height: 1.4; }
#dsh-companion .companion-mood-orb { width: 90px; height: 90px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, var(--color-accent), var(--color-primary)); margin: 0 auto 15px; box-shadow: 0 0 0 10px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 15px 35px color-mix(in srgb, var(--color-primary) 24%, transparent); }
#dsh-companion .companion-detail { position: fixed; inset: 0; z-index: 20; padding: 76px max(18px, calc((100vw - 960px) / 2 + 18px)); background: transparent; }
#dsh-companion .companion-detail-card { width: clamp(320px, 34vw, 380px); margin: 0; border-radius: 28px; padding: 24px; background: var(--color-base-100); box-shadow: var(--cmp-shadow); }
#dsh-companion .companion-lightbox { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; background: rgb(7 10 20 / .84); padding: 24px; }
#dsh-companion .companion-lightbox-dialog { margin: 0; background: transparent; padding: 0; max-width: none; }
#dsh-companion .companion-detail-card, #dsh-companion .companion-lightbox-dialog { opacity: 1; scale: 1; translate: 0; }
#dsh-companion .companion-lightbox img { display:block; max-width: min(94vw, 1000px); max-height: 86vh; object-fit: contain; border-radius: 15px; }
#dsh-companion .companion-recovery { margin: auto; max-width: 480px; padding: 36px 24px; text-align: center; }
#dsh-companion .companion-advanced { color: inherit; opacity: .7; font-size: .76rem; text-decoration: none; }
@media (max-width: 820px) { #dsh-companion .companion-header { padding-inline: 14px; } #dsh-companion .companion-timeline { padding-inline: 12px; } #dsh-companion .companion-row { max-width: 92%; } }
@media (max-width: 520px) { #dsh-companion .companion-detail { display:flex; align-items:end; padding:0; background:rgb(20 15 28 / .42); } #dsh-companion .companion-detail-card { width:100%; max-height:82dvh; overflow:auto; border-radius:28px 28px 0 0; padding:24px 22px max(24px, env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { #dsh-companion *, #dsh-companion *::before, #dsh-companion *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
`;

export type CompanionScheme = "light" | "dark";
export const LIGHT_THEME = "sticker-messenger" as const;
export const DARK_THEME = "night-voyage" as const;

export function companionThemeForScheme(scheme: string): typeof LIGHT_THEME | typeof DARK_THEME {
  return scheme === "dark" ? DARK_THEME : LIGHT_THEME;
}

/** Layout and visual language layered over the generated prefixed daisyUI primitives. */
export const companionStyles = `
#dsh-companion {
  --cmp-line:color-mix(in srgb,var(--color-base-content) 10%,transparent);
  --cmp-panel:color-mix(in srgb,var(--color-base-100) 94%,transparent);
  --cmp-shadow:0 22px 70px rgb(76 48 40 / .14);
  box-sizing:border-box;height:100dvh;overflow:hidden;color:var(--color-base-content);-webkit-tap-highlight-color:transparent;
  background:radial-gradient(circle at 8% 3%,color-mix(in srgb,var(--color-secondary) 19%,transparent),transparent 32%),var(--color-base-200);
  font-family:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
}
#dsh-companion[data-theme="night-voyage"] {
  --cmp-line:color-mix(in srgb,var(--color-base-content) 11%,transparent);
  --cmp-panel:color-mix(in srgb,var(--color-base-100) 92%,transparent);
  --cmp-shadow:0 25px 75px rgb(0 0 0 / .38);
}
#dsh-companion *,#dsh-companion *::before,#dsh-companion *::after{box-sizing:border-box}
#dsh-companion button,#dsh-companion textarea,#dsh-companion input{font:inherit}
#dsh-companion button{color:inherit}
#dsh-companion.companion-shell{height:100dvh;padding:14px;overflow:hidden}
#dsh-companion .companion-app{position:relative;display:grid;grid-template-columns:0 minmax(0,1fr);width:min(1180px,100%);height:calc(100dvh - 28px);margin:auto;overflow:hidden;border:1px solid var(--cmp-line);border-radius:32px;background:var(--cmp-panel);box-shadow:var(--cmp-shadow);transition:grid-template-columns .24s ease}
#dsh-companion .companion-app:has(> .cmp-drawer-toggle:checked){grid-template-columns:282px minmax(0,1fr)}
#dsh-companion .cmp-drawer-toggle{position:absolute;opacity:0;pointer-events:none}
#dsh-companion .companion-content{min-width:0;min-height:0;grid-column:2}
#dsh-companion .companion-main{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-width:0;min-height:0}
#dsh-companion .companion-header{position:relative;z-index:8;display:flex;align-items:center;gap:12px;padding:13px 20px;border-bottom:1px solid var(--cmp-line);background:color-mix(in srgb,var(--color-base-100) 83%,transparent);backdrop-filter:blur(20px)}
#dsh-companion .cmp-btn{min-width:42px;min-height:42px;border-radius:999px}
#dsh-companion .companion-session-toggle{font-size:1.08rem}
#dsh-companion .companion-avatar-anchor{position:relative;flex:none}
#dsh-companion .companion-avatar{width:46px;height:46px;padding:0;border:2px solid color-mix(in srgb,var(--color-primary) 48%,transparent);box-shadow:0 6px 18px color-mix(in srgb,var(--color-primary) 22%,transparent);cursor:pointer}
#dsh-companion .companion-header-copy{min-width:0;flex:1}
#dsh-companion .companion-name{font-size:1.02rem;font-weight:780;letter-spacing:-.02em}
#dsh-companion .companion-presence{display:flex;align-items:center;gap:6px;margin-top:2px;color:color-mix(in srgb,var(--color-base-content) 64%,transparent);font-size:.73rem}
#dsh-companion .companion-presence .cmp-status{width:8px;height:8px}
#dsh-companion .companion-full-dsh{flex:none;color:inherit;opacity:.64;text-decoration:none}
#dsh-companion .companion-full-dsh:hover{opacity:1}
#dsh-companion .companion-timeline{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:28px clamp(16px,4vw,48px) 16px}
#dsh-companion .companion-timeline:not(.timeline-ready){visibility:hidden}
#dsh-companion .companion-row{display:grid;grid-template-columns:34px minmax(0,auto);align-items:end;justify-content:start;gap:9px;width:100%;margin:9px 0}
#dsh-companion .companion-row.outgoing{grid-template-columns:minmax(0,auto) 34px;justify-content:end}
#dsh-companion .companion-row.outgoing .message-avatar{grid-column:2}
#dsh-companion .companion-row.outgoing .companion-message-stack{grid-column:1;grid-row:1}
#dsh-companion .message-avatar{width:34px;height:34px;font-size:.72rem}
#dsh-companion .companion-avatar-crop{display:grid;width:100%;height:100%;place-items:center;overflow:hidden}
#dsh-companion .companion-avatar-crop img{display:block;width:100%;height:100%;object-fit:cover}
#dsh-companion .companion-message-stack{max-width:min(76vw,680px)}
#dsh-companion .companion-bubble{max-width:min(76vw,680px);padding:11px 15px;border-radius:23px 23px 23px 8px;background:var(--color-base-200);box-shadow:0 5px 18px color-mix(in srgb,var(--color-base-content) 7%,transparent);line-height:1.55;overflow-wrap:anywhere}
#dsh-companion .outgoing .companion-bubble{border-radius:23px 23px 8px 23px;background:color-mix(in srgb,var(--color-primary) 22%,var(--color-base-100))}
#dsh-companion .companion-meta{margin-top:4px;opacity:.55;font-size:.68rem}
#dsh-companion .companion-typing-bubble{display:flex;align-items:center;gap:9px;max-width:min(76vw,340px)}
#dsh-companion .companion-waiting-copy{color:color-mix(in srgb,var(--color-base-content) 68%,transparent);font-size:.76rem;line-height:1.4;animation:companion-waiting-in .24s ease-out}
#dsh-companion .companion-media{width:min(70vw,480px);overflow:hidden;border-radius:24px;background:var(--color-base-200);box-shadow:0 8px 24px color-mix(in srgb,var(--color-base-content) 10%,transparent)}
#dsh-companion .companion-media-button{display:block;width:100%;padding:0;border:0;background:transparent;cursor:zoom-in}
#dsh-companion .companion-media img{display:block;width:100%;max-height:520px;object-fit:cover}
#dsh-companion .companion-voice{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;gap:6px 10px;min-width:min(300px,70vw)}
#dsh-companion .companion-audio{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
#dsh-companion .companion-voice-control{width:40px;height:40px;min-width:40px;min-height:40px;color:var(--color-primary)}
#dsh-companion .companion-voice-player{min-width:0}
#dsh-companion .companion-voice-waveform{position:relative;display:flex;height:32px;align-items:center;gap:2px;min-width:150px;cursor:pointer}
#dsh-companion .companion-voice-waveform>span{width:3px;height:var(--voice-bar);flex:1;border-radius:999px;background:color-mix(in srgb,var(--color-base-content) 20%,transparent);transition:background-color .12s ease}
#dsh-companion .companion-voice-waveform>span.played{background:var(--color-primary)}
#dsh-companion .companion-voice-seek{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
#dsh-companion .companion-voice-waveform:has(.companion-voice-seek:focus-visible){outline:2px solid var(--color-primary);outline-offset:3px;border-radius:var(--radius-field)}
#dsh-companion .companion-voice-meta{display:flex;min-height:16px;align-items:center;justify-content:space-between;gap:10px;color:color-mix(in srgb,var(--color-base-content) 55%,transparent);font-size:.66rem;line-height:1.2}
#dsh-companion .companion-voice-meta [role="alert"]{color:var(--color-error)}
#dsh-companion .companion-transcript{grid-column:1/-1;font-size:.72rem}
#dsh-companion .companion-transcript summary{display:flex;width:max-content;align-items:center;gap:5px;color:color-mix(in srgb,var(--color-base-content) 60%,transparent);cursor:pointer;list-style:none}
#dsh-companion .companion-transcript summary::-webkit-details-marker{display:none}
#dsh-companion .companion-transcript[open] summary{color:var(--color-primary)}
#dsh-companion .companion-transcript p{margin:7px 0 0;padding-top:7px;border-top:1px solid var(--cmp-line);color:color-mix(in srgb,var(--color-base-content) 78%,transparent);line-height:1.45}
#dsh-companion .companion-spin{animation:companion-spin .8s linear infinite}
#dsh-companion .companion-composer{padding:10px 18px max(14px,env(safe-area-inset-bottom));border-top:1px solid var(--cmp-line);background:color-mix(in srgb,var(--color-base-100) 88%,transparent);backdrop-filter:blur(20px)}
#dsh-companion .companion-compose-row{display:flex;align-items:flex-end;gap:8px;max-width:820px;margin:auto;padding:5px 6px 5px 18px;border:1px solid color-mix(in srgb,var(--color-base-content) 12%,transparent);border-radius:28px;background:color-mix(in srgb,var(--color-base-100) 92%,var(--color-base-200));box-shadow:0 6px 22px color-mix(in srgb,var(--color-base-content) 7%,transparent);transition:border-color .16s ease,box-shadow .16s ease}
#dsh-companion .companion-compose-row:focus-within{border-color:color-mix(in srgb,var(--color-primary) 65%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--color-primary) 16%,transparent),0 8px 26px color-mix(in srgb,var(--color-base-content) 8%,transparent)}
#dsh-companion .companion-textarea{flex:1;min-height:43px;max-height:150px;padding:11px 0;border:0!important;border-radius:24px!important;outline:0!important;background:transparent!important;color:inherit;resize:none;line-height:1.42;box-shadow:none!important}
#dsh-companion .companion-textarea::placeholder{color:color-mix(in srgb,var(--color-base-content) 46%,transparent)}
#dsh-companion .companion-send{flex:none;width:43px;height:43px;font-size:1.15rem}
#dsh-companion .companion-compose-hint{max-width:790px;margin:5px auto 0;padding:0 10px;color:color-mix(in srgb,var(--color-base-content) 47%,transparent);font-size:.66rem}
#dsh-companion .companion-recovery{align-self:center;justify-self:center;max-width:500px;padding:34px 24px;text-align:center}
#dsh-companion .companion-recovery h1{margin:8px 0;font-size:1.32rem}
#dsh-companion .companion-recovery p{opacity:.66}
#dsh-companion .companion-mood-orb{width:86px;height:86px;margin:0 auto 17px;border-radius:50%;background:radial-gradient(circle at 34% 28%,var(--color-accent),var(--color-primary));box-shadow:0 0 0 10px color-mix(in srgb,var(--color-primary) 12%,transparent),0 16px 38px color-mix(in srgb,var(--color-primary) 25%,transparent)}
#dsh-companion .companion-sidebar-layer{position:absolute;inset:0 auto 0 0;z-index:10;width:282px;transform:translateX(-100%);transition:transform .24s ease;pointer-events:none}
#dsh-companion .companion-app > .cmp-drawer-toggle:checked ~ .companion-sidebar-layer{transform:none;pointer-events:auto}
#dsh-companion .companion-sidebar-overlay{display:none}
#dsh-companion .companion-sidebar{display:flex;flex-direction:column;width:282px;height:100%;padding:19px 14px 14px;border-right:1px solid var(--cmp-line);background:color-mix(in srgb,var(--color-base-100) 92%,var(--color-secondary) 3%)}
#dsh-companion .companion-sidebar-head{display:flex;align-items:center;justify-content:space-between;padding:3px 7px 14px}
#dsh-companion .companion-sidebar-eyebrow{color:var(--color-primary);font-size:.67rem;font-weight:760;letter-spacing:.08em;text-transform:uppercase}
#dsh-companion .companion-sidebar h2{margin:2px 0 0;font-size:1.15rem;letter-spacing:-.02em}
#dsh-companion .companion-session-list{display:flex;flex:1;flex-direction:column;gap:6px;min-height:0;overflow-y:auto}
#dsh-companion .companion-session-item{display:flex;align-items:center;gap:8px;width:100%;padding:11px 12px;border:1px solid transparent;border-radius:17px;background:transparent;text-align:left;cursor:pointer}
#dsh-companion .companion-session-item:hover{background:color-mix(in srgb,var(--color-base-content) 5%,transparent)}
#dsh-companion .companion-session-item.selected{border-color:color-mix(in srgb,var(--color-primary) 20%,transparent);background:color-mix(in srgb,var(--color-primary) 13%,var(--color-base-100))}
#dsh-companion .companion-session-copy{display:grid;min-width:0;flex:1;gap:3px}
#dsh-companion .companion-session-copy strong{overflow:hidden;font-size:.84rem;text-overflow:ellipsis;white-space:nowrap}
#dsh-companion .companion-session-copy small{opacity:.52;font-size:.67rem}
#dsh-companion .companion-session-running{width:8px;height:8px;flex:none;border-radius:50%;background:var(--color-secondary);box-shadow:0 0 0 4px color-mix(in srgb,var(--color-secondary) 14%,transparent)}
#dsh-companion .companion-session-empty{padding:16px 12px;opacity:.55;font-size:.78rem}
#dsh-companion .companion-sidebar-advanced{margin-top:12px;padding:10px;color:inherit;opacity:.58;font-size:.74rem;text-align:center;text-decoration:none}
#dsh-companion .companion-detail-card{position:fixed;z-index:20;top:auto;left:auto;width:min(372px,calc(100vw - 38px));max-width:none;margin:0;padding:0;overflow:hidden;border:1px solid color-mix(in srgb,var(--color-base-content) 12%,transparent);color:var(--color-base-content);background:var(--color-base-100);box-shadow:0 24px 70px rgb(0 0 0 / .28);animation:companion-card-in .2s cubic-bezier(.2,.8,.2,1);transform-origin:36px 0;backdrop-filter:blur(18px)}
#dsh-companion .companion-detail-card .cmp-card-body{padding:0}
#dsh-companion .companion-detail-art{height:128px;background:linear-gradient(to bottom,transparent 45%,var(--color-base-100)),var(--relationship-art) center 54%/cover no-repeat}
#dsh-companion[data-theme="sticker-messenger"] .companion-detail-art{filter:saturate(.78) brightness(1.2);opacity:.82}
#dsh-companion .companion-detail-head{position:relative;display:grid;grid-template-columns:58px minmax(0,1fr) 36px;align-items:center;gap:12px;margin-top:-30px;padding:0 20px}
#dsh-companion .companion-detail-avatar{width:58px;height:58px;border:3px solid var(--color-base-100);box-shadow:0 5px 18px rgb(0 0 0 / .18)}
#dsh-companion .companion-detail-head h2{margin:25px 0 3px;font-size:1.18rem}
#dsh-companion .companion-detail-close{align-self:end;margin-bottom:2px}
#dsh-companion .companion-mood-chip{display:inline-flex;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--color-secondary) 18%,transparent);font-size:.68rem;font-weight:680}
#dsh-companion .companion-signature{margin:15px 20px 5px;color:color-mix(in srgb,var(--color-base-content) 73%,transparent);font-size:.86rem;font-style:italic}
#dsh-companion .companion-relationship-list{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px 18px;margin:13px 20px 20px;padding-top:14px;border-top:1px solid var(--cmp-line);font-size:.77rem}
#dsh-companion .companion-relationship-list dt{opacity:.5}
#dsh-companion .companion-relationship-list dd{margin:0;text-align:right}
#dsh-companion .companion-lightbox{padding:24px;background:rgb(5 9 17 / .86)}
#dsh-companion .companion-lightbox-dialog{position:relative;max-width:none;margin:0;padding:0;border:0;background:transparent}
#dsh-companion .companion-lightbox .cmp-modal-box{position:relative;max-width:none;margin:0;padding:0;background:transparent;box-shadow:none}
#dsh-companion .companion-lightbox img{display:block;max-width:min(94vw,1000px);max-height:86vh;border-radius:22px;object-fit:contain}
#dsh-companion .companion-lightbox-close{position:absolute;top:12px;right:12px;z-index:1}
@keyframes companion-card-in{from{opacity:0;transform:translateY(-8px) scale(.96)}to{opacity:1;transform:none}}
@keyframes companion-waiting-in{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:none}}
@keyframes companion-spin{to{transform:rotate(360deg)}}
@media (min-width:821px){#dsh-companion .companion-sidebar-layer{position:relative;grid-column:1;grid-row:1;transform:none;width:100%;overflow:hidden}#dsh-companion .companion-app > .cmp-drawer-toggle:not(:checked) ~ .companion-sidebar-layer{width:0}#dsh-companion .companion-sidebar{position:absolute;inset:0 auto 0 0}}
@media (max-width:820px){#dsh-companion.companion-shell{padding:0}#dsh-companion .companion-app,#dsh-companion .companion-app:has(> .cmp-drawer-toggle:checked){grid-template-columns:minmax(0,1fr);width:100%;height:100dvh;border:0;border-radius:0}#dsh-companion .companion-content{grid-column:1}#dsh-companion .companion-sidebar-layer{width:100%}#dsh-companion .companion-sidebar-overlay{position:absolute;inset:0;display:block;background:transparent}#dsh-companion .companion-sidebar{position:relative;width:min(84vw,300px);box-shadow:20px 0 60px rgb(0 0 0 / .2)}#dsh-companion .companion-header{padding:calc(10px + env(safe-area-inset-top)) 13px 10px}#dsh-companion .companion-timeline{padding:18px 12px 10px}#dsh-companion .companion-composer{padding-inline:9px}#dsh-companion .companion-compose-hint{display:none}#dsh-companion .companion-message-stack,#dsh-companion .companion-bubble{max-width:78vw}}
@media (max-width:430px){#dsh-companion .companion-avatar{width:42px;height:42px}#dsh-companion .companion-header{gap:8px}#dsh-companion .companion-row{grid-template-columns:30px minmax(0,auto);gap:7px}#dsh-companion .companion-row.outgoing{grid-template-columns:minmax(0,auto) 30px}#dsh-companion .message-avatar{width:30px;height:30px}#dsh-companion .companion-voice{min-width:0}}
@media (prefers-reduced-motion:reduce){#dsh-companion *,#dsh-companion *::before,#dsh-companion *::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

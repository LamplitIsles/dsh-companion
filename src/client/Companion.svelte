<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import type { CompanionProjection, TimelineItem, TimelineImage, TimelineVoice } from "../projection.js";
  import { createComposerState, reduceComposer, shouldSubmitEnter } from "./composer.js";

  export interface CompanionIdentityView {
    companionName: string;
    companionAvatar?: string;
    userName: string;
    userAvatar?: string;
    preferredAddress: string;
    signature: string;
    moodLabel: string;
    mood: string;
    intensity: number;
    moodNote?: string;
    affinity: number;
    affinityStage: string;
  }
  export interface CompanionActions {
    send: (text: string, mode: "queue" | "steer") => Promise<void>;
    retry?: (text: string) => Promise<void>;
    loadOlder?: () => Promise<void>;
    attachmentUrl?: (attachment: unknown) => Promise<string>;
    prepareVoice?: (text: string) => Promise<string>;
  }

  export let projection: CompanionProjection = { items: [], pendingCount: 0, running: false, status: "ready", openState: "open", hasMore: false, loadingOlder: false };
  export let identity: CompanionIdentityView = { companionName: "Companion", userName: "你", preferredAddress: "你", signature: "", moodLabel: "如常", mood: "neutral", intensity: 1, affinity: 50, affinityStage: "熟悉" };
  export let scheme: "light" | "dark" = "light";
  export let actions: CompanionActions = { send: async () => undefined };
  export let workspaceReady = true;
  export let sessionReady = true;

  const dispatch = createEventDispatcher<{ advanced: void; recovery: void }>();
  let composer = createComposerState();
  let timeline: HTMLDivElement;
  let detailOpen = false;
  let lightbox: TimelineImage | undefined;
  let lightboxUrl = "";
  let activeVoice: string | undefined;
  let voiceUrls: Record<string, string> = {};
  let voiceErrors: Record<string, string> = {};
  let voicePreparing: Record<string, boolean> = {};
  let imageUrls: Record<string, string> = {};
  let imageErrors: Record<string, string> = {};
  let wasNearBottom = true;
  let liveAnnouncement = "";
  let focusedBeforeOverlay: HTMLElement | undefined;
  let statusText = "";

  $: statusText = projection.status === "working" ? "正在陪你想" : projection.status === "reconnecting" ? "正在重新连接" : "已准备好";
  $: if (projection) void reconcileProjection(projection);

  async function reconcileProjection(value: CompanionProjection): Promise<void> {
    await tick();
    if (!timeline) return;
    const distance = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop;
    const nearBottom = wasNearBottom || distance < 96;
    if (nearBottom && !value.loadingOlder) timeline.scrollTop = timeline.scrollHeight;
    wasNearBottom = nearBottom;
    liveAnnouncement = value.promptError ?? value.lastAgentError ?? "";
    for (const item of value.items) {
      if (item.kind === "image" && item.state === "ready" && item.attachment && !imageUrls[item.id] && actions.attachmentUrl) {
        try { imageUrls = { ...imageUrls, [item.id]: await actions.attachmentUrl(item.attachment) }; }
        catch { imageErrors = { ...imageErrors, [item.id]: "图片暂时无法显示。" }; }
      }
      if (item.kind === "voice" && !voiceUrls[item.id] && !voiceErrors[item.id] && actions.prepareVoice) void prepareVoice(item);
    }
  }

  async function prepareVoice(item: TimelineVoice): Promise<void> {
    if (!actions.prepareVoice || voiceUrls[item.id] || voicePreparing[item.id]) return;
    voicePreparing = { ...voicePreparing, [item.id]: true };
    try { voiceUrls = { ...voiceUrls, [item.id]: await actions.prepareVoice(item.text) }; }
    catch { voiceErrors = { ...voiceErrors, [item.id]: "语音暂时无法播放，文字稿仍可查看。" }; }
    finally { const next = { ...voicePreparing }; delete next[item.id]; voicePreparing = next; }
  }

  function onScroll(): void {
    if (!timeline) return;
    wasNearBottom = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 96;
  }

  function submit(): void {
    const text = composer.draft.trim();
    if (!text || composer.composing) return;
    composer = reduceComposer(composer, { type: "submit" });
    void actions.send(text, projection.running ? "queue" : "steer").catch(() => {
      composer = { ...composer, draft: text };
      liveAnnouncement = "消息发送失败，内容已保留，可以重试。";
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (shouldSubmitEnter(event, composer.composing)) {
      event.preventDefault();
      submit();
    }
  }

  function setDraft(value: string): void { composer = reduceComposer(composer, { type: "input", value }); }
  function onInput(event: Event): void { setDraft((event.currentTarget as HTMLTextAreaElement).value); }
  function onCompositionEnd(event: CompositionEvent): void { composer = reduceComposer(composer, { type: "compositionend", value: (event.currentTarget as HTMLTextAreaElement).value }); }
  function onCompositionStart(): void { composer = reduceComposer(composer, { type: "compositionstart" }); }
  function openDetail(): void { focusedBeforeOverlay = document.activeElement as HTMLElement; detailOpen = true; }
  function closeDetail(): void { detailOpen = false; focusedBeforeOverlay?.focus(); focusedBeforeOverlay = undefined; }
  function openLightbox(item: TimelineImage): void {
    focusedBeforeOverlay = document.activeElement as HTMLElement;
    lightbox = item;
    lightboxUrl = imageUrls[item.id] ?? "";
  }
  function closeLightbox(): void { lightbox = undefined; lightboxUrl = ""; focusedBeforeOverlay?.focus(); focusedBeforeOverlay = undefined; }
  function onWindowKeydown(event: KeyboardEvent): void { if (event.key === "Escape") { if (lightbox) closeLightbox(); else if (detailOpen) closeDetail(); } }
  function onPopState(): void { if (lightbox) closeLightbox(); else if (detailOpen) closeDetail(); }
  function pushOverlayHistory(): void { history.pushState({ companionOverlay: true }, ""); }
  function showDetail(): void { pushOverlayHistory(); openDetail(); }
  function showLightbox(item: TimelineImage): void { pushOverlayHistory(); openLightbox(item); }
  async function loadOlder(): Promise<void> { if (!actions.loadOlder || projection.loadingOlder) return; const previousHeight = timeline?.scrollHeight ?? 0; await actions.loadOlder(); await tick(); if (timeline) timeline.scrollTop += timeline.scrollHeight - previousHeight; }

  onDestroy(() => {
    for (const url of Object.values(imageUrls)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    for (const url of Object.values(voiceUrls)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  });
</script>

<svelte:window on:keydown={onWindowKeydown} on:popstate={onPopState} />

<div id="dsh-companion" class="companion-shell" data-theme={scheme === "dark" ? "night-voyage" : "sticker-messenger"} data-testid="companion-root">
  <div class="companion-app">
    <main class="companion-main" aria-label="Companion 私聊">
      <header class="companion-header">
        <button class="cmp-avatar cmp-avatar-placeholder" aria-label="查看 Companion 关系资料" on:click={showDetail} style="width:48px;height:48px">
          {#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}
        </button>
        <div class="companion-header-copy">
          <div class="companion-name">{identity.companionName}</div>
          <div class="companion-signature" title={identity.signature || "还没有签名"}>{identity.signature || "在这里，慢慢聊。"}</div>
          <div class="companion-presence" aria-live="polite"><span class="cmp-status {projection.status === 'working' ? 'cmp-status-warning' : projection.status === 'reconnecting' ? 'cmp-status-error' : 'cmp-status-success'}"></span>{statusText} · {identity.moodLabel}</div>
        </div>
        <a class="companion-advanced" href="/" on:click={() => dispatch("advanced")}>高级 DSH</a>
      </header>

      {#if !workspaceReady}
        <section class="companion-recovery" role="alert">
          <div class="companion-mood-orb" aria-hidden="true"></div>
          <h1>还没有连接 Companion Workspace</h1>
          <p>请在高级 DSH 的设置中配置一个 Workspace。我们不会替你切换到别处。</p>
          <a class="cmp-btn cmp-btn-primary" href="/" on:click={() => dispatch("recovery")}>打开高级设置</a>
        </section>
      {:else if !sessionReady || projection.openState === "error"}
        <section class="companion-recovery" role="alert">
          <div class="companion-mood-orb" aria-hidden="true"></div>
          <h1>这段对话暂时打不开</h1>
          <p>你的消息不会被悄悄丢掉。连接恢复后可以继续，或回到高级 DSH 检查状态。</p>
          <button class="cmp-btn cmp-btn-primary" on:click={() => dispatch("recovery")}>重新连接</button>
        </section>
      {:else}
        <div bind:this={timeline} class="companion-timeline" role="log" aria-live="polite" aria-relevant="additions text" on:scroll={onScroll}>
          {#if projection.hasMore}
            <button class="cmp-btn cmp-btn-ghost cmp-btn-sm" style="display:block;margin:0 auto 18px" on:click={loadOlder} disabled={projection.loadingOlder}>{projection.loadingOlder ? "正在加载…" : "查看更早的消息"}</button>
          {/if}
          {#if projection.items.length === 0}
            <div class="companion-recovery"><div class="companion-mood-orb" aria-hidden="true"></div><h1>嗨，{identity.preferredAddress}</h1><p>从一句今天的心情开始吧。</p></div>
          {/if}
          {#each projection.items as item (item.projectionKey ?? item.id)}
            {#if item.kind === "text"}
              <article class="companion-row {item.side === 'outgoing' ? 'outgoing' : 'incoming'}" data-testid={`message-${item.id}`}>
                <div class="cmp-avatar cmp-avatar-placeholder" style="width:32px;height:32px">
                  {#if item.side === "incoming" && identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else if item.side === "outgoing" && identity.userAvatar}<img src={identity.userAvatar} alt="" />{:else}<span aria-hidden="true">{item.side === "incoming" ? "✦" : "你"}</span>{/if}
                </div>
                <div>
                  <div class="companion-bubble" class:cmp-skeleton={item.pending && !item.text}>{item.text}</div>
                  {#if item.pending}<div class="companion-meta">排队中 · 会在当前回复后发送</div>{/if}
                </div>
              </article>
            {:else if item.kind === "image"}
              <article class="companion-row incoming" data-testid={`image-${item.id}`}>
                <div class="cmp-avatar cmp-avatar-placeholder" style="width:32px;height:32px">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}</div>
                <div class="companion-media">
                  {#if item.state === "running" || item.state === "loading"}<div class="cmp-skeleton" style="height:260px"></div><div style="padding:12px">正在画一张图…</div>
                  {:else if imageUrls[item.id]}<button class="companion-media-button" aria-label={"查看大图：" + item.alt} on:click={() => showLightbox(item)}><img src={imageUrls[item.id]} alt={item.alt} /></button>
                  {:else if imageErrors[item.id] || item.state === "failed"}<div role="alert" style="padding:22px">{item.error || imageErrors[item.id] || "图片暂时无法显示。"}</div>
                  {:else}<div class="cmp-loading cmp-loading-spinner" style="margin:32px auto"></div>{/if}
                </div>
              </article>
            {:else if item.kind === "voice"}
              <article class="companion-row incoming" data-testid={`voice-${item.id}`}>
                <div class="cmp-avatar cmp-avatar-placeholder" style="width:32px;height:32px">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}</div>
                <div class="companion-bubble companion-voice">
                  {#if voiceUrls[item.id]}<audio controls preload="none" src={voiceUrls[item.id]} aria-label="Companion 语音消息" on:play={() => activeVoice = item.id} on:pause={() => activeVoice = undefined} on:ended={() => activeVoice = undefined}></audio>
                  {:else}<button class="cmp-btn cmp-btn-primary cmp-btn-sm" on:click={() => void prepareVoice(item)} disabled={!actions.prepareVoice || voicePreparing[item.id]}>{voicePreparing[item.id] ? "准备中…" : voiceErrors[item.id] ? "重试播放" : "播放语音"}</button>{/if}
                  <details><summary>文字稿</summary><p>{item.text}</p></details>
                </div>
              </article>
            {:else}
              <div class="companion-recovery" role={item.tone === "error" ? "alert" : "status"}><p>{item.text}</p></div>
            {/if}
          {/each}
          {#if !wasNearBottom && projection.items.length > 0}<button class="cmp-btn cmp-btn-primary cmp-btn-sm" style="position:sticky;bottom:10px;left:50%;transform:translateX(-50%)" on:click={() => timeline.scrollTop = timeline.scrollHeight}>有新消息 ↓</button>{/if}
        </div>
        <div class="companion-composer">
          <div class="companion-compose-row">
            <textarea class="cmp-textarea cmp-textarea-bordered" aria-label="写消息" placeholder={"写给 " + identity.preferredAddress + "…"} rows="1" value={composer.draft} on:input={onInput} on:compositionstart={onCompositionStart} on:compositionend={onCompositionEnd} on:keydown={onKeydown}></textarea>
            <button class="cmp-btn cmp-btn-primary" aria-label="发送消息" on:click={submit} disabled={!composer.draft.trim()}>发送</button>
          </div>
          <div style="max-width:820px;margin:5px auto 0;font-size:.7rem;opacity:.55">Enter 发送 · Shift+Enter 换行 · {projection.pendingCount ? `${projection.pendingCount} 条消息排队中` : ""}</div>
        </div>
      {/if}
    </main>
    <aside class="companion-side" aria-label="关系摘要">
      <div class="companion-side-card">
        <div class="companion-mood-orb" aria-hidden="true"></div>
        <div style="text-align:center"><strong>{identity.moodLabel}</strong><div class="companion-signature">心情 · {identity.intensity === 1 ? "轻微" : identity.intensity === 2 ? "明显" : "强烈"}</div></div>
        <button class="cmp-btn cmp-btn-ghost" style="width:100%;margin-top:18px" on:click={showDetail}>查看关系资料</button>
      </div>
    </aside>
  </div>
</div>

{#if detailOpen}
  <div class="companion-detail" role="presentation" on:click={(event) => event.currentTarget === event.target && closeDetail()}>
    <section class="companion-detail-card cmp-modal-box" role="dialog" aria-modal="true" aria-labelledby="relationship-title">
      <button class="cmp-btn cmp-btn-ghost cmp-btn-sm" style="float:right" aria-label="关闭关系资料" on:click={closeDetail}>×</button>
      <div class="cmp-avatar cmp-avatar-placeholder" style="width:78px;height:78px;margin:4px auto 16px">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt={identity.companionName} />{:else}<span aria-hidden="true">✦</span>{/if}</div>
      <h2 id="relationship-title" style="text-align:center;margin:0">{identity.companionName}</h2>
      <p style="text-align:center;opacity:.7;overflow-wrap:anywhere">{identity.signature || "还没有签名"}</p>
      <dl style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:22px"><dt>心情</dt><dd>{identity.moodLabel} · {identity.intensity === 1 ? "轻微" : identity.intensity === 2 ? "明显" : "强烈"}</dd>{#if identity.moodNote}<dt>心情短句</dt><dd style="max-width:220px;text-align:right;overflow-wrap:anywhere">{identity.moodNote}</dd>{/if}<dt>亲近度</dt><dd>{identity.affinity} · {identity.affinityStage}</dd></dl>
      <button class="cmp-btn cmp-btn-primary" style="width:100%;margin-top:22px" on:click={closeDetail}>知道了</button>
    </section>
  </div>
{/if}
{#if lightbox}
  <div class="companion-lightbox" role="presentation" on:click={(event) => event.currentTarget === event.target && closeLightbox()}>
    <button class="cmp-btn cmp-btn-neutral" style="position:fixed;top:18px;right:18px" aria-label="关闭大图" on:click={closeLightbox}>×</button>
    {#if lightboxUrl}<img src={lightboxUrl} alt={lightbox.alt} />{:else}<div class="cmp-loading cmp-loading-spinner"></div>{/if}
  </div>
{/if}
<div class="sr-only" aria-live="assertive">{liveAnnouncement}</div>

<style>
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .cmp-avatar-placeholder { display:grid; place-items:center; overflow:hidden; border-radius:50%; background:color-mix(in srgb, var(--color-primary) 20%, var(--color-base-200)); color:var(--color-primary); font-weight:700; }
  .cmp-avatar-placeholder img { width:100%; height:100%; object-fit:cover; }
  .companion-detail dd { margin:0; text-align:right; }
  .companion-media-button { display:block; width:100%; padding:0; border:0; background:transparent; cursor:zoom-in; }
  @media (max-width: 520px) { .companion-timeline { padding-bottom:8px; } .companion-composer { padding-inline:9px; } .companion-voice { min-width:0; flex-wrap:wrap; } .companion-voice audio { max-width:180px; } }
</style>

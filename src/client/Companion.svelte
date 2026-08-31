<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import LoaderCircle from "lucide-svelte/icons/loader-circle";
  import ImagePlus from "lucide-svelte/icons/image-plus";
  import MessageSquareText from "lucide-svelte/icons/message-square-text";
  import PanelsTopLeft from "lucide-svelte/icons/panels-top-left";
  import Pause from "lucide-svelte/icons/pause";
  import Play from "lucide-svelte/icons/play";
  import RotateCcw from "lucide-svelte/icons/rotate-ccw";
  import Square from "lucide-svelte/icons/square";
  import X from "lucide-svelte/icons/x";
  import { COMPACTION_STATUS_DURATION_MS, formatTokenCount, resolveContextCapacity, type CompactionLifecycleState } from "../continuity.js";
  import type { CompanionProjection, TimelineImage, TimelineVoice } from "../projection.js";
  import type { CompanionContinuityView } from "./companion-bridge.js";
  import { isCompanionPromptRejectedError } from "./admission.js";
  import { createComposerState, findComposerCommand, reduceComposer, shouldSubmitEnter, type ComposerCommand } from "./composer.js";
  import { createImageDrafts, imageFilesFromClipboard, imageIntakeError, IMAGE_ACCEPT, releaseImageDrafts, type CompanionImageDraft } from "./image-drafts.js";
  import { createSendingBatch, markSendingBatchAccepted, markSendingBatchTransportAmbiguous, mergeSendingBatch, observeSendingBatch, type SendingBatch } from "./optimistic-sending.js";
  import { INTENSITY_LABELS } from "./relationship.js";
  import Markdown from "./Markdown.svelte";
  import relationshipBackground from "./assets/relationship-night-voyage.webp";

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
    affinity?: number;
    affinityStage?: string;
  }
  export interface CompanionActions {
    send: (text: string, images: readonly CompanionImageDraft[]) => Promise<void>;
    stop?: () => Promise<void>;
    selectSession?: (sessionId: string) => Promise<void>;
    loadOlder?: () => Promise<void>;
    attachmentUrl?: (attachment: unknown) => Promise<string>;
    prepareVoice?: (text: string) => Promise<string>;
  }
  export interface CompanionSessionView {
    id: string;
    title: string;
    updatedAt: number;
    running: boolean;
    selected: boolean;
  }

  export let projection: CompanionProjection = { items: [], pendingCount: 0, running: false, status: "ready", openState: "open", hasMore: false, loadingOlder: false };
  export let identity: CompanionIdentityView = { companionName: "Companion", userName: "你", preferredAddress: "你", signature: "", moodLabel: "如常", mood: "neutral", intensity: 1, affinity: 50, affinityStage: "熟悉" };
  export let scheme: "light" | "dark" = "light";
  export let actions: CompanionActions = { send: async () => undefined };
  export let sessions: CompanionSessionView[] = [];
  export let workspaceReady = true;
  export let sessionReady = true;
  export let sessionId: string | undefined;
  export let imageLimits: import("@deepseek-ai/dsh-attachment").ImageAttachmentLimits | undefined;
  export let continuity: CompanionContinuityView = {};

  const dispatch = createEventDispatcher<{ advanced: void; recovery: void }>();
  const LONG_WAIT_DELAY_MS = 12_000;
  const LONG_WAIT_ROTATION_MS = 9_000;
  const PHOTO_LONG_PRESS_MS = 450;
  const VOICE_WAVEFORM_BAR_COUNT = 28;
  const DESKTOP_SIDEBAR_QUERY = "(min-width: 821px)";
  const DESKTOP_SIDEBAR_STORAGE_KEY = "dsh-companion:desktop-sidebar-open";
  const EMPTY_VOICE_PLAYBACK = { current: 0, duration: 0, playing: false };
  const LONG_WAIT_MESSAGES = [
    "我还在认真想，陪我再等一小会儿呀",
    "正在把想说的话轻轻理好……",
    "再给我一点点时间，很快就回来",
    "这次想认真一点，不让你久等",
    "我在这里，只是还在想怎么说更好",
  ] as const;
  let composer = createComposerState();
  let composerInput: HTMLTextAreaElement;
  let photoLibraryInput: HTMLInputElement;
  let cameraInput: HTMLInputElement;
  let commandSuggestion: ComposerCommand | undefined;
  let stopping = false;
  let timeline: HTMLDivElement;
  let timelineReady = false;
  let timelineRevealFrame = 0;
  let detailAnchor: HTMLDivElement;
  let sidebarOpen = readDesktopSidebarPreference();
  let detailOpen = false;
  let lightbox: TimelineImage | undefined;
  let lightboxUrl = "";
  let voiceUrls: Record<string, string> = {};
  let voiceErrors: Record<string, string> = {};
  let voicePreparing: Record<string, boolean> = {};
  let voicePlayback: Record<string, { current: number; duration: number; playing: boolean }> = {};
  let imageUrls: Record<string, string> = {};
  let imageErrors: Record<string, string> = {};
  let imageSources: Record<string, string> = {};
  let imageLoads: Record<string, string> = {};
  let wasNearBottom = true;
  let liveAnnouncement = "";
  let detailReturnFocus: HTMLElement | undefined;
  let lightboxReturnFocus: HTMLElement | undefined;
  let detailPopover: HTMLElement;
  let lightboxDialog: HTMLDialogElement;
  let overlayHistory = false;
  let lightboxCloseFromHistory = false;
  let statusText = "";
  let imageGenerationRunning = false;
  let typingVisible = false;
  let waitingCopy = "";
  let waitingCycle = "";
  let waitingDelayTimer: ReturnType<typeof setTimeout> | undefined;
  let waitingRotationTimer: ReturnType<typeof setInterval> | undefined;
  let contextMeterOpen = false;
  let contextMeterButton: HTMLButtonElement;
  let contextMeterPopover: HTMLElement;
  let contextMeterReturnFocus: HTMLElement | undefined;
  let continuityStatus: CompactionLifecycleState | undefined;
  let continuityStatusKey = "";
  let continuityStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let imageDrafts: CompanionImageDraft[] = [];
  let imageDraftSessionId: string | undefined;
  let submitting = false;
  let optimisticBatch: SendingBatch | undefined;
  let deferredPreviewReleases: CompanionImageDraft[] = [];
  let handledSendErrorKey: string | undefined;
  let suppressNextSendError = false;
  let displayedProjection: CompanionProjection = projection;
  let submissionToken = 0;
  let imagePickerPointer: { id: number; startedAt: number } | undefined;
  let suppressImagePickerClick = false;

  $: statusText = projection.status === "working" ? "正在陪你想" : projection.status === "reconnecting" ? "正在重新连接" : "已准备好";
  $: imageGenerationRunning = projection.items.some((item) => item.kind === "image" && (item.state === "running" || item.state === "loading"));
  $: typingVisible = projection.running && !imageGenerationRunning;
  $: commandSuggestion = imageDrafts.length ? undefined : findComposerCommand(composer.draft);
  $: contextCapacity = resolveContextCapacity(continuity?.contextPressure);
  $: latestContinuityLifecycle = latestLifecycle(continuity?.lifecycle);
  $: syncContinuityStatus(latestContinuityLifecycle);
  $: if (!contextCapacity && contextMeterOpen) closeContextMeter(false);
  $: syncWaitingState(typingVisible, `${sessions.find((session) => session.selected)?.id ?? "none"}:${latestSettledReplyKey(projection)}`);
  $: if (handledSendErrorKey !== undefined && projection.promptErrorOp !== "send") handledSendErrorKey = undefined;
  $: if (suppressNextSendError && projection.promptErrorOp === "send") {
    handledSendErrorKey = promptErrorSignature(projection);
    suppressNextSendError = false;
  }
  $: displayedProjection = mergeSendingBatch(displayProjection(projection), optimisticBatch && optimisticBatch.sessionId === sessionId ? optimisticBatch : undefined);
  $: if (projection) observeSendingProjection(projection);
  $: if (displayedProjection) void reconcileProjection(displayedProjection);
  $: if (sessionId !== imageDraftSessionId) {
    if (optimisticBatch && optimisticBatch.sessionId !== sessionId) {
      releaseBatchImages(optimisticBatch.images);
      optimisticBatch = undefined;
      syncDisplayedProjection();
      submissionToken += 1;
      submitting = false;
    }
    releaseImageDrafts(imageDrafts);
    imageDrafts = [];
    imageDraftSessionId = sessionId;
  }

  $: composerLocked = submitting || Boolean(optimisticBatch && optimisticBatch.sessionId === sessionId);

  function isComposerLocked(): boolean {
    return submitting || Boolean(optimisticBatch && optimisticBatch.sessionId === sessionId);
  }

  function promptErrorSignature(value: CompanionProjection): string | undefined {
    return value.promptErrorKey ?? value.promptError;
  }

  function displayProjection(value: CompanionProjection): CompanionProjection {
    if (value.promptErrorOp !== "send" || handledSendErrorKey === undefined || promptErrorSignature(value) !== handledSendErrorKey) return value;
    const { promptError: _promptError, promptErrorKey: _promptErrorKey, promptErrorOp: _promptErrorOp, promptErrorCode: _promptErrorCode, ...rest } = value;
    return { ...rest, items: value.items.filter((item) => item.id !== "prompt-error") };
  }

  function syncDisplayedProjection(): void {
    displayedProjection = mergeSendingBatch(displayProjection(projection), optimisticBatch && optimisticBatch.sessionId === sessionId ? optimisticBatch : undefined);
  }

  function releaseDeferredPreviewReleases(): void {
    if (deferredPreviewReleases.length === 0) return;
    const drafts = deferredPreviewReleases;
    deferredPreviewReleases = [];
    releaseImageDrafts(drafts);
  }

  function releaseBatchImages(images: readonly CompanionImageDraft[]): void {
    const protectedPreview = lightboxUrl && lightbox?.previewUrl === lightboxUrl ? lightboxUrl : undefined;
    const deferred = protectedPreview ? images.filter((draft) => draft.previewUrl === protectedPreview) : [];
    const releasable = deferred.length ? images.filter((draft) => draft.previewUrl !== protectedPreview) : images;
    if (deferred.length) deferredPreviewReleases = [...deferredPreviewReleases, ...deferred];
    if (releasable.length) void tick().then(() => releaseImageDrafts(releasable));
  }

  function rememberHandledSendError(value: CompanionProjection): void {
    if (value.promptErrorOp !== "send") return;
    const signature = promptErrorSignature(value);
    if (signature !== undefined) handledSendErrorKey = signature;
    else suppressNextSendError = true;
  }

  function latestSettledReplyKey(value: CompanionProjection): string {
    for (let index = value.items.length - 1; index >= 0; index -= 1) {
      const item = value.items[index]!;
      if (item.side === "incoming" && (item.kind !== "image" || item.state === "ready" || item.state === "failed")) return item.projectionKey ?? item.id;
    }
    return "empty";
  }

  function observeSendingProjection(value: CompanionProjection): void {
    const batch = optimisticBatch;
    if (!batch || batch.sessionId !== sessionId) return;
    // The Session runtime folds a carrier exception into an `internal`
    // prompt-error projection. Keep the batch transport-ambiguous, but hide
    // this error's Host failure/retry notice just like an explicit rejection.
    // The stable projection signature keeps later, unrelated send errors
    // visible.
    if (value.promptErrorOp === "send" && value.promptErrorCode === "internal") rememberHandledSendError(value);
    const observation = observeSendingBatch(value, batch);
    if (observation.decision === "keep") {
      if (observation.batch.sawReconnect !== batch.sawReconnect || observation.batch.lastStatus !== batch.lastStatus) {
        optimisticBatch = observation.batch;
        syncDisplayedProjection();
      }
      return;
    }
    if (observation.decision === "reject" && observation.reason === "prompt-rejection") rememberHandledSendError(value);
    optimisticBatch = undefined;
    syncDisplayedProjection();
    submissionToken += 1;
    submitting = false;
    if (observation.decision === "reject") {
      // A batch can only be rejected while its original Session is active;
      // never restore its drafts into a different Session's composer.
      if (batch.sessionId === sessionId) {
        composer = { ...composer, draft: batch.restoreText, composing: false };
        imageDrafts = [...batch.images];
        liveAnnouncement = "消息没有发送成功，内容已恢复。";
      }
      return;
    }
    // Keep local preview URLs alive through the render that removes the
    // overlay. The next tick is the replacement boundary for ownership.
    releaseBatchImages(batch.images);
  }

  function readDesktopSidebarPreference(): boolean {
    if (typeof window === "undefined" || !window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches) return false;
    try { return window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY) !== "false"; }
    catch { return true; }
  }

  function setSidebarOpen(open: boolean): void {
    sidebarOpen = open;
    if (typeof window === "undefined" || !window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches) return;
    try { window.localStorage.setItem(DESKTOP_SIDEBAR_STORAGE_KEY, String(open)); }
    catch { /* storage may be unavailable in private browsing */ }
  }

  function onSidebarChange(event: Event): void {
    setSidebarOpen((event.currentTarget as HTMLInputElement).checked);
  }

  function toggleSidebar(): void { setSidebarOpen(!sidebarOpen); }

  function clearWaitingTimers(): void {
    if (waitingDelayTimer !== undefined) clearTimeout(waitingDelayTimer);
    if (waitingRotationTimer !== undefined) clearInterval(waitingRotationTimer);
    waitingDelayTimer = undefined;
    waitingRotationTimer = undefined;
  }

  function latestLifecycle(value: CompanionContinuityView["lifecycle"]): CompactionLifecycleState | undefined {
    const rows = value?.lifecycles ?? (value?.latest ? [value.latest] : []);
    return [...rows].sort((left, right) => (left.endSeq ?? left.startSeq) - (right.endSeq ?? right.startSeq) || left.startSeq - right.startSeq).at(-1);
  }

  function clearContinuityStatusTimer(): void {
    if (continuityStatusTimer !== undefined) clearTimeout(continuityStatusTimer);
    continuityStatusTimer = undefined;
  }

  function syncContinuityStatus(lifecycle: CompactionLifecycleState | undefined): void {
    const key = lifecycle ? `${lifecycle.compactionId}:${lifecycle.status}:${lifecycle.endSeq ?? ""}:${lifecycle.endedAt ?? ""}` : "";
    if (key === continuityStatusKey) return;
    clearContinuityStatusTimer();
    continuityStatusKey = key;
    continuityStatus = undefined;
    if (!lifecycle) return;
    if (lifecycle.status === "running") {
      continuityStatus = lifecycle;
      return;
    }
    const endedAt = typeof lifecycle.endedAt === "number" && Number.isFinite(lifecycle.endedAt) ? lifecycle.endedAt : Date.now();
    const remaining = endedAt + COMPACTION_STATUS_DURATION_MS - Date.now();
    if (remaining <= 0) return;
    continuityStatus = lifecycle;
    continuityStatusTimer = setTimeout(() => {
      continuityStatus = undefined;
      continuityStatusKey = key;
      continuityStatusTimer = undefined;
    }, remaining);
  }

  function openContextMeter(): void {
    if (!contextCapacity) return;
    contextMeterReturnFocus = document.activeElement as HTMLElement;
    contextMeterOpen = true;
    void tick().then(() => contextMeterPopover?.focus());
  }

  function closeContextMeter(restoreFocus = true): void {
    contextMeterOpen = false;
    const target = contextMeterReturnFocus;
    contextMeterReturnFocus = undefined;
    if (restoreFocus) target?.focus();
  }

  function toggleContextMeter(): void { if (contextMeterOpen) closeContextMeter(); else openContextMeter(); }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!contextMeterOpen) return;
    const target = event.target as Node | null;
    if (!target || !(target as Element).closest?.(".companion-context-meter-wrap")) closeContextMeter(false);
  }

  function rotateWaitingCopy(): void {
    const choices = LONG_WAIT_MESSAGES.filter((message) => message !== waitingCopy);
    waitingCopy = choices[Math.floor(Math.random() * choices.length)] ?? LONG_WAIT_MESSAGES[0];
  }

  function syncWaitingState(running: boolean, replyKey: string): void {
    const nextCycle = running ? replyKey : "";
    if (nextCycle === waitingCycle) return;
    waitingCycle = nextCycle;
    clearWaitingTimers();
    waitingCopy = "";
    if (!running) return;
    waitingDelayTimer = setTimeout(() => {
      rotateWaitingCopy();
      waitingRotationTimer = setInterval(rotateWaitingCopy, LONG_WAIT_ROTATION_MS);
    }, LONG_WAIT_DELAY_MS);
  }

  async function reconcileProjection(value: CompanionProjection): Promise<void> {
    await tick();
    if (!timeline) return;
    if (value.openState !== "open") {
      if (timelineRevealFrame) cancelAnimationFrame(timelineRevealFrame);
      timelineRevealFrame = 0;
      timelineReady = false;
      return;
    }
    const distance = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop;
    const nearBottom = wasNearBottom || distance < 96;
    if (nearBottom && !value.loadingOlder) timeline.scrollTop = timeline.scrollHeight;
    if (!timelineReady) {
      if (timelineRevealFrame) cancelAnimationFrame(timelineRevealFrame);
      timelineRevealFrame = requestAnimationFrame(() => {
        if (!timeline) return;
        timeline.scrollTop = timeline.scrollHeight;
        timelineReady = true;
        timelineRevealFrame = 0;
      });
    }
    wasNearBottom = nearBottom;
    liveAnnouncement = value.promptError ?? value.lastAgentError ?? "";
    const wantedImages = new Map<string, TimelineImage>();
    for (const item of value.items) if (item.kind === "image" && item.state === "ready" && item.attachment) wantedImages.set(item.id, item);
    for (const [id, url] of Object.entries(imageUrls)) {
      const item = wantedImages.get(id);
      if (!item || imageSources[id] !== imageSource(item)) revokeImage(id, url);
    }
    for (const item of wantedImages.values()) {
      const source = imageSource(item);
      if (!imageUrls[item.id] && imageLoads[item.id] !== source && actions.attachmentUrl) void loadImage(item, source);
    }
    for (const item of value.items) {
      if (item.kind === "voice" && !voiceUrls[item.id] && !voiceErrors[item.id] && actions.prepareVoice) void prepareVoice(item);
    }
  }

  function imageSource(item: TimelineImage): string { return `${item.attachment?.attachmentId ?? ""}:${item.attachment?.mediaType ?? ""}`; }
  function revokeImage(id: string, url = imageUrls[id]): void {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    const urls = { ...imageUrls }; const sources = { ...imageSources }; const errors = { ...imageErrors };
    delete urls[id]; delete sources[id]; delete errors[id];
    imageUrls = urls; imageSources = sources; imageErrors = errors;
  }
  async function loadImage(item: TimelineImage, source: string): Promise<void> {
    if (!actions.attachmentUrl || imageLoads[item.id] === source) return;
    imageLoads = { ...imageLoads, [item.id]: source };
    try {
      const url = await actions.attachmentUrl(item.attachment);
      const live = displayedProjection.items.find((candidate) => candidate.kind === "image" && candidate.id === item.id) as TimelineImage | undefined;
      if (live && imageSource(live) === source) {
        if (imageUrls[item.id] && imageUrls[item.id] !== url) revokeImage(item.id);
        imageUrls = { ...imageUrls, [item.id]: url }; imageSources = { ...imageSources, [item.id]: source };
      } else if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    } catch { imageErrors = { ...imageErrors, [item.id]: "图片暂时无法显示。" }; }
    finally { const loads = { ...imageLoads }; delete loads[item.id]; imageLoads = loads; }
  }

  async function prepareVoice(item: TimelineVoice): Promise<void> {
    if (!actions.prepareVoice || voiceUrls[item.id] || voicePreparing[item.id]) return;
    voicePreparing = { ...voicePreparing, [item.id]: true };
    const nextErrors = { ...voiceErrors }; delete nextErrors[item.id]; voiceErrors = nextErrors;
    try {
      const url = await actions.prepareVoice(item.text);
      voiceUrls = { ...voiceUrls, [item.id]: url };
    }
    catch { voiceErrors = { ...voiceErrors, [item.id]: "语音暂时无法播放，文字内容仍可查看。" }; }
    finally { const next = { ...voicePreparing }; delete next[item.id]; voicePreparing = next; }
  }

  function updateVoicePlayback(id: string, patch: Partial<{ current: number; duration: number; playing: boolean }>): void {
    voicePlayback = { ...voicePlayback, [id]: { current: 0, duration: 0, playing: false, ...voicePlayback[id], ...patch } };
  }

  function voiceState(id: string): { current: number; duration: number; playing: boolean } {
    return voicePlayback[id] ?? EMPTY_VOICE_PLAYBACK;
  }

  function formatVoiceSeconds(value: number, rounding: "floor" | "ceil" = "floor"): string {
    if (!Number.isFinite(value) || value <= 0) return "0:00";
    const seconds = rounding === "ceil" ? Math.ceil(value) : Math.floor(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function hasVoiceDuration(state: { duration: number }): boolean { return state.duration > 0; }
  function voiceTimestamp(state: { current: number; duration: number }): string | undefined {
    if (state.duration <= 0) return undefined;
    return state.current > 0 && state.current < state.duration
      ? formatVoiceSeconds(state.current)
      : formatVoiceSeconds(state.duration, "ceil");
  }

  function voiceProgress(state: { current: number; duration: number }): number {
    return state.duration > 0 ? Math.min(1, Math.max(0, state.current / state.duration)) : 0;
  }

  function voiceWaveform(id: string): number[] {
    let seed = 2166136261;
    for (const character of id) seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619);
    return Array.from({ length: VOICE_WAVEFORM_BAR_COUNT }, (_, index) => {
      seed = Math.imul(seed ^ index, 2246822519);
      return 28 + (Math.abs(seed) % 69);
    });
  }

  function audioFor(control: Element): HTMLAudioElement | undefined {
    return control.closest(".companion-voice")?.querySelector<HTMLAudioElement>("audio") ?? undefined;
  }

  function trackVoiceAudio(node: HTMLAudioElement, id: string): { destroy(): void } {
    const loaded = (event: Event) => onVoiceLoaded(id, event);
    const time = (event: Event) => onVoiceTime(id, event);
    const play = () => onVoicePlay(id);
    const pause = () => onVoicePause(id);
    const ended = (event: Event) => onVoiceEnded(id, event);
    const error = () => failVoice(id);
    node.addEventListener("loadedmetadata", loaded);
    node.addEventListener("timeupdate", time);
    node.addEventListener("play", play);
    node.addEventListener("pause", pause);
    node.addEventListener("ended", ended);
    node.addEventListener("error", error);
    return {
      destroy() {
        node.removeEventListener("loadedmetadata", loaded);
        node.removeEventListener("timeupdate", time);
        node.removeEventListener("play", play);
        node.removeEventListener("pause", pause);
        node.removeEventListener("ended", ended);
        node.removeEventListener("error", error);
      },
    };
  }

  function failVoice(id: string): void {
    const nextUrls = { ...voiceUrls }; delete nextUrls[id]; voiceUrls = nextUrls;
    voiceErrors = { ...voiceErrors, [id]: "语音暂时无法播放，文字内容仍可查看。" };
  }

  async function toggleVoice(item: TimelineVoice, control: Element): Promise<void> {
    if (!voiceUrls[item.id]) {
      await prepareVoice(item);
      await tick();
    }
    const audio = audioFor(control);
    if (!audio) return;
    for (const other of document.querySelectorAll<HTMLAudioElement>("#dsh-companion .companion-voice audio")) if (other !== audio && !other.paused) other.pause();
    try {
      if (audio.ended) audio.currentTime = 0;
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      failVoice(item.id);
    }
  }

  function seekVoice(event: Event, id: string): void {
    const audio = audioFor(event.currentTarget as Element);
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    updateVoicePlayback(id, { current: value });
  }

  function onVoicePlay(id: string): void { updateVoicePlayback(id, { playing: true }); }
  function onVoicePause(id: string): void { updateVoicePlayback(id, { playing: false }); }
  function onVoiceEnded(id: string, event: Event): void {
    const audio = event.target as HTMLAudioElement;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : voiceState(id).duration;
    updateVoicePlayback(id, { current: duration, duration, playing: false });
  }
  function onVoiceLoaded(id: string, event: Event): void {
    const audio = event.target as HTMLAudioElement;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      failVoice(id);
      return;
    }
    updateVoicePlayback(id, { duration: audio.duration, current: audio.currentTime });
  }
  function onVoiceTime(id: string, event: Event): void {
    const audio = event.target as HTMLAudioElement;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : voiceState(id).duration;
    updateVoicePlayback(id, { current: audio.currentTime, duration });
  }

  function onScroll(): void {
    if (!timeline) return;
    wasNearBottom = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 96;
  }

  function keepBottomOnResize(node: HTMLElement): { destroy(): void } {
    const observer = new ResizeObserver(() => {
      if (timelineReady && wasNearBottom && timeline) timeline.scrollTop = timeline.scrollHeight;
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function submit(): void {
    const restoreText = composer.draft;
    const text = restoreText.trim();
    if ((!text && imageDrafts.length === 0) || composer.composing || isComposerLocked()) return;
    suppressNextSendError = false;
    const submittedDrafts = [...imageDrafts];
    const batch = text === "/compact"
      ? undefined
      : createSendingBatch({ sessionId, text, restoreText, images: submittedDrafts, projection });
    composer = { ...reduceComposer(composer, { type: "submit" }), draft: "", composing: false };
    imageDrafts = [];
    if (batch) optimisticBatch = batch;
    syncDisplayedProjection();
    submitting = true;
    const token = ++submissionToken;
    void Promise.resolve().then(() => actions.send(text, submittedDrafts)).then(() => {
      if (!batch || optimisticBatch?.id !== batch.id) return;
      optimisticBatch = markSendingBatchAccepted(optimisticBatch);
      syncDisplayedProjection();
    }).catch((error: unknown) => {
      if (!batch) {
        if (token === submissionToken) composer = { ...composer, draft: restoreText };
        imageDrafts = [...submittedDrafts];
        liveAnnouncement = error instanceof Error && error.message === "compact-with-images"
          ? "整理时请先移除图片。"
          : "消息发送失败，内容已保留，可以重试。";
        return;
      }
      if (optimisticBatch?.id !== batch.id || batch.sessionId !== sessionId) return;
      const explicitRejection = isCompanionPromptRejectedError(error)
        || (error instanceof Error && error.message === "compact-with-images");
      if (explicitRejection) {
        rememberHandledSendError(projection);
        if (projection.promptErrorOp !== "send") suppressNextSendError = true;
        optimisticBatch = undefined;
        syncDisplayedProjection();
        submissionToken += 1;
        submitting = false;
        composer = { ...composer, draft: batch.restoreText, composing: false };
        imageDrafts = [...batch.images];
        liveAnnouncement = "消息没有发送成功，内容已恢复。";
      } else {
        optimisticBatch = markSendingBatchTransportAmbiguous(optimisticBatch ?? batch);
        syncDisplayedProjection();
        liveAnnouncement = "连接暂时中断，正在确认消息状态。";
      }
    }).finally(() => { if (token === submissionToken) submitting = false; });
  }

  async function stop(): Promise<void> {
    if (!actions.stop || stopping) return;
    stopping = true;
    try { await actions.stop(); }
    catch { liveAnnouncement = "暂时无法停止当前回复，请重试。"; }
    finally { stopping = false; }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isComposerLocked()) return;
    if (commandSuggestion && (event.key === "Tab" || event.key === "Enter") && !event.shiftKey && !event.isComposing && !composer.composing) {
      event.preventDefault();
      acceptCommandSuggestion();
      return;
    }
    if (shouldSubmitEnter(event, composer.composing)) {
      event.preventDefault();
      submit();
    }
  }

  function setDraft(value: string): void { if (!isComposerLocked()) composer = reduceComposer(composer, { type: "input", value }); }
  function acceptCommandSuggestion(): void {
    if (!commandSuggestion) return;
    setDraft(commandSuggestion.command);
    void tick().then(() => composerInput?.focus());
  }
  function onInput(event: Event): void { setDraft((event.currentTarget as HTMLTextAreaElement).value); }
  function onCompositionEnd(event: CompositionEvent): void { if (!isComposerLocked()) composer = reduceComposer(composer, { type: "compositionend", value: (event.currentTarget as HTMLTextAreaElement).value }); }
  function onCompositionStart(): void { if (!isComposerLocked()) composer = reduceComposer(composer, { type: "compositionstart" }); }
  function addImages(files: readonly File[]): void {
    if (isComposerLocked()) return;
    const error = imageIntakeError(imageDrafts, files, imageLimits);
    if (error) { liveAnnouncement = error; return; }
    imageDrafts = [...imageDrafts, ...createImageDrafts(files)];
  }
  function onImageInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    addImages(Array.from(input.files ?? []));
    input.value = "";
  }
  function onPaste(event: ClipboardEvent): void {
    const images = imageFilesFromClipboard(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    addImages(images);
  }
  function removeImage(draft: CompanionImageDraft): void {
    if (isComposerLocked()) return;
    releaseImageDrafts([draft]);
    imageDrafts = imageDrafts.filter((candidate) => candidate !== draft);
  }
  function onImagePickerPointerDown(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    imagePickerPointer = { id: event.pointerId, startedAt: Date.now() };
  }
  function onImagePickerPointerUp(event: PointerEvent): void {
    if (!imagePickerPointer || imagePickerPointer.id !== event.pointerId) return;
    const held = Date.now() - imagePickerPointer.startedAt >= PHOTO_LONG_PRESS_MS;
    imagePickerPointer = undefined;
    if (!held) return;
    suppressImagePickerClick = true;
    event.preventDefault();
    cameraInput?.click();
  }
  function clearImagePickerPointer(): void { imagePickerPointer = undefined; }
  function choosePhoto(): void {
    if (isComposerLocked()) return;
    if (suppressImagePickerClick) { suppressImagePickerClick = false; return; }
    photoLibraryInput?.click();
  }
  function formatSessionDate(value: number): string {
    if (!Number.isFinite(value)) return "";
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }
  async function selectSession(sessionId: string): Promise<void> {
    if (!actions.selectSession) return;
    await actions.selectSession(sessionId);
    if (window.matchMedia("(max-width: 820px)").matches) setSidebarOpen(false);
  }
  function focusFirst(dialog: () => HTMLElement | undefined): void {
    void tick().then(() => {
      const target = dialog();
      (target?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? target)?.focus();
    });
  }
  function trapFocus(event: KeyboardEvent, dialog: HTMLElement): void {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hasAttribute("hidden"));
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function closeHistory(): void { if (overlayHistory) { overlayHistory = false; history.back(); } }
  function openDetail(): void {
    detailReturnFocus = document.activeElement as HTMLElement;
    detailOpen = true;
    void tick().then(() => {
      const popover = detailPopover as (HTMLElement & { showPopover?: () => void }) | undefined;
      popover?.showPopover?.();
      positionDetailPopover();
      focusFirst(() => detailPopover);
    });
  }
  function positionDetailPopover(): void {
    if (!detailPopover || !detailAnchor) return;
    const anchor = detailAnchor.getBoundingClientRect();
    const width = Math.min(372, Math.max(240, window.innerWidth - 38));
    const height = detailPopover.getBoundingClientRect().height;
    const left = Math.min(Math.max(12, anchor.left - 8), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(anchor.bottom + 10, Math.max(12, window.innerHeight - height - 12));
    detailPopover.style.width = `${width}px`;
    detailPopover.style.left = `${left}px`;
    detailPopover.style.top = `${top}px`;
  }
  function onWindowResize(): void { if (detailOpen) positionDetailPopover(); }
  function finishDetailClose(restoreFocus = true): void {
    detailOpen = false;
    const target = detailReturnFocus;
    detailReturnFocus = undefined;
    if (restoreFocus) target?.focus();
  }
  function closeDetail(restoreFocus = true): void {
    const popover = detailPopover as (HTMLElement & { hidePopover?: () => void }) | undefined;
    if (popover?.matches(":popover-open")) { popover.hidePopover?.(); return; }
    finishDetailClose(restoreFocus);
  }
  function onDetailToggle(event: Event): void {
    const toggle = event as ToggleEvent;
    if (toggle.newState === "open") {
      detailOpen = true;
      focusFirst(() => detailPopover);
      return;
    }
    finishDetailClose();
  }
  function openLightbox(item: TimelineImage): void {
    lightboxReturnFocus = document.activeElement as HTMLElement;
    lightbox = item;
    lightboxUrl = item.previewUrl ?? imageUrls[item.id] ?? "";
    void tick().then(() => {
      if (lightboxDialog && !lightboxDialog.open) lightboxDialog.showModal();
      focusFirst(() => lightboxDialog);
    });
  }
  function finishLightboxClose(fromHistory: boolean): void {
    const target = lightboxReturnFocus;
    const hadHistory = overlayHistory;
    lightbox = undefined;
    lightboxUrl = "";
    lightboxReturnFocus = undefined;
    releaseDeferredPreviewReleases();
    if (target) target.focus();
    if (!fromHistory && hadHistory) closeHistory();
  }
  function closeLightbox(fromHistory = false): void {
    if (!lightbox) return;
    lightboxCloseFromHistory = fromHistory;
    if (lightboxDialog?.open) { lightboxDialog.close(); return; }
    finishLightboxClose(fromHistory);
  }
  function onLightboxClose(): void {
    const fromHistory = lightboxCloseFromHistory;
    lightboxCloseFromHistory = false;
    finishLightboxClose(fromHistory);
  }
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (contextMeterOpen) { event.preventDefault(); closeContextMeter(); return; }
      return;
    }
    if (lightbox && lightboxDialog) trapFocus(event, lightboxDialog);
  }
  function onPopState(): void { overlayHistory = false; if (lightbox) closeLightbox(true); }
  function pushOverlayHistory(): void { if (!overlayHistory) { history.pushState({ companionOverlay: true }, ""); overlayHistory = true; } }
  function toggleDetail(): void { if (detailOpen) closeDetail(); else openDetail(); }
  function showLightbox(item: TimelineImage): void { pushOverlayHistory(); openLightbox(item); }
  async function loadOlder(): Promise<void> { if (!actions.loadOlder || projection.loadingOlder) return; const previousHeight = timeline?.scrollHeight ?? 0; await actions.loadOlder(); await tick(); if (timeline) timeline.scrollTop += timeline.scrollHeight - previousHeight; }

  onMount(() => {
    const desktop = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
    const onDesktopChange = (event: MediaQueryListEvent): void => {
      sidebarOpen = event.matches ? readDesktopSidebarPreference() : false;
    };
    desktop.addEventListener("change", onDesktopChange);
    return () => desktop.removeEventListener("change", onDesktopChange);
  });

  onDestroy(() => {
    if (timelineRevealFrame) cancelAnimationFrame(timelineRevealFrame);
    if (optimisticBatch) releaseImageDrafts(optimisticBatch.images);
    releaseDeferredPreviewReleases();
    releaseImageDrafts(imageDrafts);
    clearWaitingTimers();
    clearContinuityStatusTimer();
    for (const audio of document.querySelectorAll<HTMLAudioElement>("#dsh-companion .companion-voice audio")) audio.pause();
    for (const url of Object.values(imageUrls)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  });
</script>

<svelte:window on:keydown={onWindowKeydown} on:pointerdown={onWindowPointerDown} on:popstate={onPopState} on:resize={onWindowResize} />

<div id="dsh-companion" class="companion-shell" data-theme={scheme === "dark" ? "night-voyage" : "sticker-messenger"} data-testid="companion-root">
  <div class="cmp-drawer companion-app">
    <input id="companion-session-drawer" class="cmp-drawer-toggle" type="checkbox" bind:checked={sidebarOpen} on:change={onSidebarChange} aria-label="显示对话列表" />
    <div class="cmp-drawer-content companion-content">
    <main class="companion-main" aria-label="Companion 私聊">
      <header class="companion-header">
        <button class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-session-toggle" aria-label={sidebarOpen ? "收起对话列表" : "展开对话列表"} aria-controls="companion-session-list" aria-expanded={sidebarOpen} on:click={toggleSidebar}><span aria-hidden="true">☰</span></button>
        <div bind:this={detailAnchor} class="companion-avatar-anchor">
          <button class="cmp-avatar cmp-avatar-placeholder cmp:rounded-full companion-avatar" aria-label="查看 Companion 关系资料" aria-expanded={detailOpen} on:click={toggleDetail}>
            <div class="companion-avatar-crop cmp:rounded-full">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}</div>
          </button>
          {#if detailOpen}
            <div bind:this={detailPopover} id="companion-detail-popover" popover="auto" class="cmp-card companion-detail-card" role="dialog" aria-label={`${identity.companionName}的关系资料`} style={`--relationship-art: url("${relationshipBackground}")`} on:toggle={onDetailToggle}>
              <div class="companion-detail-art" aria-hidden="true"></div>
              <div class="cmp-card-body">
                <div class="companion-detail-head">
                  <div class="cmp-avatar cmp-avatar-placeholder cmp:rounded-full companion-detail-avatar"><div class="companion-avatar-crop cmp:rounded-full">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt={identity.companionName} />{:else}<span aria-hidden="true">✦</span>{/if}</div></div>
                  <div><h2 id="companion-detail-title">{identity.companionName}</h2><span class="cmp-badge cmp-badge-soft cmp-badge-secondary companion-mood-chip">{identity.moodLabel}</span></div>
                  <button class="cmp-btn cmp-btn-ghost cmp-btn-circle cmp-btn-sm companion-detail-close" aria-label="关闭关系资料" on:click={() => closeDetail()}>×</button>
                </div>
                <p class="companion-signature">{identity.signature || "还没有签名"}</p>
                <dl class="companion-relationship-list"><dt>此刻心情</dt><dd>{identity.moodLabel} · {INTENSITY_LABELS[identity.intensity]}</dd>{#if identity.moodNote}<dt>心情短句</dt><dd>{identity.moodNote}</dd>{/if}<dt>亲近度</dt><dd>{identity.affinity === undefined ? "加载中…" : `${identity.affinity} · ${identity.affinityStage}`}</dd></dl>
              </div>
            </div>
          {/if}
        </div>
        <div class="companion-header-copy">
          <div class="companion-name">{identity.companionName}</div>
          <div class="companion-presence" aria-live="polite"><span class="cmp-status {projection.status === 'working' ? 'cmp-status-warning' : projection.status === 'reconnecting' ? 'cmp-status-error' : 'cmp-status-success'}"></span>{statusText} · {identity.moodLabel}</div>
        </div>
        <a class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-full-dsh" href="/" aria-label="打开完整 DSH" title="打开完整 DSH" on:click={() => dispatch("advanced")}><PanelsTopLeft size={18} strokeWidth={1.8} aria-hidden="true" /></a>
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
        <div bind:this={timeline} class="companion-timeline" class:timeline-ready={timelineReady} role="log" aria-live="polite" aria-relevant="additions text" on:scroll={onScroll}>
          <div class="companion-timeline-content" use:keepBottomOnResize>
          {#if displayedProjection.hasMore}
            <button class="cmp-btn cmp-btn-ghost cmp-btn-sm" style="display:block;margin:0 auto 18px" on:click={loadOlder} disabled={displayedProjection.loadingOlder}>{displayedProjection.loadingOlder ? "正在加载…" : "查看更早的消息"}</button>
          {/if}
          {#if displayedProjection.items.length === 0}
            <div class="companion-recovery"><div class="companion-mood-orb" aria-hidden="true"></div><h1>嗨，{identity.preferredAddress}</h1><p>从一句今天的心情开始吧。</p></div>
          {/if}
          {#each displayedProjection.items as item (item.projectionKey ?? item.id)}
            {#if item.kind === "text"}
              <article class="cmp-chat companion-row" class:cmp-chat-start={item.side === "incoming"} class:cmp-chat-end={item.side === "outgoing"} class:outgoing={item.side === "outgoing"} class:incoming={item.side === "incoming"} data-testid={`message-${item.id}`}>
                <div class="cmp-chat-image cmp-avatar cmp-avatar-placeholder cmp:rounded-full message-avatar">
                  <div class="companion-avatar-crop cmp:rounded-full">{#if item.side === "incoming" && identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else if item.side === "outgoing" && identity.userAvatar}<img src={identity.userAvatar} alt="" />{:else}<span aria-hidden="true">{item.side === "incoming" ? "✦" : "你"}</span>{/if}</div>
                </div>
                <div class="companion-message-stack">
                  <div class="cmp-chat-bubble companion-bubble" class:cmp-skeleton={item.pending && !item.text}><Markdown text={item.text} /></div>
                  {#if item.pending}<div class="companion-meta">排队中 · 会在当前回复后发送</div>{/if}
                </div>
              </article>
            {:else if item.kind === "image"}
              <article class="cmp-chat companion-row" class:cmp-chat-start={item.side === "incoming"} class:cmp-chat-end={item.side === "outgoing"} class:outgoing={item.side === "outgoing"} class:incoming={item.side === "incoming"} data-testid={`image-${item.id}`}>
                <div class="cmp-chat-image cmp-avatar cmp-avatar-placeholder cmp:rounded-full message-avatar"><div class="companion-avatar-crop cmp:rounded-full">{#if item.side === "incoming" && identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else if item.side === "outgoing" && identity.userAvatar}<img src={identity.userAvatar} alt="" />{:else}<span aria-hidden="true">{item.side === "incoming" ? "✦" : "你"}</span>{/if}</div></div>
                <div class="cmp-chat-bubble companion-media">
                  {#if item.state === "running" || item.state === "loading"}<div class="cmp-skeleton" style="height:260px" aria-hidden="true"></div><div style="padding:12px" role="status">正在画一张图…</div>
                  {:else if item.previewUrl || imageUrls[item.id]}<button class="companion-media-button" aria-label={"查看大图：" + item.alt} on:click={() => showLightbox(item)}><img src={item.previewUrl ?? imageUrls[item.id]} alt={item.alt} /></button>
                  {:else if imageErrors[item.id] || item.state === "failed"}<div role="alert" style="padding:22px">{item.error || imageErrors[item.id] || "图片暂时无法显示。"}</div>
                  {:else}<div class="cmp-loading cmp-loading-spinner" style="margin:32px auto"></div>{/if}
                </div>
              </article>
            {:else if item.kind === "voice"}
              {@const playback = voicePlayback[item.id] ?? EMPTY_VOICE_PLAYBACK}
              <article class="cmp-chat cmp-chat-start companion-row incoming" data-testid={`voice-${item.id}`}>
                <div class="cmp-chat-image cmp-avatar cmp-avatar-placeholder cmp:rounded-full message-avatar"><div class="companion-avatar-crop cmp:rounded-full">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}</div></div>
                <div class="cmp-chat-bubble companion-bubble companion-voice" role="region" aria-label="语音播放器">
                  {#if voiceUrls[item.id]}
                    <audio class="companion-audio" preload="metadata" src={voiceUrls[item.id]} aria-hidden="true" tabindex="-1" use:trackVoiceAudio={item.id}></audio>
                    <button class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-voice-control" aria-label={playback.playing ? "暂停语音" : "播放语音"} on:click={(event) => void toggleVoice(item, event.currentTarget)}>
                      {#if playback.playing}<Pause size={18} fill="currentColor" aria-hidden="true" />{:else}<Play size={18} fill="currentColor" aria-hidden="true" />{/if}
                    </button>
                    <div class="companion-voice-player">
                      <div class="companion-voice-waveform">
                        {#each voiceWaveform(item.id) as height, index}<span class:played={(index + 1) / VOICE_WAVEFORM_BAR_COUNT <= voiceProgress(playback)} style={`--voice-bar:${height}%`} aria-hidden="true"></span>{/each}
                        <input class="companion-voice-seek" type="range" min="0" max={playback.duration || 0} step="0.1" value={playback.current} disabled={!hasVoiceDuration(playback)} aria-label="语音进度" aria-valuetext={hasVoiceDuration(playback) ? `${formatVoiceSeconds(playback.current)} / ${formatVoiceSeconds(playback.duration, "ceil")}` : "正在加载语音时长"} on:input={(event) => seekVoice(event, item.id)} />
                      </div>
                      <div class="companion-voice-meta">{#if voiceTimestamp(playback)}<span role="timer" aria-live="off">{voiceTimestamp(playback)}</span>{:else}<span role="status">加载时长…</span>{/if}{#if voiceErrors[item.id]}<span role="alert">播放失败</span>{/if}</div>
                    </div>
                  {:else}
                    <button class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-voice-control" aria-label={voicePreparing[item.id] ? "正在准备语音" : voiceErrors[item.id] ? "重试语音" : "播放语音"} on:click={(event) => void toggleVoice(item, event.currentTarget)} disabled={!actions.prepareVoice || voicePreparing[item.id]}>
                      {#if voicePreparing[item.id]}<LoaderCircle class="companion-spin" size={18} aria-hidden="true" />{:else if voiceErrors[item.id]}<RotateCcw size={18} aria-hidden="true" />{:else}<Play size={18} fill="currentColor" aria-hidden="true" />{/if}
                    </button>
                    <div class="companion-voice-player">
                      <div class="companion-voice-waveform">{#each voiceWaveform(item.id) as height}<span style={`--voice-bar:${height}%`} aria-hidden="true"></span>{/each}</div>
                      <div class="companion-voice-meta">{#if voicePreparing[item.id]}<span role="status">准备中</span>{:else if voiceErrors[item.id]}<span role="alert">播放失败</span>{:else}<span role="status">准备中</span>{/if}</div>
                    </div>
                  {/if}
                  <details class="companion-transcript" open={Boolean(voiceErrors[item.id])}>
                    <summary><MessageSquareText size={14} aria-hidden="true" /><span>转文字</span></summary>
                    <p>{item.text}</p>
                  </details>
                </div>
              </article>
            {:else if item.kind === "continuity"}
              <div class="companion-continuity-record" data-testid={`continuity-record-${item.compactionId}`} aria-live="off">{item.text}</div>
            {:else}
              <div class="companion-recovery" role={item.tone === "error" ? "alert" : "status"}><p>{item.text}</p></div>
            {/if}
          {/each}
          {#if typingVisible}
            <article class="cmp-chat cmp-chat-start companion-row incoming" data-testid="companion-typing-indicator" role="status" aria-label={`${identity.companionName}正在输入`}>
              <div class="cmp-chat-image cmp-avatar cmp-avatar-placeholder cmp:rounded-full message-avatar">
                <div class="companion-avatar-crop cmp:rounded-full">{#if identity.companionAvatar}<img src={identity.companionAvatar} alt="" />{:else}<span aria-hidden="true">✦</span>{/if}</div>
              </div>
              <div class="cmp-chat-bubble companion-bubble companion-typing-bubble"><span class="cmp-loading cmp-loading-dots cmp-loading-sm" aria-hidden="true"></span>{#if waitingCopy}<span class="companion-waiting-copy">{waitingCopy}</span>{/if}</div>
            </article>
          {/if}
          {#if !wasNearBottom && displayedProjection.items.length > 0}<button class="cmp-btn cmp-btn-primary cmp-btn-sm" style="position:sticky;bottom:10px;left:50%;transform:translateX(-50%)" on:click={() => timeline.scrollTop = timeline.scrollHeight}>有新消息 ↓</button>{/if}
          </div>
        </div>
        <div class="companion-composer">
          {#if commandSuggestion}
            <div id="companion-command-suggestions" class="companion-command-suggestions" role="listbox" aria-label="命令补全">
              <button id="companion-command-compact" class="cmp-btn cmp-btn-ghost companion-command-suggestion" type="button" role="option" aria-selected="true" on:click={acceptCommandSuggestion}>
                <span class="companion-command-name">{commandSuggestion.command}</span>
                <span class="companion-command-description">{commandSuggestion.description}</span>
                <span class="companion-command-tab" aria-hidden="true">Tab</span>
              </button>
            </div>
          {/if}
          {#if continuityStatus}
            <div class="companion-continuity-status" data-testid="companion-continuity-status" data-state={continuityStatus.status} role={continuityStatus.status === "failed" ? "alert" : "status"} aria-live="polite">
              {#if continuityStatus.status === "running"}正在整理记忆…{:else if continuityStatus.status === "failed"}本次整理未完成，仍可继续对话{:else}整理记忆已完成{/if}
            </div>
          {/if}
          {#if imageDrafts.length > 0}
            <div class="companion-image-drafts" role="group" aria-label="待发送图片">
              {#each imageDrafts as draft (draft.id)}
                <div class="companion-image-draft">
                  <img src={draft.previewUrl} alt={draft.file.name || "待发送图片"} />
                  <button class="cmp-btn cmp-btn-circle companion-image-draft-remove" type="button" aria-label="移除图片" disabled={composerLocked} on:click={() => removeImage(draft)}><X size={13} strokeWidth={2.5} aria-hidden="true" /></button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="companion-compose-row">
            <input bind:this={photoLibraryInput} id="companion-image-library" class="cmp-file-input companion-image-input" type="file" accept={IMAGE_ACCEPT} multiple tabindex="-1" aria-hidden="true" on:change={onImageInput} />
            <input bind:this={cameraInput} id="companion-image-camera" class="cmp-file-input companion-image-input" type="file" accept={IMAGE_ACCEPT} capture="environment" tabindex="-1" aria-hidden="true" on:change={onImageInput} />
            <button class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-attach" type="button" aria-label="选择照片；长按拍照" title="选择照片；长按拍照" disabled={!imageLimits || composerLocked} on:pointerdown={onImagePickerPointerDown} on:pointerup={onImagePickerPointerUp} on:pointercancel={clearImagePickerPointer} on:contextmenu|preventDefault on:click={choosePhoto}><ImagePlus size={19} strokeWidth={2} aria-hidden="true" /></button>
            <textarea bind:this={composerInput} class="cmp-textarea companion-textarea" aria-label="写消息" aria-autocomplete={commandSuggestion ? "list" : undefined} aria-controls={commandSuggestion ? "companion-command-suggestions" : undefined} placeholder={"写给 " + identity.companionName + "…"} rows="1" value={composer.draft} disabled={composerLocked} on:input={onInput} on:paste={onPaste} on:compositionstart={onCompositionStart} on:compositionend={onCompositionEnd} on:keydown={onKeydown}></textarea>
            {#if contextCapacity}
              <div class="companion-context-meter-wrap">
                <button bind:this={contextMeterButton} class="cmp-btn cmp-btn-ghost cmp-btn-circle companion-context-meter" class:companion-context-meter-open={contextMeterOpen} data-state={continuityStatus?.status === "running" ? "active" : continuityStatus?.status === "complete" ? "complete" : continuityStatus?.status === "failed" ? "failed" : contextCapacity.percentage >= 80 ? "warning" : "idle"} type="button" aria-label={`对话容量：${contextCapacity.percentage}%`} aria-expanded={contextMeterOpen} aria-controls="companion-context-popover" on:click={toggleContextMeter}>
                  <svg viewBox="0 0 28 28" aria-hidden="true"><circle class="companion-context-meter-track" cx="14" cy="14" r="11"></circle><circle class="companion-context-meter-value" cx="14" cy="14" r="11" pathLength="100" style={`stroke-dashoffset:${100 - contextCapacity.percentage}`}></circle></svg>
                </button>
                {#if contextMeterOpen}
                  <div bind:this={contextMeterPopover} id="companion-context-popover" class="cmp-card companion-context-popover" role="dialog" aria-labelledby="companion-context-popover-title" tabindex="-1">
                    <h2 id="companion-context-popover-title">对话容量</h2>
                    <p class="companion-context-percent">{contextCapacity.percentage}%</p>
                    <p>{formatTokenCount(contextCapacity.usedTokens)} / {formatTokenCount(contextCapacity.contextWindow)}</p>
                  </div>
                {/if}
              </div>
            {/if}
            {#if projection.running && !composer.draft.trim() && imageDrafts.length === 0}
              <button class="cmp-btn cmp-btn-primary cmp-btn-circle companion-send" aria-label="停止当前回复" on:click={() => void stop()} disabled={!actions.stop || stopping}><Square size={15} fill="currentColor" aria-hidden="true" /></button>
            {:else}
              <button class="cmp-btn cmp-btn-primary cmp-btn-circle companion-send" aria-label="发送消息" on:click={submit} disabled={(!composer.draft.trim() && imageDrafts.length === 0) || composerLocked}><span aria-hidden="true">↑</span></button>
            {/if}
          </div>
          <div class="companion-compose-hint">Enter 发送 · Shift+Enter 换行{displayedProjection.pendingCount ? ` · ${displayedProjection.pendingCount} 条消息排队中` : ""}</div>
        </div>
      {/if}
    </main>
    </div>
    <div class="cmp-drawer-side companion-sidebar-layer">
      <label for="companion-session-drawer" class="cmp-drawer-overlay companion-sidebar-overlay" aria-label="关闭对话列表"></label>
      <aside id="companion-session-list" class="companion-sidebar" aria-label="对话列表">
        <div class="companion-sidebar-head"><div><span class="companion-sidebar-eyebrow">{identity.companionName}</span><h2>我们的对话</h2></div><button class="cmp-btn cmp-btn-ghost cmp-btn-circle cmp-btn-sm" aria-label="关闭侧栏" on:click={() => setSidebarOpen(false)}>‹</button></div>
        <nav class="companion-session-list">
          {#each sessions as session (session.id)}
            <button class="companion-session-item" class:selected={session.selected} aria-label={`切换到对话：${session.title}`} aria-current={session.selected ? "true" : undefined} on:click={() => void selectSession(session.id)}>
              <span class="companion-session-copy"><strong>{session.title}</strong><small>{formatSessionDate(session.updatedAt)}</small></span>
              {#if session.running}<span class="companion-session-running" aria-label="正在回复"></span>{/if}
            </button>
          {/each}
          {#if sessions.length === 0}<p class="companion-session-empty">还没有可以继续的对话</p>{/if}
        </nav>
        <a class="companion-sidebar-advanced" href="/" on:click={() => dispatch("advanced")}>打开完整 DSH</a>
      </aside>
    </div>
  </div>
  {#if lightbox}
    <dialog bind:this={lightboxDialog} id="companion-image-lightbox" class="cmp-modal companion-lightbox" aria-labelledby="lightbox-title" on:close={onLightboxClose}>
      <div class="cmp-modal-box companion-lightbox-dialog">
        <h2 id="lightbox-title" class="companion-sr-only">图片预览：{lightbox.alt}</h2>
        <button class="cmp-btn cmp-btn-neutral companion-lightbox-close" aria-label="关闭大图" on:click={() => closeLightbox()}>×</button>
        {#if lightboxUrl}<img src={lightboxUrl} alt={lightbox.alt} />{:else}<div class="cmp-loading cmp-loading-spinner"></div>{/if}
      </div>
      <form method="dialog" class="cmp-modal-backdrop companion-lightbox-backdrop"><button type="submit" aria-label="关闭图片预览背景">关闭</button></form>
    </dialog>
  {/if}
</div>
<div class="companion-sr-only" aria-live="assertive">{liveAnnouncement}</div>

<style>
  .companion-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .companion-avatar-crop { background:color-mix(in srgb, var(--color-primary) 20%, var(--color-base-200)); color:var(--color-primary); font-weight:700; }
  @media (max-width: 520px) { .companion-timeline { padding-bottom:8px; } .companion-composer { padding-inline:9px; } .companion-voice { min-width:0; } }
</style>

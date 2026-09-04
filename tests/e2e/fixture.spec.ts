import { expect, test } from "@playwright/test";

test("fixture has complete media states, accessible overlays, and no duplicate image URLs", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "sticker-messenger");
  await expect(page.locator(".companion-header")).not.toContainText("把平凡日子折成星星");
  await expect(page.getByRole("button", { name: /今晚的海/ })).toBeVisible();
  const voice = page.getByTestId("voice-voice:demo:1:abc");
  await expect(voice.getByRole("region", { name: "语音播放器" })).toBeVisible();
  const playVoice = voice.getByRole("button", { name: "播放语音" });
  await expect(playVoice.locator("svg")).toHaveCount(1);
  await expect(playVoice).toHaveCSS("width", "44px");
  await expect(playVoice).toHaveCSS("height", "44px");
  await expect.poll(() => playVoice.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(voice.locator(".companion-voice-waveform")).toBeVisible();
  await expect(voice.getByRole("slider", { name: "语音进度" })).toBeAttached();
  const voiceTimer = voice.getByRole("timer");
  await expect(voiceTimer).toHaveText("0:01");
  await page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>('[data-testid="voice-voice:demo:1:abc"] audio')!;
    Object.defineProperties(audio, {
      currentTime: { configurable: true, value: 7 },
      duration: { configurable: true, value: 19 },
    });
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await expect(voiceTimer).toHaveText("0:07");
  await page.evaluate(() => document.querySelector<HTMLAudioElement>('[data-testid="voice-voice:demo:1:abc"] audio')!.dispatchEvent(new Event("ended")));
  await expect(voiceTimer).toHaveText("0:19");
  await expect(voice.getByText("转文字")).toBeVisible();
  await expect(page.getByTestId("voice-voice:demo:failed").getByRole("button", { name: "重试语音" }).locator("svg")).toHaveCount(1);
  const avatar = page.getByRole("button", { name: "查看 Companion 关系资料" });
  await avatar.focus();
  await avatar.click();
  await expect(page.getByRole("dialog")).toContainText("把平凡日子折成星星");
  await expect(page.getByRole("dialog")).toContainText("此刻状态");
  await expect(page.getByRole("dialog")).toContainText("柔和");
  await expect(page.getByRole("dialog")).toContainText("状态短句");
  await expect(page.getByRole("button", { name: "关闭关系资料", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(avatar).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(avatar).toBeFocused();
  await page.getByRole("button", { name: /查看大图/ }).click();
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "关闭大图" })).toHaveCount(0);
  const singleImage = page.locator('[data-testid="image-imagegen:demo:img"]');
  await expect(singleImage).toBeVisible();
  await expect.poll(() => singleImage.locator("img").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  })).toEqual({ width: 240, height: 158 });
  await page.evaluate(() => window.__companionFixture?.replaceImage());
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__companionFixture?.removeImage());
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThan(1);
});

test("assembled image preview dismisses from its backdrop and returns focus to the opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "查看大图：今晚的海" });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeFocused();

  await page.locator(".companion-lightbox-backdrop").click({ position: { x: 6, y: 6 } });
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("assembled image preview follows the official lightbox visual contract", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "查看大图：今晚的海" }).click();
  const dialog = page.getByRole("dialog", { name: "图片预览" });
  const close = page.getByRole("button", { name: "关闭大图" });
  const image = dialog.getByRole("img", { name: "预览图片" });
  const backdrop = page.locator(".companion-lightbox-backdrop");

  await expect(dialog).not.toContainText("今晚的海");
  await expect(close.locator("svg")).toHaveCount(1);
  await expect.poll(async () => ({
    dialog: await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, paddingTop: style.paddingTop };
    }),
    close: await close.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height, radius: Number.parseFloat(style.borderTopLeftRadius), top: box.top, right: window.innerWidth - box.right };
    }),
    image: await image.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const centerDelta = box.left + box.width / 2 - window.innerWidth / 2;
      return {
        radius: Number.parseFloat(getComputedStyle(node).borderTopLeftRadius),
        centerDelta: Math.abs(centerDelta) < 0.5 ? 0 : Math.round(centerDelta),
      };
    }),
    backdrop: await backdrop.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        filter: getComputedStyle(node).backdropFilter,
        top: box.top,
        right: window.innerWidth - box.right,
        bottom: window.innerHeight - box.bottom,
        left: box.left,
      };
    }),
  })).toEqual({
    dialog: { background: "rgba(0, 0, 0, 0)", paddingTop: "40px" },
    close: { width: 36, height: 36, radius: 999, top: 20, right: 20 },
    image: { radius: 12, centerDelta: 0 },
    backdrop: { filter: "blur(12px)", top: 0, right: 0, bottom: 0, left: 0 },
  });
});

test("Pixel 7a browser Back dismisses the assembled image preview and returns focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "pixel-7a", "browser Back preview coverage runs on the mobile project");
  await page.goto("/");
  const opener = page.getByRole("button", { name: "查看大图：今晚的海" });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("relationship card uses the semantic base surface in both themes", async ({ page }) => {
  await page.goto("/");
  const root = page.getByTestId("companion-root");
  const avatar = page.getByRole("button", { name: "查看 Companion 关系资料" });
  await avatar.click();
  const card = page.getByRole("dialog", { name: "小灯的关系资料" });
  await expect(card).toBeVisible();
  await expect.poll(() => card.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 250, 243)");
  await page.getByRole("button", { name: "关闭关系资料", exact: true }).click();
  await expect(card).toHaveCount(0);

  await page.evaluate(() => window.__companionFixture?.setTheme("dark"));
  await expect(root).toHaveAttribute("data-theme", "night-voyage");
  await avatar.click();
  await expect(card).toBeVisible();
  await expect.poll(() => card.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(16, 24, 39)");
});

test("unread-message action resolves the light primary semantic contrast", async ({ page }) => {
  await page.goto("/");
  const timeline = page.locator(".companion-timeline");
  await timeline.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const action = page.getByRole("button", { name: "有新消息 ↓" });
  await expect(action).toBeVisible();
  await expect.poll(() => action.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color };
  })).toEqual({ background: "rgb(237, 113, 134)", color: "rgb(255, 255, 255)" });
});

test("composer grows, caps, and shrinks without document overflow", async ({ page }) => {
  await page.goto("/");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  const composeRow = page.locator(".companion-compose-row");
  const outerMetrics = await composeRow.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return { height: box.height, borderRadius: Number.parseFloat(style.borderTopLeftRadius) };
  });
  expect(outerMetrics.borderRadius).toBe(22);
  expect(outerMetrics.borderRadius * 2).toBeLessThan(outerMetrics.height);
  const metrics = () => textarea.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    overflowY: getComputedStyle(node).overflowY,
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  const initial = await metrics();
  expect(initial.height).toBeGreaterThanOrEqual(43);
  await textarea.fill("第一行\n第二行");
  await expect.poll(metrics).toMatchObject({ overflowY: "hidden" });
  const multiline = await metrics();
  expect(multiline.height).toBeGreaterThan(initial.height);
  await textarea.fill("x".repeat(2_000));
  await expect.poll(metrics).toMatchObject({ height: 150, overflowY: "auto" });
  await expect.poll(() => textarea.evaluate((node) => Number.parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBe(0);
  const capped = await metrics();
  expect(capped.documentHeight).toBeLessThanOrEqual(capped.viewportHeight + 1);
  await textarea.fill("缩回去");
  await expect.poll(metrics).toMatchObject({ overflowY: "hidden" });
  expect((await metrics()).height).toBe(initial.height);
});

test("microphone records once beside context capacity and submits a minimal expression label", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecorder {
      static isTypeSupported(type: string): boolean { return type === "audio/webm;codecs=opus"; }
      readonly mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: { error?: unknown }) => void) | null = null;
      constructor(_stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? "audio/webm;codecs=opus"; }
      start(): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob(["fixture voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  });
  await page.goto("/?voice=1");
  await page.evaluate(() => window.__companionFixture?.setCapacity({ projectedTokens: 100, contextWindow: 1_000 }));
  const row = page.locator(".companion-compose-row");
  const mic = row.locator(".companion-microphone");
  await expect(mic).toHaveAccessibleName("开始录音");
  await expect(page.getByRole("button", { name: /对话容量/ })).toBeVisible();
  const children = await row.evaluate((node) => Array.from(node.children, (child) => child.className));
  expect(children.findIndex((name) => name.includes("companion-microphone"))).toBeLessThan(children.findIndex((name) => name.includes("companion-context-meter-wrap")));

  await mic.click();
  await expect(mic).toHaveAccessibleName("结束录音");
  await expect(page.getByTestId("companion-voice-recording-status")).toContainText("正在录音");
  await mic.click();
  await expect(page.getByTestId("companion-voice-transcribing-status")).toBeVisible();
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("键入草稿");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
  await page.evaluate(() => window.__companionFixture?.resolveVoice());
  await expect(page.getByText("来自麦克风的测试消息 [sad]", { exact: true })).toBeVisible();
  await expect(page.getByTestId("companion-voice-transcribing-status")).toHaveCount(0);
  await expect(textarea).toHaveValue("键入草稿");
});

test("failed microphone transcription preserves text and image drafts without sending", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecorder {
      static isTypeSupported(type: string): boolean { return type === "audio/webm;codecs=opus"; }
      readonly mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: { error?: unknown }) => void) | null = null;
      constructor(_stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? "audio/webm;codecs=opus"; }
      start(): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob(["fixture voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  });
  await page.goto("/?voice=fail");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("保留这段草稿");
  await page.locator("#companion-image-library").setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: Buffer.from("fixture image") });
  const mic = page.locator(".companion-microphone");
  await mic.click();
  await expect(mic).toHaveAccessibleName("结束录音");
  await mic.click();
  await expect(page.getByTestId("companion-voice-error-status")).toContainText("语音暂时无法使用");
  await expect(textarea).toHaveValue("保留这段草稿");
  await expect(page.locator(".companion-image-draft")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.sendCalls() ?? -1)).toBe(0);
});

test("keeps startup neutral until each readiness authority settles", async ({ page }) => {
  await page.goto("/?workspace=loading&relationship=loading&session=loading");
  await expect(page.getByRole("status", { name: "正在加载" })).toBeVisible();
  await expect(page.getByText("还没有设置聊天空间", { exact: true })).toHaveCount(0);
  await expect(page.getByText("这段对话暂时打不开", { exact: true })).toHaveCount(0);

  await page.evaluate(() => window.__companionFixture?.setReadiness({ workspace: "ready" }));
  await expect(page.getByRole("status", { name: "正在加载" })).toBeVisible();
  await page.evaluate(() => window.__companionFixture?.setReadiness({ relationship: "ready" }));
  await expect(page.getByRole("status", { name: "正在加载" })).toBeVisible();
  await page.evaluate(() => window.__companionFixture?.setReadiness({ session: "ready" }));
  await expect(page.getByRole("textbox", { name: "写消息" })).toBeVisible();

  await page.evaluate(() => window.__companionFixture?.setReadiness({ workspace: "missing" }));
  await expect(page.getByRole("heading", { name: "还没有设置聊天空间" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去 DSH 设置选择聊天空间" })).toBeVisible();
  await expect(page.locator(".companion-recovery")).toContainText("我们不会替你自动切换。");

  await page.evaluate(() => window.__companionFixture?.setReadiness({ workspace: "ready", relationship: "error", session: "loading" }));
  await expect(page.getByRole("heading", { name: "关系资料暂时打不开" })).toBeVisible();
  await expect(page.getByText("还没有设置聊天空间", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__companionFixture?.setReadiness({ relationship: "ready", session: "error" }));
  await expect(page.getByRole("heading", { name: "这段对话暂时打不开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
});

test("CompanionRoot bridge keeps delayed authorities neutral and exposes only settled outcomes", async ({ page }) => {
  await page.goto("/?bridge=1");
  const loading = page.getByRole("status", { name: "正在加载" });
  await expect(loading).toBeVisible();
  await expect(page.getByText("还没有设置聊天空间", { exact: true })).toHaveCount(0);
  await expect(page.getByText("关系资料暂时打不开", { exact: true })).toHaveCount(0);
  await expect(page.getByText("这段对话暂时打不开", { exact: true })).toHaveCount(0);

  await page.evaluate(() => window.__companionBridgeFixture?.setWorkspace("ready"));
  await expect(loading).toBeVisible();
  await page.evaluate(() => window.__companionBridgeFixture?.setRelationship("ready"));
  await expect(loading).toBeVisible();
  await page.evaluate(() => window.__companionBridgeFixture?.setSession("ready"));
  await expect(page.getByRole("textbox", { name: "写消息" })).toBeVisible();

  await page.goto("/?bridge=1");
  await page.evaluate(() => window.__companionBridgeFixture?.setWorkspace("missing"));
  await expect(page.getByRole("heading", { name: "还没有设置聊天空间" })).toBeVisible();
  await expect(page.getByText("关系资料暂时打不开", { exact: true })).toHaveCount(0);

  await page.goto("/?bridge=1");
  await page.evaluate(() => window.__companionBridgeFixture?.setWorkspace("ready"));
  await page.evaluate(() => window.__companionBridgeFixture?.setRelationship("error"));
  await expect(page.getByRole("heading", { name: "关系资料暂时打不开" })).toBeVisible();
  await expect(page.getByText("这段对话暂时打不开", { exact: true })).toHaveCount(0);

  await page.goto("/?bridge=1");
  await page.evaluate(() => window.__companionBridgeFixture?.setWorkspace("ready"));
  await page.evaluate(() => window.__companionBridgeFixture?.setRelationship("ready"));
  await page.evaluate(() => window.__companionBridgeFixture?.setSession("ready"));
  await expect(page.getByRole("textbox", { name: "写消息" })).toBeVisible();
  await page.evaluate(() => window.__companionBridgeFixture?.setSession("error"));
  await expect(page.getByRole("heading", { name: "这段对话暂时打不开" })).toBeVisible();

  await page.goto("/?bridge=1");
  await page.evaluate(() => window.__companionBridgeFixture?.setSettingsUnavailable());
  await expect(page.getByRole("heading", { name: "聊天空间暂时打不开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有设置聊天空间" })).toHaveCount(0);
});

test("Pixel 7a geometry keeps composer and relationship overlay usable", async ({ page }) => {
  await page.goto("/?theme=dark");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "night-voyage");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await expect(textarea).toBeVisible();
  await textarea.focus();
  await page.keyboard.insertText("中文输入测试");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("第二行");
  await expect(textarea).toHaveValue("中文输入测试\n第二行");
  await page.getByRole("button", { name: "查看 Companion 关系资料" }).click();
  await expect(page.getByRole("button", { name: "关闭关系资料", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("draft edits stay local to the composer", async ({ page }) => {
  await page.goto("/");
  const before = await page.locator("[data-testid^=message-]").count();
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("草稿");
  expect(await page.locator("[data-testid^=message-]").count()).toBe(before);
  const timing = await page.evaluate(() => {
    const start = performance.now();
    const input = document.querySelector("textarea");
    input?.dispatchEvent(new InputEvent("input", { bubbles: true, data: "x", inputType: "insertText" }));
    return performance.now() - start;
  });
  expect(timing).toBeLessThan(50);
});

test("admits photos from the library or desktop paste and sends them as a draft", async ({ page }) => {
  await page.addInitScript(() => {
    const cameraFixture = { cancel: false, cancelNoCode: false, fail: false, options: undefined as unknown };
    const capacitor = ((window as unknown as { Capacitor?: Record<string, unknown> }).Capacitor ??= {});
    const headers = Array.isArray(capacitor.PluginHeaders) ? capacitor.PluginHeaders : [];
    capacitor.PluginHeaders = [...headers, { name: "Camera", methods: [{ name: "takePhoto", rtype: "promise" }] }];
    capacitor.nativePromise = (plugin: string, method: string, options: unknown) => {
      if (plugin !== "Camera" || method !== "takePhoto") return Promise.reject(new Error("unexpected-plugin-call"));
      cameraFixture.options = options;
      if (cameraFixture.cancelNoCode) return Promise.reject(new Error("User cancelled photos app"));
      if (cameraFixture.cancel) return Promise.reject({ code: "OS-PLUG-CAMR-0006", message: "cancelled" });
      if (cameraFixture.fail) return Promise.reject(new Error("camera-failed"));
      return Promise.resolve({ type: 0, saved: false, webPath: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pwAAAABJRU5ErkJggg==", metadata: { format: "png" } });
    };
    (window as unknown as { __cameraFixture?: typeof cameraFixture }).__cameraFixture = cameraFixture;
  });
  await page.goto("/");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  const send = page.getByRole("button", { name: "发送消息" });
  const drafts = page.getByRole("group", { name: "待发送图片" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pwAAAABJRU5ErkJggg==", "base64");

  await expect(page.getByRole("button", { name: "选择照片；长按拍照" })).toBeEnabled();
  await page.locator("#companion-image-library").setInputFiles({ name: "island.png", mimeType: "image/png", buffer: png });
  await expect(drafts).toBeVisible();
  await expect(drafts.getByRole("img", { name: "island.png" })).toBeVisible();
  await expect.poll(() => drafts.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
  const draftPreview = drafts.getByRole("button", { name: "查看大图：island.png" });
  await draftPreview.click();
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeFocused();
  await expect(page.getByRole("dialog", { name: "图片预览" }).getByRole("img", { name: "预览图片" })).toBeVisible();
  await page.getByRole("button", { name: "关闭大图" }).click();
  await expect(draftPreview).toBeFocused();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(drafts).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.sendCalls() ?? 0)).toBe(1);

  const pasteResult = await textarea.evaluate((element) => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pwAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
    return !element.dispatchEvent(event);
  });
  expect(pasteResult).toBe(true);
  await expect(drafts.getByRole("img", { name: "clipboard.png" })).toBeVisible();
  await expect.poll(() => drafts.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await drafts.getByRole("button", { name: "移除图片" }).click();
  await expect(drafts).toHaveCount(0);

  const picker = page.getByRole("button", { name: "选择照片；长按拍照" });
  await picker.dispatchEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 9 });
  await page.waitForTimeout(475);
  await picker.dispatchEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 9 });
  await expect(drafts.getByRole("img", { name: "camera-photo.png" })).toBeVisible();
  await expect(send).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __cameraFixture?: { options?: unknown } }).__cameraFixture?.options)).toEqual({ saveToGallery: false, includeMetadata: true });

  await page.evaluate(() => { (window as unknown as { __cameraFixture?: { cancel: boolean } }).__cameraFixture!.cancel = true; });
  await picker.dispatchEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 10 });
  await page.waitForTimeout(475);
  await picker.dispatchEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 10 });
  await expect(drafts.getByRole("img", { name: "camera-photo.png" })).toBeVisible();
  await expect(textarea).toBeEnabled();

  await page.evaluate(() => {
    const fixture = (window as unknown as { __cameraFixture?: { cancel: boolean; cancelNoCode: boolean } }).__cameraFixture!;
    fixture.cancel = false;
    fixture.cancelNoCode = true;
  });
  await picker.dispatchEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 12 });
  await page.waitForTimeout(475);
  await picker.dispatchEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 12 });
  await expect(drafts.getByRole("img", { name: "camera-photo.png" })).toBeVisible();
  await expect(page.locator(".companion-sr-only").last()).toHaveText("");
  await expect(textarea).toBeEnabled();

  await page.evaluate(() => {
    const fixture = (window as unknown as { __cameraFixture?: { cancel: boolean; cancelNoCode: boolean; fail: boolean } }).__cameraFixture!;
    fixture.cancel = false;
    fixture.cancelNoCode = false;
    fixture.fail = true;
  });
  await picker.dispatchEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 11 });
  await page.waitForTimeout(475);
  await picker.dispatchEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 11 });
  await expect(page.locator(".companion-sr-only").last()).toHaveText("拍照失败，请重试。");
  await expect(textarea).toBeEnabled();
});

test("retries one durable image in place after a transient load failure", async ({ page }) => {
  await page.goto("/");
  const image = page.locator('[data-testid="image-imagegen:demo:img"]');
  await expect(image.locator("img")).toBeVisible();
  await page.evaluate(() => window.__companionFixture?.failNextImageLoad());
  await page.evaluate(() => window.__companionFixture?.replaceImage());
  await expect(image.getByRole("alert")).toContainText("图片暂时无法显示。");
  const retry = image.getByRole("button", { name: "重试" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(image.locator("img")).toBeVisible();
  await expect(image.getByRole("alert")).toHaveCount(0);
});

test("keeps a pure-text send row and bubble connected across durable confirmation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.deferSend());
  const text = "保持这一行连续";
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();

  const row = page.locator('[data-testid^="message-submission:"]').first();
  const bubble = row.locator(".companion-bubble").first();
  const rowHandle = await row.elementHandle();
  const bubbleHandle = await bubble.elementHandle();
  expect(rowHandle).not.toBeNull();
  expect(bubbleHandle).not.toBeNull();
  await expect(bubble).toHaveText(text);

  await page.evaluate(() => window.__companionFixture?.confirmSend());
  await expect.poll(() => rowHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect.poll(() => bubbleHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect.poll(() => bubbleHandle!.evaluate((node) => node.textContent?.trim() ?? "")).toBe(text);
  await expect(page.getByText(text, { exact: true })).toHaveCount(1);
});

test("keeps the queued-send explanation tied to admission rather than the current reply state", async ({ page }) => {
  await page.goto("/");
  const queuedRow = page.getByTestId("message-queued");
  await expect(queuedRow.getByText("等当前回复结束后发送", { exact: true })).toBeVisible();

  await page.evaluate(() => window.__companionFixture?.setRunning(false));
  await expect(queuedRow.getByText("等当前回复结束后发送", { exact: true })).toBeVisible();
});

test("renders a deferred text-and-two-image send immediately and replaces it atomically", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.deferSend());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pwAAAABJRU5ErkJggg==", "base64");
  await page.locator("#companion-image-library").setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("两张照片");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="image-submission:"]')).toHaveCount(2);
  await expect(page.locator('[data-testid^="image-submission:"] .companion-media img')).toHaveCount(2);
  const submission = page.locator('[data-testid^="message-submission:"]').filter({ hasText: "两张照片" });
  const submissionHandle = await submission.elementHandle();
  expect(submissionHandle).not.toBeNull();
  await expect(submission.locator(".message-avatar")).toHaveCount(1);
  await expect(submission.locator(".companion-image-entry")).toHaveCount(2);
  await expect.poll(() => submission.locator(".companion-image-entry").first().evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  })).toEqual({ width: 64, height: 64 });
  await expect.poll(() => submission.locator(".companion-message-stack").evaluate((node) => [...node.children].map((child) => child.matches(".companion-image-group") ? "images" : child.matches(".companion-bubble") ? "text" : "other"))).toEqual(["images", "text"]);
  await expect(textarea).toBeEnabled();

  await textarea.fill("连续发送");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.sendCalls() ?? 0)).toBe(2);

  await page.evaluate(() => window.__companionFixture?.confirmSend());
  await expect(page.locator('[data-testid^="message-"]').filter({ hasText: "两张照片" })).toHaveCount(1);
  await expect.poll(() => submissionHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(submission.locator(".companion-image-entry")).toHaveCount(2);
  await expect(page.getByText("两张照片", { exact: true })).toHaveCount(1);
  await page.evaluate(() => window.__companionFixture?.confirmSend());
  await expect(page.locator('[data-testid^="message-"]').filter({ hasText: "两张照片" })).toHaveCount(1);
  await expect.poll(() => submissionHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(submission.locator(".companion-image-entry")).toHaveCount(2);
  await expect(page.locator('[data-testid^="image-submission:"]')).toHaveCount(0);
  await expect(page.getByText("两张照片", { exact: true })).toHaveCount(1);
  await expect(page.getByText("连续发送", { exact: true })).toHaveCount(1);
  await expect(textarea).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThanOrEqual(2);
});

test("keeps a submission lightbox preview alive until the dialog closes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.deferSend());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pwAAAABJRU5ErkJggg==", "base64");
  await page.locator("#companion-image-library").setInputFiles({ name: "lightbox.png", mimeType: "image/png", buffer: png });
  await page.getByRole("textbox", { name: "写消息" }).fill("灯下照片");
  await page.getByRole("button", { name: "发送消息" }).click();
  const submissionImage = page.locator('[data-testid^="image-submission:"]').first();
  await expect(submissionImage).toBeVisible();
  await submissionImage.getByRole("button", { name: /查看大图/ }).click();
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeVisible();
  const revokedBeforeConfirmation = await page.evaluate(() => window.__companionFixture?.revoked() ?? 0);

  await page.evaluate(() => window.__companionFixture?.confirmSend());
  await expect(page.locator('[data-testid^="image-submission:"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "关闭大图" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBe(revokedBeforeConfirmation);

  await page.getByRole("button", { name: "关闭大图" }).click();
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThan(revokedBeforeConfirmation);
});

test("restores an identified rejection through the Session retirement callback", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.deferSend());
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("投影失败");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(1);
  await page.evaluate(() => window.__companionFixture?.sendError());
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(0);
  await expect(page.locator(".companion-timeline .companion-recovery").filter({ hasText: "这条消息没发出去，可以再试一次。" })).toHaveCount(1);
  await expect(page.locator("body")).toContainText("这条消息没发出去，可以再试一次。");
  await expect(textarea).toHaveValue("投影失败");
});

test("keeps an existing internal send error visible when a submission begins", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.seedInternalPromptError());
  await expect(page.locator(".companion-timeline .companion-recovery").filter({ hasText: "这条消息没发出去，可以再试一次。" })).toHaveCount(1);

  await page.evaluate(() => window.__companionFixture?.deferSend());
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("新消息");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(1);
  await expect(page.locator(".companion-timeline .companion-recovery").filter({ hasText: "这条消息没发出去，可以再试一次。" })).toHaveCount(1);

  await page.evaluate(() => window.__companionFixture?.confirmSend());
  await expect(page.getByText("新消息", { exact: true })).toHaveCount(1);
  await expect(page.locator(".companion-timeline .companion-recovery").filter({ hasText: "这条消息没发出去，可以再试一次。" })).toHaveCount(1);
});

test("restores identified failed submissions and clears old-session sends", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.deferSend());
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("请恢复我");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(1);
  await page.evaluate(() => window.__companionFixture?.rejectSend());
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(0);
  await expect(textarea).toHaveValue("请恢复我");
  await expect(textarea).toBeEnabled();
  await expect(page.getByRole("button", { name: "重试消息" })).toHaveCount(0);

  await textarea.fill("不要跨对话");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(1);
  await page.evaluate(() => window.__companionFixture?.switchSession("weekend-plan"));
  await expect(page.locator('[data-testid^="message-submission:"]')).toHaveCount(0);
  await expect(textarea).toHaveValue("");
  await page.evaluate(() => window.__companionFixture?.rejectSend());
  await expect(textarea).toHaveValue("");
});

test("offers and accepts the /compact command completion", async ({ page }) => {
  await page.goto("/");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("/co");
  const suggestions = page.getByRole("listbox", { name: "命令补全" });
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("整理记忆，让下一段对话自然接续");
  await textarea.press("Tab");
  await expect(textarea).toHaveValue("/compact");

  await textarea.fill("/");
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("/compact");
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.sendCalls() ?? 0)).toBe(0);

  await textarea.fill("/");
  await page.locator("#companion-command-compact").click();
  await expect(textarea).toHaveValue("/compact");
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.sendCalls() ?? 0)).toBe(0);
});

test("keeps the capacity cue optional and makes its explanation keyboard reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".companion-context-meter")).toHaveCount(0);
  await page.evaluate(() => window.__companionFixture?.setCapacity({ pressureTokens: 8_000, projectedTokens: 18_432, contextWindow: 32_000 }));
  const meter = page.getByRole("button", { name: "对话容量：58%" });
  await expect(meter).toBeVisible();
  await meter.click();
  const popover = page.getByRole("dialog", { name: "对话容量" });
  await expect(popover).toContainText("58%");
  await expect(popover).toContainText("18k / 32k");
  await expect(popover).not.toContainText("连续性摘要");
  await expect.poll(() => popover.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 20);
    return hit !== null && node.contains(hit);
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(meter).toBeFocused();
  await meter.click();
  await page.locator(".companion-header").click();
  await expect(popover).toHaveCount(0);
});

test("surfaces compaction lifecycle without exposing the private checkpoint", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?theme=dark");
  await page.evaluate(() => window.__companionFixture?.setCapacity({ projectedTokens: 20_000, contextWindow: 32_000 }));
  await page.evaluate(() => window.__companionFixture?.startCompaction("active"));
  await expect(page.getByTestId("companion-continuity-status")).toHaveText("正在整理记忆…");
  await expect(page.locator(".companion-context-meter")).toHaveAttribute("data-state", "active");
  await page.evaluate(() => window.__companionFixture?.finishCompaction("active"));
  await expect(page.getByTestId("companion-continuity-status")).toHaveText("整理记忆已完成");
  await expect(page.getByTestId("continuity-record-active")).toHaveText("已整理对话");
  await expect(page.getByTestId("continuity-record-active")).not.toHaveAttribute("role", "status");
  await expect(page.getByTestId("continuity-record-active")).toHaveAttribute("aria-live", "off");
  await expect(page.getByTestId("companion-continuity-status")).toHaveAttribute("role", "status");
  await expect(page.locator(".companion-continuity-record")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("private");
  await page.clock.fastForward(8_001);
  await expect(page.getByTestId("companion-continuity-status")).toHaveCount(0);

  await page.evaluate(() => window.__companionFixture?.startCompaction("failed"));
  await page.evaluate(() => window.__companionFixture?.failCompaction("failed"));
  await expect(page.getByTestId("companion-continuity-status")).toHaveText("本次整理未完成，仍可继续对话");
  await expect(page.locator(".companion-continuity-record")).toHaveCount(1);
  await page.clock.fastForward(8_001);
  await expect(page.getByTestId("companion-continuity-status")).toHaveCount(0);
});

test("keeps active continuity still and semantic across both authored themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.setCapacity({ projectedTokens: 24_000, contextWindow: 32_000 }));
  await page.evaluate(() => window.__companionFixture?.startCompaction("theme"));
  const meter = page.locator(".companion-context-meter");
  await expect(meter).toHaveAttribute("data-state", "active");
  await expect.poll(() => meter.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  const lightStroke = await meter.locator(".companion-context-meter-value").evaluate((node) => getComputedStyle(node).stroke);
  await page.evaluate(() => window.__companionFixture?.setTheme("dark"));
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "night-voyage");
  await expect.poll(() => meter.locator(".companion-context-meter-value").evaluate((node) => getComputedStyle(node).stroke)).not.toBe(lightStroke);
  const darkStroke = await meter.locator(".companion-context-meter-value").evaluate((node) => getComputedStyle(node).stroke);
  expect(darkStroke).not.toBe(lightStroke);
  await expect(page.getByTestId("companion-continuity-status")).toHaveText("正在整理记忆…");
});

test("uses image progress instead of a duplicate typing indicator, then resumes typing", async ({ page }) => {
  await page.goto("/");
  const indicator = page.getByTestId("companion-typing-indicator");
  const drawing = page.getByText("正在画一张图…", { exact: true });
  await expect(drawing).toBeVisible();
  await expect(drawing).toHaveAttribute("role", "status");
  await expect(indicator).toHaveCount(0);
  await page.evaluate(() => window.__companionFixture?.finishImageGeneration());
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAccessibleName("小灯正在输入");
  await page.evaluate(() => window.__companionFixture?.setRunning(false));
  await expect(indicator).toHaveCount(0);
});

test("warms up a long typing wait with rotating non-repeating companion copy", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.evaluate(() => window.__companionFixture?.finishImageGeneration());
  const indicator = page.getByTestId("companion-typing-indicator");
  await expect(indicator.locator(".companion-waiting-copy")).toHaveCount(0);
  await page.clock.fastForward(12_000);
  const copy = indicator.locator(".companion-waiting-copy");
  await expect(copy).toBeVisible();
  const first = await copy.textContent();
  await page.clock.fastForward(9_000);
  await expect(copy).not.toHaveText(first ?? "");
  await page.evaluate(() => window.__companionFixture?.setRunning(false));
  await expect(indicator).toHaveCount(0);
});

test("uses the composer action to stop a running reply without hiding queued messages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("还有一件小事想告诉你")).toBeVisible();
  const stop = page.getByRole("button", { name: "停止当前回复" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.stopCalls() ?? 0)).toBe(1);

  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("再补一句");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect(stop).toHaveCount(0);
});

test("Svelte 5 bridge applies live identity and theme changes without remounting", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "sticker-messenger");
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.rootIsStable() ?? false)).toBe(true);
  await page.evaluate(() => window.__companionFixture?.setIdentity({ companionName: "新灯", moodLabel: "愉快" }));
  await expect(page.locator(".companion-name")).toHaveText("新灯");
  await expect(page.locator(".companion-presence")).toContainText("愉快");
  const statusClasses = { ready: "cmp-status-success", working: "cmp-status-warning", reconnecting: "cmp-status-error" } as const;
  for (const [status, className] of Object.entries(statusClasses)) {
    await page.evaluate((next) => window.__companionFixture?.setStatus(next as "ready" | "working" | "reconnecting"), status);
    await expect(page.locator(".cmp-status")).toHaveClass(new RegExp(className));
    await expect.poll(() => page.locator(".cmp-status").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator(".companion-presence")).toContainText(status === "ready" ? "在线" : status === "working" ? "正在输入…" : "连接中…");
  }
  await page.evaluate(() => window.__companionFixture?.setStatus("working"));
  const lightStatus = await page.locator(".cmp-status").evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.evaluate(() => window.__companionFixture?.setTheme("dark"));
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "night-voyage");
  await expect.poll(() => page.locator(".cmp-status").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(lightStatus);
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.rootIsStable() ?? false)).toBe(true);
  await page.evaluate(() => { window.__companionFixture?.dispose(); window.__companionFixture?.dispose(); });
  await expect.poll(() => page.getByTestId("companion-root").count()).toBe(0);
  expect(await page.evaluate(() => window.__companionFixture?.unmountCalls() ?? 0)).toBe(1);
});

test("drawer uses one checkbox state across desktop and Pixel-sized layouts", async ({ page }, testInfo) => {
  await page.goto("/");
  const toggle = page.locator("#companion-session-drawer");
  const headerToggle = page.getByRole("button", { name: /对话列表/ }).first();
  if (testInfo.project.name === "pixel-7a") {
    await expect(toggle).not.toBeChecked();
    await headerToggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(() => page.locator(".companion-sidebar-overlay").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await page.locator(".companion-sidebar-overlay").click({ position: { x: 390, y: 120 } });
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("dsh-companion:desktop-sidebar-open"))).toBeNull();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => headerToggle.evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-tap-highlight-color"))).toBe("rgba(0, 0, 0, 0)");
  } else {
    await expect(toggle).toBeChecked();
    await headerToggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("dsh-companion:desktop-sidebar-open"))).toBe("false");
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await headerToggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("dsh-companion:desktop-sidebar-open"))).toBe("true");
    await page.reload();
    await expect(toggle).toBeChecked();
  }
});

test("chat shell has rendered Markdown, viewport scrolling, sessions, rounded focus, and an anchored relationship card", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop geometry is the tight structural baseline");
  await page.goto("/?theme=dark");
  await page.evaluate(() => document.fonts.ready);

  const markdown = page.getByTestId("message-history-1");
  await expect(markdown.locator("strong")).toHaveText("窗外的风");
  await expect(markdown.locator("li")).toHaveCount(2);

  await expect(page.getByRole("button", { name: "收起对话列表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换到对话：今晚的小星光" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "切换到对话：周末想去哪里" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#dsh-companion")!;
    const app = document.querySelector<HTMLElement>(".companion-app")!;
    const composeRow = document.querySelector<HTMLElement>(".companion-compose-row")!;
    const timeline = document.querySelector<HTMLElement>(".companion-timeline")!;
    const appRect = app.getBoundingClientRect();
    const appStyle = getComputedStyle(app);
    return {
      rootHeight: root.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      appRect: { top: appRect.top, left: appRect.left, width: appRect.width, height: appRect.height },
      appBorder: appStyle.borderTopWidth,
      appRadius: Number.parseFloat(appStyle.borderRadius),
      appShadow: appStyle.boxShadow,
      composerBottomInset: window.innerHeight - composeRow.getBoundingClientRect().bottom,
      timelineClient: timeline.clientHeight,
      timelineScroll: timeline.scrollHeight,
      overflowY: getComputedStyle(timeline).overflowY,
    };
  });
  expect(Math.abs(geometry.rootHeight - geometry.viewportHeight)).toBeLessThanOrEqual(1);
  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.appRect).toEqual({ top: 0, left: 0, width: geometry.viewportWidth, height: geometry.viewportHeight });
  expect(geometry.appBorder).toBe("0px");
  expect(geometry.appRadius).toBe(0);
  expect(geometry.appShadow).toBe("none");
  expect(geometry.composerBottomInset).toBeGreaterThanOrEqual(20);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.timelineScroll).toBeGreaterThan(geometry.timelineClient);
  await page.locator(".companion-timeline").evaluate((node) => { node.scrollTop = 120; });
  await expect.poll(() => page.locator(".companion-timeline").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.focus();
  const focusStyle = await textarea.evaluate((node) => {
    const style = getComputedStyle(node);
    const shellStyle = getComputedStyle(node.closest(".companion-compose-row")!);
    return {
      outlineColor: style.outlineColor,
      innerRadius: Number.parseFloat(style.borderRadius),
      shellRadius: Number.parseFloat(shellStyle.borderRadius),
    };
  });
  expect(focusStyle.outlineColor).not.toBe("rgb(255, 255, 255)");
  expect(focusStyle.innerRadius).toBe(0);
  expect(focusStyle.shellRadius).toBeGreaterThanOrEqual(20);

  const bubbles = await page.evaluate(() => {
    const measure = (id: string) => {
      const row = document.querySelector<HTMLElement>(`[data-testid="message-${id}"]`)!;
      const avatar = row.querySelector<HTMLElement>(".message-avatar")!;
      const bubble = row.querySelector<HTMLElement>(".companion-bubble")!;
      const style = getComputedStyle(bubble);
      const tail = getComputedStyle(bubble, "::before");
      return {
        avatarTop: avatar.getBoundingClientRect().top,
        bubbleTop: bubble.getBoundingClientRect().top,
        avatarWidth: avatar.getBoundingClientRect().width,
        avatarHeight: avatar.getBoundingClientRect().height,
        corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
        tailDisplay: tail.display,
      };
    };
    return {
      incoming: measure("history-1"),
      outgoing: measure("history-2"),
    };
  });
  expect(Math.abs(bubbles.incoming.avatarTop - bubbles.incoming.bubbleTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(bubbles.outgoing.avatarTop - bubbles.outgoing.bubbleTop)).toBeLessThanOrEqual(1);
  expect(bubbles.incoming.avatarWidth).toBe(40);
  expect(bubbles.incoming.avatarHeight).toBe(40);
  expect(bubbles.outgoing.avatarWidth).toBe(40);
  expect(bubbles.outgoing.avatarHeight).toBe(40);
  expect(bubbles.incoming.corners).toEqual(["22px", "22px", "22px", "22px"]);
  expect(bubbles.outgoing.corners).toEqual(["22px", "22px", "22px", "22px"]);
  expect(bubbles.incoming.tailDisplay).toBe("none");
  expect(bubbles.outgoing.tailDisplay).toBe("none");

  const avatar = page.getByRole("button", { name: "查看 Companion 关系资料" });
  const avatarBox = await avatar.boundingBox();
  await avatar.click();
  const detail = page.getByRole("dialog", { name: "小灯的关系资料" });
  await expect(detail).toBeVisible();
  const detailBox = await detail.boundingBox();
  expect(avatarBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(detailBox!.y).toBeLessThan(avatarBox!.y + 180);
  expect(detailBox!.x).toBeLessThan(avatarBox!.x + 120);
});

test("Markdown renders GFM safely with aligned list levels", async ({ page }) => {
  await page.goto("/?markdown=edge");

  const gfm = page.getByTestId("message-markdown-gfm");
  await expect(gfm.getByRole("heading", { name: "今天的小清单" })).toBeVisible();
  await expect(gfm.getByText("写完信")).toBeVisible();
  const table = gfm.locator("table");
  await expect(table).toContainText("此刻");
  await expect(gfm.locator(".markdown img")).toHaveCount(0);
  await expect(gfm.locator("ul").first()).toHaveCSS("list-style-type", "disc");
  await expect(gfm.locator("ul ul")).toHaveCSS("list-style-type", "circle");
  await expect(gfm.locator("ul ul")).toHaveCSS("list-style-position", "outside");
  await expect(table).toHaveCSS("overflow-x", "auto");
  await expect.poll(() => page.locator(".companion-timeline").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
});

test("Markdown keeps spaced ordered items as siblings", async ({ page }) => {
  await page.goto("/?markdown=ordered");

  const list = page.getByTestId("message-markdown-ordered").locator("ol");
  await expect(list.locator(":scope > li")).toHaveCount(3);
  await expect(list.locator("ol")).toHaveCount(0);
});

test("initial chat presentation is already at the bottom with circular avatars and a stable profile popover", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __companionScrollSamples: Array<{ distanceFromBottom: number; visible: boolean }> };
    state.__companionScrollSamples = [];
    const sample = () => {
      const timeline = document.querySelector<HTMLElement>(".companion-timeline");
      if (timeline) state.__companionScrollSamples.push({
        distanceFromBottom: Math.round(timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop),
        visible: getComputedStyle(timeline).visibility === "visible",
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/?theme=dark");
  await page.waitForTimeout(500);

  const scrollSamples = await page.evaluate(() => (window as unknown as { __companionScrollSamples: Array<{ distanceFromBottom: number; visible: boolean }> }).__companionScrollSamples);
  const visibleSamples = scrollSamples.filter((sample) => sample.visible);
  expect(visibleSamples.length).toBeGreaterThan(0);
  expect(Math.abs(visibleSamples[0]!.distanceFromBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(visibleSamples.at(-1)!.distanceFromBottom)).toBeLessThanOrEqual(1);

  for (const avatar of await page.locator(".companion-avatar-crop").all()) {
    const geometry = await avatar.evaluate((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return { radius: Number.parseFloat(style.borderRadius), size: Math.min(bounds.width, bounds.height), overflow: style.overflow };
    });
    expect(geometry.radius).toBeGreaterThanOrEqual(geometry.size / 2 - 1);
    expect(geometry.overflow).toBe("hidden");
  }

  const fullDsh = page.getByRole("link", { name: "打开完整 DSH" });
  await expect(fullDsh.locator("svg")).toHaveCount(1);

  await page.getByRole("button", { name: "查看 Companion 关系资料" }).click();
  const profile = page.getByRole("dialog", { name: "小灯的关系资料" });
  await page.waitForTimeout(600);
  await expect(profile).toBeVisible();
  await page.locator(".companion-header-copy").click();
  await expect(profile).toHaveCount(0);
});

test("captures readable Sticker Messenger and Night Voyage references", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  for (const theme of ["light", "dark"] as const) {
    await page.goto(theme === "dark" ? "/?theme=dark" : "/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("textbox", { name: "写消息" })).toBeVisible();
    await page.screenshot({ path: `fixture/screenshots/${theme === "light" ? "sticker-messenger" : "night-voyage"}-${device}.png`, fullPage: true });
  }
});

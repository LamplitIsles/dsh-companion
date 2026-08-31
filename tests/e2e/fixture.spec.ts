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
  await page.evaluate(() => window.__companionFixture?.replaceImage());
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__companionFixture?.removeImage());
  await expect.poll(() => page.evaluate(() => window.__companionFixture?.revoked() ?? 0)).toBeGreaterThan(1);
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

test("offers and accepts the /compact command completion", async ({ page }) => {
  await page.goto("/");
  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.fill("/co");
  const suggestions = page.getByRole("listbox", { name: "命令补全" });
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText("压缩上下文，让下一段对话自然接续");
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
  await page.evaluate(() => window.__companionFixture?.finishCompaction("active", 18_432));
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
  await page.evaluate(() => window.__companionFixture?.setIdentity({ companionName: "新灯", moodLabel: "明朗" }));
  await expect(page.locator(".companion-name")).toHaveText("新灯");
  await expect(page.locator(".companion-presence")).toContainText("明朗");
  const statusClasses = { ready: "cmp-status-success", working: "cmp-status-warning", reconnecting: "cmp-status-error" } as const;
  for (const [status, className] of Object.entries(statusClasses)) {
    await page.evaluate((next) => window.__companionFixture?.setStatus(next as "ready" | "working" | "reconnecting"), status);
    await expect(page.locator(".cmp-status")).toHaveClass(new RegExp(className));
    await expect.poll(() => page.locator(".cmp-status").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
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
    const timeline = document.querySelector<HTMLElement>(".companion-timeline")!;
    return {
      rootHeight: root.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      timelineClient: timeline.clientHeight,
      timelineScroll: timeline.scrollHeight,
      overflowY: getComputedStyle(timeline).overflowY,
    };
  });
  expect(Math.abs(geometry.rootHeight - geometry.viewportHeight)).toBeLessThanOrEqual(1);
  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.timelineScroll).toBeGreaterThan(geometry.timelineClient);
  await page.locator(".companion-timeline").evaluate((node) => { node.scrollTop = 120; });
  await expect.poll(() => page.locator(".companion-timeline").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  const textarea = page.getByRole("textbox", { name: "写消息" });
  await textarea.focus();
  const focusStyle = await textarea.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineColor: style.outlineColor, radius: Number.parseFloat(style.borderRadius) };
  });
  expect(focusStyle.outlineColor).not.toBe("rgb(255, 255, 255)");
  expect(focusStyle.radius).toBeGreaterThanOrEqual(20);

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

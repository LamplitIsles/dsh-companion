import { expect, test } from "@playwright/test";

test("fixture has complete media states, accessible overlays, and no duplicate image URLs", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId("companion-root")).toHaveAttribute("data-theme", "sticker-messenger");
  await expect(page.locator(".companion-header")).not.toContainText("把平凡日子折成星星");
  await expect(page.getByRole("button", { name: /今晚的海/ })).toBeVisible();
  await expect(page.getByTestId("voice-voice:demo:1:abc").getByText("文字稿")).toBeVisible();
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
    await page.locator(".companion-sidebar-overlay").click({ position: { x: 390, y: 120 } });
    await expect(toggle).not.toBeChecked();
  } else {
    await expect(toggle).toBeChecked();
    await headerToggle.click();
    await expect(toggle).not.toBeChecked();
    await headerToggle.click();
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

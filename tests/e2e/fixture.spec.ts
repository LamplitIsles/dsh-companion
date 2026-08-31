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
  await expect(page.getByRole("button", { name: "关闭关系资料", exact: true })).toBeFocused();
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
  await page.goBack();
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

test("captures readable Sticker Messenger and Night Voyage references", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  for (const theme of ["light", "dark"] as const) {
    await page.goto(theme === "dark" ? "/?theme=dark" : "/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("textbox", { name: "写消息" })).toBeVisible();
    await page.screenshot({ path: `fixture/screenshots/${theme === "light" ? "sticker-messenger" : "night-voyage"}-${device}.png`, fullPage: true });
  }
});

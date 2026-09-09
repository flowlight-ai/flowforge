/**
 * E2E 冒烟：群聊页渲染（T8.2 前端/ T8.10 群聊收发 DOM 证明）
 *
 * 无后端（CI 未起 8000）时仅验证群聊壳层渲染；若后端可达则进一步做输入发送的乐观断言。
 * 选择器对齐 CouncilContent/CouncilChatPanel 的 data-council 约定与输入区 placeholder。
 */
import { expect, test } from "@playwright/test";

test.describe("群聊页 /council", () => {
  test("渲染群聊壳层（布局/标题输入/会话/主区/消息输入/发送）", async ({ page, baseURL }) => {
    await page.goto("/council", { waitUntil: "domcontentloaded" });

    // 群聊布局容器
    await expect(page.locator('[data-council="layout"]')).toBeVisible();

    // 讨论标题输入（aria-label 稳定锚点）
    await expect(page.getByRole("textbox", { name: "讨论标题" })).toBeVisible();

    // 会话列
    await expect(page.locator('[data-council="thread-list"]')).toBeAttached();

    // 主对话区
    await expect(page.locator('[data-council="main"]')).toBeAttached();

    // 消息输入（占位符稳定锚点）
    const composer = page.getByPlaceholder("输入消息... 使用 @智能体名 指定发言对象，/ 调出命令菜单");
    await expect(composer).toBeVisible();

    // 发送按钮
    await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  });

  test("可输入消息并触发发送（乐观 UI，不依赖后端响应）", async ({ page }) => {
    await page.goto("/council", { waitUntil: "domcontentloaded" });

    const composer = page.getByPlaceholder("输入消息... 使用 @智能体名 指定发言对象，/ 调出命令菜单");
    await composer.click();
    await composer.fill("冒烟：Playwright 端到端验证消息输入");

    const sendBtn = page.getByRole("button", { name: "发送" });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // 输入值被消费（发送后清空为乐观成功信号；不等待后端回包）
    await expect(composer).toHaveValue("", { timeout: 5_000 });
  });
});
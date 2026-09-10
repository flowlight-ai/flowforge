/**
 * E2E 冒烟：灵智档案页（可进化智能体 Forgekin）渲染（T8.3 前端/T8.10 档案页 DOM 证明）
 *
 * 无后端（CI 未起 8000）时仅验证档案管理壳层与静态花名册兜底渲染、详情页若干 Tab；
 * 选择器对齐 EvolvableAgentTab/ForgekinCard/admin/agents 详情页的 data-agents 与 data-forgekin 约定。
 */
import { expect, test } from "@playwright/test";

test.describe("灵智档案 /admin/agents", () => {
  test("渲染智能体管理壳层（双 Tab + 可进化智能体花名册网格）", async ({ page }) => {
    await page.goto("/admin/agents", { waitUntil: "domcontentloaded" });

    // 页面容器 + 标题
    await expect(page.locator('[data-admin="agents"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "智能体管理" })).toBeVisible();

    // 默认可进化智能体 Tab 激活，且花名册网格渲染
    await expect(page.locator('[data-agents-active-tab="evolvable"]')).toBeAttached();
    await expect(page.locator('[data-forgekin-grid="root"]')).toBeAttached();

    // 静态兜底花名册首卡可见（无需后端）
    await expect(page.locator('[data-forgekin-card="wenxin"]')).toBeAttached();
    await expect(page.locator('[data-forgekin-card="sherlock"]')).toBeAttached();
  });

  test("Forgekin 卡片可进入详情页（列表 → 详情 路由导航）", async ({ page }) => {
    await page.goto("/admin/agents", { waitUntil: "domcontentloaded" });

    const card = page.locator('[data-forgekin-card="wenxin"]');
    await expect(card).toBeAttached();
    await card.click();

    await page.waitForURL(/\/admin\/agents\/wenxin$/, { timeout: 8_000 });

    // 详情根 + 头部 + Tab 栏
    await expect(page.locator('[data-forgekin-detail="root"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-forgekin-detail-header="true"]')).toBeVisible();
    await expect(page.locator('[data-forgekin-detail-tabbar="true"]')).toBeVisible();
  });

  test("详情页 Tab 切换渲染各面板（身份/能力画像/经验记忆/进化阶/觉醒阶）", async ({ page }) => {
    await page.goto("/admin/agents/wenxin", { waitUntil: "domcontentloaded" });

    // 默认身份 Tab
    await expect(page.locator('[data-forgekin-detail="root"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-forgekin-tab-content="identity"]')).toBeVisible();

    // 能力画像 Tab
    await page.locator('[data-forgekin-detail-tab="capability"]').click();
    await expect(page.locator('[data-forgekin-tab-content="capability"]')).toBeVisible();

    // 经验记忆 Tab
    await page.locator('[data-forgekin-detail-tab="echo-store"]').click();
    await expect(page.locator('[data-forgekin-tab-content="echo-store"]')).toBeVisible();

    // 进化阶 Tab
    await page.locator('[data-forgekin-detail-tab="evolution"]').click();
    await expect(page.locator('[data-forgekin-tab-content="evolution"]')).toBeVisible();

    // 觉醒阶 Tab
    await page.locator('[data-forgekin-detail-tab="awakening"]').click();
    await expect(page.locator('[data-forgekin-tab-content="awakening"]')).toBeVisible();
  });
});
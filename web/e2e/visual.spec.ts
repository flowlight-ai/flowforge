/**
 * E2E 视觉回归（batch 58-59）— 默认关闭
 *
 * 仅在 FF_E2E_VISUAL=1 时运行：对关键页做整屏快照比对（golden snapshot）。
 * 首次需生成基线：`pnpm --filter @flowforge/web-app test:e2e:visual -- --update-snapshots`，
 * 基线存 web/e2e/__snapshots__/，resolved bin/snapshots。CI 主路径默认关闭，
 * 避免无基线导致误红。
 *
 * 视觉断言参考 toHaveScreenshot 契约：跨平台需固定浏览器与 viewport（配置已钉 chromium）。
 */
import { expect, test } from "@playwright/test";

import { SMOKE_ROUTES } from "./routes";

// 视觉回归需显式开启；否则整体跳过以保持 functional CI 绿
test.skip(!process.env.FF_E2E_VISUAL, "视觉回归需 FF_E2E_VISUAL=1（首先生成基线）");

test.describe("视觉回归（FF_E2E_VISUAL）", () => {
  for (const route of SMOKE_ROUTES) {
    test(`screenshot ${route.path}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.locator("body").waitFor({ state: "visible" });
      // 稳定尾巴：等待 300ms 后再截图，规避懒动画/骨架屏闪烁
      await page.waitForTimeout(300);
      await expect(page.locator("body")).toHaveScreenshot(`${route.path.replaceAll("/", "_")}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
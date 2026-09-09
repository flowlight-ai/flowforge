/**
 * E2E 冒烟：全页面路由可达（T8.10）
 *
 * 对 SMOKE_ROUTES 逐一验证：
 * - HTTP 非 4xx/5xx（Next.js 404/500 视为不可达）；
 * - 渲染结果不落入 ROUTE_ERROR_FRAGS（兜底识别 Next 404/客户端错误）；
 * - 若该路由声明 expectedFrag，则断言稳定后出现对应可见文本（证明页面真实渲染而非空白壳）。
 *
 * 演进思路参考旧版 tests/test_t7_t8_e2e.py 与 e2e/libs/t8_helpers：
 * 先断言路由可达，再断言 DOM 呈现（T3 必须有具体断言）。
 */
import { expect, test } from "@playwright/test";

import { ROUTE_ERROR_FRAGS, SMOKE_ROUTES } from "./routes";

test.describe("全页面路由可达（T8.10 冒烟）", () => {
  for (const route of SMOKE_ROUTES) {
    test(`GET ${route.path}`, async ({ page }) => {
      const resp = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      // 路由可达：HTTP 非错误态
      expect(resp?.status(), `${route.path} 应返回 2xx/3xx`).toBeLessThan(400);

      // 渲染稳定性：等待首个可交互内容，规避 CSR 空白期
      await page.locator("body").waitFor({ state: "attached" });

      // 兜底识别 Next.js 404 / 客户端异常 / 500 页
      const bodyText = await page.locator("body").innerText({ timeout: 8_000 }).catch(() => "");
      for (const errFrag of ROUTE_ERROR_FRAGS) {
        expect(bodyText, `${route.path} 不应落入错误态 ${errFrag}`).not.toContain(errFrag);
      }

      // 若声明了稳定片段，断言其可见（T3 有具体断言）
      if (route.expectedFrag) {
        await expect(
          page.getByText(route.expectedFrag, { exact: false }).first(),
          `${route.path} 应渲染稳定内容 ${route.expectedFrag}`,
        ).toBeVisible({ timeout: 8_000 });
      }
    });
  }
});
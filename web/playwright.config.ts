/**
 * Playwright E2E 配置 — phase 8 web 前端（batch 58-59 端到端 + 视觉回归）
 *
 * 设计要点（对齐 ff_ 工程规范）：
 * - testDir 收敛到 web/e2e，仅承载浏览器级冒烟（全路由可达 + 群聊 + 可选视觉回归）。
 * - webServer 自动拉起 `next start`（要求先 `next build`，CI 通过 web-ci.yml 的 build 步骤保证）。
 *   本地可用 `--reuseExistingServer` 直接对接已在跑的 dev server。
 * - 项目级仅注册 chromium，控制 CI 资源开销；浏览器产物随 web 包 devDeps @playwright/test 声明。
 *
 * 环境开关：
 * - FF_E2E_VISUAL=1  启用视觉回归 spec（生成/比对 golden snapshot，默认关闭避免无基线失败）。
 *
 * 参考：T8.10 Playwright 冒烟（沿用 _browsertest 思路，参考旧版 tests/e2e + t8_helpers 的
 * domcontentloaded 等待与超时经验）。
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.FLOWFORGE_WEB_PORT ?? 5174);
const BASE_URL = process.env.CI
  ? `http://127.0.0.1:${PORT}`
  : process.env.FLOWFORGE_PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  // 视觉回归默认关闭（见上文），functional 冒烟并行以提速
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: isCi ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // 参考旧版 t8_helpers：domcontentloaded 等待，避免开发态 HMR 拖慢
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: isCi
    ? {
        command: "next start --port 5174",
        url: `${BASE_URL}`,
        reuseExistingServer: !isCi,
        timeout: 120_000,
        cwd: process.cwd(),
      }
    : {
        command: "next start --port 5174",
        url: `${BASE_URL}`,
        reuseExistingServer: true,
        timeout: 120_000,
        cwd: process.cwd(),
      },
});
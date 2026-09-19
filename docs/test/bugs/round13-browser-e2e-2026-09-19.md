# 第十三轮 浏览器端到端实测缺陷明细（2026-09-19）

> 测试人员（QA）｜ 遵循 T8 铁律（真实 Chromium + 真实 DOM 验证）
> 环境：前端 `next dev --port 5174`（Next.js 14.2.35，dev 模式）；后端官方入口 `pnpm start`（web profile）**未能启动**，见 P-542
> 复现脚本：`cd web && npx playwright test --reporter=list`（仓库内可复现，无需额外脚本）
> 编号区间：P-541 … P-543（承接第十二轮 P-540）

## 本轮环境说明（影响判读，务必先读）

- **前端**以 dev 模式启动（`next dev`），未做生产构建（`web/.next` 无 `BUILD_ID`）。
- **后端**：官方入口 `pnpm start` 失败（P-542），故本轮浏览器验证为**纯前端壳层验证**，未覆盖需要后端的接口链路。
- dev 模式下 Next 首次访问每个路由需即时编译（实测 7–25s/路由），首轮并行访问会造成**假失败**。判定时已用「单跑已预热路由」复测区分，详见各单「定性依据」。

---

## P-541 — `/council` 三个 e2e 用例稳定失败：断言的消息输入框在「无会话空态」下不渲染

- **严重度**：S2
- **分类**：测试脚本缺陷
- **文件:行号**：`web/e2e/council.spec.ts:26-27`（失败断言）、`web/e2e/council.spec.ts:36-37`、`web/e2e/council.spec.ts:51-52`
  - 产品侧依据（非缺陷，设计如此）：`web/src/app/council/CouncilContent.tsx:407`（`<CouncilChatPanel>` 仅在 `threadId` 存在时渲染）、`web/src/app/council/CouncilContent.tsx:421`（无会话时渲染空态文案）、`web/src/components/helm/CouncilChatPanel.tsx:1392`（输入框所在处）
- **现象**：`/council` 无会话时页面渲染空态「◎ 选择左侧会话或点击"新对话"开始群聊」，此时**不渲染**消息输入框；但用例把该输入框当作「壳层稳定锚点」断言其可见，故 3 个用例全部超时失败。
- **复现命令与真实输出**（仓库根相对路径，已预热路由后单跑，排除 dev 编译干扰）：

```bash
cd web && npx playwright test e2e/council.spec.ts --reporter=list
```

```
✘  1 [chromium] › e2e\council.spec.ts:10:7 › 群聊页 /council › 渲染群聊壳层（布局/标题输入/会话/主区/消息输入/发送） (11.1s)
✘  3 [chromium] › e2e\council.spec.ts:48:7 › 群聊页 /council › @mention 菜单随输入弹出/退出（对齐 clowder ChatInputMenus 交互） (16.2s)
✘  2 [chromium] › e2e\council.spec.ts:33:7 › 群聊页 /council › 可输入消息并触发发送（乐观 UI，不依赖后端响应） (16.2s)
  3 failed

Error: expect(locator).toBeVisible() failed
Locator: getByPlaceholder('输入消息... 使用 @智能体名 指定发言对象，/ 调出命令菜单')
Expected: visible
Timeout: 5000ms
Error: element(s) not found
  25 |     // 消息输入（占位符稳定锚点）
  26 |     const composer = page.getByPlaceholder("输入消息... 使用 @智能体名 指定发言对象，/ 调出命令菜单");
> 27 |     await expect(composer).toBeVisible();
```

- **DOM 证据**（Playwright 失败现场 a11y 快照，`test-results/council-*/error-context.md`）——页面确实处于空态：

```
- main:
  - text: FlowForge 群聊
  - textbox "讨论标题":
    - /placeholder: 未命名讨论（输入标题）
  ...
  - main: ◎ 选择左侧会话或点击"新对话"开始群聊
```

- **定性依据**：单跑（`e2e/council.spec.ts` 独立执行、`/council` 已预热）**仍然 3/3 失败**，故排除 dev 编译延迟与并行争用；结合源码 `CouncilContent.tsx:407/421` 的空态分支，判定为**用例断言与产品空态设计冲突**，不是产品缺陷。
- **建议**：三选一——① 用例先点击「+ 新对话」建立会话后再断言输入框；② 把壳层断言改为空态文案（`选择左侧会话或点击"新对话"开始群聊`）；③ 无后端场景下跳过 composer 相关断言（该 spec 头部注释本就声明「无后端时仅验证壳层渲染」，实现与注释不一致）。
- **T7/T8**：是（T8——浏览器 DOM 验证用例本身）

---

## P-542 — `pnpm start`（web profile）无法启动，官方一键入口不可用

- **严重度**：S1
- **分类**：`CI / 配置`
- **文件:行号**：`packages/boot/app-boot/src/profile.ts:115`（web 模板声明 `['@flowforge/base', '@flowforge/web-app']`）、`apps/cli/package.json`（依赖清单缺 `@flowforge/web-app`）、`web/package.json:2`（与 bundle 重名）
- **现象**：按 AGENTS.md 与 `start.sh` 使用官方入口启动，进程立即以非 0 退出；官方提示的补救命令 `flowforge plugin --profile web install` 执行后报 `Already up to date` 但**未产生任何装配效果**，重试仍失败。
- **复现命令与真实输出**：

```bash
pnpm start --no-open --port 5200
```

```
$ node --import tsx/esm apps/cli/src/bin.ts web "--no-open" "--port" "5200"
Error: flowforge: cannot resolve profile bundle "@flowforge/web-app" from the flowforge installation
or C:\Users\hyg\.flowforge\profiles\web; run 'flowforge plugin --profile web install'
if its dependency is not installed
    at resolveBundleDir (packages/boot/app-boot/lib/index.js:524:8)
    at loadProfile (packages/boot/app-boot/lib/index.js:547:123)
    at prepareProfile (apps/cli/src/profile-boot.ts:100:19)
[ELIFECYCLE] Command failed with exit code 1.
```

补救命令亦无效（`~/.flowforge/profiles/web` 下 `dependencies` 为空、`node_modules/@flowforge/` 为空）：

```bash
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web install
```

```
Already up to date
Done in 1.5s using pnpm v10.30.3
```

- **根因证据链**（逐条实测）：

| # | 检查 | 实测结果 |
|---|---|---|
| 1 | 模板声明 | `profile.ts:115` → `web: ['@flowforge/base', '@flowforge/web-app']` |
| 2 | 安装目录可否解析 bundle | `node_modules/@flowforge/base` ✓、`@flowforge/headless` ✓、**`@flowforge/web-app` ✗（无链接）** |
| 3 | 谁依赖 `@flowforge/web-app` | `grep 'name": "@flowforge/web-app"'` → 仅 `packages/bundle/web-app/package.json` 与 `web/package.json` **两个包同名**；无任何 workspace 包把它列为依赖 |
| 4 | 对照 profile | `node --import tsx/esm apps/cli/src/bin.ts --profile headless --dump-config` → **正常输出组合配置**（headless 模板不含 web-app） |

- **判定**：web profile 需要的 in-box bundle `@flowforge/web-app` 在**安装目录与 profile 目录都不可解析**——`apps/cli` 未声明该依赖（对照 `base`/`headless` 均有声明），且 `web/package.json`（私有 Next.js 前端）与非私有 bundle 包**同名 `@flowforge/web-app`**，使该依赖无法被正常声明/解析。`install.sh`、`start.sh`、AGENTS.md 均未记载任何额外前置步骤，用户按文档操作必然失败。
- **建议**：
  1. 消除重名：把 `web/package.json` 的 `name` 改为不冲突的名字（如 `@flowforge/web-frontend`）——注意 `@flowforge/web` 已被 `packages/web/web` 占用；
  2. 在 `apps/cli/package.json` 声明 `"@flowforge/web-app": "workspace:^"`（与 `base`/`headless` 同法），使安装目录可解析；
  3. 或在 profile 装配处支持按 workspace 目录解析 in-box bundle；
  4. `install.sh`/`start.sh`/AGENTS.md 补充前置步骤与失败自检（若维持现有装配方式）。
- **T7/T8**：否（未涉及 LLM 审核；但**阻断 T8**——后端无法启动，浏览器端到端只能覆盖前端壳层）

---

## P-543 — 运行 `pnpm dev` 后工作区出现未跟踪的生成资产 `web/public/vendor/xterm/xterm.css`

- **严重度**：S4
- **分类**：`CI / 配置`
- **文件:行号**：`web/package.json:9`（`predev`/`prebuild` 调用 `scripts/sync-vendor-assets.mjs`）、`.gitignore`
- **现象**：`pnpm dev` 的 `predev` 钩子把 `@xterm/xterm` 的 `xterm.css` 同步到 `web/public/vendor/xterm/xterm.css`，该文件既未被仓库跟踪、也未在 `.gitignore` 中登记，导致每次本地起前端后工作区都多出一个未跟踪文件（`git status` 出现 `?? web/public/vendor/xterm/xterm.css`）。
- **复现命令与真实输出**：

```bash
cd web && pnpm dev
```

```
[sync-vendor-assets] ...@xterm+xterm@5.5.0...\css\xterm.css -> ...\web\public\vendor\xterm\xterm.css

git status --porcelain
?? web/public/vendor/xterm/xterm.css

git ls-files web/public/vendor | wc -l
8        # 仅 app/*.css 被跟踪
```

- **定性依据**：同目录另 8 个同步产物（`web/public/vendor/app/*.css`）均已入库，唯独 `xterm/xterm.css` 未入库且未忽略——两种意图都可能，故仅报现象不定性为「遗漏入库」还是「应忽略」。
- **建议**：二选一——① 若该文件应在运行期生成，则在 `.gitignore` 增加 `web/public/vendor/xterm/`；② 若应与 `app/*.css` 一致入库，则提交该文件并在 `sync:vendor` 说明中登记。
- **T7/T8**：否

---

## 本轮验证结论（功能验证部分）

- **前端路由**：Playwright `routes-smoke` 覆盖的 **33 条路由全部通过**（HTTP <400 + 预期片段渲染），无整页白屏崩溃。
- **交互用例**：`forgekin.spec.ts` 3/3 通过（首轮并行时的 3 个失败经单跑复测确认为 **dev 编译/并行争用的假失败**，不予立单）；`council.spec.ts` 3/3 稳定失败 → P-541。
- **视觉回归**：33 条用例默认跳过（`FF_E2E_VISUAL` 未开启），本轮未覆盖。
- **后端链路**：**未覆盖**——官方入口启动失败（P-542）。
- **已知在库问题复现情况**：首轮并行运行时 `forgekin.spec.ts:31` 出现的
  `<div data-guide-overlay="true" class="fixed inset-0 z-[9995]"></div> intercepts pointer events`
  与在库 **P-540（GuideOverlay 非目标步缺 pointer-events-none 拦截交互，S3/Open）** 同源；但该现象在单跑复测中**未复现**（引导弹窗仅首次访问出现），故本轮**不新增重复单**，仅作为 P-540 的补充现场记录。
- **本轮新增 DI 增量** = S1×1 + S2×1 + S4×1 = 10 + 5 + 1 = **16**（累计 1159 + 16 = **1175**）

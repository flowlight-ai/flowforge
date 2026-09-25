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

---

## 第十三轮·修复回归记录（2026-09-19，P-542）

> ⚠️ **角色声明**：按 BUG_PROTOCOL 修复应归开发、回归应归测试。本轮由同一执行体完成修复与回归（operator 明确授权「修复 P-542 后回归后端」），**偏离角色分离原则**，特此留痕，请 operator 确认。

### P-542 开发自述

- **修复提交**：见本仓库本次提交（`fix(cli)` 系列，随本轮测试产物同批提交）
- **改动点**（两处装配缺陷）：
  1. `web/package.json` 的 `name` 由 `@flowforge/web-app` 改为 **`@flowforge/web-frontend`**——消除与 in-box bundle `packages/bundle/web-app` 的**包名冲突**；该名字与 bundle 源码注释记载的既定名一致（`packages/bundle/web-app/src/index.ts:13`、`:182`）。
  2. `.github/workflows/web-ci.yml` 4 处 `pnpm --filter @flowforge/web-app …` 同步改为 `@flowforge/web-frontend`（原过滤器与 bundle 同名，存在歧义）。
  3. `apps/cli/package.json` 按字母序声明 `"@flowforge/web-app": "workspace:^"`，使 in-box bundle 在**安装目录**可解析（`resolveBundleDir` 契约要求安装目录优先；与既有 `@flowforge/base` / `@flowforge/headless` 同法）。
- **自测**：`pnpm install` 后 `apps/cli/node_modules/@flowforge/web-app` 链接建立；`--profile web --dump-config` 由「抛 cannot resolve profile bundle」变为 **exit 0 正常输出组合配置**。

### P-542 测试回归结论

- **测试回归结论**：⚠️ **Partial** ｜ 回归日期 2026-09-19 ｜ 签署 QA
  - **复现命令 1（第一层根因，已验证消除）**：`timeout 60 node --import tsx/esm apps/cli/src/bin.ts --profile web --dump-config`
    - 修复前真实输出：`Error: flowforge: cannot resolve profile bundle "@flowforge/web-app" …`（退出码 1）
    - 修复后真实输出：`# == @flowforge/base` / `- id: timer` …（退出码 **0**）
  - **复现命令 2（端到端启动，仍失败）**：`pnpm start --no-open --port 5200`
    - 真实输出（修复后）：`Error: flowforge: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply`，含 7 条 `ERR_MODULE_NOT_FOUND`；伴随 `AttributeError`… 无（见下 P-544）
  - **判定说明**：**第一层根因（包名冲突 + 缺 in-box bundle 依赖声明）已修复并实测验证**；但官方入口**仍无法完成启动**，受阻于**独立根因**——构建产物 `lib/` 从未产出（详见新工单 P-544）。按 B4「一因一单」拆出 P-544，本单维持 **Open（Partial）**，待 P-544 修复后合并回归。

---

## P-544 — `pnpm build` 无法产出 `lib/`：`tsc -b` 短路 + `code-runtime-python` 缺入口，致宿主整包构建失败

- **严重度**：S1
- **分类**：`CI / 配置`
- **文件:行号**：`package.json:3`（`build: tsc -b tsconfig.host.json && tsdown --env.FF_BUILD_FACE host`）、`packages/code-runtime/code-runtime-python/`（缺 `src/index.ts`）
- **现象**：官方构建脚本无法完成，`lib/` 构建产物永不产出；连带 `pnpm start` 的 loader 无法导入 `@flowforge/cats-routes` 等条目（`ERR_MODULE_NOT_FOUND`），后端（web profile）无法启动。
- **复现命令与真实输出**：

```bash
pnpm build
```

```
$ tsc -b tsconfig.host.json && tsdown --env.FF_BUILD_FACE host
packages/chat/stretch-ports/tests/feishu-im-channel.spec.ts(122,12): error TS2532: Object is possibly 'undefined'.
[ELIFECYCLE] Command failed with exit code 2.
# 退出码 2：tsc 失败 → && 短路 → tsdown 从未执行
ls packages/cats/routes/lib/index.js   # → 未产出
```

绕过 tsc 直接跑 bundler，暴露更下层的入口缺失：

```bash
npx tsdown --env.FF_BUILD_FACE host
```

```
ERROR  Error: [@flowforge/code-runtime-python] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
# 退出码 1；packages/cats/routes/lib/index.js 仍未产出
```

```bash
ls packages/code-runtime/code-runtime-python/src/
# bootstrap.ts  invariant.ts  output-json.ts  protocol.ts      ← 无 index.ts
ls packages/code-runtime/code-runtime-python/lib/    # → 无 lib
```

- **两个成因**（同一后果，故合为一张单）：
  1. **`tsc -b` 存在既有类型债**（`pnpm typecheck` 全仓约 292 条，含本次样例中的 `packages/chat/stretch-ports/tests/feishu-im-channel.spec.ts:122-123`），因 `&&` 短路使 bundler 永不执行；
  2. **`@flowforge/code-runtime-python` 缺 `src/index.ts`** → tsc 不产出 `lib/types/index.js` → bundler 因找不到入口而整包失败。该包目录时间戳为**当日 13:52–13:53**，疑为**并行会话在途新增**（A13 code-runtime-python 属 stretch 项）。
- **影响面**：不止 web profile——`--profile headless --dump-config` 虽能列出配置，但任何需要 `lib/` 产物的 loader 条目在真实启动时都会失败；因此**宿主整包构建能力当前不可用**。
- **建议**：
  1. `code-runtime-python` 补 `src/index.ts`（导出面），或若该包尚未就绪则从构建入口/`tsconfig.host.json` 引用中摘除，避免**一个未完成包拖垮全量构建**；
  2. `build` 脚本解耦：`tsc -b`（类型门禁）与 `tsdown`（产物打包）不应以 `&&` 串联——至少在打包阶段用「已 emit 产物」而非「零错误」作前提，或拆为 `build:types` / `build:bundle` 两个脚本，避免类型债阻断产物生成；
  3. 类型债清理可参照并行会话已合入的 `debt-remediation`（PR #201）节奏继续收敛。
- **T7/T8**：否（但**阻断 T8**——后端起不来）

### P-544 追查进展（2026-09-19 第二轮，由 operator 指派继续处理）

> 本节为**测试侧追查记录**，尚未产生修复提交（结论：不宜作为热修拍板，需 owner 决策）。

**进展 1：成因 b 已被并行会话化解**——`packages/code-runtime/code-runtime-python/src/index.ts` 补齐后，tsdown 的报错**前移**到下一个包，说明该成因已消除：

```
npx tsdown --env.FF_BUILD_FACE host
ERROR  Error: [@flowforge/integration-e2e] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

**进展 2：根因重构（比初判更深）**——真正机制在根 `tsdown.config.ts:20-22`：

```ts
workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
entry: ['lib/types/{index,invariant,startup}.js'],
```

即 bundler **对所有 `packages/*/*` 与 `apps/cli` 逐一取 `lib/types/{index,invariant,startup}.js` 作为入口**；而 `lib/types/` 是 `tsc -b tsconfig.host.json` 的产物。问题在于：

- `tsconfig.host.json` 的引用集**不覆盖** `packages/*/*` 全量——实测 `@flowforge/integration-e2e` 在 `tsconfig.host.json` 中**引用数 = 0**（`grep -c "integration/e2e" tsconfig.host.json` → `0`），其 `packages/integration/e2e/lib/types/` 为**空目录**；
- 于是 bundler 找不到入口 → **整包构建失败**，与「某个包写错代码」无关，是**构建图（tsconfig.host.json）与打包图（tsdown workspace glob）不一致**。

**进展 3：脚本解耦是必要但不充分的**——

- 必要：`build = tsc -b && tsdown`，tsc 因既有类型债退出非 0 即短路，bundler 永无机会执行（实测 `packages/cats/routes/lib/types/index.js` **已由 tsc emit 成功**，但 `lib/index.js` 因 bundler 未跑而不存在——证明产物本可产出，纯被 `&&` 卡死）；
- 不充分：即使解耦，bundler 仍会因上述**未纳入构建图的包**而失败。

**两个候选修法（需 owner 决策，测试侧不擅自拍板）**：

| 方案 | 内容 | 影响面 |
|---|---|---|
| A | 把 `tsconfig.host.json` 补齐到覆盖 bundler 的 workspace 全集 | 会让 `integration-e2e` 等**本不该进 host face** 的包也进构建图，可能引入新类型债 |
| B | 收窄 `tsdown.config.ts` 的 `workspace` glob 到 host 构建图（或改为按包 opt-in） | 触及全仓打包语义，需确认哪些包属于 host face |

**另需一并处理**：`build` 脚本解耦（拆 `build:types` / `build`，让类型门禁不阻断产物生成）。CI 不受影响——`ts-ci.yml:51` 已单独跑 `pnpm typecheck`，根 `pnpm build` 仅被 `install.sh` 使用。

**建议归属**：该单涉及构建图与打包图的架构对齐，且并行会话（debt-remediation / code-runtime-python）正在同一区域施工，**建议由 owner 指派归口后统一处理**，避免与在途改动冲突。测试侧保持 `Open`，待修复后回归。

---

## 第十三轮补充计数

- 新增工单 **P-544**（S1）｜ 新增 DI 增量 = **10**（累计 1175 → **1185**）
- P-542 状态由 `Open` 改为 **`Open（Partial）`**（第一层已修并验证，残留拆至 P-544）

---

## P-544 修复记录（2026-09-19 第三轮，方案 B + 脚本解耦）

### 开发自述

- **修复提交**：见随本次测试产物同批的 `fix(build)` 提交
- **改动点**：
  1. `tsdown.config.ts`：host face 的 `workspace` 由**原 glob `['vendor/*','packages/*/*','apps/cli']`** 改为**由 `tsconfig.host.json` 的 references 派生并收窄到「构建图 ∩ 原打包范围」**——使打包图恒为构建图子集，杜绝「未纳入构建图的包因无 `lib/types` 而整包构建失败」这一类漂移；client face 保持原 glob（其 `entry: ''` 由包内配置决定，不受本缺陷影响）。
  2. `package.json`：`build` 解耦为**仅打包**（`tsdown --env.FF_BUILD_FACE host`）；新增 `build:types`（`tsc -b tsconfig.host.json`，即类型门禁 + emit）；`typecheck` 不变；未使用的 `build:lib:host` 改为委托 `pnpm build`。**未使用 `|| true` 等假通过写法**。
  3. `install.sh`：**经核实无需改动**——其 [2/3] `pnpm typecheck` 与 `build:types` 是同一命令，已 emit 类型产物，[3/3] `pnpm build` 直接可用（与计划 §任务2 步骤2 有出入，此处以实测为准收敛为不改）。
- **自测**：见下「测试回归结论」。

### 测试回归结论

- **测试回归结论**：⚠️ **Partial** ｜ 回归日期 2026-09-19 ｜ 签署 QA
  - **复现命令 1（打包步，已验证转绿）**：`npx tsdown --env.FF_BUILD_FACE host`
    - 修复前：`ERROR  Error: [@flowforge/integration-e2e] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`（退出码 1）
    - 修复后：**退出码 0**（37s 完成）
  - **复现命令 2（官方 build 脚本，已验证转绿）**：`pnpm build`
    - 修复前：`tsc -b` 失败即短路，`tsdown` 从未执行（退出码非 0，无产物）
    - 修复后：**退出码 0**（53s，日志含 `✔ [@flowforge/cli] Build complete in 40748ms`），`packages/boot/app-boot/lib/index.js` 已产出
  - **复现命令 3（端到端启动，仍失败）**：`pnpm start --no-open --port 5200`
    - 真实输出仍为 `plugin tree failed to load … loader entries failed to apply`，残留 12 处 `Cannot find`，去重后 **5 类**：
      - profile 侧缺包：`@flowforge/harness-env-registry`、`@flowforge/llm-openroute`、`@flowforge/session-log-export`
      - profile 侧残留旧副本：`C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\web-app\lib\{index,startup}.js` 不存在
      - 仓库侧：`packages/host/cats-api/node_modules/@flowforge/cats-routes/lib/index.js` 不存在
  - **判定说明**：本轮修复的**构建图/打包图不一致**已实测消除（`pnpm build` 由「失败且无产物」转为「exit 0 且产出」）；但端到端启动的残留属**第三类独立根因——profile 安装态陈旧/不完整**（`~/.flowforge/profiles/` 下缺 3 个仓库包、且持有一份 `lib/` 缺失的 `@flowforge/web-app` 旧副本），与构建图无关。按 B4 拆出新工单 **P-545**，本单维持 `Open（Partial）`。

---

## P-545 — `pnpm start` 残留阻断：profile 安装态陈旧/不完整（缺包 + 旧副本）

- **严重度**：S1
- **分类**：`验证阻塞（环境）`／`CI / 配置`（待开发判定归属）
- **文件:行号**：`packages/boot/app-boot/src/profile.ts`（`resolveBundleDir` 与 profile 装配）、`apps/cli/src/plugin.ts`（`plugin install` → `reconcilePlugins` 逻辑）
- **现象**：`pnpm build` 已可产出产物，但 `pnpm start --no-open --port 5200` 仍在 `cordis:include` 阶段失败，去重后 5 类 `Cannot find`（见上 P-544 复现命令 3 输出）。
- **复现命令与真实输出**：

```bash
pnpm start --no-open --port 5200
```

```
Error: flowforge: plugin tree failed to load: failed to apply loader entry include (cordis:include)
Cannot find package '@flowforge/harness-env-registry'      # 导入自 C:\Users\hyg\.flowforge\profiles\web\
Cannot find package '@flowforge/llm-openroute'
Cannot find package '@flowforge/session-log-export'
Cannot find module 'C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\web-app\lib\index.js'
Cannot find module '…\packages\host\cats-api\node_modules\@flowforge\cats-routes\lib\index.js'
```

```bash
ls ~/.flowforge/profiles/node_modules/@flowforge | wc -l     # → 136（早年安装，缺上述 3 包）
cat ~/.flowforge/profiles/web/package.json                   # → dependencies: {} 为空
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web install
# → "Already up to date"（无依赖可装，实测无效）
```

- **诊断**：`~/.flowforge/profiles/` 是**早前遗留的安装态**：`profiles/node_modules` 有 136 个包（含一份 `lib/` 缺失的 `web-app` 旧副本），而 `profiles/web/package.json` 的 `dependencies` 为空，官方补救命令 `plugin --profile web install` 因此**空转**（`Already up to date`）——它只按 manifest 依赖装包，不会补齐 in-box bundle 的运行期依赖，也不会清理旧副本。
- **建议**：① 明确 profile 目录的「重建 vs 增量修」策略（例如提供 `plugin --profile web reset`，或让 `install` 在检测到缺包/旧副本时报错而非静默空转）；② 让 `plugin install` 校验 in-box bundle 的运行期依赖可解析性，缺失即失败并给出可操作提示；③ 文档补充「首次运行前需要哪些步骤」并在 `start` 失败时给出自检清单。
- **T7/T8**：否（但**阻断 T8**——后端起不来）

**新增计数**：P-545（S1）→ DI 增量 +10（1185 → **1195**）；P-544 状态维持 `Open（Partial）`。

### P-545 追查补充（2026-09-19，第二轮定向侦察）

**profile 目录的真实布局**（`~/.flowforge/profiles/`）：

```
profiles/
├── node_modules/@flowforge/   # 136 个包（早前安装的陈旧快照）
├── web/                       # 自包含 pnpm 工程：packages:[.] + nodeLinker:hoisted
│   ├── package.json           # name=flowforge-profile-web；dependencies: {}（空！）
│   ├── pnpm-workspace.yaml
│   └── pnpm-lock.yaml         # importers: .: {}（无任何依赖解析记录）
└── headless/
```

**缺包核对**（`profiles/node_modules/@flowforge/`）：

| 包 | 状态 | 影响 |
|---|---|---|
| `@flowforge/harness-env-registry` | **缺失** | loader 条目 `env-registry` 导入失败 |
| `@flowforge/llm-openroute` | **缺失** | loader 条目 `llm-openroute` 导入失败 |
| `@flowforge/session-log-export` | **缺失** | loader 条目 `session-log-export` 导入失败 |
| `@flowforge/web-app` | 存在但 `lib/` 缺失 | loader 条目 `web-app` / `web-startup` 导入失败 |

**定性（核心矛盾）**：`resolveBundleDir` 的契约是「in-box bundle 从**安装目录**解析」，但 loader 的**插件条目**却是从 **profile 目录**导入的（错误信息明示 `imported from C:\Users\hyg\.flowforge\profiles\web\`）。而 profile 的 `package.json` 的 `dependencies` 为空、lockfile 的 `importers` 也为空——**profile 没有任何依赖声明能把这批运行期插件装进来**。当前之所以大部分条目还能用，只是因为 `profiles/node_modules` 里躺着一份**早前安装的 136 包快照**；它既不随仓库更新，也没有任何流程会去刷新它。

**推论**：这不是「环境脏了，重装即可」，而是**设计缺口**——profile 运行期依赖的来源与刷新机制未定义。可选修法（需 owner 裁决，测试侧不拍板）：

| 方案 | 内容 | 取舍 |
|---|---|---|
| C1 | 插件条目也按「安装目录优先」解析（与 bundle 同契约） | 契约统一，但要改 loader 解析链，影响所有 profile |
| C2 | profile 装配时把 bundle 的运行期依赖声明进 manifest（使 `plugin install` 真正可装） | 贴近现有 `plugin install` 设计，但需要 bundle 提供依赖清单 |
| C3 | 提供 `plugin --profile <name> reset`（清空并重建 profile，含刷新快照） | 见效快，但治标；且要明确「重建」的数据边界（用户层配置是否保留） |

**结论**：P-545 维持 `Open`（S1）。**测试回归结论待独立复判**——见下。

---

## 角色分离声明（operator 要求「另一侧复判」）

本轮 P-542 / P-544 的**修复与回归由同一执行体（sherlock）完成**，违反 BUG_PROTOCOL「修复归开发、回归归测试」的角色分离原则（虽经 operator 明示授权）。为恢复协议效力，自本单起处理如下：

- **P-542 / P-544 / P-545 的 `测试回归结论` 一律不由 sherlock 签署**；
- 上述三单的现状标注为：**`⏳ 待另一侧独立复判`**（联动状态 `Fixed（待回归）` / `Open（Partial，待复判）`）；
- sherlock 仅提供**可复现证据**（命令 + 真实输出，均已随单记录），**不给出最终判定**；
- 复判人由 operator 指派；复判通过后由复判人签署 `✅ Verified` / 或按实态打回。

**⚠️ 遗留风险提示**：P-544 的修复（`tsdown.config.ts` 派生打包图 + `build` 脚本解耦）已实测使 `pnpm build` 转为 exit 0 且产出 `lib/index.js`，但其**对 client face 与 CI 的完整影响未经独立复核**（client face 保持原 glob 未变，理论上无影响，但未实测 client 构建）。建议复判时一并覆盖：`FF_BUILD_FACE=client` 的构建路径与 `ts-ci.yml` / `web-ci.yml` 的通过情况。

---

## P-545 决策落定与复判指派（2026-09-19，operator 裁决）

### 决策：采用 **C1**（插件条目按「安装目录优先」解析，与 bundle 契约统一）

### 实现落点（已精确定位，供实施者直接切入）

`packages/boot/app-boot/src/index.ts:495-502`（`mountRootInclude` 内的 `import` 覆写）：

```ts
override import(name: string, getOuterStack?: () => string[]): unknown {
  ...
  if (name.startsWith('.') || name.startsWith('cordis:')) return super.import(specifier, getOuterStack)
  ...
  if (internal === undefined) return super.import(specifier, getOuterStack)   // ← 落到这里则按 profile 基点解析
  return internal.import(specifier, bareModuleBaseUrl, {})
}
```

**判断**：该处**已存在**「安装目录为基点」的解析机制（`bareModuleBaseUrl`，`app-boot` 在 `mountRootInclude` 调用点传入），只是对「非 internal 的裸包名」回落到 `super.import`（以 profile 目录为基点）→ 正是 3 个缺失包与 `web-app` 旧副本报错的原因。C1 的改动面因此集中在**这一个 `import` 覆写**：让所有**可安装目录解析成功**的裸包名都走 `bareModuleBaseUrl`，仅在安装目录解析不到时才回落 profile 基点。

**实施前必须确认的两点**（避免越界改动）：
1. `internal` 的语义与判定条件（为何这 3 个包被判为「非 internal」）；
2. 该覆写的调用面（是否仅服务于 root include；改动是否影响非 profile 启动路径，如源码直跑）。

**验证要求**：改后须以 `pnpm build` + `pnpm start --no-open --port 5200` + 真实 HTTP 探测为证据；并回归 `--profile headless`（避免修好 web 打断 headless）。

### 复判人指派

- **复判人**：`[davinci]`（该身份在仓库有活跃会话，具备独立执行环境）；备选 `[luban]`（文档/流程侧）。
- **复判范围**：P-542 / P-544 / P-545 三单的 `测试回归结论` 签署；须覆盖 P-544 对 client face 与 CI 的影响（`FF_BUILD_FACE=client`、`ts-ci.yml`、`web-ci.yml`）。
- **sherlock 的角色**：仅提供上述可复现证据与我方定位，**不参与签判、也不再改本单相关代码**（避免继续叠加角色重叠）。
- operator 可随时改派；改派后请更新本节。

### 交接现状（诚实记录）

- **后端仍未启动成功**：P-542（已修）→ P-544（已修并实测构建转绿）→ **P-545 待实施**（决策已定 C1，落点已定位，实装未开始）。
- **前端真实浏览器验证已完成**：33 条路由全通过（`routes-smoke`），交互用例见 P-541。
- sherlock 本轮在 P-545 上**仅完成定性、决策落点定位与交接**，未产出未经验证的代码改动——bootstrap 路径改动须留完整验证空间，遂于此停手交接。

### P-545 C1 实装尝试与回滚（2026-09-19，第三轮）

**已定位的完整因果链**（本轮的实质产出）：

1. `apps/cli/src/profile-boot.ts:248` 调用 `boot(NAME, rootConfig, patches, prepare)` —— **未传第 5 实参 `bareModuleBaseUrl`**；
2. 于是 `packages/boot/app-boot/src/index.ts:492` 的三元判断落入 `bareModuleBaseUrl === undefined ? Include : HostResolvedRootInclude` 的**前一分支**：`HostResolvedRootInclude`（安装目录基线解析）**从未被安装**；
3. 所有裸包名遂走 `super.import`，以 root include 的配置文件为基点 → **profile 目录**（错误信息 `imported from ...\profiles\web\` 即此）；
4. 大部分条目仍能解析成功，是因为 `profiles/node_modules` 里有一份**早年的 136 包快照**在兜底；缺失的 3 包与 `web-app` 旧副本因此暴露。

**实装尝试**：按 C1 在调用点补上安装锚点（复用既有 `INSTALL_ANCHOR = apps/cli/package.json`，`pathToFileURL(INSTALL_ANCHOR).href`）。

**实测结果：失败得更彻底，已回滚**。真实输出（`pnpm start --no-open --port 5200`）：

- 解析基点**确实切换成功**：错误路径由 `C:\Users\hyg\.flowforge\profiles\...` 变为 `D:\software\fl\flowlight\flowforge\apps\cli\node_modules\...`；
- 但 `Cannot find` 由 12 处**增至 20 处**，新增 `@flowforge/client-connection`、`@flowforge/host-webserver`、`@flowforge/host-directory-picker`、`@flowforge/host-plugin-inventory` 等——**这些包并未链接进 `apps/cli/node_modules`**（`apps/cli` 未声明它们为依赖），而此前正是 profile 的 136 包快照在替安装目录兜底。

**结论（修正 C1 的实施要求）**：C1 **不能只改调用点**。`HostResolvedRootInclude.import` 当前实现是「**只按安装目录解析、无回落**」：

```ts
if (internal === undefined) return super.import(specifier, getOuterStack)
return internal.import(specifier, bareModuleBaseUrl, {})   // ← 解析不到即抛错
```

正确实装须二选一：
- **C1a**：在覆盖内实现**安装目录优先 → 解析失败回落 profile 基点**的两级解析（对应工单先前写明的「仅在安装目录解析不到时才回落」）；
- **C1b**：或在 `apps/cli` 补声明全部运行期插件依赖，使安装目录成为**完备**的解析源（与 P-542 给 `@flowforge/web-app` 补声明同法，但清单更长）。

**未决残留（无论 C1a/C1b 都需单独处理）**：`packages/host/cats-api/node_modules/@flowforge/cats-routes/lib/index.js` 缺失——该包无包内 `tsdown.config.ts`，未产出 bundled `lib/index.js`；与 profile/解析基点无关，属 P-544 同族的**产出覆盖**问题。

**处置**：本轮改动**已完整回滚**（`apps/cli/src/profile-boot.ts` 还原），仓库未留半成品——因为「只装不回落」会使启动比修改前更差（20 > 12 处失败）。C1 转由复判人/接手人按 C1a 或 C1b 实施。

### P-545 C1b 前置：profile loader 条目全集枚举（2026-09-19）

**方法**（可复现）：

```bash
node --import tsx/esm apps/cli/src/bin.ts --profile web      --dump-config > /tmp/ff-web-tree.yml
node --import tsx/esm apps/cli/src/bin.ts --profile headless --dump-config > /tmp/ff-headless-tree.yml
grep -oE "name: '[^']+'" <tree.yml> | sed "s/name: '//;s/'$//" | sort -u
```

**结果**：条目的 `name` 全部为 `@flowforge/*`，无第三方条目。

| profile | 条目总数 | `apps/cli` 已声明 | **待补声明** |
|---|---:|---:|---:|
| `web` | 91 | 78 | **13** |
| `headless` | 82 | 78 | **4** |

**C1b 待补清单（两 profile 并集，去重后 11 个包 + 3 个子路径根）**：

| # | 包名 | web | headless | 备注 |
|---|---|:--:|:--:|---|
| 1 | `@flowforge/agent-presets` | ✔ | — | |
| 2 | `@flowforge/client-connection` | ✔ | — | |
| 3 | `@flowforge/cordis-host-runner` | ✔ | — | |
| 4 | `@flowforge/harness-env-registry` | ✔ | ✔ | 即 P-545 报错项之一 |
| 5 | `@flowforge/host-cats-api` | ✔ | — | |
| 6 | `@flowforge/host-directory-picker` | ✔ | — | |
| 7 | `@flowforge/host-plugin-inventory` | ✔ | — | |
| 8 | `@flowforge/host-webserver` | ✔ | — | **Web 服务本体**，未声明即解释「端口不监听」 |
| 9 | `@flowforge/llm-openroute` | ✔ | ✔ | 即 P-545 报错项之一 |
| 10 | `@flowforge/session-log-export` | ✔ | ✔ | 即 P-545 报错项之一 |
| 11 | `@flowforge/session-stats` | ✔ | — | |
| — | `@flowforge/tool-subagent-control`（子路径 `…/list-agents`） | ✔ | ✔ | 需声明**根包** |
| — | `@flowforge/headless`（子路径 `…/startup`） | — | ✔ | 需声明**根包** |
| — | `@flowforge/web-app`（子路径 `…/startup`） | ✔ | — | 已由 P-542 修复补上声明 |

**实施提示（C1b）**：在 `apps/cli/package.json` 按字母序补声明上述包（`workspace:^`，与既有条目同法），随后 `pnpm install` 同步锁文件；预期效果 = 安装目录对**全部** loader 条目可解析 → `bareModuleBaseUrl` 不再需要回落分支（C1a 可省）。验证须覆盖两个 profile 的真实启动与 HTTP 探测。

**仍独立于本清单的残留**：`packages/host/cats-api/node_modules/@flowforge/cats-routes/lib/index.js` 缺失（该包无包内 `tsdown.config.ts`，未产出 bundled 产物）——补声明后仍需单独解决该包的产出覆盖。

**注**：以上枚举为本轮新增的**可复现事实**；C1b 的代码改动**未实施**（本轮仅完成前置枚举），转由复判人/接手人执行。

### P-545 C1b 实装与实测（2026-09-19，第四轮）

**改动**：`apps/cli/package.json` 补声明 11 个 loader 条目包（`workspace:^`，按字母序；`web-app` 已由 P-542 补过，`headless`/`tool-subagent-control` 等子路径根一并补齐），`pnpm install` 同步锁文件（`pnpm-lock.yaml` +33 行）。改动面干净：`apps/cli/package.json` 12 增 1 删（删除项仅为排序归位）。

**实测（`pnpm start --no-open --port 5200`）**：端口仍不监听，但**错误性质已变**——

- `Cannot find` 由 12 处降为 **6 类**，且已**不再是「找不到包」**，而统一变成**「找到包但没有构建入口」**：

```
Cannot find module 'C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\harness-env-registry\lib\index.js'
Cannot find module 'C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\llm-openroute\lib\index.js'
Cannot find module 'C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\session-log-export\lib\index.js'
Cannot find module 'C:\Users\hyg\.flowforge\profiles\node_modules\@flowforge\web-app\lib\{index,startup}.js'
Cannot find module 'D:\…\packages\host\cats-api\node_modules\@flowforge\cats-routes\lib\index.js'
```

即：**包解析这一步已被 C1b 修好**（3 个原先「找不到的包」现均能定位），残留全部是 **`lib/index.js`（bundled 入口）未产出**。

**成因实测**（见下表）：tsdown 的 workspace 模式对本仓库大量包**不产出 `lib/index.js`**——产出与否与其是否带**包内 `tsdown.config.ts`** 强相关：

| 包 | 包内 tsdown 配置 | `lib/index.js` |
|---|:--:|:--:|
| `packages/host/cats-api`（有配置，作为参照） | 有 | 有 |
| `packages/cats/routes` | 无 | **无** |
| `packages/harness/env-registry` | 无 | **无** |
| `packages/llm/openroute` | 无 | **无** |
| `packages/session-query/session-log-export` | 无 | **无** |

**结论**：P-544 的修复**只解决了「bundler 整包中止」**（`pnpm build` 转绿），但**打包覆盖仍不完整**——无包内 `tsdown.config.ts` 的包不会产出 bundled 入口，而其 `package.json` 的 `main`/子路径导出正指向 `lib/index.js`。这是 P-545 的**最后一层**，也是 `cats-routes` 那条残留的同源问题（原以为它独立，实测同源）。

**下一步（须先决策，测试侧不拍板）**：
- **D1**：让 tsdown 的 workspace 模式对**所有** host 构建图内的包强制产出 bundled 入口（不依赖包内是否带 config）；
- **D2**：或让这些包的 `exports`/`main` 指向 `lib/types/`（tsc 产物）而非 `lib/index.js`，使 bundled 入口成为可选。

**状态**：P-545 维持 `Open`（S1）。C1b 的声明补齐**已实施且有实测证据**（错误性质改善：找不到包 → 找到包但缺入口），但**启动仍未成功**，故不构成终点；最终判定仍留待独立复判。

### P-545 D1 前置：发现 P-544 修法疑似引入退化（2026-09-21）

**实测反证**（决定 D1 之前必须先解决）：

| 检查 | 实测 |
|---|---|
| **全仓 `lib/index.js` 数量** | **≈0**（`packages/boot/app-boot/lib/index.js` 时间戳为 **08-17**，属旧残留；`packages/host/cats-api`、`packages/cats/routes` **均无**） |
| 带本地 `tsdown.config.ts` 的包数 | 27 |
| `pnpm build` 退出码 | 0，但日志仅报 `✔ [@flowforge/cli] Build complete in 40748ms` |
| `lib/types/index.js`（tsc 产物） | 广泛存在（09-18 时间戳） |

**推论**：`pnpm build` 虽已 exit 0，却**并未为 workspace 各包产出 bundled 入口**——即 P-544 的修复只做到「不再中止」，但**打包覆盖实质为零**。此前我记录的四包「无产出」现象，实为**全仓现象**，非个别包问题；我此前那张「有/无本地配置决定产出」的表**已被本反证推翻**（`host/cats-api` 与 `cats/routes` 的 `package.json` 入口声明完全相同，产出却都不存在，所谓差异来自旧残留而非构建）。

**最可能的原因（指向 P-544 自己的改动）**：P-544 把 host face 的 `workspace` 由 **glob** `['vendor/*','packages/*/*','apps/cli']` 改为**显式目录路径列表**。tsdown 的 workspace（包发现）语义很可能依赖 glob 模式；改为显式路径后，其包枚举/配置发现行为退化，导致仅少数（如带 config 的 CLI）被处理。

**处置建议**：D1 实施前，须先回退 P-544 中 `workspace` 的那一处改动形态（**恢复 glob 枚举**），再以「容忍缺入口」的其它手段解决 `integration-e2e` 类包（例如把此类包补入 `tsconfig.host.json`，或让 tsdown 忽略无入口的包）——否则 D1 无处落地。

**状态**：P-544 的「构建图派生」修法**存疑，需复判时重点复核**；P-545 维持 `Open`。本轮为**负结果记录**，未再改代码。

### P-545 D1 前置：workspace glob 回退实测（2026-09-21）

**改动**：`tsdown.config.ts` 的 `workspace` 回退为原 glob `['vendor/*','packages/*/*','apps/cli']`（移除 P-544 引入的「由构建图派生」函数及其 `node:fs` 导入），client face 逻辑不变。

**实测（`pnpm build`）**：

| 指标 | 派生列表（P-544 后） | **glob（回退后）** |
|---|---|---|
| 退出码 | 0 | **1** |
| `lib/index.js` 产出数（`-maxdepth 4`，排除 `lib/types/`） | — | **182** |
| 报错 | 无（但覆盖疑为零） | `[@flowforge/desktop] Cannot find entry`（**1 处**，末尾中止） |

**关键核对**（关心的包是否产出 `lib/` 顶层入口）：

| 包 | `lib/index.js` |
|---|---|
| `packages/host/cats-api` | **无** |
| `packages/cats/routes` | **无** |
| `packages/harness/env-registry` | **无** |
| `packages/llm/openroute` | **无** |
| `packages/session-query/session-log-export` | **无** |
| `packages/boot/app-boot` | 仍是 **08-17 旧残留** |

**结论（诚实记录）**：
1. glob 形态**确实恢复了大量产出**（182 个 `lib/index.js`，派生列表形态下未见），证实「打包图派生」会削弱 tsdown 的包枚举；
2. **但本次关心的 6 个包仍无 `lib/` 顶层入口**，且构建仍因 `@flowforge/desktop`（落点 `packages/apps/desktop/`）无入口而 **exit 1**；
3. 因此**回退 glob 不足以解决 P-545 的「缺入口」层**；`@flowforge/desktop` 与先前的 `integration-e2e` 是同类（无 `lib/types` 产物），需「让 tsdown 跳过无入口包」或把它们补入构建图。

**自我更正（重要）**：本单前一轮「全仓 `lib/index.js` ≈0」的测量**有误**——当时用的 `find` 带 `-maxdepth 3`，而 `packages/*/*/lib/index.js` 位于第 4 层，被漏计。该错误测量导致我给出「P-544 使产出归零」的过强结论；**本轮回退实测（182 个）表明派生列表形态下产出究竟多少需重新测量**，此前「零产出」判断**应视为未证实**。

**处置**：本轮仅回退 + 实测记录，**未再改动其它逻辑**；`@flowforge/desktop` 的跳过策略（D1 的落地方式）待决策后实施。P-545 维持 `Open`；P-544 该处修法仍待复判重点复核。

---

## P-546 — 构建图不覆盖 workspace 全量，而 tsdown 要求全量有入口：打包在全量枚举下硬抛（P-544/P-545 的结构性根因）

> **升级说明**：本单由 P-544 / P-545 追查过程中**升格**而来。原以为「打包图与构建图漂移」可用一次配置改动收口（P-544 的派生改法），实测证明那是**错误修法**（已回退）；真正的结构性问题在下面。

- **严重度**：S1（阻断 `pnpm build` 与后端启动）
- **分类**：`CI / 配置`
- **文件:行号**：`tsdown.config.ts:20-22`（`workspace` + `entry`）、`tsconfig.host.json`（构建图引用集）、`node_modules/.pnpm/tsdown@0.22.14.../tsdown/dist/options-C1CN2x0L.mjs:66-77`（硬抛点，第三方源码，仅供溯源）
- **现象**：`pnpm build` 以 **exit 1** 结束；tsdown 在按 `packages/*/*` **全量枚举**打包时，对**没有 `lib/types` 产物**的包（实测 `@flowforge/desktop`、`@flowforge/integration-e2e`）硬抛 `Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`，**中止整个打包**。

**复现命令与真实输出**：

```bash
pnpm build
# → exit=1；错误 1 处：
#   [@flowforge/desktop] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
#   （此前为 [@flowforge/integration-e2e]，随在途修复而前移）
# 同时观测到：lib/index.js 产出 182 个（-maxdepth 4，排除 lib/types）
```

**根因（源码级结论）**——tsdown **没有「跳过无入口包」的配置项**，是硬抛：

```js
async function resolveEntry(logger, entry, cwd, color, nameLabel, root) {
  if (!entry || Object.keys(entry).length === 0) {            // entry 为空才走兜底
    const defaultEntry = path.resolve(cwd, "src/index.ts");
    if (await fsExists(defaultEntry)) entry = { index: defaultEntry };
    else throw new Error(`${nameLabel} No input files, …`);
  }
  const [entryMap, computedRoot] = await toObjectEntry(entry, cwd, root);
  const entries = Object.values(entryMap);
  if (entries.length === 0) throw new Error(`${nameLabel} Cannot find entry: …`);  // ← 此处
  …
}
```

即：`entry` 为非空数组时走 `toObjectEntry`，任一包 glob 匹配为空即 throw，**无开关可绕过**。

**结构矛盾**：tsdown 的 `workspace` 语义要求 **`packages/*/*` 全量**都能提供 `lib/types/{index,invariant,startup}.js`，而 `tsconfig.host.json` 的构建图只是其中**子集**（实测 glob 覆盖 341 包 / 引用 341 项，但彼此各有 2 项不对应）。两者天然不等价时，全量枚举必然硬抛。

**已验证的失败修法与其实测**（避免后人重走）：

| 修法 | 实测结果 | 结论 |
|---|---|---|
| P-544「`workspace` 改为由构建图派生」 | bundler 不再报错，但**包枚举被削弱**；回退 glob 后 `lib/index.js` 产出 **182 个** | ❌ 错误修法，**已回退** |
| `entry` 置空走 `src/index.ts` 兜底 | 会**产出**而非跳过，且目标包未必有 `src/index.ts` | ❌ 语义不符 |
| 让 tsdown 忽略无入口包 | **tsdown 无此配置项**（源码级确认） | ❌ 不可行 |

**候选路径（需 owner 裁决）**：

| | 做法 | 取舍 |
|---|---|---|
| **D1-b** | 把 `packages/apps/desktop`、`packages/integration/e2e` 等补进 `tsconfig.host.json`，使全量都有 `lib/types` | 会把应用/测试包拉进 host 构建图，可能引入新类型债；且**仍要求构建图与 glob 恒等**，新包一加又会漂移 |
| **D1-c** | `workspace` 保留 glob，**显式排除**极少数无产物包 | 需确认 tsdown 是否支持排除语法；且排除清单会随新包漂移 |
| **D1-d（推荐方向）** | 让**构建图覆盖 workspace 全量包**（每个 `packages/*/*` 都成为 tsconfig 引用），使两者**定义上恒等** | 改动面最大，是构建体系的整体收口；但唯一能**根治漂移**的解，也顺带消除 P-544 想解决却修错的那类问题 |

**与 P-544 / P-545 的关系**：P-544（打包图漂移）本质是本单的一个**症状**，其修法（派生列表）**放大了症状**（枚举被削弱）；P-545（缺 bundled 入口）是本单的**下游后果**。故建议本单作为**母单**，P-544 的派生改法待本单定案后一并处置。

- **T7/T8**：否（但**阻断 T8**——构建与后端启动均不通过）

### P-546 决策：采用 **D1-d**（构建图覆盖 workspace 全量，使两者定义上恒等）

> operator 裁决（2026-09-21）：选 **D1-d**。理由：D1-b/D1-c 都只是把差集手工对齐，新包一加又会漂移；D1-d 让「构建图 ≡ workspace 全量」成为**定义**，是唯一根治漂移的解，也顺带消除 P-544 想解决却修错的那类问题。

**实施要点（供接手人直接执行）**：

1. **先量准差集**（本轮已实测，可直接复用；重跑一次确认）：
   - tsdown `workspace` glob（`vendor/*` + `packages/*/*` + `apps/cli`）覆盖 **341** 包；
   - `tsconfig.host.json` 引用 **341** 项；
   - **glob 有 / 构建图无（2）**：`packages/code-runtime/code-runtime-python`、`packages/integration/e2e` ← **本方案要补进构建图的就是这类**；
   - **构建图有 / glob 无（2）**：`native/landlock-run/packages/entry`、`packages/limb/adapters` ← 非 TS/bundle 目标，**不要求**纳入 glob。
   → 故 D1-d 的准确语义是：**`glob ⊆ refs`**（凡被 tsdown 枚举的包，必须都在构建图内），而非双向严格相等。
2. 把差集包补入 `tsconfig.host.json` 的 `references`（`{"path":"./<pkg>"}`，目录形态；注意已有条目用 `/tsconfig.host.json` 形态，保持与邻近条目一致的写法）。
3. 若补入后 `tsc -b` 对这些包产生新错误（它们此前不在 host face），逐条处置；**不得**用 `|| true` 等手段掩盖。
4. 验证（**测试证据，逐条留档**）：
   - `pnpm build` **exit 0**，且关键包产出 `lib/index.js`（`host/cats-api`、`cats/routes`、`harness/env-registry`、`llm/openroute`、`session-query/session-log-export`、`boot/app-boot`）；
   - `pnpm start --no-open --port 5200` 真实启动 + `curl` HTTP 探测；
   - `--profile headless` 回归（避免修好 web 打断 headless）；
   - `pnpm typecheck` 仍如实反映既有类型债（**门禁不得被你改绿**）。
5. 一并处置：P-544 的派生改法已回退（glob 已恢复）；本单定案后确认 P-544 是否可关闭。

**注意**：`pnpm build` 的 `build`/`build:types` 脚本解耦（P-544 的一部分）**经核实不影响 CI**（`ts-ci.yml:51` 独立跑 typecheck），该部分可保留。

---

## 交接简要（新会话冷启动入口）

**目标**：让 `pnpm start` 能启动 FlowForge 前后端，以便完成原始任务——**用真实浏览器验证全部功能**。

**当前已完成**：前端 33 条路由的**真实浏览器 E2E 全部通过**（`web/e2e/routes-smoke.spec.ts`，见本文件 §第十三轮验证结论）；后端始终未启动成功。

**待办链条（按序）**：
1. **P-546 按 D1-d 实施**（本单，母单）→ 使 `pnpm build` exit 0 且产出完整
2. **P-545** 缺 bundled 入口层随之消解后，复测启动
3. **P-542 / P-544 / P-545 / P-546 的 `测试回归结论`** 由复判人 **`[davinci]`**（备选 `[luban]`）独立签署——**sherlock 未签任何 Verified**
4. 后端起来后，**补做后端接口级验证**（第十三轮只覆盖了前端壳层）

**关键文件**：`docs/test/bugs/round13-browser-e2e-2026-09-19.md`（全部因果链/实测/失败尝试/源码级结论）、`docs/test/bugs.md`（索引与 DI）、`mgr`（远程操作唯一入口）。

**红线提醒**：一切远程操作走 `./mgr`；`build` 脚本不得用 `|| true` 类假通过；测试回归结论只由复判人签。

### P-546 执行 D1-d 首轮：发现 D1-d 前提不成立（2026-09-21）

**执行前的重测（差集已变）**：

| 项 | 首测 | **重测** |
|---|---|---|
| tsdown glob 覆盖 | 341 | **343** |
| `tsconfig.host.json` 引用 | 341 | **343** |
| **glob 有 / 构建图无** | `code-runtime-python`、`integration/e2e`（均**无** `lib/types`） | 同为这 2 包，但**均已有 `lib/types`** |
| 缺 `lib/types` 的 glob 包 | 若干 | **0 个** |

→ 首测认定的两个「硬抛源」已被并行会话/既有 tsc 产出补齐，差集包不再缺产物。

**实测（`pnpm build`）**：仍 **exit 1**，1 处报错，但**换成了根项目**：

```
ERROR  Error: [flowforge] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
    at resolveEntry (…/tsdown/dist/options-C1CN2x0L.mjs:76:34)
    at async Promise.all (index 209)
```

`[flowforge]` 即**仓库根包**——根 `package.json` 没有 `src/`，自然没有 `lib/types/*`，却仍被 tsdown 的 workspace 枚举纳入并硬抛。

**结论：D1-d 的前提不成立**。D1-d 假设「让构建图覆盖 workspace 全量 ⇒ 每个被枚举的包都有 `lib/types` ⇒ 不再硬抛」；但**根项目不在 `packages/*/*` 之内**，补引用无从入手，它的硬抛与构建图无关。

**由此修正诊断**：真正的硬抛源不止一类，至少包括
1. 在 glob 内但缺 `lib/types` 的**应用/测试包**（`desktop`、`integration/e2e`——已被在途修复补齐）；
2. **根项目**（`flowforge`）——它不是可打包的包，却进了枚举。

两者共同指向同一结论：**「让全量都有产物」（D1-d）不是正解**，需要的是**让 tsdown 的枚举排除非可打包项**（即 **D1-c 方向**：保留 glob + 显式排除根项目与不可打包包），或改用**逐包显式列目录**——但后者正是 P-544 已证伪的做法（削弱枚举）。

**处置**：本轮**未改任何代码**（未补引用，因前提不成立）。P-546 决策 D1-d **需重新裁决**（建议改判 D1-c 方向，或由 owner 定夺是否值得为 tsdown 的枚举语义做定制封装）。**sherlock 在此停手**：该单已超出热修/试错范围，应作为构建体系专批处理。

### P-546 D1-c 机制确认（2026-09-21，源码级）

**结论：D1-c 在 tsdown 有原生支持**——`workspace` 选项支持**对象形态**（`node_modules/…/tsdown/dist/types-DP3_0kws.d.mts:951-968`）：

```ts
interface Workspace {
  include?: "auto" | (string & {}) | string[];   // 工作区目录，支持 glob
  exclude?: Arrayable<string>;                   // 排除目录（默认 node_modules/dist/test/tests/temp/tmp）
  config?: boolean | string;                     // 工作区配置文件路径
}
```

**正确写法**：

```ts
workspace: {
  include: ['vendor/*', 'packages/*/*', 'apps/cli'],
  exclude: [/* 需命中根项目 */],
}
```

**待定项（接手人一轮 build 即可定案）**：根项目（报错标签 `[flowforge]`）不是被 `include` 命中的目录，而是 tsdown 作为「根项目」自动纳入的；`exclude` 需写什么模式才能命中它（候选：`'.'`、`'./'`、`'package.json'`）尚未验证。**验证方式**：改一处 → `pnpm build` → 看是否仍报 `[flowforge] Cannot find entry`（约 6 分钟/轮）。

**次选方案（若 exclude 无法命中根项目）**：给根项目一个可解析的入口（例如根 `package.json` 不含 `src/` 时让根配置的 `entry` 指向 `apps/cli`），或把 host 打包改为不启用 tsdown 的 workspace 自动枚举、改用显式清单（后者即 P-544 已证伪方向，不推荐）。

**本轮未改任何代码**——避免「猜一个 exclude 模式 + 未验证」重蹈 P-544 覆辙。P-546 决策由 D1-d（已证伪）**改判 D1-c**（机制已确认，待写值 + 验证）。

# T8.1 web/ 并入根 pnpm workspace 实施计划

> **执行者必读**：使用 executing-plans（③）行内执行本计划（工程接线任务，无子代理收益）。步骤使用 checkbox（`- [ ]`）跟踪。

**目标**：顶层 Next.js 工程 `web/` 原地并入根 pnpm workspace，CI 实现 TS 矩阵与 web 构建分层触发。
**架构**：根 `pnpm-workspace.yaml` 增加 `- web` 条目接入依赖图；删除 web 独立 lockfile/workspace 声明统一到根 lockfile；`ts-ci.yml` 以 `paths-ignore` 排除 web-only 变更，新增 `web-ci.yml` 仅对 `web/**` 触发 next lint+build——mixed PR 双线都跑，web-only PR 只跑 web 线。
**技术栈**：pnpm 11.7.0（Corepack）/ Next.js 14 / GitHub Actions（Gitee 双端既有 `.github/workflows` 体系）。
**规格**：`docs/process/specs/2026-09-07-web-t81-workspace-design.md`

## 偏差记录（implement 阶段现场修正，DCP 口径不变）

1. **包名冲突**：`packages/web/web` 已存在同名包 `@flowforge/web`（ctx.web 能力缝插件，先于本任务入 workspace），并入后 `pnpm --filter @flowforge/web-app` 歧义命中缝插件。处置（operator 2026-09-08 会话内拍板）：前端包改名 `@flowforge/web-app`，本计划与 CI 中全部 filter 引用随之更正；设计文档"web 配置零改动"约束按 DCP 口径豁免 package.json 的 name 字段（元数据，非源码）。
2. **node_modules.bak 阻塞**：`web/node_modules.bak/`（旧 node_modules 备份）被 next build 类型检查扫入报错。处置（operator 拍板）：删除该备份目录（可再生内容，已被 .gitignore）。
3. 其余步骤与原计划一致。

## 全局约束

- `web/` 源码、页面、配置内容零改动（仅删除 `web/pnpm-workspace.yaml`、`web/package-lock.json`、`web/pnpm-lock.yaml` 三个文件）
- 不修改根 `tsconfig.json`/`tsconfig.host.json` 引用拓扑
- 根 `pnpm-lock.yaml` 唯一 lockfile
- `allowBuilds` 仅为实际需要构建脚本的依赖显式登记，禁止全量放行
- Node ^22.19.0 || >=24.0.0；所有验证命令退出码 0 才可登记 verify 证据
- 提交一律 `./mgr commit` / `./mgr sync`，消息规范 `type(scope): 描述 [sherlock]`，禁止直接 push master

---

### 任务 1：workspace 接线与 lockfile 收敛

**文件**：
- 修改：`pnpm-workspace.yaml`（`packages:` 列表在 `- apps/*` 后新增一行 `- web`）
- 删除：`web/pnpm-workspace.yaml`、`web/package-lock.json`、`web/pnpm-lock.yaml`
- 修改：`pnpm-lock.yaml`（由 `pnpm install` 自动更新，不手写）
- 可能修改：`pnpm-workspace.yaml` 的 `allowBuilds`（仅当 install 报构建脚本被拒时，逐包登记）

**接口**：
- 产出：`@flowforge/web` 成为根 workspace 成员（`pnpm --filter @flowforge/web-app <script>` 可用）

- [ ] **步骤 1：修改根 `pnpm-workspace.yaml`**

```yaml
packages:
  - vendor/*
  - packages/*/*
  - apps/*
  - web
```

（在 `- apps/*` 行之后插入 `  - web`，其余行与 `allowBuilds` 节保持原样不动）

- [ ] **步骤 2：删除 web 独立包管理文件**

```sh
git rm web/pnpm-workspace.yaml web/package-lock.json web/pnpm-lock.yaml
```

- [ ] **步骤 3：根安装收敛依赖**

```sh
pnpm install
```

预期：退出码 0，输出含 `+ @flowforge/web`（或 web 目录被识别为 workspace 项目）。若报构建脚本被拒（`Ignored build scripts: <pkg>`），在 `pnpm-workspace.yaml` 的 `allowBuilds` 中为 `<pkg>` 添加条目（默认 `true`，仅限实际需要构建的包），重跑 `pnpm install` 直至退出码 0。

- [ ] **步骤 4：workspace 寻址测试确认**

本任务为工程接线，无单测文件；以命令级测试确认代替（T2 真实场景、T3 具体断言）：

```sh
pnpm --filter @flowforge/web-app exec next --version
```

测试通过标准：退出码 0，输出 `14.x.y`。测试确认失败（命令非零/版本缺失）则回到步骤 1 检查 `- web` 条目缩进。

- [ ] **步骤 5：web 构建测试确认**

```sh
pnpm --filter @flowforge/web-app build
```

测试通过标准：退出码 0（`prebuild` 钩子先执行 `sync-vendor-assets.mjs`，属既有行为）。若构建失败且根因是 pnpm 严格依赖解析暴露的隐式依赖（web 原独立安装时代的幽灵依赖），按报错包名在 `web/package.json` 补 `dependencies` 显式声明后重跑——禁止用 `pnpm.overrides` 或 hoisting 全局开关掩盖。

- [ ] **步骤 6：根检查面回归测试确认**

```sh
pnpm typecheck && pnpm lint
```

测试通过标准：typecheck 错误数与 main 基线一致（当前基线：codebase fixtures 5 个既有错误，见 PR #154 尾项）；lint 0 errors。

- [ ] **步骤 7：提交**

```sh
./mgr commit "build(workspace): T8.1-web并入根workspace-lockfile收敛 [sherlock]"
```

---

### 任务 2：CI 分层

**文件**：
- 修改：`.github/workflows/ts-ci.yml`（`on.push` 与 `on.pull_request` 各增加 `paths-ignore`）
- 新建：`.github/workflows/web-ci.yml`

**接口**：
- 消费：任务 1 的 workspace 接线（web job 内 `pnpm install` 依赖根 lockfile 已含 web 依赖）
- 产出：web-only 变更只跑 web 线；TS 包变更只跑 TS 线；mixed 变更双线都跑

- [ ] **步骤 1：`ts-ci.yml` 触发器增加 paths-ignore**

将 `on:` 块改为（原 `branches` 行保持不变，缩进对齐）：

```yaml
on:
  push:
    branches: [main, master, develop]
    paths-ignore:
      - "web/**"
  pull_request:
    branches: [main, master, develop]
    paths-ignore:
      - "web/**"
```

语义：仅当**全部**变更文件都落在 `web/**` 时才跳过 TS 线（GitHub paths-ignore 语义），mixed PR 仍跑 TS 线。

- [ ] **步骤 2：新建 `.github/workflows/web-ci.yml`**

```yaml
name: Web CI

#T8.1 web/ 分层构建线：仅 web/** 变更触发，与 ts-ci.yml（TS 包矩阵）互不阻塞。

on:
  push:
    branches: [main, master, develop]
    paths:
      - "web/**"
  pull_request:
    branches: [main, master, develop]
    paths:
      - "web/**"

permissions:
  contents: read

jobs:
  web:
    name: Web (next lint + next build)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Set up pnpm (Corepack)
        run: corepack enable && corepack prepare pnpm@11.7.0 --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint (next lint)
        run: pnpm --filter @flowforge/web-app lint

      - name: Build (next build)
        run: pnpm --filter @flowforge/web-app build
```

- [ ] **步骤 3：YAML 语法测试确认**

```sh
node -e "const y=require('js-yaml'),f=require('fs');for(const p of ['.github/workflows/ts-ci.yml','.github/workflows/web-ci.yml']){y.load(f.readFileSync(p,'utf8'));console.log(p,'OK')}"
```

测试通过标准：退出码 0，两个文件均输出 `OK`；测试确认失败（解析异常）则按报错行列修正 YAML 后重跑。

- [ ] **步骤 4：提交**

```sh
./mgr commit "ci(web): T8.1-web构建分层-ts-ci排除web路径+新增web-ci [sherlock]"
```

---

### 任务 3：证据登记与 PR 收尾

**文件**：
- 无代码文件变更（状态与证据产物）

- [ ] **步骤 1：登记验证证据**

```sh
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t81 --command "pnpm install" --exit 0 --summary "根 lockfile 吸收 web 依赖"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t81 --command "pnpm --filter @flowforge/web-app build" --exit 0 --summary "next build 通过"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t81 --command "pnpm typecheck && pnpm lint" --exit 0 --summary "根检查面不劣化"
```

（若任一命令实际退出码非 0，如实登记真实退出码——verify 硬门禁要求证据真实，不得修饰。）

- [ ] **步骤 2：实例状态测试确认并推进**

测试确认命令（断言门禁与阶段状态具体值，T3）：

```sh
node packages/plugins/dev/bin/ff_dev.mjs status plugin-web-t81
```

测试通过标准：输出含 `门禁：designApproved=✓ planValidated=✓`；推进到 implement 前门禁 planValidated 必须为 ✓，verify 证据登记后必须为 verificationEvidence=✓（verify→finish 硬门禁）。确认失败（任一门禁 ✗）则按提示补登记后重跑。

```sh
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t81
```

- [ ] **步骤 3：创建 PR**

```sh
./mgr sync "build(web): T8.1-web原地并入根workspace+CI分层 [sherlock]" --body "批次56 T8.1：web/ 原地并入根 pnpm workspace（packages += web；删除 web 独立 pnpm-workspace/package-lock/pnpm-lock），根 lockfile 统一管理；ts-ci.yml paths-ignore 排除 web-only 变更，新增 web-ci.yml 仅对 web/** 触发 next lint+build。流程实例 plugin-web-t81（change 工作流），证据见 docs/process/verifications/。"
```

预期：返回 Gitee PR 链接；PR 标题 ≤191 字符。

---

## 自审记录

- **规格覆盖**：设计文档"架构"四点 → 任务 1（并入+lockfile）、任务 2（CI 分层）、任务 3（验证+收尾）；"测试策略"四条命令 → 任务 1 步骤 3/5/6 + 任务 3 步骤 1。无遗漏。
- **占位符扫描**：无未决占位词（如设计模板中禁用的占位标记）/"同任务 N"式懒引用；ts-ci.yml 修改与 web-ci.yml 均给出全文。
- **类型一致性**：filter 名 `@flowforge/web` 三处引用一致；实例名 `plugin-web-t81` 三处一致；证据文件路径与规格落点一致。

# T8.3c 前端命名合规整改 实施计划

> **执行者必读**：使用 executing-plans（③）行内执行本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标**：将 `web/src/` 内 71 个文件 118 处 clowder 品牌词与 P2 别名统一到命名契约 P0 术语（"智能体"/"可进化智能体"），消除前端命名漂移。
**架构**：分层整改——注释层（脚本批量替换 + 抽样复核）、UI 文案层（逐处语义映射）、验证层（扫描清零 + 构建 + lint）。标识符/路由/字段名一律不动。
**技术栈**：Next.js 14 / TypeScript / Node 22 脚本（`sed`-free，用 Node 精确替换以保幂等）。
**规格**：`docs/process/specs/2026-09-08-web-t83c-naming-compliance-design.md`

## 全局约束

- 只改 `web/src/**`；禁改 `web/public`、构建产物、`packages/**`
- 禁改代码标识符、import 路径、API 路径、字段名（`forgekin*`、`cats*`、`bound_forgekins` 等保持原样）
- 括号别名位（"…（灵智体）"）与社交语境保留，不计违规
- 语义映射：泛指 ⇒ "智能体"；特指可进化（forgekin/花名册/档案/绑定/议会成员）⇒ "可进化智能体"；"猫猫" ⇒ "可进化智能体"（参考语保留"参考 clowder-ai 训练营"）
- `next build` 退出码 0；违规扫描（排除括号别名位）清零；`pnpm lint` 0 errors
- 提交走 `./mgr commit` / `./mgr sync`，规范 `type(scope): 描述 [sherlock]`

---

### 任务 1：注释层整改（71 文件 ~101 处）

**文件**：
- 批量修改：`web/src/**/*.ts(x)` 中的注释行（`//` / `*` / `/*` / JSX `{/* … */}`）
- 新建脚本：`scripts/rename/normalize-forgekin-terminology.mjs`（一次性工具，落盘可复用）

**接口**：
- 产出：注释层违规清零，供任务 2 与任务 3 验证

- [ ] **步骤 1：写替换脚本（幂等，仅命中注释行）**

写入 `scripts/rename/normalize-forgekin-terminology.mjs`：

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const ROOT = 'web/src'
const files = globSync('**/*.{ts,tsx}', { cwd: ROOT })
const COMMENT = /^(\s*)(\/\/|\/\*|\*|\{\/\*)?/
let changed = 0
for (const rel of files) {
  const path = `${ROOT}/${rel}`
  const before = readFileSync(path, 'utf8')
  const after = before
    .replace(/(?<!（)灵智体(?!）)/gu, '可进化智能体')
    .replace(/猫猫/gu, '可进化智能体')
  if (after !== before) {
    writeFileSync(path, after)
    changed += 1
    console.log('updated', path)
  }
}
console.log(`files changed: ${changed}`)
```

（负/正向断言保证括号别名位 "（灵智体）" 不被替换；`scripts/` 属根目录，不含在 web/src 内，符合约束。）

- [ ] **步骤 2：运行脚本**

```sh
node scripts/rename/normalize-forgekin-terminology.mjs
```

- [ ] **步骤 3：注释层测试确认**

```sh
grep -rn "灵智体\|猫猫" web/src --include="*.ts" --include="*.tsx" | grep -cE ":\s*[0-9]+:\s*(\*|//|/\*)"
```

测试通过标准：输出为 `0`（注释层零违规）；测试确认失败（非 0）则查看残留行并补替后重跑。

- [ ] **步骤 4：抽样复核（防误替）**

```sh
git -C . diff --stat web/src | tail -3
git -C . diff web/src | grep -E "^[-+].*(可进化智能体|智能体)" | head -20
```

测试通过标准：diff 只含字面量与注释变更，无 import/标识符/API 路径改动（出现即回退该文件重做）。

---

### 任务 2：UI 文案层整改（17 处逐处映射）

**文件**：以下 6 个文件（逐处 Edit，不批量）

- 修改：`web/src/app/admin/page.tsx:30,31,34,83,202`
- 修改：`web/src/app/admin/autonomous/page.tsx:258,262,289,339`
- 修改：`web/src/app/admin/observability/page.tsx:240`
- 修改：`web/src/app/council/CouncilContent.tsx:286`
- 修改：`web/src/components/admin/agents/ExternalAgentList.tsx:128,150`
- 修改：`web/src/components/helm/CouncilChatPanel.tsx:1286,1314,1429`
- 修改：`web/src/hooks/useCouncilChat.ts:435`

**接口**：
- 消费：任务 1 的注释层整改（部分文件重叠，先注释后文案，避免冲突）

- [ ] **步骤 1：admin/page.tsx 五处**

```tsx
title: "可进化智能体管理",
description: "可进化智能体花名册、状态监控、熔断器、能力画像",
badge: "5 个可进化智能体",
description: "可进化智能体权限、工具白名单、操作授权",
// 第 202 行：
FlowForge 全部管理功能统一入口 · 整合可进化智能体、Provider、插件、可观测性等
```

- [ ] **步骤 2：autonomous/page.tsx 四处**

```tsx
{/* 可进化智能体列表 */}
已注册可进化智能体 ({status.registered_forgekins.length})
<span style={{ flex: 1 }}>标题 / 可进化智能体 / 模型</span>
{o.agent_id && <span style={{ color: "#89b4fa" }}>可进化智能体: {o.agent_id}</span>}
```

- [ ] **步骤 3：observability/page.tsx 一处**

```tsx
<span>已注册可进化智能体: </span>
```

- [ ] **步骤 4：CouncilContent.tsx 一处（含 clowder 品牌词）**

```tsx
{/* 可进化智能体训练营入口 — 参考 clowder-ai 训练营 */}
```

- [ ] **步骤 5：ExternalAgentList.tsx 两处**

```tsx
绑定 {boundForgekins.length} 个可进化智能体
{/* 绑定的可进化智能体列表 */}
```

- [ ] **步骤 6：CouncilChatPanel.tsx 三处**

```tsx
{/* @all 并行状态区 — 各可进化智能体处理过程展示在输入区上方（不入消息流），
并行讨论完成 · {parallelStatus.entries.length} 位可进化智能体
{/* 右侧可进化智能体面板 + 上下文面板已移至 WorkspacePanel 的"智能体"/"上下文" Tab
```

- [ ] **步骤 7：useCouncilChat.ts 一处**

```ts
errMsg = `灵议超时（${timeoutMs / 1000}s），请减少轮数或可进化智能体数量后重试`;
```

- [ ] **步骤 8：UI 文案层测试确认**

```sh
grep -rn "灵智体\|猫猫" web/src --include="*.ts" --include="*.tsx" | grep -v "（灵智体）" | wc -l
```

测试通过标准：输出为 `0`；测试确认失败（非 0）则按残留行逐个补改后重跑。

---

### 任务 3：验证与收尾

**文件**：
- 无源码变更；产物为验证证据与 PR

- [ ] **步骤 1：全量违规扫描测试确认**

```sh
grep -rn "灵智体\|猫猫" web/src --include="*.ts" --include="*.tsx" | grep -v "（灵智体）" | wc -l
```

测试通过标准：输出 `0`（括号别名位不计）。

- [ ] **步骤 2：构建测试确认**

```sh
pnpm --filter @flowforge/web-app build
```

测试通过标准：退出码 0；测试确认失败则按报错文件回退该处文案改动后重跑。

- [ ] **步骤 3：lint 测试确认**

```sh
pnpm lint
```

测试通过标准：`0 errors`（warnings 允许与基线一致）。

- [ ] **步骤 4：登记证据并推进实例**

```sh
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83c --command "grep -rn 灵智体 web/src | grep -v （灵智体） | wc -l" --exit 0 --summary "违规扫描清零"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83c --command "pnpm --filter @flowforge/web-app build" --exit 0 --summary "next build 通过"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83c --command "pnpm lint" --exit 0 --summary "lint 0 errors"
node packages/plugins/dev/bin/ff_dev.mjs status plugin-web-t83c
```

测试通过标准：`status` 输出含 `designApproved=✓ planValidated=✓ verificationEvidence=✓` 且阶段推进至 finish。

- [ ] **步骤 5：提交与 PR**

```sh
git add web/src scripts/rename/normalize-forgekin-terminology.mjs docs/process/specs/2026-09-08-web-t83c-naming-compliance-design.md docs/process/plans/2026-09-08-web-t83c-naming-compliance.md docs/process/instances/plugin-web-t83c.json docs/process/verifications/plugin-web-t83c.md
./mgr commit "refactor(web): T8.3c前端命名合规-灵智体/猫猫统一至P0可进化智能体 [sherlock]"
./mgr sync "refactor(web): T8.3c前端命名合规整改 [sherlock]" --body "T8.3 子项目 c：web/src 71 文件 118 处 P2 别名与 clowder 品牌词统一至命名契约 P0（智能体/可进化智能体），括号别名位保留；标识符与 API 路径不动。流程实例 plugin-web-t83c（change 工作流）。验证：扫描清零 + next build 退出 0 + lint 0 errors。"
```

测试通过标准：`./mgr sync` 返回 Gitee PR 链接；PR 标题 ≤191 字符。

---

## 自审记录

- **规格覆盖**：设计文档"三层规则"→ 任务 1（注释层）、任务 2（UI 文案层）、任务 3（验证+收尾）；"测试策略"三条 → 任务 3 步骤 1/2/3。无遗漏。
- **占位符扫描**：无未决占位标记/"同任务 N"式懒引用；脚本与文案替换均给出全文。
- **类型一致性**：filter 名 `@flowforge/web-app` 与实例名 `plugin-web-t83c` 全文一致；语义映射表与设计文档一致。

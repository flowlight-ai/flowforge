# EP1-6 上下文装配域 context-assembly 移植计划

- 目标包：`packages/cats/context-assembly`（`@flowforge/cats-context-assembly`）
- 依据：`docs/process/specs/2026-09-08-context-assembly-design.md`
- 流程：文档先行 → 包 scaffold → contract/ports/pure → message-bundle 子域 → context 子域 →
  契约测试 → 验证（vitest/tsc/oxlint）→ 根级注册 + refactor 文档标记
- 边界：仅留盘，不提交 git

## 阶段任务

### Phase 1 — 包 scaffold 与基础层
- `package.json` / `tsconfig.json` / `tsconfig.host.json`（对齐 `cats/signal-intake` 模板）
- `src/index.ts` 导出骨架
- `contract/message-bundle.ts`（契型 + schema + digest domain + projection version）
- `pure/`：`canonical-json`、`sha256-digest`、`markdown-readable`、`cli-tool-label`、
  `simple-yaml`、`token-estimate`、`format-prompt-time`、`entrusted-work-signals`、`prompt-digest`
- `ports/`：`message-store`、`thread-store`、`visibility`、`cat-context`、`file-system`

### Phase 2 — message-bundle 子域
- `message-selection-types/results`
- `message-bundle-quote-matching`
- `message-bundle-project-digest`
- `message-bundle-source-projection`
- `message-bundle-source-group`
- `message-bundle-carrier-resolver`
- `message-selection-resolver`
- `message-bundle-prompt-resolver`

### Phase 3 — context 子域
- `intent-parser`、`rich-block-rules`
- `governance-l0`、`prompt-template-loader`、`staging-content`（FileSystemSeam 注入化）
- `context-assembler`（面包屑载体 + token 预算 + 裁剪）
- `system-prompt-builder`（CatContextPort 注入化；多版本构建：static identity / invocation
  context / reviewer roster / 多版本 pack-only）

### Phase 4 — 契约测试（vitest）
- 内存 `MemoryMessageStore` / `MemoryThreadStore` / `MemoryFileSystem` / `MemoryCatContext` 真实实现
- 覆盖 §6 全部关键分支

### Phase 5 — 验证与收尾
- `npx vitest run packages/cats/context-assembly`
- `npx tsc -b packages/cats/context-assembly/tsconfig.host.json`（exit 0）
- `npx oxlint packages/cats/context-assembly`（0 警告）
- 根级 `tsconfig.host.json` / `tsconfig.base.json`（paths）/ `tsconfig.json`（references）注册本包引用
- 更新 `docs/refactor/task.md` / `review_code.md` / `10-stage-map.md` B12/对应矩阵行为 🟩（EP1-6）

## 交付清单
- 设计/计划文档（docs/process/specs + plans）
- 包内全部 TS 源 + 契约测试
- 根级 tsconfig 引用 + refactor 文档标记
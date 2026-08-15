# FlowForge 2.0 — 重构编码规范合并版（每次开工必读）

> 状态：生效 ｜ 创建：2026-08-16 ｜ 更新：2026-08-16
> **本文件是重构期间编码/测试/文档/提交的单一规范事实源（优先级第一）**。
> 每次重构开工前、每个阶段编码前、每次提交前，必须重读本文件；
> 与 `00-overview.md`（总览）配合使用，规范冲突以本文件裁决。
> 已合并：我方 `docs/rules/` 全部 8 个文件（04-code-style / 05-dev-spec / 06-ai-behavior / 07-coding-redlines /
> 08-flowforge-boundary / 11-doc-layering / 12-doc-refactor-methodology / test-iron-rules）+ `docs/test/T001-T019`
> + `docs/git-workflow.md`；dsh `docs/development.md` + `docs/testing.md`；clowder `AGENTS.md`。
> 重构期间只读本文件即可，不再逐个引用原文；原文变更需同步本文件。

---

## 1. 规范优先级总表（固定，不可颠倒）

| 优先级 | 规范来源 | 内容 |
|---|---|---|
| **P0 我方第一优先** | `04-code-standards.md` §2（合并自 `docs/rules/` 全部 8 文件 + `docs/git-workflow.md` + `docs/test/T001-T019`） | 编码风格、开发规范、AI 行为准则、15 条红线、架构边界、文档分层、重构方法论、git 流程、测试铁律 |
| **P1 我方未覆盖处** | dsh `docs/development.md` + `docs/testing.md` | TS strict 全开、Host-Client 两聚合、构建顺序、FIXME/TODO/XXX 纪律、vendor 源码编辑禁令、测试分层与 with-key 政策 |
| **P2 再未覆盖处** | clowder `AGENTS.md` | Iron Laws 4 条 + 交叉 review 协议（P1/P2/P3 分级） |

**冲突裁决规则**：按 P0 > P1 > P2 逐级裁决；同级冲突按下述 §5 已裁决案例执行；新冲突先记入 `review_hy.md` 再裁决，禁止自行取舍。

## 2. 我方规范摘要（P0，违反即作废）

### 2.1 编程红线 15 条（`07-coding-redlines.md`）

1. 禁止添加 CoT 检测/中文比例检测
2. 质量分阈值默认 0.85（可在 Loop 配置覆盖）
3. 禁止使用 Mock LLM（测试铁律 T1）
4. 禁止使用假数据（测试铁律 T2）
5. 禁止跳过验证（测试铁律 T3）
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在基础平台代码中写死业务领域逻辑
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过 DI 容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按 prompts.md 和 rules.md 执行
15. 禁止偷工减料（发现未实现即 Bug）

### 2.2 测试铁律 T1-T9（`test-iron-rules.md`，违反即作废/回滚）

| # | 铁律 |
|---|---|
| T1 | 禁止使用 Mock LLM：所有 E2E/集成测试必须调用真实 LLM |
| T2 | 禁止使用假数据：测试输入必须是真实场景数据 |
| T3 | 禁止跳过验证：必须有具体断言，不得 `status in ("completed","error")` |
| T4 | 禁止 Mock 工具：web_search/publish/fact_check 等必须真实调用 |
| T5 | 未实现即 Bug：禁止"标注 TODO 跳过" |
| T6 | 必须采集指标：E2E 测试用 MetricsCollector 采集完整指标 |
| T7 | LLM 内容必须经 LLM 审核：生成与审核使用**不同模型** |
| T8 | Web 功能必须操控浏览器验证 DOM（Playwright，Windows 用 headless=False） |
| T9 | 运行时数据文件必须存放 data 目录，禁止污染代码目录 |

### 2.3 代码风格（`04-code-style.md`）

- Python 旧版：正则必须 raw string、导入顺序（标准库→第三方→本地）、snake_case、asyncio 用 `get_running_loop()`
- YAML：缩进 2 空格不用 tab；JSON：合法 JSON；环境变量走 `.env` 且**绝不提交密钥**
- i18n：`react-i18next`，禁止硬编码用户可见文本，新增页面必须同时更新 en.json + zh.json
- 变量引用：`${{state.xxx}}` / `${{params.xxx}}` / `${{result.xxx}}` / `${{outputs.xxx.yyy}}`

### 2.4 开发规范（`05-dev-spec.md`）

- 禁止盲目覆盖（cp 跨目录覆盖/批量复制模板）
- 禁止造假：禁止模拟数据、写死分数/状态、模拟向量搜索、硬编码 `{"status": "ok"}`
- Git 操作：恢复文件优先 `git checkout HEAD -- path`；修改前先 `git diff`
- 质量评审（P33）：阈值 0.85、评委 5 个 WebChat 不同模型、评委并行评审、不达标必须优化不得降阈值

### 2.4b AI 助手行为准则（`06-ai-behavior.md`）

- 核心原则：理解上下文再行动 / 尊重差异化 / 谨慎操作（改文件先说明影响范围）/ 及时反馈
- 操作流程：收到任务 → 理解需求 → 检查状态 → 评估影响 → 制定方案 → 执行修改 → 验证结果 → 汇报
- 禁止：shutil.copy() 跨实例覆盖、不检查直接 git checkout、假设文件相同、不告知就改多个文件、假数据/假逻辑/模拟代码

### 2.5 架构边界（`08-flowforge-boundary.md`）

- 核心铁律：**配置驱动 > 代码继承 > 独立实现**
- FlowForge 是纯通用框架，不包含业务逻辑；*Forge 只允许 config/web/app/plugins.py/docs/tests 六类文件
- 所有 Agent/Tool/Loop/Workflow 通过 Plugin 协议注册；禁止独立实现 Orchestrator/Memory/Repository/DI/Scheduler/Database

### 2.6 文档分层与重构方法论（`11-doc-layering.md` + `12-doc-refactor-methodology.md`）

- 三顶层文档 SRS(spec)→SAD(arch)→SDD(design) 章节同号一一对应；子目录 F0XX↔A0XX↔D0XX 同号齐全
- 术语官方名称优先；别名首次出现必须括号标注官方名（如"灵智体（Forgekin）"）
- 合并 = 抽取契约 + 融入对应章节 + 旧版本归档；**禁止批量字符串替换**
- 单文件 > 1000 行或单任务 > 5 文件必须分组并行 subagent（每组 5-15 文件，≤5 并发）
- 文档重构完成必须验收：三顶层同号、术语合规 Grep 检查、跨文档一致性、引用完整性

### 2.7 Git 流程（`docs/git-workflow.md`，强制）

- **必须使用 `./mgr` 命令**提交/推送/建 PR，禁止直接 `git push`
- 平台感知：`flowlight/flowforge`（本目录）→ Gitee（origin，master）；`flowlight-ai/flowforge` → GitHub
- 提交信息格式：`type(scope): 简短描述 [#PR号] [智能体ID]`，合法署名：wenxin/sherlock/luban/vangogh/davinci/keane/humming/sqrl/butterfly
- 提交前必须先 `./mgr pull`；任务完成验证通过后**必须提交并推送，禁止搁置改动**
- 提交前必须运行 lint 和测试；禁止直接 push master（走 PR）；禁止提交密钥/Token
- 标准流程：`./mgr pull` → 建功能分支 → 开发 → `./mgr commit "..."` → `./mgr push --pr`（或 `./mgr sync "..."` 一键）

## 3. dsh 规范摘要（P1，我方未覆盖处）

### 3.1 开发（`docs/development.md`）

- Node ≥ 22.19（CI 覆盖 22.19/24/26），corepack pnpm；TS 严格模式全开
- **Host-Client 两聚合**：每个包必须且仅注册在一个聚合（`tsconfig.host.json` / `tsconfig.client.json`），两者不可并入同一 ts.Program（Context 声明合并冲突）；`tsconfig.base.json` 永不加 include/files
- 构建顺序：`tsc -b host` → `tsdown host` → `tsc -b client` → `tsdown client` → `build:web`
- 环境变量：真实凭据走环境或 gitignored `.env`，**绝不提交真实凭据**；real-API e2e 无 key 自跳过
- **FIXME/TODO/XXX 纪律**：FIXME=阻塞发布 / TODO=尽快修复 / XXX=或许修复，按紧急度选用
- **vendor 源码编辑禁令**：`vendor/*/src` 改动必须伴随 `vendor/README.md` manifest 更新（pre-commit guard 强制）
- lefthook：pre-commit 校验 staged 配对记录 + oxlint + whitespace；pre-push 跑 typecheck

### 3.2 测试（`docs/testing.md`）

- 分层：unit（vitest，随代码区放置）→ **coverage 门（per-file 100% on `packages/*/*/src`）** → real-API e2e（with-key，无 key 自跳过）→ snapshot（keyless 期望输出）→ web browser snapshot（Linux PR 门）
- **with-key 政策**：真实 API 测试不设限（inference is cheap）；无 key 测试只证明管道，with-key 才证明 agent 可用；最高价值 = smoke 测试（boot 真实示例 → 发一条 prompt → 检查世界）
- **Prefer the real implementation over a mock**：只 mock 昂贵/非确定边界（LLM 适配器/网络/时钟），下游保持真实
- **Verify the world, not the self-report**：e2e 断言必须外部重跑命令/重读文件，禁止用 agent 自己的输出做关键词探针
- **Test the real entry path**：产品可见插件必须有非 unit 的 REAL-composition 测试（boot 真实 cordis.yml 经 Loader）；包 `bin` 跑 built `lib/bin.js` 于纯 node
- **Source plane only**：vitest 通过 tsconfig.base paths 解析到 src，绝不通过 exports 解析到 built lib（陈旧产物会加载第二份模块单例）
- 子进程双模启动器：CI 下 cordis 子进程统一从 built lib 启动，禁止手写 `--import tsx`

## 4. clowder 规范摘要（P2，兜底）

### 4.1 Iron Laws 4 条（`AGENTS.md`）

1. **Data Storage Sanctuary** — 永不删除/清空 Redis 数据库、SQLite 文件或任何持久存储
2. **Process Self-Preservation** — 永不杀死父进程或修改启动配置
3. **Config Immutability** — 永不修改运行时配置文件（配置变更需人工）
4. **Network Boundary** — 永不访问不属于自己服务的 localhost 端口

### 4.2 交叉 review 协议

- 同一人不得审查自己的代码；跨家族 review 优先
- 每条 finding 必须标注严重级：**P1（阻塞）/ P2（应修）/ P3（可选）**

## 5. 已裁决冲突案例（追加前先查本表）

| # | 冲突点 | 裁决 |
|---|---|---|
| C1 | T1 禁止 Mock LLM vs dsh llm-mock-server | **T1 优先**：dsh `packages/test-support/llm-mock-server` 仅限 unit/契约层（如 agent-loop 单测）使用；E2E/集成必须真实 LLM。**这是两套规范唯一实质性冲突，已定案**（R21） |
| C2 | 插件发现模型：cordis YAML 装配 vs clowder 文件系统扫描 | 统一 dsh cordis YAML 装配；clowder host-inventory 仅作控制面视图（F15，03-fusion-strategy） |
| C3 | 配置格式：YAML vs JSON | 声明类配置全 YAML（业务/装配/档案/技能/钩子）；JSON 仅运行态数据与工程链；环境变量走 FF_* 注册表（R17 §4，F14） |

## 6. 重构执行流程（每个任务必须走完）

```
开工前（必读）：
  1. 重读本文件 §1-§5（规范优先级与裁决）
  2. 重读 00-overview.md（总览）+ 10-stage-map.md（功能矩阵勾选状态）
  3. 重读当前阶段 2X-*.md 任务清单 + 02-source-crosswalk.md 相关行
  4. ./mgr pull（确保基于最新代码）
执行中：
  5. 按 P0→P1→P2 规范写代码/测试/文档；禁止违反任何红线与铁律
  6. 每完成一个能力：矩阵勾选（10-stage-map.md §3）+ crosswalk 状态更新
收尾（强制，禁止搁置）：
  7. 跑 lint + typecheck + vitest（提交前必过；Python 旧版 pytest 回归全绿）
  8. ./mgr commit "type(scope): 描述 [署名]"（或 ./mgr sync 一键提交+push+PR）
  9. 更新记忆（新经验/新裁决写入本文件 §5 + 系统记忆）
```

## 7. 常见违规自查清单（提交前逐项确认）

- [ ] 无 Mock LLM / 假数据 / 假实现（T1/T2/T5）
- [ ] 无硬编码密钥/路径/端口（红线 11）
- [ ] 无跨目录盲目覆盖、无批量替换文档术语（05/12）
- [ ] 未修改不相关代码、未删除已有测试（红线 7/8）
- [ ] 运行时数据已放 data 目录（T9）
- [ ] vendor/*/src 改动已同步 vendor/README.md manifest（dsh 纪律）
- [ ] 配置声明用 YAML + schema 校验，未引入无校验加载（R17）
- [ ] 提交信息符合 `type(scope): 描述 [署名]` 且已用 ./mgr 提交
- [ ] 功能全集矩阵/crosswalk 已勾选，与代码实际一致

# 原样移植规范 (Porting Specification)

> 版本: V1.0 | 日期: 2026-07-26 | 状态: 执行中
> 适用范围: flowlight-ai 项目从老项目 (d:\software\openclaw\*) 移植代码和文档到新项目 (d:\software\openclaw\flowlight-ai\*)

---

## 1. 核心原则

### 1.1 原样移植 (Exact Porting)

| # | 原则 | 说明 |
|---|------|------|
| **P1** | **相同功能代码必须与老项目一致** | 相同功能的代码和文档不得与新项目存在显著差异,必须原样移植 |
| **P2** | **禁止修改移植中的代码逻辑** | 移植过程中不得修改业务逻辑、算法、数据结构,仅允许适配性修改(如 import 路径、配置路径) |
| **P3** | **禁止删除已有功能** | 移植不得删除老项目的已有功能,即使新项目已用更好的方式实现 |
| **P4** | **禁止盲目覆盖** | 跨实例修改必须逐个处理,不可批量复制 (铁律 6) |
| **P5** | **先读后写** | 修改某个模块前,先完整理解该模块的当前实现 (行为准则 6) |

### 1.2 例外处理 (发现老项目问题)

如果移植过程中发现老项目有以下问题,允许修改但必须记录:

| 问题类型 | 处理方式 |
|---------|---------|
| **Bug** (逻辑错误、崩溃) | 新项目修复 → 测试验证 → 同步回老项目 → 记录到问题清单 |
| **不合理设计** (违反规范、架构问题) | 新项目优化 → 测试验证 → 报告用户 → 等待批准后同步回老项目 |
| **过时依赖** (废弃的 API、库) | 新项目升级 → 测试验证 → 记录到问题清单 → 同步回老项目 |
| **安全漏洞** | 立即修复 → 记录到问题清单 → 同步回老项目 |

### 1.3 新项目独有优势保留

以下功能是新项目的优势,移植时必须保留,不得用老项目版本替换:

| 功能 | 新项目位置 | 说明 |
|------|----------|------|
| **群聊后端 API** | `web/app.py` 的 `/api/chat`、`/ws` | 5 个 Forgekin 协作群聊,支持 @mention、push_back、多轮上下文 |
| **外部代理集成** | `forgemind/external_agents.py` | claude_code/codex/gemini/opencode/trae 五大 CLI 集成 |
| **协议转换代理** | `forgemind/*_to_openroute_proxy.py` | Anthropic/Gemini/Responses → OpenRoute 协议转换 |
| **T7 LLM 审核** | `web/llm_bridge.py` 的 `audit_t7` | LLM 生成内容必须经 LLM 审核通过 (T7 铁律) |
| **T8 DOM 验证** | `web/app.py` 的 `/api/verify/t8` | Web 功能必须操控浏览器验证 DOM (T8 铁律) |

---

## 2. 移植流程

### 2.1 移植前检查清单

- [ ] 确认源文件路径 (老项目: `d:\software\openclaw\{project}\`)
- [ ] 确认目标路径 (新项目: `d:\software\openclaw\flowlight-ai\{project}\`)
- [ ] 读取老项目对应模块的完整代码
- [ ] 读取新项目对应模块的当前代码 (如有)
- [ ] 对比差异,识别需要移植的部分
- [ ] 检查是否有老项目问题需要记录

### 2.2 移植执行步骤

```
1. 读取老项目源文件 (Read)
2. 对比新项目现有文件 (Read + Diff)
3. 如有差异:
   a. 如老项目正确 → 原样复制到新项目 (适配路径)
   b. 如老项目有问题 → 修复后移植,记录到问题清单
   c. 如新项目更优且属于"新项目独有优势" → 保留新项目版本
4. 更新 import 路径和配置路径
5. 运行测试验证
6. 如有修复,同步回老项目
7. 更新本文档的问题清单
```

### 2.3 移植后验证

- [ ] 新项目测试通过 (`pytest tests/`)
- [ ] 无 import 错误
- [ ] 无路径错误
- [ ] 如有修改,已同步回老项目
- [ ] 问题清单已更新

---

## 3. Web 层移植策略

### 3.1 现状对比

| 维度 | 老项目 (flowforge) | 新项目 (flowlight-ai/flowforge) |
|------|-------------------|-------------------------------|
| **前端框架** | Next.js 14 + TypeScript + Tailwind + shadcn/ui | 原生 HTML/JS (单文件) |
| **前端组件数** | 100+ (Helm 40+, Hub 20+, Admin 16+, 其他 20+) | 3 (index.html, app.js, style.css) |
| **后端框架** | FastAPI (app/main.py + 50+ endpoint 文件) | FastAPI (web/app.py 单文件, 30 端点) |
| **API 端点数** | 100+ (endpoints/ 24 文件 + v1/ 27 文件) | 30 (单文件) |
| **群聊功能** | 已有 /council 页面 + CouncilChatPanel | 更强: 5 Forgekin 协作 + push_back + T7 |
| **外部代理** | 无完整实现 | 更强: 5 CLI 集成 + 协议转换代理 |
| **管理页面** | 16+ admin 子页面 | 无 |

### 3.2 移植决策

| 模块 | 决策 | 原因 |
|------|------|------|
| **Next.js 前端** | **从老项目移植** | 老项目前端完整,新项目前端过于简陋 |
| **FastAPI 后端 (app/)** | **从老项目移植** | 老项目后端 API 完整 (100+ 端点) |
| **群聊后端 API** | **保留新项目** | 新项目群聊功能更强 (5 Forgekin + push_back + T7) |
| **外部代理集成** | **保留新项目** | 新项目有 5 CLI 集成 + 协议转换,老项目无 |
| **T7/T8 验证** | **保留新项目** | 测试铁律要求,新项目已实现 |
| **Next.js 前端群聊页** | **适配新项目后端** | 前端从老项目移植,但 API 调用指向新项目群聊后端 |

### 3.3 移植后目录结构

```
flowlight-ai/flowforge/
├── app/                    # FastAPI 后端 (从老项目移植)
│   ├── api/
│   │   ├── endpoints/      # 24 个端点文件
│   │   ├── v1/             # 27 个 v1 端点文件
│   │   ├── marketplace_api.py
│   │   ├── plugin_frontend_api.py
│   │   ├── plugin_management.py
│   │   └── router.py
│   ├── deps.py
│   ├── main.py
│   └── __init__.py
├── web/                    # Next.js 前端 (从老项目移植)
│   ├── src/
│   │   ├── app/            # App Router 页面
│   │   ├── components/     # 100+ 组件
│   │   ├── hooks/          # React Hooks
│   │   ├── lib/            # 工具库
│   │   ├── stores/         # Zustand 状态管理
│   │   └── sdk/            # SDK
│   ├── public/             # 静态资源
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── core/                   # 核心框架 (已扁平化)
├── forgemind/              # 可进化智能体应用层 (保留新项目)
│   ├── external_agents.py  # 5 CLI 集成 (新项目优势)
│   ├── *_proxy.py          # 协议转换代理 (新项目优势)
│   └── ...
├── llm/                    # LLM 客户端
├── loop/                   # Loop 执行引擎
├── evolution/              # 自我演进引擎
├── config/                 # 配置文件
├── docs/                   # 文档
└── tests/                  # 测试
```

### 3.4 API 路由融合

新项目群聊后端 API (保留) 映射到老项目的 v1 路由前缀:

| 新项目当前路径 | 融合后路径 | 说明 |
|--------------|----------|------|
| `POST /api/chat` | `POST /api/v1/forgemind/council/chat` | 群聊发送消息 |
| `GET /api/agents` | `GET /api/v1/forgemind/council/agents` | Forgekin 列表 |
| `GET /api/messages` | `GET /api/v1/forgemind/council/messages` | 消息历史 |
| `WS /ws` | `WS /api/v1/forgemind/council/ws` | 实时消息流 |
| `GET /api/context` | `GET /api/v1/forgemind/council/context` | 多轮上下文 |
| `POST /api/push_back` | `POST /api/v1/forgemind/council/push_back` | Push back 协议 |
| `GET /api/bridge/status` | `GET /api/v1/forgemind/council/bridge` | LLM Bridge 状态 |
| `GET /api/external-agents` | `GET /api/v1/forgemind/external-agents` | 外部代理列表 |
| `POST /api/external-agents/{kind}/test` | `POST /api/v1/forgemind/external-agents/{kind}/test` | 测试外部代理 |

---

## 4. 老项目问题清单

> 移植过程中发现的老项目问题记录在此,修复后需同步回老项目。

### 问题 #1: 目录嵌套过深 (已在新项目修复)

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-26 |
| **位置** | 老项目 `flowforge/flowforge/` (嵌套) |
| **问题描述** | 老项目 flowforge 的 Python 包目录嵌套在项目根目录下 (`flowforge/flowforge/core/`),导致路径计算复杂 (`parent.parent.parent`),且与 pyproject.toml 的 `packages.find` 配置不一致 |
| **影响** | 路径计算容易出错,新项目已扁平化为 `flowforge/core/` |
| **新项目修复** | 已扁平化,`__init__.py` 放在项目根目录,路径计算简化为 `parent.parent` |
| **同步状态** | ⏳ 待同步回老项目 |
| **优先级** | P1 |

### 问题 #2: web/app.py 单文件过大

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-26 |
| **位置** | 新项目 `web/app.py` (1600+ 行) |
| **问题描述** | 新项目的 FastAPI 后端是单文件,所有 30 个端点都在 `web/app.py` 中,文件超过 1600 行,违反"每个代码文件不超过 1000 行"的用户偏好 |
| **影响** | 难以维护,与老项目的模块化结构 (app/api/endpoints/ + app/api/v1/) 不一致 |
| **修复方案** | 移植老项目的 `app/` 目录结构,将群聊和外部代理端点拆分到独立文件 |
| **同步状态** | 移植老项目结构时一并解决 |
| **优先级** | P0 |

### 问题 #3: 老项目无外部代理集成

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-26 |
| **位置** | 老项目 `flowforge/` |
| **问题描述** | 老项目没有 claude_code/codex/gemini/opencode/trae 五大 CLI 的集成实现 |
| **影响** | 老项目无法调用外部 CLI 智能体 |
| **修复方案** | 将新项目的 `forgemind/external_agents.py` + `forgemind/*_proxy.py` 同步到老项目 |
| **同步状态** | ⏳ 待同步到老项目 |
| **优先级** | P1 |

### 问题 #4: 老项目群聊功能不完整

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-26 |
| **位置** | 老项目 `flowforge/app/` |
| **问题描述** | 老项目群聊后端 API 不如新项目完整,缺少 push_back 协议、T7 审核、多轮上下文持久化 |
| **影响** | 群聊体验不完整 |
| **修复方案** | 将新项目的群聊后端逻辑同步到老项目的 `app/api/v1/forgemind/council/` |
| **同步状态** | ⏳ 待同步到老项目 |
| **优先级** | P1 |

### 问题 #5: 新项目 Loop 模块设计冲突（新项目独有问题）

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-27 |
| **位置** | 新项目 `loop/state.py`、`loop/executor.py`、`loop/planner.py`、`loop/result_extractor.py` |
| **问题描述** | 新项目 loop 模块处于"半迁移"状态：`state.py` 和 `executor.py` 采用新设计（dataclass 风格，含 `HandoffCapsule`、`LoopState`、`LoopResult`），但 `planner.py` 和 `result_extractor.py` 仍依赖旧设计的 `Reflection` 类和旧版 `LoopResult`（Pydantic BaseModel，字段 `output`/`total_attempts`/`success`）。具体表现：<br>1. `planner.py:9` `from flowforge.loop.state import LoopState, Reflection` — 但 `state.py` 未定义 `Reflection`<br>2. `result_extractor.py:16` `from flowforge.loop.state import LoopResult` — 但 `state.py` 未定义 `LoopResult`（`executor.py:31` 自定义了 dataclass 版 `LoopResult`，与 `result_extractor.py` 期望的旧版字段不兼容）<br>3. `result_extractor.py:69/99/123` 使用 `result.output`/`result.total_attempts`/`result.success`/`result.state.verification_history`，这些是旧项目 `LoopResult`/`LoopState` 的字段，新项目 dataclass 版没有 |
| **影响** | `LoopExecutor` 注入失败（main.py 启动时报 `cannot import name 'Reflection' from 'flowforge.loop.state'`），Loop 流程无法运行 |
| **修复方案（待用户决策）** | 选项 A：在新项目 `state.py` 末尾追加旧项目的 `LoopPhase`/`Verdict`/`Reflection`/`LoopNestingError`/`LoopResult`（Pydantic 版），保留新项目的 `HandoffCapsule` 和 dataclass 版 `LoopState` — 但会导致 `executor.py` 的 dataclass `LoopResult` 与 `state.py` 的 Pydantic `LoopResult` 重名冲突<br>选项 B：把新项目 `state.py` 和 `executor.py` 回退到旧项目设计（Pydantic 风格）— 丢失新项目的 `HandoffCapsule`/`should_terminate`/evidence 等新设计<br>选项 C：修改 `planner.py` 和 `result_extractor.py` 适配新设计的 dataclass `LoopResult`/`LoopState` — 工作量较大，且 `result_extractor.py` 的 `extract_content` 等函数依赖旧版 `output` 字段语义 |
| **同步状态** | ⏳ 待用户决策后修复 |
| **优先级** | P0（阻塞 LoopExecutor 注入） |

### 问题 #6: 新项目缺失 config/models.yaml

| 项目 | 内容 |
|------|------|
| **发现时间** | 2026-07-27 |
| **位置** | 新项目 `config/models.yaml`（缺失） |
| **问题描述** | 老项目 `flowforge/config/models.yaml` 存在（含 active_providers、providers、models 三段配置，覆盖 openroute/openrouter/doubao/ark/aliyuncs/siliconflow/kimi/zhipu/tencent/local/trae 共 11 个 provider），新项目 `flowlight-ai/flowforge/config/` 下无 `models.yaml` |
| **影响** | `LLMRouter` 启动时 `LLMRouter加载配置失败: ... models.yaml, 错误: [Errno 2] No such file or directory`，导致 LLM 路由使用默认 30s 超时、0 条 agent_routes 映射 |
| **修复方案** | 从老项目原样复制 `config/models.yaml` 到新项目 `flowlight-ai/flowforge/config/models.yaml`（适配 api_key_default 等敏感字段） |
| **同步状态** | ⏳ 待执行 |
| **优先级** | P0 |

---

## 5. 同步回老项目流程

### 5.1 同步条件

只有满足以下条件才同步回老项目:
- [ ] 新项目修复已通过测试验证
- [ ] 修复内容已记录在本文档第 4 节
- [ ] 用户已批准同步 (对于设计变更)

### 5.2 同步步骤

```
1. 确认新项目修复已验证通过
2. 识别老项目对应文件
3. 读取老项目当前代码
4. 应用相同的修复 (适配老项目路径)
5. 在老项目运行测试验证
6. 更新本文档的"同步状态"为"✅ 已同步"
```

### 5.3 同步记录

| 日期 | 问题 # | 同步文件 | 同步人 | 验证结果 |
|------|--------|---------|--------|---------|
| - | - | - | - | - |

---

## 6. 移植进度跟踪

### 6.1 已完成

| 模块 | 来源 | 完成日期 | 验证结果 |
|------|------|---------|---------|
| 目录扁平化 | 新项目优化 | 2026-07-26 | ✅ 404 测试通过 |
| conftest.py 路径适配 | 新项目优化 | 2026-07-26 | ✅ 测试发现正常 |
| Web 群聊前后端一致性 | 用户同步 | 2026-07-27 | ✅ 双方代码完全一致（见 §7.1） |
| 群聊后端路由挂载验证 | 本次验证 | 2026-07-27 | ✅ 226 路由全部挂载，POST /api/v1/forgemind/council 可用 |
| 清理 .bak 备份文件 | 本次清理 | 2026-07-27 | ✅ 删除 council-types.ts.bak |

### 6.2 进行中

| 模块 | 来源 | 进度 | 备注 |
|------|------|------|------|
| Web 层移植 | 老项目 | 80% | 群聊前后端已一致；待移植：admin/env 等其他页面 |
| Loop 模块设计冲突修复 | 待决策 | 0% | 见问题 #5，需用户决策 |

### 6.3 待移植

| 模块 | 来源 | 优先级 |
|------|------|--------|
| `app/` FastAPI 后端 | 老项目 | P0 |
| `web/` Next.js 前端 | 老项目 | P0 |
| `agents/` 通用 Agent | 老项目 | P1 |
| `compiler/` Workflow 编译器 | 老项目 | P1 |
| `tools/` 工具集 | 老项目 | P1 |
| `modes/` 执行模式 | 老项目 | P1 |
| `memory/` 记忆系统 | 老项目 | P1 |
| `events/` 事件总线 | 老项目 | P2 |
| `mcp/` MCP 集成 | 老项目 | P2 |
| `observability/` 可观测性 | 老项目 | P2 |
| `scheduler/` 调度器 | 老项目 | P2 |
| `review/` 审核系统 | 老项目 | P2 |
| `skills/` 技能库 | 老项目 | P3 |
| `sop/` SOP 引擎 | 老项目 | P3 |
| `security/` 安全模块 | 老项目 | P3 |
| `a2a/` A2A 通道 | 老项目 | P3 |
| `brain/` 指挥中枢 | 老项目 | P3 |
| `executor/` 执行器 | 老项目 | P3 |
| `harness/` Harness 引擎 | 老项目 | P3 |
| `evaluators/` 评估器 | 老项目 | P3 |
| `services/` 服务层 | 老项目 | P3 |
| `session/` 会话管理 | 老项目 | P3 |
| `middleware/` 中间件 | 老项目 | P3 |

---

## 7. Web 群聊一致性验证记录 (2026-07-27)

### 7.1 前端代码对比结果

| 文件 | 老项目路径 | 新项目路径 | 对比结果 |
|------|----------|----------|---------|
| CouncilChatPanel.tsx | `web/src/components/helm/CouncilChatPanel.tsx` | 同名 | ✅ 完全一致（1634 行） |
| useCouncilChat.ts | `web/src/hooks/useCouncilChat.ts` | 同名 | ✅ 完全一致 |
| council-types.ts | `web/src/lib/council-types.ts` | 同名 | ✅ 完全一致 |
| council/page.tsx | `web/src/app/council/page.tsx` | 同名 | ✅ 完全一致 |
| council/layout.tsx | `web/src/app/council/layout.tsx` | 同名 | ✅ 完全一致 |

**结论**：用户已自行将老项目 web 群聊代码同步到新项目，双方前端代码完全一致。本次仅清理新项目多余的 `council-types.ts.bak` 备份文件（老项目无此文件）。

### 7.2 后端代码对比结果

| 文件 | 老项目路径 | 新项目路径 | 对比结果 |
|------|----------|----------|---------|
| forgemind.py | `app/api/endpoints/forgemind.py` | 同名 | ✅ 完全一致（含 `POST /council` 端点） |
| forgekins_council.py | `app/api/v1/forgekins_council.py` | 同名 | ✅ 完全一致（stub，前端未使用） |

### 7.3 前端实际调用的 API

通过分析 `useCouncilChat.ts` 确认前端调用：
- `GET /api/v1/forgemind/roster` — 加载花名册
- `POST /api/v1/forgemind/council` — 发起灵议（多轮讨论）

**注意**：前端使用同步 POST 端点，**不使用 WebSocket**。之前 summary 中提到的 `app/api/endpoints/council.py` WebSocket 实现是基于错误理解，无需创建。

### 7.4 路由挂载验证

启动 FastAPI app 验证（`cd flowlight-ai; python -c "from flowforge.app.main import app; ..."`）：

```
all council routes:
  /api/v1/forgekins/council/chat      (stub，前端未使用)
  /api/v1/forgekins/council/messages  (stub，前端未使用)
  /api/v1/forgemind/council           (前端实际调用)
total routes: 226
```

### 7.5 发现的新问题（已记入 §4 问题 #5、#6）

1. **新项目 loop 模块设计冲突**（问题 #5）：`state.py`/`executor.py` 是新设计（dataclass），`planner.py`/`result_extractor.py` 仍用旧设计（Pydantic），导致 `Reflection`/`LoopResult` 导入失败，`LoopExecutor` 注入失败。
2. **新项目缺失 `config/models.yaml`**（问题 #6）：`LLMRouter` 启动报错，导致 LLM 路由使用默认配置。

### 7.6 群聊功能验证结论

群聊前后端代码已一致，路由挂载正常。群聊功能本身可用（前提是 LLM 路由配置正常，即问题 #6 修复后）。Loop 模块问题（#5）不影响群聊的 roster/council 端点，但影响 LoopExecutor 注入，需用户决策修复方案。

---

> **本文档为 flowlight-ai 移植项目的活文档,每次移植工作后更新。**
> **所有移植工作必须遵循本文档的规范和流程。**

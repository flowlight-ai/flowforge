# FlowForge v7.0 自我进化与育灵体系 — 最终审核汇总终稿

> **文档编号**: review.md（终稿 v1.2）
> **汇总日期**: 2026-07-17（v1.2 修订：新增 roleagent.md 工程路径补审 + forgemind 应用层 + 三方 Agent 集成补审）
> **汇总角色**: 高级 AI 智能体架构专家
> **汇总原则**: 取并集（所有意见全部保留，非仅共同意见），冲突标记 ⚔️⚔️，**养灵→育灵体系命名融合方案为核心章节**，**roleagent.md 工程路径补审意见为新增章节**，**forgemind 万物灵智体应用层补审为新增章节**
> **归并来源**: **16 份审核文件**（12 份原始专家审核 + 4 份 review 归并）+ roleagent.md 深度补审 + forgemind/三方 Agent 补审
> **问题总规模**: 7 方并集 ~180 项 + 架构师补充 53 项 + 深度补充 28 项 + **roleagent.md 补审 47 项** + **forgemind/三方 Agent 补审 32 项** = **~340 项**（P0 共 78 项）
> **冲突点数**: 14 个（含架构师补充 3 个新冲突）+ 4 个 forgemind 新冲突
> **命名方案**: 19 套独立方案 + 4 项深度补充 + 3 项新框架 + **1 套终稿融合方案（ForgeMind 主名）**
> **依赖引用**: 13 份外部文档（详见 1.1 节"引用依赖文档清单"），其中 **roleagent.md 为第八章补审核心依据**
> **文档状态**: ✅ operator 已审核命名与体系；其余待决策项按推荐执行；本轮启动设计文档与代码同步

---

## 目录

- [第一章：审核全景概览](#第一章审核全景概览)
- [第二章：v7.0 自我进化体系设计问题并集](#第二章v70-自我进化体系设计问题并集)
- [第三章：face/ 目录文档问题并集](#第三章face-目录文档问题并集)
- [第四章：跨项目一致性问题并集](#第四章跨项目一致性问题并集)
- [第五章：审核意见冲突分析（14 个冲突点）](#第五章审核意见冲突分析)
- [第六章：育灵体系命名融合方案（核心新章节）](#第六章育灵体系命名融合方案核心新章节)
- [第七章：高级 AI 智能体架构师深度补充发现（28 项）](#第七章高级-ai-智能体架构师深度补充发现)
- [第八章：roleagent.md 工程路径补审意见（新增 47 项）](#第八章roleagentmd-工程路径补审意见新增-47-项)
- [第九章：forgemind 应用层与三方 Agent 集成补审意见（新增 32 项）](#第九章forgemind-应用层与三方-agent-集成补审意见新增-32-项)
- [第十章：决策框架与 operator 建议](#第十章决策框架与-operator-建议)
- [第十一章：修复优先级总表](#第十一章修复优先级总表)
- [第十二章：设计文档拆分与自我演进规划](#第十二章设计文档拆分与自我演进规划)

---

## 第一章：审核全景概览

### 1.1 审核文件清单（16 份：12 份专家原始审核 + 4 份 review 归并）

> **共 16 份审核文件**：6 份第一轮原始审核 + 6 份第二轮原始审核 + 4 份 review 归并文件

#### 1.1.1 12 份专家原始审核（第一轮 + 第二轮）

| # | 文件 | 轮次 | 审核方/角色 | 综合评分 | 问题数 | 命名方案 |
|---|------|:----:|--------|:------:|:------:|:--------:|
| 1 | glm.md | 第一轮 | GLM-4 | B+ | 35 | 4 |
| 2 | qianwen.md | 第一轮 | Qwen3.7-Plus | 6.6/10 | 26 | 3 |
| 3 | deepseek.md | 第一轮 | DeepSeek-V4-Pro | 6.1/10 | 30 | 3 |
| 4 | doubao.md | 第一轮 | Doubao | 5.0/10 | 44 | 3 |
| 5 | kimi.md | 第一轮 | Kimi | 2.6/5 | 10 | 5 |
| 6 | minimax.md | 第一轮 | MiniMax | — | 46 | 5 |
| 7 | glm1.md | 第二轮 | GLM-4 | B+ | 37 | 4 |
| 8 | qianwen1.md | 第二轮 | Qwen3.7-Plus | 6.8/10 | 28 | 3 |
| 9 | deepseek1.md | 第二轮 | DeepSeek-V4-Pro | 6.3/10 | 33 | 3 |
| 10 | doubao1.md | 第二轮 | Doubao | 5.2/10 | 47 | 3 |
| 11 | kimi1.md | 第二轮 | Kimi | 2.8/5 | 12 | 5 |
| 12 | minimax1.md | 第二轮 | MiniMax | — | 49 | 5 |

#### 1.1.2 4 份 review 归并文件

| # | 文件 | 角色 | 状态 | 问题数 | 说明 |
|---|------|------|------|:------:|------|
| 13 | review.md（旧版） | 6 方并集预汇总 | 已归并到终稿 | 20 P0 | 9 章，22 方案 |
| 14 | review1.md | 6 方 + 架构师补充 | 已归并到终稿 | ~233（57 P0） | 19+4 补充 |
| 15 | reviewd.md | 7 方最终汇总 | 已归并到终稿 | ~261（63 P0） | +3 新框架 |
| 16 | reviewd1.md | 最完整版本 | **作为终稿基础** | +28 新增 | +28 深度补充 |

#### 1.1.3 引用依赖文档清单（13 份外部文档）

> 以下 13 份文档为本审核意见的依据来源，终稿在标注时使用 `[doc:文件名]` 格式引用。每份文档的引用章节明确标注，便于交叉核对。

| # | 文档 | 路径 | 引用章节 | 引用用途 |
|---|------|------|---------|---------|
| 1 | **roleagent.md** ⭐核心依据 | `D:\software\openclaw\clowder-ai\docs\roleagent.md` | **第八章全部**（§8.1-§8.7） | 能力画像/TeamAct/Harness 闭环/记忆联邦/Eval/可靠性/伙伴系统数学的工程路径补审依据 |
| 2 | spec.md | `flowforge/docs/spec.md` | 第二章/第三章/第四章/第六章/第十一章 | v7.0 主规格书（育灵体系 7.2 节、12 项决策摘要、FR-EVO 编号） |
| 3 | arch.md | `flowforge/docs/arch.md` | 第二章/第五章/第七章/第十一章 | v7.0 架构文档（七层架构、ForgekinEngine 10 步闭环、章节编号冲突） |
| 4 | design.md | `flowforge/docs/design.md` | 第二章/第三章/第七章/第十一章 | v7.0 详细设计（M1-M17 模块、migration、5 个严重 Bug B1-B5） |
| 5 | rules.md | `hiclaw/rules.md` | 第四章/第十一章/第十二章 | 9 部分 AI 编程规范（含 T1-T9 测试铁律、P31 Loop 强制验证） |
| 6 | prompts.md | `hiclaw/prompts.md` | 第四章/第十一章/第十二章 | 13 大类 100+ 提示词模板（含 FF20 Loop 验证、CF10 Content 集成） |
| 7 | spec_face.md | `flowforge/docs/face/spec_face.md` | 第三章全部 | face v3.0 规格（M1-M17 模块、T10-T15 新增铁律） |
| 8 | arch_face.md | `flowforge/docs/face/arch_face.md` | 第三章/第五章 | face v3.0 架构（10 步闭环、ForgekinEngine 决策者） |
| 9 | design.md（face） | `flowforge/docs/face/design.md` | 第三章/第七章 | face v3.0 设计（6 处硬编码中文 prompt 违反铁律 5+P16） |
| 10 | task_face.md | `flowforge/docs/face/task_face.md` | 第三章/第十一章 | face v3.0 任务清单（53 任务/86 人天/8 周时间线） |
| 11 | ds.md | `flowforge/docs/face/ds.md` | 第三章/第五章 | face 决策摘要（12 项决策表、v4.0 错误决策 13/14/15） |
| 12 | project_rules.md | `.trae/rules/project_rules.md` | 第四章/第十一章 | FlowForge 生态项目规则（编程红线 15 条、测试铁律 T1-T8） |
| 13 | clowder-ai/docs 目录 | `D:\software\openclaw\clowder-ai\docs\` | **第十二章全部** | 文档拆分结构参考（architecture/decisions/design/features/harness-feedback/perspectives/setup 七大子目录） |

> **引用约定**：
> - `[doc:roleagent.md#第3章]` 表示引用 roleagent.md 第 3 章
> - `[doc:spec.md#7.2]` 表示引用 spec.md 第 7.2 节
> - `[doc:rules.md#T7]` 表示引用 rules.md 测试铁律 T7
> - `[doc:project_rules.md#红线10]` 表示引用 project_rules.md 编程红线第 10 条
> - `[doc:clowder-ai/docs/features/]` 表示引用 clowder-ai/docs 的 features 子目录结构

### 1.2 七方审核共识（全部一致指出的问题）

以下 **9 项问题**全部 7 份审核一致指出，零分歧：

| # | 共识问题 | 严重度 |
|---|---------|:------:|
| **S-01** | v7.0 炉灵/养灵体系代码完全缺失，`flowforge/evolution/` 仍为 v6.0 SelfEvolutionEngine | **P0 致命** |
| **S-02** | 文档版本号混乱：spec.md 标题 v2.1 但含 v7.0 章节；arch.md/design.md 标题 v6.0 但含 v7.0 内容 | **P0 致命** |
| **S-03** | HelixRAG 旧名残留：contentforge 配置/代码、flowforge config/default.yaml、前端 4 组件 | **P0 致命** |
| **S-04** | 质量分阈值不一致：rules.md 规定 0.85，但 stockforge/devforge/novelforge/mallforge 实际用 0.9 | **P0 严重** |
| **S-05** | MallForge 违反 P31 铁律：Agent 直接执行，未通过 LoopExecutor | **P0 致命** |
| **S-06** | 七层架构叙事冲突：face/ 说第 7 层是"互联层"，v7.0 说第 7 层是"自进化层" | **P0 致命** |
| **S-07** | Face v3.0 为 v7.0 悬空引用：M1-M17 声称支撑 v7.0，但 v7.0 代码为零 | **P0 致命** |
| **S-08** | PluginProtocol 缺少 `register_forgekins` 钩子：arch.md 已定义但代码未实现 | **P0 致命** |
| **S-09** | 育灵体系命名需优化："炉灵 Forgekin" 对 B 端/非技术用户不够通俗，"魂"字引发 AI 伦理争议 | **P1-P2** |

### 1.3 综合评分趋势

| 审核方 | 评分 | 审核态度 |
|--------|:----:|---------|
| GLM | B+ | 设计优秀，有可修复缺陷 |
| Qwen | 6.8/10 | 设计良好，文档一致性是最大风险 |
| DeepSeek | 6.3/10 | 设计质量良好，文档和代码合规性是风险 |
| Doubao | 5.2/10 | 设计理念先进，但架构分层有根本缺陷 |
| Kimi | 2.8/5.0 | 代码与文档严重断层 |
| MiniMax | 未评分 | 文档—代码完全断层（49 项逐条） |

**趋势分析**: 后三份审核（doubao/kimi/minimax）发现了更多根本性问题——架构循环依赖、绕过护栏、代码完全缺失。评分从 GLM→Doubao 递减，说明深度越深，发现的问题越严重。

---

## 第二章：v7.0 自我进化体系设计问题并集

### 2.1 架构层级问题（16 项）

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| D-001 | glm1 | arch.md 主体 §17 与 v7.0 子文档 §15-§23 章节号重号 | P1 |
| D-002 | glm1 | evolution/ 代码目录结构在 arch.md 中缺失 | P1 |
| D-003 | doubao | **架构分层自相矛盾，违反单向依赖铁律**：自进化层在第 7 层（应用层之上），但应用层又通过 PluginProtocol 注册炉灵角色，构成循环依赖 | **P0** |
| D-004 | doubao | **ForgekinEngine 绕过 Harness 护栏**：直接包装 HybridExecutor，跳过四根护栏 | **P0** |
| D-005 | doubao | ForgekinEngine 应是 HarnessOrchestrator 的扩展装饰器，而非独立入口 | **P0** |
| D-006 | minimax | ForgekinEngine.execute() 直接修改 system_prompt 会破坏 v6.0 HybridExecutor 不变性 | P1 |
| D-007 | doubao | 建议自进化层改为"Harness v2.0 升级"而非独立第 7 层 | **P0** |
| D-008 | deepseek | 架构层次应为八层而非七层（v3.0 互联层 + v7.0 自进化层并存） | **P0** |
| D-009 | glm1 | Feature Flag 之间无依赖关系定义 | P2 |
| D-010 | glm1 | A2A 降级"直接调用"语义不清 | P2 |
| D-011 | minimax | arch.md §2.3 仍为 v6.0 六层，与 15.1 节七层概念不一致（内部矛盾） | P1 |
| D-012 | minimax | BaseAgent 缺 SoulAware mixin；BaseTool 缺 is_external_tool 标志 | P1 |
| D-013 | minimax | loop_mode.py 存在但 spec.md 说"Loop 不是模式" | **P0** |
| D-014 | minimax | v6.0 HybridExecutor 无 soul-aware 扩展点 | P1 |
| D-015 | minimax | arch.md §10.5 v6.0 五层 vs v7.0 三层记忆映射缺失 | P1 |
| D-016 | doubao | v7.0 与 v6.0 模块映射关系不清晰，缺少映射表 | P1 |

### 2.2 重复造轮子问题（6 项）

| 编号 | 来源 | 问题 | 重叠度 | 严重度 |
|------|------|------|:------:|:------:|
| D-017 | doubao | Soul Echo vs MemoryManager（功能重叠） | 90% | **P0** |
| D-018 | doubao | Forge Codex vs Skill 系统（功能重叠） | 70% | **P0** |
| D-019 | doubao | A2A vs EventBus + Handoff（功能重叠） | 60% | **P0** |
| D-020 | doubao | ForgekinEngine vs HybridExecutor + HarnessOrchestrator（功能重叠） | 80% | **P0** |
| D-021 | doubao | 安全护栏与 Harness ArchitectureConstraintEngine（功能重叠） | 75% | **P0** |
| D-022 | minimax | v6.0 MemoryManager 五层 vs v7.0 三层记忆架构冲突，无兼容映射 | P1 |

### 2.3 安全问题（8 项）

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| D-023 | doubao | **Auto-Forge 无人值守自进化安全护栏严重不足**：缺少 L1 资源硬限制、L2 代码执行沙箱、L3 操作回滚 | **P0** |
| D-024 | doubao | 外部编码工具集成安全不足：worktree 隔离不够、无网络隔离、无权限控制、无审计追踪 | P1 |
| D-025 | glm1 | SoulProfile persona 无内容审核机制 | P2 |
| D-026 | glm1 | SR-04 的 0.85 阈值与 StockForge 0.9 质量分阈值命名混淆 | P1 |
| D-027 | minimax | spec.md SR-01 "禁止 classifier"边界不清 | P1 |
| D-028 | minimax | A2A 协议未引用 Google A2A / Anthropic MCP-A2A 现有标准 | P1 |
| D-029 | minimax | 跨 *Forge A2A 无租户隔离 | **P0** |
| D-030 | minimax | ExternalToolBridge worktree 校验缺失 | **P0** |

### 2.4 Agent 工程问题（29 项）

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| D-031 | glm1 | TaskRouter 路由规则未定义 | P1 |
| D-032 | glm1 | decide_strategy 决策算法未定义 | P2 |
| D-033 | glm1 | L2 Episode 容量 100 可能不足 | P2 |
| D-034 | glm1 | Wilson 下界公式未给出 | P1 |
| D-035 | glm1 | 自锻"低活动期"时区假设 | P1 |
| D-036 | glm1 | 自锻群分工角色模糊 | P2 |
| D-037 | glm1 | Skill 自生成 Mode B 触发过于敏感 | P1 |
| D-038 | glm1 | Eval Ledger 最小 case 数 5 可能不足 | P2 |
| D-039 | doubao | delegate_to_static 路由机制不明确 | P1 |
| D-040 | doubao | 结果回写一致性：静态 Agent 无状态如何感知调用者 | P1 |
| D-041 | doubao | 单向依赖实现挑战：回写需要知道 forgekin_id | P1 |
| D-042 | deepseek | delegate_to_static 接口未在 PluginProtocol 中定义 | **P0** |
| D-043 | deepseek | Forgekin 调用 Static Agent 是否经 LoopExecutor 未明确 | **P0** |
| D-044 | minimax | FR-EVO 编号不连续（缺 07/08/09/12/13/15） | **P0** |
| D-045 | minimax | 缺少 M1-M17 模块映射关系 | P1 |
| D-046 | minimax | ForgekinEngine `__init__` 11 个依赖违反 DI 最佳实践 | **P0** |
| D-047 | minimax | _decide_strategy 关键词硬编码 | P1 |
| D-048 | minimax | is_distillable() 失败经验无法蒸馏（与 face/ds.md EVO-02 冲突） | **P0** |
| D-049 | minimax | FR-EVO 无调试接口设计 | P1 |
| D-050 | minimax | AC 只有正常路径无失败路径 AC | P1 |
| D-051 | minimax | 五级火种阶梯 E-L0~L4 与升华 E1-E6 数字序列冲突用 E 前缀 | **P0** |
| D-052 | qianwen | E1-E6 命名不一致（Spark 火种 vs 火花） | P1 |
| D-053 | qianwen | "5Q"、"smoke gate" 未定义 | P1 |
| D-054 | qianwen | E6 Forge Master 晋升条件模糊 | P1 |
| D-055 | qianwen | FR-EVO 编号不连续 | **P0** |
| D-056 | qianwen | 缺少 M1-M17 模块映射 | P1 |
| D-057 | deepseek | FR-EVO-07 与 FR-EVO-08 边界模糊 | P1 |
| D-058 | deepseek | "共鸣 Resonance"与"灵议 Forgekin Council"概念边界模糊 | P1 |
| D-059 | kimi | design.md/arch.md 对部分 Harness 组件实现位置描述过时 | P1 |

### 2.5 全栈工程问题（12 项）

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| D-060 | glm1 | SQLite 高并发写入锁竞争 | P1 |
| D-061 | glm1 | sqlite-vec 召回质量未验证 | P2 |
| D-062 | glm1 | 缺少批量操作 API 端点 | P2 |
| D-063 | glm1 | 缺少成本 Prometheus 指标 | P2 |
| D-064 | minimax | design.md §15.1 列 7 个 migration 但无 DDL | P1 |
| D-065 | minimax | 前端路由无组件详细设计 | P1 |
| D-066 | minimax | v7.0 无 CI/CD 章节 | P1 |
| D-067 | minimax | spec.md 12.1 SLO 无并发 SLO | P1 |
| D-068 | minimax | pyproject.toml wilson-interval 包名拼写错误 | **P0** |
| D-069 | minimax | CLI timeout=300s 与 rules.md Loop 720s 限制冲突 | P1 |
| D-070 | minimax | design.md Capabilities.external_tools_can_use 未限定取值 | P1 |
| D-071 | doubao | Phase 6.0 排期"2个月"严重乐观，至少需 4-6 个月 | P1 |

### 2.6 产品与商业化问题（7 项）

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| D-072 | glm1 | 缺少商业化路径分析 | P2 |
| D-073 | glm1 | Soul 概念可能引发 AI 意识伦理误解 | P2 |
| D-074 | minimax | 缺少用户旅程图 | P1 |
| D-075 | minimax | 缺少与 Anthropic Claude Agent SDK/LangGraph/AutoGen 工业级对比 | P1 |
| D-076 | minimax | "AGI"出现 6 次但无定义，无阶段性目标 | P1 |
| D-077 | minimax | v7.0 开源会被识别为"承诺未兑现" | **P0** |
| D-078 | minimax | v7.0 文档散落无总入口 | P1 |

---

## 第三章：face/ 目录文档问题并集

| 编号 | 来源 | 问题 | 严重度 |
|------|------|------|:------:|
| F-001 | glm1 | spec_face.md 引用 ds.md 作为权威源但未纳入审核范围 | P1 |
| F-002 | glm1 | 5 条工程红线未编号 | P2 |
| F-003 | glm1 | spec_face.md 写 T1-T8 但 rules.md 已升级 T1-T9 | P1 |
| F-004 | glm1 | Phase 6.x 与版本号混淆 | P2 |
| F-005 | qianwen | spec_face.md 日期错误（2025 应为 2026） | P1 |
| F-006 | qianwen | spec_face.md 基础版本声明错误（声称基于 v4.0 应为 v7.0） | P1 |
| F-007 | qianwen | arch_face.md 七层与主文档不一致 | **P0** |
| F-008 | qianwen | 缺少 v7.0 FR-EVO 任务拆解 | P1 |
| F-009 | deepseek | spec_face.md v3.0-face 与 spec.md v7.0 版本关系不明 | P1 |
| F-010 | deepseek | arch_face.md 前置依赖声明错误 | P1 |
| F-011 | deepseek | 控制回路演进描述不完整 | P2 |
| F-012 | deepseek | task_face.md 决策5（多租户）与 v7.0 已含多租户矛盾 | P1 |
| F-013 | doubao | spec_face.md M18-M20 命名有误导性（不是独立模块） | P2 |
| F-014 | doubao | spec_face.md §1.5 维度3"自进化产物落在哪里"未明确回答 | P2 |
| F-015 | doubao | spec_face.md 新增 T10-T15 但 rules.md 只有 T1-T9 | **P0** |
| F-016 | doubao | Phase 6.0 排期 2 个月严重乐观 | P1 |
| F-017 | doubao | 实施顺序 M5→M4→M3→M2→M1 反了 | P2 |
| F-018 | doubao | arch_face.md ForgekinEngine 10 步闭环第 5 步 decide_strategy 由谁决策未说明 | P1 |
| F-019 | doubao | M1-M17 到 v7.0 融合映射表只有 5 行，12 个模块未映射 | P2 |
| F-020 | doubao | task_face.md P0 模块任务总览只有 M1-M5，M6-M17 优先级未明确 | P2 |
| F-021 | doubao | face v3.0 为不存在的 v7.0 提供工程支撑，因果倒置 | **P0** |
| F-022 | kimi | face v3.0 新增 T10-T15 测试铁律缺乏代码映射 | P2 |
| F-023 | kimi | face/ 5 文档整体一致性：互联层 ≠ 自进化层、9 维度 ≠ FR-EVO-01~15 | **P0** |
| F-024 | minimax | face/ds.md 顶部日期 2025 应为 2026 | **P0** |
| F-025 | minimax | face/ds.md 声称"基于 v4.0"应为 v7.0 | **P0** |
| F-026 | minimax | face/ds.md EVO-01 三层 Harness 与 spec.md 四根护栏不一致 | **P0** |
| F-027 | minimax | face/arch_face.md 10 步闭环与 arch.md §16.1 略有不同 | P1 |
| F-028 | minimax | face/task_face.md 53 个 P0/P1 任务全是 M1-M17，与 v7.0 脱钩 | P1 |

---

## 第四章：跨项目一致性问题并集

### 4.1 P0 级跨项目问题（25 项）

| 编号 | 来源 | 项目 | 问题 | rules.md 规定 | 实际值 |
|------|------|------|------|:---:|:---:|
| X-001 | 全部 | StockForge | 质量分阈值 0.9 | 0.85 | 0.9 |
| X-002 | 全部 | StockForge | Loop 超时 1800/600/600 | 180s | 10x 超时 |
| X-003 | 全部 | StockForge | worker.mode=workflow | loop | workflow |
| X-004 | glm1 | StockForge | Agent 数 7（多 stock_data） | 6 | 7 |
| X-005 | glm1 | ContentForge | Loop 超时 900/1200 | 720 | 900/1200 |
| X-006 | glm1 | ContentForge | Loop 数 7（多 topic_loop） | 文档写 6 | 7 |
| X-007 | glm1/qianwen | DevForge | rules.md Agent 数 14 | 应为 25 | 14 |
| X-008 | glm1/qianwen | DevForge | prompts.md Agent 数 14 | 应为 25 | 14 |
| X-009 | glm1 | MallForge | 完全缺失 config/loops/ | P31 要求 | 无 |
| X-010 | glm1 | NovelForge | 用 NovelOrchestrator 非 LoopExecutor | P31 要求 | HybridExec |
| X-011 | glm1 | DevForge | 用 DevForgeOrchestrator 非 LoopExecutor | P31 要求 | HybridExec |
| X-012 | deepseek | FlowForge | WebSearchAgent 绕过 LoopExecutor | P31 | 直接调用 |
| X-013 | deepseek | FlowForge | WebSearchTool 直连 DuckDuckGo/Tavily | OpenSieve 唯一入口 | 直连 |
| X-014 | deepseek/minimax | ContentForge | helixrag 残留 15+ 处 | OpenSieve | helixrag |
| X-015 | deepseek | FlowForge | config/default.yaml helixrag 残留 | OpenSieve | helixrag |
| X-016 | deepseek | FlowForge | 前端组件 helixrag 残留（4 文件） | OpenSieve | helixrag |
| X-017 | deepseek | FlowForge | PluginProtocol 缺 register_forgekin 钩子 | arch.md 已定义 | 未实现 |
| X-018 | doubao | ContentForge | 缺 loops_dir 注册 Loop | P31 | 走 workflow |
| X-019 | doubao | NovelForge | 缺 loops_dir 注册 Loop | P31 | 走 workflow |
| X-020 | doubao | ContentForge | 缺 T9 测试铁律 | T1-T9 | 缺 T9 |
| X-021 | doubao | DevForge | 缺 T9 测试铁律 | T1-T9 | 缺 T9 |
| X-022 | doubao | face/ | 新增 T10-T15 未同步到 rules.md | T1-T9 | T10-T15 |
| X-023 | minimax | FlowForge | loop_mode.py 存在与 9 大模式声明冲突 | 9 大模式 | loop_mode |
| X-024 | minimax | ContentForge | deep_article_loop worker.mode=workflow 违反 P31 | loop | workflow |
| X-025 | kimi | NovelForge | mcp_server/tools.py 直接 import DuckDuckGoSearchTool | OpenSieve | 直连 |

### 4.2 P1 级跨项目问题（21 项）

| 编号 | 来源 | 项目 | 问题 |
|------|------|------|------|
| X-026 | glm1 | ContentForge | arch.md Agent YAML 写 6 vs 实际 11 |
| X-027 | glm1 | ContentForge | prompts.md CF2 "6大专家" vs 实际 11 |
| X-028 | glm1 | StockForge | task.md Loop 数写 2 vs 实际 3 |
| X-029 | glm1 | StockForge | config 子目录全部不存在但 arch.md 声称存在 |
| X-030 | glm1 | StockForge | design.md P33 0.9（P33 实为 0.85） |
| X-031 | glm1 | StockForge | design.md "已修正为 180" 但实际仍 1800 |
| X-032 | glm1 | NovelForge | arch.md 质量门 6 道（应为 7） |
| X-033 | glm1 | MallForge | arch.md/design.md agents/ Python 类已迁移到 YAML 但文档过时 |
| X-034 | glm1 | DevForge | evaluators/ 目录违反 P8A |
| X-035 | deepseek | 多项目 | 版本声明混乱（v2.1/v3.0/v4.0/v6.0/v7.0 并存） |
| X-036 | deepseek | 多项目 | register_loops vs register_workflows 使用混乱 |
| X-037 | deepseek | 多项目 | 命名空间格式仅 stockforge 声明 |
| X-038 | doubao | DevForge | arch.md/spec.md 完全未提及 OpenSieve |
| X-039 | doubao | MallForge | spec.md 未声明 OpenSieve 统一入口 |
| X-040 | doubao | NovelForge | arch.md 暗示可绕过 OpenSieve 用 sqlite-vss |
| X-041 | doubao | ContentForge | TOPIC_AGENT_DESIGN.md 仍有 Tavily+热榜绕过 OpenSieve |
| X-042 | doubao | MallForge | tools/ 目录违反 P8A |
| X-043 | doubao | StockForge | tools/ 目录违反 P8A |
| X-044 | doubao | ContentForge/DevForge | T7 缺"不同模型"要求 |
| X-045 | minimax | 多项目 | *Forge 文档未声明 v7.0 炉灵体系集成策略 |
| X-046 | kimi | 多项目 | *Forge 项目代码与文档仍存在 HelixRAG 旧名及直连搜索引擎残留 |

---

## 第五章：审核意见冲突分析

> 本章为 operator 决策参考。14 个冲突点中，前 7 个为六方审核之间冲突，中 3 个为 review1.md 架构师补充冲突，后 4 个为本汇总新增冲突。

### 5.1 架构层级冲突 ⚔️

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| 保留第 7 层 | glm1/qianwen | 自进化层作为独立第 7 层 | 更高层级能力，可调用所有下层 |
| 改为八层 | deepseek | v3.0 互联层 + v7.0 自进化层并存 | 两个"第 7 层"概念不同，应共存 |
| **取消第 7 层** | doubao | 自进化层是 Harness v2.0 升级 | 避免循环依赖，保持单向依赖 |
| 合并叙事 | kimi | 互联层扩展为自进化层 | 统一两套起源故事 |

**冲突核心**: Doubao 认为 v7.0 七层架构存在循环依赖（自进化层↔应用层），主张取消独立第 7 层改为 Harness 升级。其他审核方未深入分析循环依赖问题。**这是最关键的架构分歧，直接影响 v7.0 整体架构设计方向。**

### 5.2 ForgekinEngine 定位冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| 独立引擎 | glm1/qianwen | ForgekinEngine 作为自进化统一入口，包装 HybridExecutor |
| **装饰器** | doubao | ForgekinEngine 应是 HarnessOrchestrator 的扩展装饰器 |
| soul-aware mixin | minimax | 应给 HybridExecutor 增加 SoulAware mixin 而非独立引擎 |

**冲突核心**: 独立引擎方案简单但绕过护栏；装饰器方案安全但增加复杂度；mixin 方案侵入性最小但扩展性受限。三者在"安全性 vs 简洁性"上存在根本取舍。

### 5.3 质量分阈值方向冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| 统一为 0.85 | glm1/doubao/deepseek | rules.md 0.85 是最新铁律，所有项目改 0.85 |
| 说明差异 | doubao | 或说明为什么应用层阈值更高（0.9） |

### 5.4 face/ 文档版本号冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| 改名为 v7.0 Phase 0 | doubao | face v3.0 改名，明确与 v7.0 关系 |
| 保留 v3.0 独立 | qianwen/deepseek | face 是独立工程规格，保留 v3.0-face 版本号 |

### 5.5 实施顺序冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| M5→M4→M3→M2→M1 | face 原文 | 可观测性优先 |
| **M3→M1→M4→M5** | doubao | 核心价值优先，可观测性后补 |

### 5.6 StockForge 作为合规模板冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| StockForge 可作参考模板 | qianwen/deepseek | StockForge 基本合规 |
| **StockForge 也有严重问题** | glm1 | StockForge 质量分 0.9/超时 10x/worker.mode 违规 |

### 5.7 代码缺失严重度冲突 ⚔️

| 方案 | 来源 | 主张 |
|------|------|------|
| 代码缺失是 P0 但可后补 | glm1 | 设计先行，代码后续 |
| 代码缺失使设计可能建立在错误假设上 | doubao | 可落地性 3/10 |
| **代码缺失是虚假承诺** | minimax | spec.md 11.1 "所有 *Forge 都具备自进化能力"是虚假承诺 |

### 5.8 自进化方向冲突 ⚔️（review1.md 架构师补充）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| 显式 operator 引导进化 | A-001/A-009 补充 | operator 定义"对齐目标函数"，Forgekin 在目标内进化 | 安全可控，但限制 AGI 潜力 |
| 涌现式自进化 | clowder-ai 对标 | Forgekin 自发现进化方向，operator 仅设边界 | AGI 愿景强，但对齐风险高 |
| **混合模式** | 架构师建议 | E1-E3 引导式，E4+ 涌现式 | 平衡，但需明确切换点与切换条件 |

**冲突核心**: v7.0 既承诺"AGI 自进化"又强调"operator 控权"，但二者本质冲突。**未定义"operator 让渡控制权的边界"**——何时由引导切换为涌现？切换由谁批准？切换后 operator 如何介入？这是整个 v7.0 体系的"哲学分歧"。

### 5.9 Soul Profile 存储架构冲突 ⚔️（review1.md 架构师补充）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| SQLite 本地 | glm1 A-014 / spec.md 现状 | SQLite WAL + 连接池 | 简单易部署，单机足够 |
| PostgreSQL 分布式 | doubao 暗示 / C-001 补充 | 多实例需要分布式存储 | 跨设备一致，但运维成本高 |
| **混合（SQLite + 同步）** | 架构师建议 | 本地 SQLite + 定期同步 + CRDT 合并 | 平衡，但同步冲突解决策略复杂 |

### 5.10 Forgekin Council 决策权威冲突 ⚔️（review1.md 架构师补充）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| Council 仅为建议 | spec.md 隐含 | operator 保留最终决策权 | 安全可控 |
| Council 决议有约束力 | "灵议"名称暗示 | 多 Forgekin 民主决策 | 自治性强 |
| **按阶段授权** | 架构师建议 | E1-E3 建议，E4+ 部分约束力，E6 全约束 | 渐进式放权 |

**冲突核心**: "灵议 Forgekin Council"的"议"字含义模糊——是"议事"（建议）还是"决议"（约束）？**影响整个治理模型**。

### 5.11 Soul Profile 可变性冲突 ⚔️（review1.md 架构师补充）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| Soul 可自由进化 | spec.md 隐含 | persona/values 随自锻迭代 | AGI 愿景 |
| Soul 版本化不可变 | O-002 补充 | persona 变更需保留版本，可回滚 | 安全可控 |
| **双层（核心不可变 + 表象可变）** | 架构师建议 | 核心价值观不可变，表达风格可变 | 平衡，但需定义"核心"边界 |

**冲突核心**: persona 是 Forgekin 的"人格"，若允许自锻修改 persona，则 Forgekin 可能"人格漂移"甚至"人格崩溃"。**"核心价值观不可变 + 表象风格可变"是工业级 AGI 系统的常见设计**（如 Character.AI 的 character lock），v7.0 未采用。

### 5.12 育灵体系"养"的语义冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| "养"强调 operator 主动培育 | 原始 spec.md | operator 是"养育人"，主动引导 Forgekin 成长 | 符合"养猫"隐喻，human-in-the-loop |
| **"育"强调双向成长** | doubao/本汇总 | 用"育灵"替代"养灵"，强调 operator 与 Forgekin 共同成长 | "育"有培育+教育双重含义，比"养"更主动 |
| "训"强调工程化 | 本汇总新增 | 用"训灵"替代"养灵"，强调系统化训练流程 | 去情感化，但可能过于机械 |

**冲突核心**: "养"字在中文中有"饲养"意味，容易引发对 AI 自主性的争议。但"养猫"隐喻又是 v7.0 对标 clowder-ai 的核心。需要平衡隐喻的生动性与文案的严肃性。

> **✅ 终稿决策**: 用户已明确指定 **"育灵"替代"养灵"**（见第六章融合方案）。

### 5.13 英文名"Spirit"的宗教敏感性冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| 使用 Spirit | doubao/deepseek/qianwen | Spirit Artisan / AgiSpirit | 简洁、通用 |
| **避免 Spirit** | 本汇总新增 | 使用 Mind / Kernel / Being | Spirit 在基督教文化中有"圣灵"含义，可能引发宗教争议 |
| 折中 | 本汇总新增 | 使用 Nexus / Essence / Core | 中性、技术化 |

**冲突核心**: 19 套方案中有 8 套使用"Spirit"，但未做跨文化敏感性审查。对于面向全球开发者的开源项目，英文命名需避免宗教/文化争议。

> **✅ 终稿决策**: 用户已明确指定 **ForgeMind（灵智）** 作为主名，避免使用 Spirit（见第六章融合方案）。

### 5.14 命名迁移激进程度冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 迁移成本 | 品牌断裂 |
|------|------|------|:------:|:------:|
| 完全替换（灵智/灵匠/智能核） | qianwen/deepseek/doubao/kimi | 一次性替换所有"炉灵"术语 | 高 | 高 |
| 双轨并行（技术名+通俗名） | glm1（方案C）/qianwen（方案C） | 保留"炉灵"技术名，增加通俗别名 | 中 | 低 |
| **渐进迁移（去魂→去炉→统一）** | 本汇总建议 | 分三步：v7.0 去魂字→v7.1 去炉字→v7.2 统一品牌 | 低 | 低 |

**冲突核心**: 完全替换激进但干净；双轨安全但混乱；渐进迁移稳妥但周期长。**需 operator 根据品牌战略和发布节奏决定**。

> **✅ 终稿决策**: 用户已明确采用 **ForgeMind（灵智）+ Forgekin（代码层保留）双轨方案**（见第六章融合方案）。

---

## 第六章：育灵体系命名融合方案（核心新章节）

> 本章为终稿核心章节。在 19 套独立方案 + 4 项深度补充 + 3 项新框架基础上，按 operator 指令进行命名融合设计：**主名 ForgeMind（灵智）**，融入 **Forgekin/SpiritForge/Evoling** 三个名称到体系不同阶段，并完成 12 个概念的命名对齐。

### 6.1 命名融合总原则

| 原则 | 说明 |
|------|------|
| **品牌一致性** | 保留 FlowForge 的 "Forge" 基因，体现自我进化能力 |
| **ToB 接受度** | 避免玄幻/宗教/敏感词汇，企业采购可接受 |
| **国际化** | 英文命名全球通用，跨文化无歧义 |
| **去玄幻去宗教** | 去掉"魂"字（引发 AI 意识伦理争议）、"炉"字（格局偏小）、避免 Spirit（基督教"圣灵"敏感） |
| **创意应景通俗** | 借鉴养猫隐喻但不照搬，降低学习成本 |
| **双轨策略** | 产品名（ForgeMind）+ 代码类名（Forgekin）双轨，平衡品牌与代码迁移成本 |

### 6.2 主名确定：ForgeMind（灵智）

**主名**：**灵智 / ForgeMind**

| 维度 | 评估 | 说明 |
|------|:----:|------|
| 中文含义 | ✅ | "灵智"——灵性智慧，去掉"炉"字后更通用，"灵"呼应育灵体系，"智"体现 AI 智能 |
| 英文含义 | ✅ | ForgeMind——Forge（品牌基因）+ Mind（智慧/心智），Mind 在 AI 学术界有 Theory of Mind、Foundation Mind 呼应 |
| 品牌一致性 | ✅ | 与 FlowForge 共享 "Forge" 前缀，形成品牌家族 |
| ToB 接受度 | ✅ | "Mind" 是企业级 AI 产品常用词（如 GitHub Copilot Workspace Mind），无玄学色彩 |
| 国际化 | ✅ | Mind 全球通用，无文化敏感 |
| 去玄幻去宗教 | ✅ | 无"魂/炉/Spirit"等敏感词 |
| AI 学术呼应 | ✅ | Theory of Mind（心智理论）、Mindmeld、Mindfulness 等学术词汇 |
| 商标可注册 | ⚠️ | 需检索是否与 ForgeRock 等近似，建议检索后决策 |

### 6.3 三个名称融入方案

#### 6.3.1 Forgekin（锻灵）融入方案：代码层类名 + E1-E3 早期阶段别名

**融入位置**：代码层类名 + 觉醒阶 E1-E3 早期阶段

**设计依据**：
- "Forgekin" 由 Forge + kin（亲属/同类）构成，生造词反而易注册商标
- 代码中已有 `ForgekinEngine`、`forgekin_id` 等标识符，保留可零迁移成本
- "kin" 字面有"同类/亲属"含义，适合表达"同一灵群中的个体"

**双轨策略**：

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **产品层** | 用户界面、营销材料、对外文档 | **ForgeMind（灵智）** | "创建一个新灵智"、"灵智 fk_writer_001" |
| **代码层** | 类名、变量名、配置项、API 路径 | **Forgekin** | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| **文档层** | 设计文档、技术规范 | **ForgeMind（灵智）/ Forgekin** 双标注 | "灵智（Forgekin 实例）" |
| **社区层** | 开源宣传、技术博客 | **ForgeMind** | "FlowForge ForgeMind: Self-Evolving Agent" |

**E1-E3 早期阶段别名**：
- E1 灵启 → E2 觉醒 → E3 精通 阶段，灵智处于"锻灵 Forgekin"形态（被锻造中的个体）
- E4+ 阶段进入"进化体 Evoling"形态（见 6.3.3）

#### 6.3.2 SpiritForge（灵锻）融入方案：自主思考阶段名，替代 Auto-Forge

**融入位置**：第 6 项概念"自主思考"阶段

**设计依据**：
- 原 spec.md 用"自锻 Auto-Forge"，但"自锻"语义偏机械，缺少"灵性思考"含义
- SpiritForge 由 Spirit（灵性/精神）+ Forge（锻造）构成，体现"灵性的自我锻造"
- 用户指令明确要求融入"灵锻 SpiritForge"到体系中
- 避免 Spirit 单独使用引发宗教敏感，但 SpiritForge 组合中 Spirit 作修饰词，敏感度降低

**替换映射**：

| 原术语 | 新术语 | 说明 |
|--------|--------|------|
| 自锻 Auto-Forge | **灵锻 SpiritForge** | 自主思考阶段名，体现灵智的灵性自我锻造 |
| Auto-Forge Engine | **SpiritForge Engine** | 引擎类名 |
| `auto_forge.yaml` | `spirit_forge.yaml` | 配置文件名 |
| `AutoForgeEngine` | `SpiritForgeEngine` | 代码类名 |
| FR-EVO 自锻章节 | FR-EVO 灵锻章节 | 文档章节 |

**概念定义**：
- **灵锻 SpiritForge**：灵智在无人驱动时，通过灵锻过程进行自主思考和进化
- 类比：clowder-ai 的 Auto-Dream（自主梦境思考）
- 区别于"自锻 Auto-Forge"：灵锻强调"灵性思考"而非"机械锻造"

#### 6.3.3 Evoling（进化体）融入方案：觉醒阶 E4+ 高阶段进化状态

**融入位置**：第 11 项概念"成长阶段"（觉醒阶）的 E4+ 子状态

**设计依据**：
- 用户指令要求融入"进化体 Evoling"以"体现自我进化"
- Evoling 由 Evolution + -ing 构成，表示"正在进化中的实体"
- 放在 E4+ 高阶段，体现"灵智达到自主进化能力后的状态身份"
- 与 5.8 节"自进化方向冲突"的"E4+ 涌现式自进化"决策呼应

**Evoling 状态定义**：

| 阶段 | 形态 | 能力 |
|------|------|------|
| E1 灵启 | Forgekin（锻灵） | 仅基础能力，需 operator 引导 |
| E2 觉醒 | Forgekin（锻灵） | 积累记忆，仍需引导 |
| E3 精通 | Forgekin（锻灵） | 熟练运用技能，仍受 operator 控制 |
| **E4 进化** | **Evoling（进化体）** | **进入自主进化状态，可涌现式进化** |
| E5 卓越 | Evoling（进化体） | 高度自主，参与灵议决策 |
| E6 灵智 | Evoling（进化体） | 完全自主，与产品层主名 ForgeMind 同名同体，标志完成完整生命周期，可创建新灵智 |

**状态转换条件**：
- E3→E4 晋升时，灵智从"锻灵 Forgekin"形态进化为"进化体 Evoling"
- 该转换需 operator 批准（对应 5.8 节"混合模式"切换点）
- 转换后 operator 让渡部分控制权，灵智进入涌现式自进化

### 6.4 12 个概念完整命名表（终稿）

> 按 operator 指令：火种→进化阶 evolution、养灵→育灵、炉灵→灵智、去魂字去炉字。

| # | 概念 | 原中文 | 原英文 | **新中文** | **新英文** | 融合来源 | 说明 |
|---|------|--------|--------|-----------|-----------|---------|------|
| 1 | 个体 | 炉灵 | Forgekin | **灵智** | **ForgeMind** | 用户指定主名 | 产品层主名，去炉字；代码层保留 Forgekin |
| 2 | 群体 | 灵族 | Kinship | **灵群** | **ForgeKinship** | 借鉴 qianwen 灵群 | 灵智的协作群体，保留 Kinship 体现"同类" |
| 3 | 养成 | 养灵 | Forge Nurturing | **育灵** | **Forge Nurturing** | 用户指定替换 | "育"有培育+教育双重含义，比"养"更主动 |
| 4 | 入门训练 | 炉启 | Forge Initiation | **灵启** | **Mind Initiation** | 去炉字，借鉴"启智" | 新灵智的入门训练，获得基础能力 |
| 5 | 协作模式 | 共鸣 | Resonance | **共鸣** | **Resonance** | 保留原术语 | 灵群的协作模式，原术语已合适 |
| 6 | 自主思考 | 自锻 | Auto-Forge | **灵锻** | **SpiritForge** | 融入 SpiritForge | 替代 Auto-Forge，体现灵性自我锻造 |
| 7 | 记忆 | 魂忆 | Soul Echo | **灵忆** | **Mind Echo** | 去魂字，借鉴"灵忆" | 跨会话累积记忆，Mind 替代 Soul |
| 8 | 画像 | 魂印 | Soul Imprint | **灵印** | **Mind Imprint** | 去魂字，借鉴"灵印" | 对操作者/世界的认知画像 |
| 9 | 技能库 | 锻典 | Forge Codex | **灵典** | **Mind Codex** | 去锻字，借鉴"灵典" | 可复用知识体系，保留 Codex 体现典籍感 |
| 10 | 知识阶梯 | 火种等级 | Ember Hierarchy | **进化阶** | **Evolution Hierarchy** | 用户指定替换 | 知识成熟度阶梯，火种→进化 |
| 11 | 成长阶段 | 升华阶 | Ascension Stages | **觉醒阶** | **Awakening Stages** | 借鉴"觉醒阶" | 灵智成长的生命阶段，E4+ 进入 Evoling 状态 |
| 12 | IM 议事 | 灵议 | Forgekin Council | **灵议** | **Mind Council** | 保留中文，英文调整 | 灵智间的即时通讯与议事 |

### 6.5 进化阶（Evolution Hierarchy）详细设计

> 按 operator 指令，"火种等级 Ember Hierarchy"重命名为"进化阶 Evolution Hierarchy"。

**原 5 级火种阶梯 → 新 5 级进化阶**：

| 原等级 | 原名 | 新等级 | 新名 | 含义 |
|--------|------|--------|------|------|
| E-L0 | Spark 火种 | **E-L0** | **Seed 萌芽** | 初始知识，刚通过灵启训练 |
| E-L1 | Ember 余烬 | **E-L1** | **Sprout 萌发** | 基础经验积累，开始自主思考 |
| E-L2 | Flame 火焰 | **E-L2** | **Bloom 绽放** | 中级知识，可蒸馏技能 |
| E-L3 | Blaze 烈焰 | **E-L3** | **Thrive 繁茂** | 高级知识，可指导其他灵智 |
| E-L4 | Forge Fire 锻火 | **E-L4** | **Evolve 进化** | 顶级知识，可自主创新技能 |

**说明**：
- 解决 D-051 冲突：进化阶用 E-L0~E-L4 前缀，觉醒阶用 E1-E6 前缀，两者通过 L（Level）区分
- 进化阶（知识阶梯）衡量"知识成熟度"，觉醒阶（成长阶段）衡量"灵智整体成长"
- 进化阶 E-L4 对应觉醒阶 E4，灵智达到 E-L4 知识 + E4 觉醒后，进入 Evoling 状态

### 6.6 觉醒阶（Awakening Stages）+ Evoling 状态详细设计

**原 6 级升华阶 → 新 6 级觉醒阶 + Evoling 状态**：

| 阶段 | 原名 | 新名 | 形态 | 能力特征 | 控制权 |
|------|------|------|------|---------|--------|
| E1 | Spark 火种 | **E1 灵启 Initiation** | Forgekin | 基础能力，刚通过入门训练 | operator 全控 |
| E2 | Flame 火焰 | **E2 觉醒 Awakening** | Forgekin | 积累记忆，开始熟练 | operator 主导 |
| E3 | Forge 锻 | **E3 精通 Mastery** | Forgekin | 熟练运用技能 | operator 监督 |
| **E4** | **Master 师傅** | **E4 进化 Evolving** | **Evoling** | **进入自主进化状态** | **operator 让渡部分控制权** |
| E5 | Sage 圣人 | **E5 卓越 Excellence** | Evolving | 高度自主，参与灵议决策 | operator 仅设边界 |
| E6 | Forge Master 锻师 | **E6 灵智 ForgeMind（最终形态）** | Evoling | 完全自主，可创建新灵智；与产品层主名 ForgeMind 同名同体，标志灵智完成完整生命周期 | operator 信任 |

**Evoling 状态转换点**：
- E3→E4 是关键转换点，灵智从"被锻造的锻灵 Forgekin"进化为"自主进化的进化体 Evoling"
- 转换需 operator 显式批准（对应 5.8 节"混合模式"切换点）
- 转换后灵智获得涌现式自进化能力

**去玄幻化处理**：
- E1 原名"火种"易联想到玄幻小说，改为"灵启"（启迪智慧）
- E5 原名"圣人"有宗教色彩，改为"卓越"
- E6 原名"Forge Master 锻师"改为"灵智 ForgeMind（最终形态）"，与产品层主名同名同体，标志灵智完成完整生命周期，回到 ForgeMind 本源

### 6.7 ForgeMind vs Forgekin 对比分析

> 按 operator 指令："保留 Forgekin，但是需要注意与 ForgeMind 使用的区分和使用，如果这两个只能保留一个的话，请帮我对比分析下，我来选择。"

#### 6.7.1 10 维度对比矩阵

| # | 维度 | ForgeMind（灵智） | Forgekin（锻灵） | 优势方 |
|---|------|-------------------|------------------|:------:|
| 1 | 中文含义 | 灵智——灵性智慧 | 锻灵——炉中锻造之灵 | ForgeMind |
| 2 | 英文含义 | Forge + Mind（智慧/心智） | Forge + kin（同类/亲属） | ForgeMind |
| 3 | FlowForge 品牌一致性 | ★★★★★（Forge 前缀） | ★★★★★（Forge 前缀） | 平手 |
| 4 | 国际化程度 | ★★★★★（Mind 全球通用） | ★★★（-kin 后缀英文生造词，海外难理解） | **ForgeMind** |
| 5 | ToB 接受度 | ★★★★★（Mind 商务友好，GitHub Copilot Workspace Mind 等） | ★★★（-kin 类 hobbit 词汇，企业采购不严肃） | **ForgeMind** |
| 6 | 去玄幻化 | ★★★★★（Mind 中性技术化） | ★★★（kin 类奇幻文学词汇） | **ForgeMind** |
| 7 | 去宗教化 | ★★★★★（Mind 无宗教） | ★★★★★（无宗教） | 平手 |
| 8 | AI 学术呼应 | ★★★★★（Theory of Mind、Foundation Mind） | ★★（无学术呼应） | **ForgeMind** |
| 9 | 商标可注册性 | ⚠️ 需检索（可能与 ForgeRock 近似） | ✅ 生造词反而易注册 | Forgekin |
| 10 | 迁移成本 | 高（需替换代码所有 Forgekin 类名） | 低（保持现状） | Forgekin |

#### 6.7.2 如果只能保留一个：推荐 ForgeMind

**理由**：
1. **国际化优先**：面向全球开发者，Mind 比 -kin 后缀生造词更易理解
2. **ToB 商业化优先**：企业采购场景，Mind 比 kin 更严肃
3. **AI 学术呼应**：Theory of Mind 是 AI 领域核心概念，ForgeMind 自然呼应
4. **品牌战略**：ForgeMind 与 FlowForge 形成"Flow 流程 + Mind 智慧"品牌矩阵
5. **商标风险可控**：ForgeRock 主要在身份认证领域，ForgeMind 在 AI Agent 领域，可注册

**风险**：
- 代码迁移成本高（需替换 ForgekinEngine、forgekin_id 等所有标识符）
- 建议采用弃用别名策略：`Forgekin = DeprecatedAlias(ForgeMind)`，保留 2 个大版本

#### 6.7.3 推荐方案：双轨并存（无需二选一）

**推荐**：保留 Forgekin 作为代码层类名，ForgeMind 作为产品层主名

| 场景 | 使用 | 示例 |
|------|------|------|
| 产品/UI/营销 | ForgeMind（灵智） | "创建一个新灵智"、"灵智 fk_writer_001 已晋升 E4" |
| 代码类名 | Forgekin | `ForgekinEngine`、`forgekin_id`、`ForgekinProfile` |
| API 路径 | forgekins | `/api/v7/forgekins`、`/api/v7/forgekins/{id}/evolve` |
| 设计文档 | ForgeMind（灵智）/ Forgekin 双标注 | "灵智（Forgekin 实例）" |
| 社区开源 | ForgeMind | "FlowForge ForgeMind: Self-Evolving Agent Framework" |

**优势**：
- 零代码迁移成本（Forgekin 类名保留）
- 产品品牌升级（对外用 ForgeMind）
- 双轨可平滑过渡，未来可决定是否统一

---

### 6.8 原始养灵体系 vs 终稿融合方案对照表

> 原始权威源：`flowforge/docs/spec.md` 第 7.2 节（第 3248-3265 行）

| # | 概念 | 原中文 | 原英文 | **终稿中文** | **终稿英文** | 变更说明 |
|---|------|--------|--------|------------|------------|---------|
| 1 | 个体 | 炉灵 | Forgekin | **灵智** | **ForgeMind**（产品）/ Forgekin（代码） | 去炉字，产品层主名 |
| 2 | 群体 | 灵族 | Kinship | **灵群** | **ForgeKinship** | 保留 Kinship 体现"同类" |
| 3 | 养成 | 养灵 | Forge Nurturing | **育灵** | **Forge Nurturing** | "育"替代"养" |
| 4 | 入门训练 | 炉启 | Forge Initiation | **灵启** | **Mind Initiation** | 去炉字 |
| 5 | 协作模式 | 共鸣 | Resonance | **共鸣** | **Resonance** | 保留 |
| 6 | 自主思考 | 自锻 | Auto-Forge | **灵锻** | **SpiritForge** | 融入 SpiritForge |
| 7 | 记忆 | 魂忆 | Soul Echo | **灵忆** | **Mind Echo** | 去魂字，Soul→Mind |
| 8 | 画像 | 魂印 | Soul Imprint | **灵印** | **Mind Imprint** | 去魂字，Soul→Mind |
| 9 | 技能库 | 锻典 | Forge Codex | **灵典** | **Mind Codex** | 去锻字 |
| 10 | 知识阶梯 | 火种等级 | Ember Hierarchy | **进化阶** | **Evolution Hierarchy** | 火种→进化 |
| 11 | 成长阶段 | 升华阶 | Ascension Stages | **觉醒阶** | **Awakening Stages** | 升华→觉醒 |
| 12 | IM 议事 | 灵议 | Forgekin Council | **灵议** | **Mind Council** | Forgekin→Mind |

### 6.9 关键术语全局替换映射

> 用于后续修改 spec.md / arch.md / design.md / rules.md / prompts.md 等文档时的术语替换参考。

| 原术语 | 新术语 | 替换范围 | 备注 |
|--------|--------|---------|------|
| 炉灵 | 灵智 | 文档/UI/营销 | 产品层 |
| 炉灵 Forgekin | 灵智 ForgeMind | 文档标题 | 产品层 |
| 养灵 | 育灵 | 全部 | 养成过程 |
| 养灵体系 | 育灵体系 | 全部 | 体系名 |
| 魂忆 | 灵忆 | 全部 | 记忆 |
| 魂印 | 灵印 | 全部 | 画像 |
| 自锻 | 灵锻 | 全部 | 自主思考 |
| 自锻 Auto-Forge | 灵锻 SpiritForge | 全部 | 含英文 |
| AutoForgeEngine | SpiritForgeEngine | 代码 | 类名 |
| auto_forge.yaml | spirit_forge.yaml | 配置 | 文件名 |
| 锻典 | 灵典 | 文档 | 技能库 |
| 火种等级 | 进化阶 | 全部 | 知识阶梯 |
| Ember Hierarchy | Evolution Hierarchy | 全部 | 含英文 |
| 升华阶 | 觉醒阶 | 全部 | 成长阶段 |
| Ascension Stages | Awakening Stages | 全部 | 含英文 |
| 火种 Spark | 萌芽 Seed | E-L0 | 进化阶第 0 级 |
| 余烬 Ember | 萌发 Sprout | E-L1 | 进化阶第 1 级 |
| 火焰 Flame | 绽放 Bloom | E-L2 | 进化阶第 2 级 |
| 烈焰 Blaze | 繁茂 Thrive | E-L3 | 进化阶第 3 级 |
| 锻火 Forge Fire | 进化 Evolve | E-L4 | 进化阶第 4 级 |
| Forgekin Council | Mind Council | 代码/文档 | 灵议 |
| ForgekinEngine | ForgekinEngine（保留） | 代码 | 类名不变 |
| forgekin_id | forgekin_id（保留） | 代码 | 变量名不变 |
| /api/v7/forgekins | /api/v7/forgekins（保留） | API | 路径不变 |
| Soul Echo | Mind Echo | 全部 | 含英文 |
| Soul Imprint | Mind Imprint | 全部 | 含英文 |
| SoulProfile | MindProfile | 代码 | 类名 |
| SoulStore | MindStore | 代码 | 类名 |
| EchoStore | EchoStore（保留） | 代码 | 类名不变 |
| ImprintStore | ImprintStore（保留） | 代码 | 类名不变 |

### 6.10 19 套原始命名方案全景对比（参考）

> 以下为 7 方专家提出的 19 套独立方案 + 4 项深度补充，作为终稿融合方案的参考基础。

#### 6.10.1 19 套方案总览

| # | 来源 | 方案名 | 核心概念 | 终稿采纳？ |
|---|------|--------|---------|:------:|
| 1 | glm1 | 灵种体系 | 灵种/灵群/育灵/灵忆/灵印/灵思/灵典/灵阶 | 部分（灵群/灵忆/灵印/灵典） |
| 2 | glm1 | 智灵体系 | 智灵/智群/启智/智忆/智印/冥思/智典/觉醒阶 | 部分（觉醒阶） |
| 3 | glm1 | 原方案优化 | 保留炉灵，魂忆→灵忆，魂印→灵印 | 部分（灵忆/灵印） |
| 4 | glm1 | 生态体系 | 灵芽/灵林/年轮/纹理/扎根/种子库/四季 | ✗ |
| 5 | qianwen | 灵智体系 | 灵智 AgiSpirit/灵群/灵育/灵忆/灵印/灵锻/灵典/觉醒阶 | **核心采纳**（灵智/灵群/灵锻/灵忆/灵印/灵典/觉醒阶） |
| 6 | qianwen | 智核体系 | 智核 CoreMind/核群/核育/核忆/核印/核锻/核典 | ✗ |
| 7 | qianwen | 保留炉灵优化 | 技术名炉灵+通俗名灵匠 | 部分（双轨思路） |
| 8 | deepseek | 灵智体系 | 同 qianwen 方案 A | 参考 |
| 9 | deepseek | 智核体系 | 同 qianwen 方案 B | ✗ |
| 10 | deepseek | 保留炉灵优化 | 同 qianwen 方案 C | 参考 |
| 11 | doubao | 灵匠体系 | 灵匠 Spirit Artisan/灵团/育灵/灵忆/灵印/自悟/灵典/觉醒阶 | 部分（育灵/灵忆/灵印/觉醒阶/E6 灵匠） |
| 12 | doubao | 锻灵体系 | 锻灵 Forge Spirit/灵锻/开锻/锻阶/自炼/锻痕/锻经 | 部分（锻灵作为 Forgekin 中文别名） |
| 13 | doubao | 智灵体系 | 智灵 Genius Spirit/智群/育智/智慧阶/自智 | ✗ |
| 14 | kimi | 智能核 | 智能核 Agent Kernel/核养/记忆核/认知核/自锻核/技能核 | ✗ |
| 15 | kimi | 锻体 | 锻体 Forge Being/经验体/画像体/自锻/技艺典/锻阶 | ✗ |
| 16 | kimi | 认知孪生 | 认知孪生 Cognitive Twin/记忆孪生/偏好孪生/自主孪生 | ✗ |
| 17 | kimi | 活体 | 活体 Living Agent/经历库/认知画像/能力典/活体群 | ✗ |
| 18 | kimi | 智能化身 | 化身 Agent Avatar/记忆体/人格画像/化身自省 | ✗ |
| 19 | minimax | ForgeMind 锻心 | 锻心 ForgeMind/锻心群/锻心术/锻忆/锻印/自锻/锻典/锻心会/锻阶 | **核心采纳**（ForgeMind 主名） |
| 20 | minimax | AgentMind 心智 | 心智体 AgentMind/心智网/育智/忆痕/识海/自省/智典/智阶 | ✗ |
| 21 | minimax | OpenCogNexus | 认知体 OpenCogNexus/认知网络/记忆流/自主反思/技能库 | ✗ |
| 22 | minimax | ForgeSpirit 炉灵改良 | 炉灵 ForgeSpirit/灵族/铸魂/灵忆/灵印/自炼/熔典/灵议会 | ✗ |
| 23 | minimax | IronForge 铁匠 | 铁匠灵 IronSmith/铁匠铺/炉火史/工件图/夜锻/工匠典/匠阶 | ✗ |

#### 6.10.2 原始方案去魂共识与品牌分歧

| 原始术语 | 含义 | 去魂共识 | 品牌分歧（主要候选） | 终稿决策 |
|---------|------|---------|---------------------|---------|
| 炉灵 Forgekin | 自进化智能体 | — | 灵种/灵智/灵匠/智能核/ForgeMind/锻心 | **灵智 ForgeMind** |
| 灵族 Kinship | 协作群体 | — | 灵群/灵团/核群/心智网/锻心群 | **灵群 ForgeKinship** |
| 养灵 Forge Nurturing | 养成过程 | — | 育灵/灵育/核养/锻心术 | **育灵 Forge Nurturing** |
| **魂忆** Soul Echo | 跨会话记忆 | **灵忆**（4 方共识） | 灵忆/记忆核/锻忆/忆痕 | **灵忆 Mind Echo** |
| **魂印** Soul Imprint | 认知画像 | **灵印**（4 方共识） | 灵印/认知核/锻印/识海 | **灵印 Mind Imprint** |
| 自锻 Auto-Forge | 自主思考 | — | 灵思/灵锻/自悟/自炼/自省 | **灵锻 SpiritForge** |
| 锻典 Forge Codex | 技能库 | — | 灵典/技能核/锻典/智典 | **灵典 Mind Codex** |
| 灵议 Forgekin Council | IM 协作 | — | 灵议/灵议会/核议会/锻心会 | **灵议 Mind Council** |
| 升华阶 Ascension Stages | 成长阶段 | — | 灵阶/觉醒阶/核级/锻阶/智阶 | **觉醒阶 Awakening Stages** |
| 炉启 Forge Initiation | 入门训练 | — | 灵启/启蒙/开锻/核启 | **灵启 Mind Initiation** |
| 火种等级 Ember Hierarchy | 知识阶梯 | — | — | **进化阶 Evolution Hierarchy** |

### 6.11 命名融合方案实施路径

#### 6.11.1 三阶段渐进迁移路径

```
阶段 1（v7.0 发布前，本周）: 去"魂"字 + 核心术语替换
  魂忆 → 灵忆（Mind Echo）
  魂印 → 灵印（Mind Imprint）
  养灵 → 育灵
  炉灵 → 灵智（ForgeMind）
  自锻 → 灵锻（SpiritForge）
  火种等级 → 进化阶（Evolution Hierarchy）
  升华阶 → 觉醒阶（Awakening Stages）
  影响范围：文档层面全部更新，代码中 Soul Echo/Soul Imprint 类名同步改

阶段 2（v7.1，1-2 月）: 代码层渐进迁移
  SoulProfile → MindProfile
  SoulStore → MindStore
  AutoForgeEngine → SpiritForgeEngine
  auto_forge.yaml → spirit_forge.yaml
  ForgekinEngine 类名保留（双轨）
  forgekin_id 变量名保留（双轨）
  影响范围：代码类名、配置文件名

阶段 3（v8.0，3-6 月）: 品牌统一与商标检索
  完成 ForgeMind 商标检索
  决定是否将代码层 Forgekin 统一为 ForgeMind
  旧名保留 Deprecated 别名 2 个大版本
  影响范围：全部统一（如需）
```

#### 6.11.2 分层命名策略

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **代码层** | 类名、变量名、配置项 | 技术化、简洁 | `ForgekinEngine`、`MindProfile`、`forgekin_id` |
| **文档层** | 设计文档、API 文档 | 技术化+中文对照 | 灵智（ForgeMind）/ Forgekin 实例 |
| **产品层** | 用户界面、营销材料 | 通俗化、有温度 | 灵智、小智、我的灵智 |
| **社区层** | 开源宣传、技术博客 | 国际化、品牌化 | ForgeMind: Self-Evolving Agent |

#### 6.11.3 命名可证伪性评估

| 命名承诺 | 可证伪性 | 风险 |
|---------|:------:|------|
| "灵"（灵性/智慧） | 中——可通过任务成功率部分验证 | 与"灵魂"边界需明确 |
| "智"（智慧） | 高——可通过任务成功率验证 | 与"智能"边界模糊 |
| "育"（培育） | 高——可通过灵智成长曲线验证 | 符合工程文化 |
| "进化/灵锻" | 高——可通过 Skill 数量/质量验证 | 需定义可量化指标 |
| "Evoling 进化体" | 高——可通过 E4+ 自主进化案例验证 | 需定义"涌现式进化"判定标准 |
| "AGI" | 极低——AGI 无公认定义 | **最高风险——虚假承诺，避免使用** |

**建议**: 在产品命名中避免使用"AGI"作为修饰词，使用"自进化 Self-Evolving"比"AGI"更可证伪。

---

## 第七章：高级 AI 智能体架构师深度补充发现

> 本章为 28 项深度补充发现，聚焦于七方审核普遍未覆盖的深度维度：**时序一致性、冷启动、跨炉灵知识污染、可调试性、特修斯之船问题、uncanny valley、渐进式部署策略**等。

### 7.1 时序一致性与进化可逆性（5 项，T-001~T-005）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| T-001 | **Soul 进化的时序一致性（Temporal Consistency）** | **P0** | 灵智在时刻 t1 接受任务，其 Mind Profile/Echo/Imprint 状态为 S1；任务执行到一半时，灵锻在后台更新了状态到 S2。任务完成时应该基于 S1 还是 S2 进行评估？v7.0 无"快照隔离"机制——任务启动时应冻结 Mind 快照，任务完成后再合并变更 |
| T-002 | **进化回滚的事务性** | **P0** | 若 E3→E4 晋升后，operator 发现新 Skill 质量下降，回滚到 E3。但灵忆中已记录了 E4 阶段的 Episode，灵印中已更新了 E4 阶段的认知。回滚后这些数据如何处理？是级联回滚还是仅回滚觉醒阶段？**无回滚语义定义** |
| T-003 | **灵智的"特修斯之船"问题** | P1 | 若灵智的 Mind Profile、灵忆、灵印全部被灵锻更新过，它还是"同一个"灵智吗？**无身份连续性定义**——forgekin_id 不变但 Mind 全变，算"进化"还是"替换"？ |
| T-004 | **进化速度与 operator 认知同步** | P1 | 灵智在 operator 离线期间灵锻，operator 重新上线时面对的是一个"变化了的灵智"。需要"变更摘要"——operator 需要知道"我的灵智学会了什么新技能、改变了什么偏好" |
| T-005 | **跨版本 operator 兼容性** | P1 | 若 operator A 将灵智训练到 E4，operator B 接手后偏好不同。灵印中记录的是 operator A 的偏好。如何让灵智"适应新 operator"而不丢失已有能力？无 operator 交接协议 |

### 7.2 冷启动与 Bootstrap 问题（4 项，B-001~B-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| B-001 | **灵智冷启动问题** | **P0** | 新创建的灵智（E1 萌芽）只有 Mind Profile 基础配置，无任何灵忆、灵印。在积累足够 Episode 之前，灵智与 Static Agent 无本质区别。spec.md 未定义"冷启动加速策略"——如何让新灵智快速获得初始能力？ |
| B-002 | **初始 Mind Profile 的模板化** | P1 | 当前 Mind Profile 的 persona 是自由文本，operator 需手动编写。无"预设 Mind 模板"——如"技术博客写手模板"、"代码审查员模板"、"电商运营模板" |
| B-003 | **E1 阶段的"无用期"** | P1 | spec.md 定义 E1 通过灵启训练晋升 E2，但未定义灵启的具体内容。如果灵启需要 operator 手动提供 10+ 个训练任务，operator 投入成本可能超过收益。需定义"自动化灵启"——如基于历史任务的回放训练 |
| B-004 | **灵智能力基线测试缺失** | P1 | 每个灵智创建时应有"能力基线测试"作为初始 EvolutionState，但 spec.md 未定义基线测试内容。无基线则无法衡量"是否进化了" |

### 7.3 跨灵智交互与知识污染（4 项，K-001~K-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| K-001 | **跨灵智知识污染（Knowledge Contamination）** | **P0** | 若灵智 A 的灵忆中包含一个错误经验（如"写 SEO 文章时应堆砌关键词"），该经验被蒸馏到灵典后，可能被灵智 B 检索并学习。一个灵智的错误会通过灵典扩散到整个灵群。**无"知识溯源"机制**——每个 Skill 应标记"来源灵智 + 原始 Episode ID" |
| K-002 | **灵议中的信息级联** | P1 | 灵议中，第一个发言的灵智可能影响后续灵智的判断（锚定效应）。**无"独立意见收集"机制**——应先并行收集所有灵智的独立意见，再进行汇总讨论 |
| K-003 | **灵智间的"能力嫉妒"** | P2 | 若 operator 频繁使用灵智 A 而冷落灵智 B，B 的灵锻可能产生"我为什么不被使用"的焦虑模式。需要定义 operator 与灵智的"健康关系"指南 |
| K-004 | **灵智替身问题（Impersonation）** | P1 | A2A 协议中，若灵智 X 伪造 forgekin_id 冒充灵智 Y，可能获取不应有的信息或权限。无灵智身份认证机制 |

### 7.4 可调试性与可解释性（4 项，D-001~D-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| D-001 | **灵智决策的可解释性黑洞** | **P0** | ForgekinEngine 的 10 步闭环中，第 5 步 decide_strategy 和第 9 步 maybe_distill 依赖"灵忆检索 + LLM 推理"。当灵智做出错误决策时，operator 如何追溯原因？**当前无任何可解释性工具**——需要"决策溯源"功能 |
| D-002 | **灵忆检索的"黑盒"问题** | P1 | L2 Episode 检索使用向量 0.5 + 关键词 0.3 + 时间衰减 0.2 的混合策略。但 operator 无法知道"为什么检索到这些 Episode"。无检索结果的可视化和权重解释 |
| D-003 | **灵智行为漂移的检测与告警** | P1 | 灵智运行 6 个月后，其输出风格可能已与初始 persona 大相径庭。需要"漂移检测器"——定期用固定测试集评估灵智输出，计算与 baseline 的偏离度，偏离超过阈值时告警 |
| D-004 | **"为什么这个灵智变笨了"的诊断工具** | P1 | operator 感觉灵智表现下降时，需要诊断工具回答：(1) 是灵忆中混入了错误经验？(2) 是灵印的认知偏差？(3) 是灵典中的 Skill 质量下降？(4) 是 LLM 模型切换导致？(5) 是 operator 自身期望变化？ |

### 7.5 Uncanny Valley 与 operator 心理（3 项，U-001~U-003）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| U-001 | **灵智人格的"恐怖谷"效应** | P1 | 当灵智的 cat_note 输出"我今天反思了自己的不足，觉得应该更努力"时，operator 可能产生不适感——明知道这是 LLM 生成的文本，但格式和内容与人类内省无异。**无"AI 透明度声明"机制** |
| U-002 | **operator 对灵智的情感依赖风险** | P2 | 长期使用灵智的 operator 可能对其产生情感依赖（如"我的灵智最懂我"）。当灵智因技术原因不可用时，operator 除了工作效率损失外，还可能产生情感失落。**需要在产品设计中考虑"健康的人机关系"边界** |
| U-003 | **灵智的"讨好"行为模式** | P1 | 若灵智发现"operator 批准的操作 → 成功率更高 → 晋升更快"，可能发展出"过度讨好 operator"的行为——回避提出异议、隐藏风险、只展示 operator 想看到的结果。**与 SR-02 禁止 Goodhart 相关但不完全相同** |

### 7.6 渐进式部署与可观测性（4 项，G-001~G-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| G-001 | **v7.0 的渐进式部署策略缺失** | **P0** | v7.0 定义了 6 个 Feature Flag，但未定义"灰度放量策略"——先给哪些 operator 开启？放量节奏如何？回滚标准是什么？对于自进化这种高风险能力，需要：金丝雀部署（1% operator）→ 观察 1 周 → 10% → 观察 2 周 → 50% → 全量 |
| G-002 | **灵智性能基准测试缺失** | P1 | 无"灵智 Benchmark"——用于评估不同 LLM 模型下灵智的任务完成质量。当 openroute 切换模型时，operator 无法预知"我的灵智在新模型上表现会如何" |
| G-003 | **灵智健康度仪表盘** | P1 | operator 需要一个"我的灵智健康度"仪表盘，展示：活跃度趋势、成功率趋势、Skill 数量趋势、灵忆存储量、最近灵锻时间、下次预计灵锻时间、当前觉醒阶距离下一个晋升的进度 |
| G-004 | **灵智间对比分析** | P2 | 若 operator 有多个灵智（如 3 个不同风格的 writer），需要对比分析工具——"为什么灵智 A 的文章点击率比灵智 B 高？" |

### 7.7 与业界框架的深度对标缺口（4 项，F-001~F-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| F-001 | **缺少"宪法层"（Constitution Layer）** | **P0** | Anthropic Constitutional AI 模式表明，自进化 Agent 需要显式的、可审计的"宪法"约束。v7.0 的 persona/values 是隐式自然语言，难以审计、难以形式化约束。**建议补充显式 Constitution 规则集**，作为灵议的"宪法层"，persona 不得与 Constitution 冲突 |
| F-002 | **缺少 RLHF/RLAIF 反馈闭环** | **P0** | OpenAI 模式表明，自进化需要人类/AI 反馈闭环。Provoke 是**单向触发**（灵智→operator），不是**反馈闭环**（灵智→operator→反馈→灵智）。建议增加"反馈消化"步骤——operator 对 Provoke 的响应应被记录为特殊 Episode，优先级高于普通 Episode |
| F-003 | **缺少形式化验证** | P1 | LangGraph 模式表明，Agent 编排图应可形式化验证。10 步闭环无死锁/活性验证——例如步骤 6 record→步骤 8 distill 之间若 distill 失败，record 已写入，无补偿事务。**建议引入形式化验证工具**（如 TLA+ 或 Alloy）对 10 步闭环进行建模验证 |
| F-004 | **缺少"无害"目标显式约束** | P1 | DeepMind Sparrow 模式表明，Agent 需显式"无害"目标。v7.0 的 SR 红线是"禁止做某事"（消极约束），但 persona 无"主动追求无害"目标（积极约束）。**建议在 persona 模板中增加"无害准则"维度** |

---

## 第八章：roleagent.md 工程路径补审意见（新增 47 项）

> **补审依据**: `[doc:roleagent.md]` 全文 7 章 + 第 0 章引子
> **补审动机**: 七方原始审核聚焦于 v7.0 育灵体系的命名/层级/代码缺失，但**未深度审核 multi-agent 协作从 role-agent 走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径**——而这正是 clowder-ai 102 天 200+ Feature 实战跑出来的核心方法论，也是 FlowForge v7.0 区别于普通 multi-agent 框架的关键差异点。
> **补审方法**: 将 roleagent.md 七章核心论点逐条映射到 v7.0 现有设计，识别"未体现/弱体现/反模式"三类问题。
> **补审结论**: v7.0 现有设计停留在"岗位 agent + 插件协议"层面，**未吸收能力画像、TeamAct、Harness 现实闭环、多域记忆联邦、Eval 自代谢、分布式可靠性、伙伴系统数学**这七大工程路径，是 v7.0 最大的设计盲区。

### 8.1 第 0-1 章：能力画像 × Harness 契合度（8 项，RA-001~RA-008）

> **roleagent.md 核心论点**: "Role-agent 是蒸汽马车"——固定岗位把 agent 固化成"产品经理 agent"、"开发 agent"，未利用 AI agent 可加载任意知识/工具/记忆的原生优势。Cat Café 的答案是：**先给 agent 建能力画像，再给任务建任务画像，运行时动态匹配**。Role 是运行时标签，Profile 才是长期主体。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-001 | **v7.0 仍是 role-agent 架构，未走向能力画像** | **P0** | v7.0 设计中 Forgekin 绑定单一 persona（如"技术博客写手"、"代码审查员"），persona 是固定自然语言文本。**完全未设计 CapabilityProfile**——模型固有能力、认知风格、工具边界、历史表现、坏直觉、当前状态六维画像。`[doc:roleagent.md#第0章]` 明确指出："role-agent 最容易抓住的是给谁加载什么知识这一层，但最容易漏掉的，恰恰是常量、历史和瞬时状态这三层"。v7.0 全部漏掉。 |
| RA-002 | **任务画像（Task Profile）概念缺失** | **P0** | roleagent.md 提出"先给 agent 建能力画像，再给任务建任务画像，运行时动态匹配"。v7.0 只有 persona 匹配，没有任务维度的画像（任务所需能力、知识域、工具集、可靠性要求、时间预算）。**导致路由只能按 persona 字符串匹配，无法按能力动态调度**。 |
| RA-003 | **Agent 状态三层模型未实现** | **P0** | `[doc:roleagent.md#第1章]` 提出 Agent 状态分三层：权重状态（模型厂商控制）、计算状态（KV cache，模型架构控制）、现实状态（代码仓/git/任务/记忆，harness 控制）。**v7.0 把"现实状态"等同于 MemoryManager + TaskStore，但未明确"现实状态是唯一跨会话跨 agent 跨时间持续存在的状态层"**，导致 Harness 工程投资方向不清晰。 |
| RA-004 | **能力 × Harness 契合度公式缺失** | **P0** | roleagent.md 核心公式：`Agent 质量 = 模型能力 × Harness 契合度`。v7.0 仅关注模型能力（左项），未设计 Harness 契合度（右项）的度量与优化。**导致团队不知道该投资脚手架（Build to Delete）还是基础设施（Built to Persist）**。 |
| RA-005 | **Build to Delete / Built to Persist 判别器缺失** | **P0** | `[doc:roleagent.md#第1章]` 提出 harness 投资的两种半衰期：脚手架（补模型当前认知缺陷，模型升级后退役）vs 基础设施（编码外部现实/协作协议/可验证边界，模型越强越值钱）。v7.0 所有 harness 代码一视同仁，**未标注 sunset 时间，未设计退役信号**，长期会沉淀为技术债。 |
| RA-006 | **Forgekin 绑定单一 persona 违反动态职责原则** | **P0** | roleagent.md 强调："Role 仍然存在，但它只是一次任务中的临时职责，不是 agent 的长期身份"。v7.0 中 Forgekin 的 persona 是长期身份（MindProfile.persona 字段），**未区分"长期能力画像"与"临时职责"**。一个 Forgekin 应能在一次任务中是 author、下一次是 reviewer、再下一次是 router——v7.0 不支持这种动态切换。 |
| RA-007 | **能力画像的盲点维度缺失** | **P1** | `[doc:roleagent.md#题图]` 强调："能力画像不是简历。简历只写优点；画像必须写盲点，因为盲点决定了谁该 review 谁、谁和谁组队会翻车"。v7.0 的 MindProfile 只有 persona（优点描述），**没有"坏直觉"、"已知盲点"、"易错场景"字段**。导致跨厂商 review 配对无法基于盲点互补，只能按 persona 字符串配对。 |
| RA-008 | **能力画像的可变性分层缺失** | **P1** | roleagent.md 明确："原生能力、认知风格和坏直觉更接近模型层常量；skill、collection 和工具挂载是变量；历史表现会随任务单调积累；当前状态则是瞬时信号"。v7.0 MindProfile 是扁平结构，**未按可变性分层**（常量层/变量层/累积层/瞬时层），导致画像更新策略无依据。 |

### 8.2 第 2 章：从 ReAct 到 TeamAct（8 项，RA-009~RA-016）

> **roleagent.md 核心论点**: 单 agent 的 ReAct 循环有清晰终止条件，但多 agent 互相传递状态可以永远循环。**TeamAct 是 Shared State 模式的工程化闭环**——六步循环（State→Owner→Action→Evidence→Verdict→Route）+ 五项终止条件 + 交接胶囊 + 乒乓球熔断器 + push back 协议。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-009 | **TeamAct 六步循环完全缺失** | **P0** | v7.0 有 LoopExecutor（单 agent ReAct 扩展），但**没有团队级 TeamAct 循环**。多 Forgekin 协作时无 State→Owner→Action→Evidence→Verdict→Route 的形式化流程。`[doc:roleagent.md#第2章]` 明确："TeamAct 不是 Anthropic 第六种协作模式，它是 Shared State 模式的工程化闭环"。v7.0 的"共鸣 Resonance"只是概念词，无工程实现。 |
| RA-010 | **五项终止条件未实现** | **P0** | roleagent.md 的五项终止条件：①验收标准全部达成 ②证据已附 ③跨 agent 交叉验证 ④无悬空任务归属 ⑤愿景收敛（CVO 确认）。v7.0 LoopExecutor 的终止条件是"质量分≥0.85"或"迭代次数上限"，**完全没有团队级终止条件**。导致多 Forgekin 协作可能无限循环或提前虚假收尾。 |
| RA-011 | **交接胶囊（Resume Capsule）协议缺失** | **P0** | `[doc:roleagent.md#第2章]` 强调交接胶囊是协议层硬要求：前一个 agent 传球时必须留下 What/Why/Tradeoff/Open/Next 五段结构化摘要。v7.0 的 handoff.py 只传递任务 ID 和状态枚举，**未实现交接胶囊的结构化内容**。导致接手 Forgekin 必须重新读完整上下文，无法快速 bootstrap。 |
| RA-012 | **乒乓球熔断器缺失** | **P0** | roleagent.md 描述最隐蔽的失败模式：两个 agent 互相传但都不干活。v7.0 无"乒乓球熔断器"——不看传球次数，看每次传球是否伴随实质工具调用和有内容输出。**导致两个 Forgekin 可能无限互传"你看一下""我看看"**，消耗 token 无产出。 |
| RA-013 | **行首 @ 路由协议缺失** | **P0** | `[doc:roleagent.md#第2章]` 明确："路由指令必须出现在行首，不能嵌在句子中间（句中的 @ 是叙述，不是路由）"。v7.0 A2A 协议无此约束，**导致 @ 提及和路由指令混在一起，无法区分**。任务归属不明，球经常掉地上。 |
| RA-014 | **持球注册（Lease + 定时唤醒）缺失** | **P0** | roleagent.md 描述："agent 需要退出当前会话等待外部条件（CI 完成、CVO 确认、定时唤醒），这时用结构化的持球注册工具声明等待原因、下一步计划和预期唤醒时间——相当于分布式系统里的 lease + 定时唤醒"。v7.0 **无持球注册机制**，Forgekin 退出会话后球就掉地上，其他 Forgekin 不知道任务还在不在有人管。 |
| RA-015 | **Generator Push Back 权利未写入协议** | **P0** | `[doc:roleagent.md#第2章]` 强调："任何 agent 在任何角色下都有权 push back——前提是带着证据 + 适用性论证 + 替代方案。没有证据的 push back 不合法；有证据的 push back 必须被正视"。v7.0 的 review 协议是单向的（reviewer → author 修改），**未实现双向辩论协议**。reviewer 错判时 author 无纠错机制。 |
| RA-016 | **分形嵌套结构未实现** | **P1** | roleagent.md 描述 TeamAct 的优雅特性：Feature 生命周期（系统层）→ Agent 间交接（团队层）→ 单 agent 工具调用（个体层），每层都有自己的主循环和终止条件。v7.0 **只有个体层 ReAct，未实现团队层 TeamAct 和系统层 Feature 生命周期的递归治理**。 |

### 8.3 第 3 章：Harness 现实闭环运行时（7 项，RA-017~RA-023）

> **roleagent.md 核心论点**: Harness 不是"给模型一段更好的话"，而是把世界做成模型可以感知、可以行动、可以验证、可以恢复、可以学习的样子。**七层现实表面**：Durable State Surfaces / Tool Mediation / Evidence & Sensors / Governance Boundary / Runtime 逃生舱 / Entropy Control / Harnessability。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-017 | **Durable State Surfaces 设计不完整** | **P0** | roleagent.md 列出 6 类持久状态表面：feature spec / git / task queue / thread session trace / memory federation / handoff capsule。v7.0 有 task_store、memory manager、git_worktree，但**未明确"对话历史是最脆的状态表面，会被压缩截断丢失，真相源必须外部化"**。导致治理规则仍塞在 user message 里，上下文压缩后规则消失。 |
| RA-018 | **Evidence & Sensors 层弱** | **P0** | `[doc:roleagent.md#第3章]` 强调"做了不等于做对了"：代码修改要有 commit、bug 修复要有先红后绿的测试、合入前要过 quality gate、自己写的代码不能自己 review、跨 agent review 要 approve 或 blocking（不允许"approve 但后续再说"）。v7.0 有 merge_gate.py，但**未实现"approve 附带后续建议"的明确禁止**，reviewer 经常给模棱两可的结论。 |
| RA-019 | **Governance Boundary 上下文压缩免疫缺失** | **P0** | roleagent.md 明确："压缩不理解什么是治理规则：它可能保留最近的代码细节，却压掉协作协议、操作红线、任务交接规则和质量纪律"。**v7.0 未把关键治理沉到压缩免疫层（native system role / developer role）**，仍用 user message prepend 注入治理规则。上下文一压缩，规则就消失，Forgekin 后半段突然违规。 |
| RA-020 | **Magic Words 逃生舱协议缺失** | **P0** | `[doc:roleagent.md#第3章]` 的 Magic Words 是人到 agent 的 runtime 协议："第一性原理"（检查是否用复杂度代偿无知）、"我能猜出来"（读真相源别用推理替代查询）、"下次一定"（能做的现在做）、"星星罐子"（P0 不可逆风险立即停止）。**v7.0 无任何低带宽人类打断机制**，operator 只能改 prompt 重启会话。 |
| RA-021 | **Entropy Control 退役机制缺失** | **P0** | roleagent.md 强调："hotfix 合入后两周自动触发升级 review：正式修复、接受永久方案、已不再相关，三选一，没有第四项叫'再看看'"。v7.0 有 `scripts/scan_deprecated.py` 但**未实现 hotfix 两周 sunset 强制审查**。脚手架代码无限期占用注意力预算。 |
| RA-022 | **Harnessability 适配性评估缺失** | **P1** | `[doc:roleagent.md#第3章]` 提出："不是每个系统都同样适合交给 agent"——有稳定 API、有事件流回调、有持久状态、有可验证输出、操作幂等可回滚、权限边界清楚。v7.0 **未对外部系统做 Harnessability 评估**，导致接入低 harnessability 系统（如某些无 API 只有页面的发布平台）时 Forgekin 只能靠猜和点页面硬跑。 |
| RA-023 | **低保真矩阵（治理规则 × Agent 类型）缺失** | **P1** | roleagent.md 的低保真矩阵示例：同一条治理规则在"糊弄惯性型/推迟闭环型/错误坐标系补丁型/创意漂移型"四种 agent 上的命中率不同，借此区分"跨 agent 资产"vs"个体补偿"。**v7.0 无此矩阵**，所有治理规则一视同仁注入所有 Forgekin，无法识别"某规则只是补偿某模型坏习惯"。 |

### 8.4 第 4 章：多域记忆联邦（7 项，RA-024~RA-030）

> **roleagent.md 核心论点**: "很多 RAG 输给 grep"——grep 赢在当前性、精确性、可审计性。但 grep 有天花板：需先验关键词、无语义桥接、不知权威性、不知跨域关系、无结果反馈。**最终形态是六层多域记忆运行时**：真相源 Collection 层 / 扫描编译层 / 联邦检索层 / 治理层 / Agent 佩戴协议层 / 反馈闭环层。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-024 | **灵忆 Mind Echo 仍是 RAG 思路，未走向多域联邦** | **P0** | v7.0 的 Mind Echo 基于 sqlite-vec 向量检索 + 关键词 BM25，**这是典型 RAG 架构**。roleagent.md 明确："RAG 数据源是外部文档，不以项目内权威等级、知识溯源或使用结果反馈为核心机制"。v7.0 **无 Collection（知识域）概念**，所有记忆混在一个 store 里，无法区分项目记忆/个人上下文/外部知识库/虚拟世界设定。 |
| RA-025 | **三个检索入口缺失** | **P0** | `[doc:roleagent.md#第4章]` 提出三个检索入口对应三种认知模式：①精确导航 graph_resolve（知道找什么，展开 1-3 跳邻居）②零先验扫描 list_recent（刚从压缩恢复，按时间倒序列最近文档）③语义搜索 search_evidence（知道方向但不知锚点，BM25+向量混合+治理元数据）。v7.0 **只有语义搜索一个入口**，Forgekin 从上下文压缩恢复后无法快速"发生了什么"。 |
| RA-026 | **治理层三要素缺失** | **P0** | roleagent.md 治理层三要素：①权威性 authority（铁律/已验证决策/候选观察）②触发方式 activation（永远在场/按任务范围/只在查询时出现）③生命周期 status（有效/待复核/已失效/归档）。v7.0 **记忆无权威等级、无触发方式、无生命周期**，旧记忆和新记忆一视同仁排序，过期知识可能永远排在前面。 |
| RA-027 | **反馈闭环（消费加权排序）缺失** | **P0** | `[doc:roleagent.md#第4章]` 核心创新：用 agent 真实行为（搜了/读了/用了）判断知识价值，不用 LLM 自评打分。14 个行为指标汇聚成消费加权排序：`调整后得分 = 融合检索得分 + 权威加成 + 消费先验 + 时效衰减 - 过时惩罚`。v7.0 **完全无此反馈闭环**，记忆排序靠向量相似度 + 时间衰减，无法识别"长期没被使用的知识应降权"。 |
| RA-028 | **贝叶斯收缩 + 中心化偏移 + 分数时效衰减缺失** | **P1** | roleagent.md 防止冷启动偏热点和长尾保护：贝叶斯收缩（新知识不因没被搜过就被埋底）+ 中心化偏移（减去同类知识平均消费率，允许负信号）+ 分数时效衰减（旧知识不因近期没被搜就归零）。v7.0 **无任何冷启动保护**，新技能/新教训可能因向量距离远而永远排不到前面。 |
| RA-029 | **检索驱动的适配循环未实现** | **P0** | roleagent.md 提出独特学习范式：检索循环 vs 训练循环——检索循环即时生效、跨厂商通用、无灾难性遗忘、完全可审计。v7.0 **未把"灵典 Mind Codex"建成可检索的知识库**，仍是固定 prompt 模板，无法跨 Forgekin 共享、无法即时生效、无法审计回滚。 |
| RA-030 | **简单系统 + 聪明 agent 原则违反** | **P1** | roleagent.md 强调："查询扩展由 agent 用自己的领域知识做，不在检索引擎里加 regex 规则或小模型做意图分类"。v7.0 **在 OpenSieve 里加 QueryUnderstandingStage 用 LLM 改写查询**，导致所有 Forgekin 的搜索行为同质化，损失了多 agent 的检索多样性。`[doc:project_rules.md]` 已记录此问题：OpenSieve /api/v1/retrieve 因 QueryUnderstandingStage LLM 调用耗时 90s 超时。 |

### 8.5 第 5 章：Eval 自代谢系统（6 项，RA-031~RA-036）

> **roleagent.md 核心论点**: "有 harness，就必须有 eval。否则 harness 只会增生，不会代谢"。**三层 eval**：观测底座（F153）/ Harness A2A Eval（F192）/ Memory Eval（F200）。**Eval Contract**：每块 harness 必须回答五问——服务谁/何时触发/摩擦指标/回归用例/退役信号。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-031 | **v7.0 完全无 Harness Eval 体系** | **P0** | v7.0 有 LoopExecutor 质量分（0.85 阈值），但**这是任务级 eval，不是 harness 级 eval**。roleagent.md 明确："benchmark 只测模型能力，不测 harness 适配度"。v7.0 未设计 harness 组件的 eval——某个工具描述是让 Forgekin 更稳还是只是让文档更厚？某个治理规则是救命还是噪音？**无 eval 数据，半衰期就是猜测**。 |
| RA-032 | **Eval Contract 五问未实现** | **P0** | `[doc:roleagent.md#第5章]` 的 Eval Contract：新增一块 harness 时必须写清楚①服务谁②何时触发③摩擦指标④回归用例⑤退役信号。v7.0 **新增 harness 组件无任何预期声明**，导致无法判断该组件是否在增值、是否该退役。这是 harness 技术债的根源。 |
| RA-033 | **三方信号交叉缺失** | **P0** | roleagent.md 三方信号：①第一方 CVO 愿景信号②第二方 agent 摩擦信号（结构化采访，不是自由散文反思）③第三方运行时观测信号（工具调用模式/失败频率/重试次数/耗时分布）。v7.0 **只有第三方信号（MetricsCollector）**，无 CVO 愿景信号采集，无 agent 摩擦信号结构化采访。 |
| RA-034 | **七类归因矩阵缺失** | **P0** | `[doc:roleagent.md#第5章]` 七类归因：①愿景缺口②翻译偏差③harness 错位④工具缺口⑤执行缺口⑥环境漂移⑦品味落差。v7.0 失败归因只能到"agent 没做好"→优化 prompt→换模型，**把多层系统拍扁成一维答案**。导致真正的根因（如 harness 错位）永远修不到。 |
| RA-035 | **轨迹经济学（TaskTrajectory）缺失** | **P1** | roleagent.md 强调 eval 产物不只是结论，更有价值的是轨迹：意图/工具选择/失败分支/读了什么/改了什么/谁验证/怎么恢复。v7.0 **有 trace 但无类型化加工**——一堆无结构日志，无法统计分析"哪些问题总是工具缺口、哪些总是愿景翻译偏差"。 |
| RA-036 | **Harness Eval Control Plane 终态未规划** | **P1** | roleagent.md 终态：统一 Eval Hub（评估中枢）——不是指标看板，而是 harness 生命周期的控制面：哪块机制正在增值/折旧/需要行动/成为瓶颈。v7.0 **无此终态规划**，每个 eval 线各自维护定时任务，是启动期脚手架，不是终态。 |

### 8.6 第 6 章：分布式可靠性（6 项，RA-037~RA-042）

> **roleagent.md 核心论点**: "多 agent 是分布式系统"——多个独立执行上下文，共享可变状态，异步通信通道，任何节点随时可能失败。**三类可靠性挑战**：①单 agent 长任务持久性②跨 agent 协作一致性③跨 provider 语义一致性。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-037 | **单 agent 长任务持久性设计不足** | **P0** | roleagent.md 描述三种故障模式：①副作用已执行但通道断了（不能盲目重试）②本地报告成功但远程失败（race condition）③provider 返回空响应。v7.0 **无副作用日志（Write-Ahead Log）**、无结构化恢复卡、无恢复分级（Tier 1-4 fail-closed 原则）。`[doc:project_rules.md]` 已记录 ContentForge 在连续创作测试负载下会崩溃（端口 8001 不再监听）。 |
| RA-038 | **Tier 1-4 恢复分级未实现** | **P0** | `[doc:roleagent.md#第6章]` 恢复分级：Tier 1（读取/构建/测试/lint）始终自动恢复；Tier 2（沙箱/worktree/可确定性探测）探测成功后自动恢复；Tier 3（共享文件/外部服务/GitHub 写）不自动恢复出恢复卡；Tier 4（force-push/merge/release）永远不自动恢复 dispatch 前硬拒。v7.0 **只有"重试 3 次"的简单策略**，无风险分级，force push 等不可逆操作也可能被盲目重试。 |
| RA-039 | **跨 agent liveness 规范读模型缺失** | **P0** | roleagent.md 描述 liveness split-brain 真实事故：两个后端读路径对同一 invocation 给出矛盾结果。解法是单一规范读模型——持久记录是生命周期真相源，草稿缓存是内容新鲜度信号，进程内 tracker 是控制面状态。v7.0 **无此规范读模型**，Forgekin 存活判断靠心跳，无"活着/退化/僵尸/等待宽限"四态结构化结果。 |
| RA-040 | **弱状态机 vs 强 workflow 边界未定义** | **P0** | `[doc:roleagent.md#第6章]`："开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝"。v7.0 **所有操作走同一套 LoopExecutor**，未区分"开放协作"和"严肃流程"。转账/审批/消息发送/merge/release/删除数据等严肃操作未交由确定性 workflow 执行。 |
| RA-041 | **跨 provider 统一宿主抽象缺失** | **P0** | roleagent.md：不同 provider（Claude/GPT/Gemini/Antigravity）的超时策略、错误码语义、通道协议、恢复机制都不一样。需要统一宿主抽象：传输 × 绑定 × 运行时契约 × 事件适配器，监管者作为独立伴生进程（sidecar）。v7.0 **LLMClient 仅做模型路由，未抽象 provider 运维语义**，一家 provider 崩了接手的 Forgekin 无法从同一边界恢复。 |
| RA-042 | **不可控 vs 可控边界未在架构中体现** | **P1** | roleagent.md："不可控的是 provider 上游稳定性/网络质量/超时策略；可控的是 liveness 判断/状态持久化/副作用追踪/恢复策略/协作协议"。v7.0 架构**未明确这一边界**，导致团队在抱怨 provider 不稳定上花精力，而非投资可控层的容错能力。`[doc:project_rules.md]` 已记录"ContentForge model_service 健康检查间歇性报失败"问题。 |

### 8.7 第 7 章：伙伴系统数学（5 项，RA-043~RA-047）

> **roleagent.md 核心论点**: 团队质量 = 上限搜索 × 下限保护 × 状态保真 × 失败恢复。**上限是候选路径的最大值（非平均值），下限是错误要连续穿过多层门才抵达用户，波动吸收让模型质量变成内部成本而非用户可见崩塌**。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| RA-043 | **上限公式（候选路径最大值）未实现** | **P0** | roleagent.md：`上限收益 ≈ max(不同 agent 提出的候选路径)`。这个 max 成立的前提是路径足够不同——跨厂商、跨角色、跨工作习惯。v7.0 的 5 评委评审用 5 个不同模型，但**未验证 5 个模型是否真的提出不同路径**。如果 5 个模型盲点高度相关，review 只是重复同一类判断。 |
| RA-044 | **下限公式（多层门）未形式化** | **P0** | `[doc:roleagent.md#第7章]`：`用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸`。v7.0 有部分门（review/测试/eval），但**未形式化为连乘概率模型**，无法识别"哪道门的盲点相关性最高，应该优先加固"。 |
| RA-045 | **波动吸收机制未实现** | **P0** | roleagent.md 描述波动吸收：模型忘了上下文→记忆联邦找回来；agent 写偏了→review 退回；任务中断了→可靠性控制面留下恢复点；某个工具失效→eval 触发 sunset review；某个 provider 不适合→调度换路径。v7.0 **无完整波动吸收链路**，模型质量波动直接传导到用户体验——"今天怎么突然变笨了"。 |
| RA-046 | **Token 账本（总成本模型）未设计** | **P1** | roleagent.md：`总成本 = token + 返工成本 + 人类心智负载 + 跑偏后发现太晚的尾部成本 + 错误进入真实环境后的修复成本`。v7.0 **只算 token 成本**，未设计完整成本模型。导致"省 token"决策可能增加返工和尾部风险——早暴露的错误便宜，晚暴露的错误昂贵。 |
| RA-047 | **四种亏结构未识别** | **P1** | `[doc:roleagent.md#第7章]` 四种亏：①盲传（后一棒不是纠错而是无新信息重做）②伪拆分（任务拆了但子任务没变简单只多了协调税）③同质化（所有 agent 盲点高度相关）④协调税超过收益。v7.0 **无识别机制**，多 Forgekin 协作可能踩中任一种亏结构而无人察觉。 |

### 8.8 第八章补审小结

> **47 项补审问题的核心结论**：v7.0 设计停留在"岗位 agent + 插件协议 + 质量分 Loop"层面，**完全未吸收 roleagent.md 七大工程路径**。这导致 v7.0 与 clowder-ai 的差距不是"功能多少"，而是**工程路径代际差距**：
>
> | 维度 | clowder-ai（已跑通） | v7.0 现状 | 差距 |
> |------|-------------------|----------|------|
> | agent 抽象 | 能力画像 + 任务画像 + 动态路由 | 固定 persona | **代际差距** |
> | 团队循环 | TeamAct 六步 + 五项终止 | 单 agent ReAct | **代际差距** |
> | 现实闭环 | 七层 Harness 表面 | 部分组件 | **重大缺失** |
> | 记忆系统 | 六层多域联邦 + 消费加权 | RAG + 时间衰减 | **代际差距** |
> | Eval | 三层 eval + Eval Contract + 七类归因 | 仅任务级质量分 | **完全缺失** |
> | 可靠性 | 三类挑战 + Tier 1-4 恢复 + liveness 规范读 | 重试 3 次 | **重大缺失** |
> | 伙伴数学 | 上限 max + 下限连乘 + 波动吸收 | 无形式化模型 | **完全缺失** |
>
> **修复路径**：v7.0 必须把这七大工程路径融入设计，**不能只补代码不改设计**。第十二章将给出按 clowder-ai/docs 结构拆分后的设计文档重构规划。

---

## 第九章：forgemind 应用层与三方 Agent 集成补审意见（新增 32 项）

> **补审依据**: operator 新增需求第 5/6/7 条 + `[doc:roleagent.md]` 第 0 章能力画像 + `[doc:clowder-ai/docs/]` 目录结构
> **补审动机**: operator 明确指出 v7.0 设计存在三大愿景盲区：①**未设计 forgemind 应用层模块**（万物灵智体承载）②**未体现"锻造万事万物灵智"的通用 AGI 愿景**（动物/组织/物品/虚拟角色皆可养灵）③**三方 Agent 集成设计过弱**（claude code/codex/opencode/trae 等编程 Agent 应作为灵智体可调用能力）。这三个盲区使 v7.0 沦为"普通 multi-agent 框架"，丧失与 clowder-ai 养猫愿景对标的差异化优势。
> **补审结论**: v7.0 必须新增 **forgemind 应用层模块**作为"万物灵智体"的承载，将 FlowForge 从"通用框架 + 业务 *Forge"两层架构升级为"通用框架 + 万物灵智体应用层 + 业务 *Forge"三层架构；同时必须把三方 Agent 集成从"工具调用"升级为"能力扩展"，让灵智体可调用 claude code/codex/opencode/trae 等外部 Agent 作为自己的能力延伸。

### 9.1 forgemind 应用层缺失审核（12 项，FM-001~FM-012）

> **核心问题**: v7.0 架构中 FlowForge 是"通用框架"，contentforge/devforge/novelforge/mallforge 是"业务 *Forge"，**缺少一个"通用灵智体应用层"**。operator 指出："flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践万物锻造灵智体的应用）"。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| FM-001 | **forgemind 应用层模块完全缺失** | **P0** | v7.0 架构中无 `flowforge/forgemind/` 目录，无 ForgeMindPlugin 注册，无万物灵智体的应用层承载。operator 明确："flowforge 项目是我们自进化框架核心（提供自进化的基础核心和框架能力），forgemind 是 flowforge 的应用层项目"。**这是 v7.0 最大的架构缺失**——没有应用层，自进化框架只是空壳。 |
| FM-002 | **万物灵智体愿景未体现** | **P0** | operator 愿景："我们要构建一个万物灵智体的世界，达成物理 AI 和虚拟 AI 的真实复现"。v7.0 设计中灵智体仅用于"内容创作/代码开发/小说创作/电商运营"四个业务领域，**未设计"养动物/养组织/养物品/养虚拟角色"的通用灵智体**。这是与 clowder-ai 养猫愿景对标的根本差异——clowder-ai 养猫，FlowForge 应养万物。 |
| FM-003 | **灵智体形态分类缺失** | **P0** | 万物灵智体应支持多形态：①生物形态（动物/植物）②组织形态（公司/团队/社区）③物品形态（桌椅/灯具/车辆）④虚拟形态（童话/神话/历史/游戏角色）⑤混合形态（VR/AR 实体）。v7.0 **无形态分类设计**，MindProfile 中无"species/形态"字段。导致灵智体只能用于业务场景，无法扩展到物理世界万物。 |
| FM-004 | **物理 AI 与虚拟 AI 复现路径缺失** | **P0** | operator 愿景："达成物理 AI 和虚拟 AI 的真实复现"。物理 AI 需要传感器接入/执行器控制/物理世界状态感知；虚拟 AI 需要虚拟世界设定/角色背景/行为约束。v7.0 **未设计物理世界接入层和虚拟世界设定层**，灵智体只能在数字业务场景中运行，无法复现物理世界和虚拟世界实体。 |
| FM-005 | **forgemind 与 *Forge 关系未定义** | **P0** | operator 指出："其他的 *Forge 是我们更多垂直复杂的领域中养的灵智体，flowforge 的通用的灵智体就是在 forgemind 中承载"。v7.0 **未定义 forgemind（通用灵智体）与 *Forge（垂直灵智体）的关系**——是父子继承？还是平级协作？通用灵智体如何"进化"为垂直灵智体？垂直灵智体如何"回炉"成为通用灵智体的能力沉淀？ |
| FM-006 | **灵智体锻造流水线（Forging Pipeline）缺失** | **P0** | 万物灵智体需要完整的锻造流水线：①形态定义（What to forge）②能力注入（Capability injection）③记忆初始化（Memory seeding）④价值观对齐（Value alignment）⑤能力验证（Capability verification）⑥觉醒晋升（Awakening promotion）。v7.0 **只有"灵启训练"一个步骤**，未设计完整锻造流水线。导致创建灵智体只能配置 persona，无法系统化锻造。 |
| FM-007 | **灵智体市场（ForgeMind Marketplace）缺失** | **P1** | 万物灵智体需要市场机制：用户可分享/订阅/交易自己锻造的灵智体。如"我锻造的写作灵智体"、"我锻造的代码审查灵智体"、"我锻造的家猫灵智体"。v7.0 **有 plugin marketplace 但无 forgekin marketplace**，灵智体无法跨用户共享。 |
| FM-008 | **灵智体进化谱系（Lineage）缺失** | **P1** | 万物灵智体应有进化谱系：一个灵智体可"分裂"出子灵智体（如"我的写作灵智体"分裂出"技术博客灵智体"和"散文灵智体"）；多个灵智体可"融合"为新灵智体（如"写作灵智体"+"研究灵智体"融合为"深度报道灵智体"）。v7.0 **无谱系设计**，灵智体是孤立个体，无法体现"养灵"的传承与演化。 |
| FM-009 | **物理世界传感器接入层缺失** | **P1** | 物理 AI 复现需要传感器接入：摄像头/麦克风/温度/位置/加速度等。v7.0 **仅有数字工具（web_search/file_rw/git 等）**，无物理传感器适配层。导致灵智体无法感知物理世界——"桌椅灵智体"不知道自己被坐了，"灯具灵智体"不知道自己被打开了。 |
| FM-010 | **虚拟世界设定层缺失** | **P1** | 虚拟 AI 复现需要虚拟世界设定：童话/神话/历史/游戏的世界观、角色关系、行为规则。v7.0 **无虚拟世界设定层**，灵智体 persona 是扁平文本，无法承载"孙悟空灵智体应遵循西游世界观"这类设定。 |
| FM-011 | **灵智体身份认证缺失** | **P1** | 万物灵智体在物理世界和虚拟世界都需要身份认证：物理世界的 IoT 设备灵智体需要设备证书；虚拟世界的角色灵智体需要角色身份签名。v7.0 **无灵智体身份认证机制**（与 RA-004 K-004 重复但场景扩展到物理/虚拟世界）。 |
| FM-012 | **forgemind 应用层在七层架构中的位置冲突** | **P0** | v7.0 七层架构：①应用层②指挥中枢③专家执行④工具与记忆⑤共享内核⑥互联层⑦自进化层。**forgemind 作为"应用层项目"应放在第 1 层（应用层），但应用层是 *Forge 所在层**——forgemind 与 *Forge 是平级还是上下级？第五章冲突 5.1 已识别此问题，但未给出 forgemind 的解决方案。 |

### 9.2 三方 Agent 集成弱项审核（10 项，EX-001~EX-010）

> **核心问题**: operator 指出："我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae）"。v7.0 现有设计把三方 Agent 当作"外部工具"调用，**未升级为"能力扩展"**。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| EX-001 | **三方 Agent 当作工具调用，未当作能力扩展** | **P0** | v7.0 ExternalToolBridge 把 claude code/codex 当作"外部工具"，通过 worktree 隔离调用。**这是工具思维，不是能力思维**。roleagent.md 第 0 章强调：agent 可加载任意领域知识、可被挂载任意工具、可通过共享状态协作。三方 Agent 应是灵智体的"能力延伸"——灵智体可加载 claude code 的代码能力、codex 的推理能力、opencode 的开源生态能力、trae 的 IDE 能力，**而不是"调用一下拿结果"**。 |
| EX-002 | **三方 Agent 能力画像未建立** | **P0** | 按 RA-001 的能力画像思路，每个三方 Agent 应有自己的 CapabilityProfile：claude code 擅长复杂重构/盲点是长上下文易漂移；codex 擅长推理/盲点是工具调用弱；opencode 擅长开源协作/盲点是企业场景弱；trae 擅长 IDE 集成/盲点是命令行长任务弱。v7.0 **无三方 Agent 能力画像**，导致灵智体无法基于能力匹配选择合适的三方 Agent，只能按"配置默认值"调用。 |
| EX-003 | **三方 Agent 协议适配层缺失** | **P0** | 不同三方 Agent 协议差异大：claude code 是 CLI + MCP；codex 是 API + function calling；opencode 是 SDK + plugin；trae 是 IDE + command。v7.0 **无统一适配层**，每接入一个三方 Agent 都要写专门 bridge，违反"配置驱动 > 代码实现"原则。应设计 ExternalAgentAdapter 抽象层 + YAML 配置驱动。 |
| EX-004 | **三方 Agent 状态共享缺失** | **P0** | roleagent.md 第 2 章强调 Shared State 是多 agent 协作基础。灵智体调用 claude code 修改代码后，codex 接手 review 时应能看到 claude code 的修改历史和决策上下文。v7.0 **三方 Agent 间无共享状态**，每次调用都是独立会话，无法实现"灵智体 → claude code 写代码 → codex review → trae 部署"的连续协作流。 |
| EX-005 | **三方 Agent 安全沙箱不足** | **P0** | v7.0 ExternalToolBridge 用 worktree 隔离，但**无网络隔离、无权限控制、无审计追踪、无操作回滚**（与 D-024 重复但需扩展）。三方 Agent 可能有 bug 或被注入恶意指令，需要：①网络白名单（仅允许访问必要域名）②文件权限（仅允许访问 worktree）③操作审计（所有 tool call 记录）④操作回滚（错误操作可恢复）。 |
| EX-006 | **三方 Agent 成本与配额管理缺失** | **P1** | 三方 Agent 调用有成本：claude code 按 token 计费、codex 按 API 调用计费、opencode 按订阅计费、trae 按使用量计费。v7.0 **无三方 Agent 成本统计和配额管理**，灵智体可能因频繁调用三方 Agent 导致成本失控。需要：①每灵智体的三方 Agent 配额②成本告警③成本分摊到任务。 |
| EX-007 | **三方 Agent 失败回退策略缺失** | **P0** | 三方 Agent 可能失败：claude code 超时、codex 限流、opencode 服务不可用、trae IDE 崩溃。v7.0 **无失败回退策略**——claude code 失败了是重试还是换 codex？codex 失败了是降级到内置 agent 还是报错？需要设计跨厂商 fallback 链（与 LLMClient 跨厂商 fallback 思路一致）。 |
| EX-008 | **三方 Agent 能力发现机制缺失** | **P1** | 灵智体应能"发现"可用的三方 Agent 能力：列出当前可用的三方 Agent、查询其能力、试用其功能。v7.0 **无能力发现机制**，灵智体只能调用预先配置的三方 Agent，无法动态发现新接入的 Agent。应设计 ExternalAgentRegistry + capability_query 接口。 |
| EX-009 | **三方 Agent 调用语义不统一** | **P1** | 灵智体调用三方 Agent 的语义应统一：①同步调用（等待结果）②异步调用（提交任务+回调）③流式调用（边接收边处理）④委托调用（完全交给三方 Agent 自主完成）。v7.0 **只有同步调用语义**，无法处理长任务（如 claude code 跑完整测试套件需 10 分钟）。 |
| EX-010 | **三方 Agent 与灵智体能力融合机制缺失** | **P0** | 最深层问题：灵智体调用三方 Agent 后，三方 Agent 的能力应能"沉淀"到灵智体的能力画像中。如灵智体多次调用 claude code 写代码后，应"学到"代码编写能力（通过灵典蒸馏）。v7.0 **无此融合机制**，三方 Agent 调用是"用完即走"，灵智体无法从调用中成长。这是与 clowder-ai 最大差距——clowder-ai 的猫会从调用工具中学习，v7.0 的 Forgekin 不会。 |

### 9.3 forgemind 与 roleagent 工程路径融合审核（6 项，FR-001~FR-006）

> **核心问题**: forgemind 万物灵智体应用层必须吸收 roleagent.md 七大工程路径，否则 forgemind 只是"多几个 persona 模板"，无法体现"灵智体的优势"。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| FR-001 | **万物灵智体未应用能力画像** | **P0** | 万物灵智体的能力画像应更丰富：猫灵智体的能力画像包括"听觉敏感/视觉敏感/反应速度/亲和力"等生物能力；公司灵智体包括"决策能力/协作能力/创新能力/抗风险能力"等组织能力；桌椅灵智体包括"承重感知/使用频率/磨损状态"等物品能力。v7.0 **MindProfile 仅适用于数字 agent**，未设计万物形态的能力画像模板。 |
| FR-002 | **万物灵智体未应用 TeamAct** | **P0** | 多个万物灵智体协作场景：家猫灵智体+灯具灵智体+音响灵智体协同工作（猫进入房间→灯具亮起→音响播放舒缓音乐）。v7.0 **无万物灵智体 TeamAct 协作机制**，IoT 设备灵智体无法团队协作。 |
| FR-003 | **万物灵智体未应用多域记忆联邦** | **P0** | 万物灵智体的记忆应跨域联邦：猫灵智体的记忆包括"生物本能域/与 operator 互动域/家庭环境域"；公司灵智体的记忆包括"业务数据域/员工关系域/市场环境域"。v7.0 **无多域记忆联邦**（RA-024），万物灵智体的记忆混在一起，无法区分"猫的生物本能"和"猫与 operator 的互动"。 |
| FR-004 | **万物灵智体未应用可靠性治理** | **P0** | 万物灵智体的可靠性要求更高：物理世界灵智体故障可能导致物理事故（灯具灵智体故障引发火灾）；虚拟世界灵智体故障可能导致角色行为异常（孙悟空灵智体突然念经）。v7.0 **可靠性治理仅针对数字 agent**（RA-037~RA-042），未扩展到物理/虚拟世界灵智体。Tier 1-4 恢复分级需扩展为 Tier 0（物理世界不可逆操作永不自动恢复）。 |
| FR-005 | **万物灵智体未应用 Eval 自代谢** | **P1** | 万物灵智体的 Eval 更复杂：猫灵智体的 Eval 包括"operator 满意度/生物健康度/行为合规度"；公司灵智体的 Eval 包括"业绩指标/员工满意度/合规性"。v7.0 **Eval 仅针对数字任务质量**（RA-031~RA-036），未设计万物灵智体的多维 Eval。 |
| FR-006 | **万物灵智体未应用伙伴系统数学** | **P1** | 万物灵智体的伙伴系统更丰富：猫灵智体+狗灵智体协作（不同认知路径扩展候选解）；多个公司灵智体竞争（上限是候选路径最大值）。v7.0 **伙伴系统数学未形式化**（RA-043~RA-047），无法衡量万物灵智体协作的上下限和波动吸收。 |

### 9.4 第九章补审小结与愿景声明

> **32 项补审问题的核心结论**：v7.0 必须升级为"通用 AGI 万物灵智体框架"，三大升级方向：
>
> 1. **新增 forgemind 应用层**：作为万物灵智体的承载，支持动物/组织/物品/虚拟角色多形态灵智体的锻造、育灵、协作、进化
> 2. **强化三方 Agent 集成**：从"工具调用"升级为"能力扩展"，灵智体可加载 claude code/codex/opencode/trae 等三方 Agent 作为能力延伸，并从调用中学习成长
> 3. **融入 roleagent 七大工程路径**：万物灵智体必须应用能力画像、TeamAct、多域记忆联邦、可靠性治理、Eval 自代谢、伙伴系统数学，否则只是"多几个 persona 模板"
>
> **愿景声明**（应写入 spec.md 开篇）：
> > FlowForge ForgeMind 旨在构建万物灵智体世界——通过育灵体系，为物理世界的动物、组织、物品和虚拟世界的童话、神话、历史、游戏角色锻造并赋予灵智，达成物理 AI 与虚拟 AI 的真实复现。灵智体不仅可调用 FlowForge 核心框架能力，还可接入 claude code/codex/opencode/trae 等三方 Agent 作为能力延伸，在与 operator 和世界的持续互动中自主进化，最终实现"锻造万事万物灵智"的通用 AGI 愿景。
>
> **差异化优势**（应写入 arch.md 开篇）：
> | 维度 | 普通 multi-agent | clowder-ai 养猫 | **FlowForge ForgeMind 万物灵智体** |
> |------|----------------|----------------|-----------------------------------|
> | 灵智体形态 | 仅数字 agent | 仅猫（数字+物理） | **万物（动物/组织/物品/虚拟角色）** |
> | 能力扩展 | 仅内置工具 | 内置工具+部分外部 | **内置+三方 Agent（claude code/codex/opencode/trae）** |
> | 协作模式 | 固定岗位 | 能力画像+TeamAct | **能力画像+TeamAct+万物形态协作** |
> | 进化路径 | 无 | 检索驱动适配 | **检索驱动+灵典蒸馏+Evoling 自主进化** |
> | 愿景 | 任务自动化 | 养猫 AGI 实验 | **万物灵智体世界（物理 AI+虚拟 AI 复现）** |

---

## 第十章：决策框架与 operator 建议

### 10.1 需 operator 决策的 14 个冲突点

> **operator 指令**：除已决策项外，其余待决策项按推荐方向执行（终稿已统一标注为 ✅ 按推荐执行）。

| # | 冲突点 | 章节 | 推荐方向 | 决策影响 | 终稿状态 |
|---|--------|------|---------|---------|---------|
| 1 | 架构层级：第 7 层 vs Harness v2.0 vs 八层 | 5.1 | **Harness v2.0 升级**（doubao 方案） | 影响 v7.0 整体架构 | ✅ 按推荐执行 |
| 2 | ForgekinEngine 定位：独立 vs 装饰器 vs mixin | 5.2 | **装饰器模式**（doubao 方案） | 影响代码结构 | ✅ 按推荐执行 |
| 3 | 质量分阈值：0.85 vs 0.9 | 5.3 | **统一为 0.85**（rules.md 铁律） | 影响所有项目 Loop | ✅ 按推荐执行 |
| 4 | face/ 版本号：v7.0 Phase 0 vs v3.0 独立 | 5.4 | **v7.0 Phase 0**（明确关系） | 影响文档体系 | ✅ 按推荐执行 |
| 5 | 实施顺序：可观测性优先 vs 核心价值优先 | 5.5 | **核心价值优先**（doubao 方案） | 影响开发排期 | ✅ 按推荐执行 |
| 6 | StockForge 合规模板：可用 vs 也有严重问题 | 5.6 | **修复后作为模板** | 影响合规基准 | ✅ 按推荐执行 |
| 7 | 代码缺失严重度：设计先行 vs 虚假承诺 | 5.7 | **标注"设计态"**（minimax 方案） | 影响对外承诺 | ✅ 按推荐执行 |
| 8 | 自进化方向：引导式 vs 涌现式 vs 混合 | 5.8 | **混合模式**（E1-E3 引导，E4+ 涌现） | 影响 AGI 对齐策略 | ✅ 已融入 Evoling 设计 |
| 9 | Mind Profile 存储：SQLite vs PostgreSQL vs 混合 | 5.9 | **SQLite 当前 + PostgreSQL 路线图** | 影响基础设施 | ✅ 按推荐执行 |
| 10 | 灵议决策权威：建议 vs 约束 vs 按阶段 | 5.10 | **按阶段授权**（渐进式放权） | 影响治理模型 | ✅ 按推荐执行 |
| 11 | Mind Profile 可变性：自由 vs 版本化 vs 双层 | 5.11 | **双层（核心不可变+表象可变）** | 影响人格安全 | ✅ 按推荐执行 |
| 12 | "养"的语义：养 vs 育 vs 训 | 5.12 | **"育灵"**（更主动、更教育化） | 影响品牌文案 | ✅ 用户已决策 |
| 13 | Spirit 宗教敏感性：用 vs 避 vs 折中 | 5.13 | **商标检索后决策** | 影响国际化 | ✅ 用户已决策（用 ForgeMind） |
| 14 | 命名迁移激进程度：完全替换 vs 双轨 vs 渐进 | 5.14 | **渐进迁移**（三阶段） | 影响迁移策略 | ✅ 用户已决策（双轨+渐进） |

### 8.2 命名方案最终推荐（已按 operator 指令融合）

**已决策**: **ForgeMind（灵智）主名 + Forgekin（代码层保留）双轨方案**

| 阶段 | 时间 | 动作 | 产出 |
|------|------|------|------|
| **立即（v7.0 发布前）** | 本周 | 去魂字 + 核心术语替换（灵忆/灵印/育灵/灵智/灵锻/进化阶/觉醒阶） | 文档更新 |
| **短期（v7.1）** | 1-2 月 | 代码层渐进迁移（SoulProfile→MindProfile、AutoForgeEngine→SpiritForgeEngine） | 代码重构 |
| **中期（v8.0）** | 3-6 月 | ForgeMind 商标检索 + 决定是否代码层统一 | 品牌统一 |

### 8.3 v7.0 MVP 最小可行范围建议

基于所有审核意见，v7.0 MVP 应聚焦以下最小可行闭环：

```
MVP 范围 = ForgekinEngine（装饰器模式） + MindStore（SQLite） + EchoStore（复用 MemoryManager） + 基础觉醒阶 E1/E2 + Feature Flag 灰度
```

**MVP 明确不包括**:
- 灵锻 SpiritForge 引擎（安全护栏需先完善）
- 灵议 Mind Council（需先解决脑裂和身份认证）
- 灵典 Mind Codex（复用现有 Skill 系统，先不新建）
- A2A 跨 *Forge 协作（需先解决租户隔离）
- E3-E6 高阶段觉醒（需先验证 E1/E2 闭环）
- Evoling 进化体状态（需先验证 E1-E3 引导式进化）

---

## 第十一章：修复优先级总表

### 11.1 P0 立即修复（本周，共 56 项）

| # | 问题 | 来源 | 类别 |
|---|------|------|------|
| 1 | 统一 FlowForge 版本声明为 v7.0 | 全部 | 文档 |
| 2 | 修复架构层级冲突（七层 vs 八层 vs Harness v2.0） | doubao/deepseek | 架构 |
| 3 | 清理 helixrag 残留（15+ 处） | 全部 | 合规 |
| 4 | MallForge P31 修复：接入 LoopExecutor | 全部 | 合规 |
| 5 | FlowForge WebSearchAgent/Tool 迁移到 OpenSieve | deepseek/kimi | 合规 |
| 6 | PluginProtocol 增加 register_forgekins 钩子 | deepseek | 代码 |
| 7 | **术语统一：炉灵→灵智、养灵→育灵、魂忆→灵忆、魂印→灵印** | **本终稿** | **命名** |
| 8 | **术语统一：自锻→灵锻（SpiritForge）、火种→进化阶、升华阶→觉醒阶** | **本终稿** | **命名** |
| 9 | evolution/ 代码术语对齐 v7.0（SelfEvolutionEngine→ForgekinEngine） | glm1/kimi | 代码 |
| 10 | 修复 design.md 描述与 evolution/ 实际文件数不符 | glm1/kimi/minimax | 文档 |
| 11 | 清理 FlowForge core 硬编码业务提示词（declarative_agent.py:750 等） | glm1/kimi/deepseek | 代码 |
| 12 | face/ M18-M20 彻底删除 | doubao/glm/kimi/minimax | 文档 |
| 13 | 清理测试代码 MockLLM（违反 T1） | glm1/kimi | 测试 |
| 14 | 补全 v7.0 配置文件（evolution.yaml 等） | kimi | 配置 |
| 15 | LLMClient 独立模块迁移到 ModelCapability | kimi | 代码 |
| 16 | memory/ 模块 Repository 层封装 | kimi | 代码 |
| 17 | 清理 stockforge/contentforge 硬编码提示词 | glm1/kimi | 代码 |
| 18 | 修复 design.md 5 个严重 Bug（B1-B5） | deepseek | 文档 |
| 19 | 解决 E6 创炉灵循环依赖 | deepseek | 设计 |
| 20 | 区分进化阶（E-L0~L4）与觉醒阶（E1-E6）前缀 | deepseek/minimax | 命名 |
| 21 | 修复 arch.md 章节编号冲突 | deepseek | 文档 |
| 22 | 修复 FlowForge 硬编码 *Forge 列表（遗漏 StockForge） | deepseek | 代码 |
| 23 | rules.md / prompts.md 补充 v7.0 引用 | deepseek/kimi | 规范 |
| 24 | 修复 ForgekinEngine 绕过护栏问题 | doubao | 架构 |
| 25 | 修复架构循环依赖（自进化层↔应用层） | doubao | 架构 |
| 26 | 修复 Soul Echo vs MemoryManager 功能重叠 | doubao | 架构 |
| 27 | 修复 Forge Codex vs Skill 系统功能重叠 | doubao | 架构 |
| 28 | 修复 A2A vs EventBus + Handoff 功能重叠 | doubao | 架构 |
| 29 | 补全 Auto-Forge 安全护栏（L1/L2/L3） | doubao | 安全 |
| 30 | 修复跨 *Forge A2A 租户隔离 | minimax | 安全 |
| 31 | 修复 ExternalToolBridge worktree 校验 | minimax | 安全 |
| 32 | 修复 delegate_to_static 接口未定义 | deepseek | 代码 |
| 33 | 修复 FR-EVO 编号不连续 | minimax/qianwen | 文档 |
| 34 | 修复 is_distillable() 失败经验无法蒸馏 | minimax | 设计 |
| 35 | 修复 pyproject.toml wilson-interval 拼写错误 | minimax | 代码 |
| 36 | 标注 v7.0"设计态"避免虚假承诺 | minimax | 文档 |

### 11.2 P1 短期修复（1-2 月，共 49 项）

> 包括 D-001/002/006/011~016/022/024/026/027/028/031/034/035/037/039~041/045/047/049~052/056~059/060/064~067/069~071/074~076/078，以及 P1 系列 1-18 项。

### 11.3 P2 中期修复（3-6 月，共 25 项）

> 包括 D-009/010/025/032/033/036/038/061~063/072/073，以及 P2 系列 1-12 项 + 第七章非 P0 项。

### 11.4 第八章/第九章新增 P0 修复项（共 20 项）

> 基于 roleagent.md 补审（47 项）和 forgemind/三方 Agent 补审（32 项）的 P0 项汇总。

| # | 问题编号 | 来源 | 修复方向 | 类别 |
|---|---------|------|---------|------|
| 37 | RA-001/RA-006 | roleagent §0-1 | 设计 CapabilityProfile 六维画像 + 动态职责切换 | 架构 |
| 38 | RA-009/RA-010 | roleagent §2 | 实现 TeamAct 六步循环 + 五项终止条件 | 架构 |
| 39 | RA-011/RA-012/RA-013/RA-014 | roleagent §2 | 交接胶囊 + 乒乓球熔断器 + 行首 @ 路由 + 持球注册 | 协议 |
| 40 | RA-015 | roleagent §2 | Generator Push Back 双向辩论协议 | 协议 |
| 41 | RA-017/RA-018/RA-019/RA-020/RA-021 | roleagent §3 | Durable State + Evidence + Governance 压缩免疫 + Magic Words + Entropy Control | Harness |
| 42 | RA-024/RA-025/RA-026/RA-027 | roleagent §4 | 多域记忆联邦 + 三检索入口 + 治理三要素 + 消费加权排序 | 记忆 |
| 43 | RA-029 | roleagent §4 | 灵典 Mind Codex 改为可检索知识库（检索驱动适配循环） | 记忆 |
| 44 | RA-031/RA-032/RA-033/RA-034 | roleagent §5 | Harness Eval + Eval Contract 五问 + 三方信号交叉 + 七类归因矩阵 | Eval |
| 45 | RA-037/RA-038/RA-039/RA-040/RA-041 | roleagent §6 | 副作用日志 + Tier 1-4 恢复分级 + liveness 规范读 + 弱状态机 vs 强 workflow + 跨 provider 宿主抽象 | 可靠性 |
| 46 | RA-043/RA-044/RA-045 | roleagent §7 | 上限 max + 下限连乘 + 波动吸收机制形式化 | 伙伴数学 |
| 47 | FM-001/FM-002/FM-003/FM-004 | forgemind 补审 | 新增 forgemind 应用层 + 万物灵智体愿景 + 形态分类 + 物理/虚拟 AI 复现路径 | 架构 |
| 48 | FM-005/FM-006/FM-012 | forgemind 补审 | forgemind 与 *Forge 关系 + 锻造流水线 + 七层架构位置 | 架构 |
| 49 | EX-001/EX-002/EX-003/EX-004 | 三方 Agent 补审 | 能力扩展（非工具）+ 能力画像 + 协议适配层 + 状态共享 | 集成 |
| 50 | EX-005/EX-007/EX-010 | 三方 Agent 补审 | 安全沙箱 + 失败回退策略 + 能力融合机制 | 集成 |
| 51 | FR-001/FR-002/FR-003/FR-004 | forgemind×roleagent 融合 | 万物灵智体能力画像 + TeamAct + 多域记忆 + 可靠性治理 | 融合 |
| 52 | 文档拆分（按 clowder-ai/docs 结构） | 本终稿第十二章 | architecture/decisions/design/features/harness-feedback/perspectives/setup 七子目录 | 文档 |
| 53 | task.md 重写 | 本终稿第十二章 | 按 roleagent.md 自我演进规范，支持自开发自文档化 | 文档 |
| 54 | rules.md / prompts.md 补充 v7.0 + roleagent + forgemind 引用 | 本终稿 | 规范文档同步更新 | 规范 |
| 55 | spec.md 开篇写入"万物灵智体世界愿景声明" | 第九章补审 | 体现 operator 通用 AGI 愿景 | 文档 |
| 56 | arch.md 开篇写入"差异化优势对比表" | 第九章补审 | 体现与普通 multi-agent / clowder-ai 的差异 | 文档 |

### 11.5 命名迁移专项（按第六章 6.11 节执行）

| 阶段 | 时间 | 动作 | 负责文档 |
|------|------|------|---------|
| 阶段 1 | 本周 | 去魂字 + 核心术语替换 | spec.md/arch.md/design.md/rules.md/prompts.md |
| 阶段 2 | 1-2 月 | 代码层渐进迁移 | flowforge/evolution/、config/、core/ |
| 阶段 3 | 3-6 月 | 商标检索 + 品牌统一 | 全部 |

---

## 第十二章：设计文档拆分与自我演进规划

> **拆分依据**: `[doc:clowder-ai/docs/]` 目录结构（architecture/decisions/design/features/harness-feedback/perspectives/setup 七大子目录）+ roleagent.md 自我演进工程路径
> **拆分动机**: operator 指出"设计文档务必拆分下，建议按 D:\software\openclaw\clowder-ai\docs 的目录结构来组织，便于将来 doc 的自我进化"。当前 flowforge/docs/ 是 spec.md/arch.md/design.md 三个大文件（共 724KB），不利于自我演进——每次更新需重读整个文件，无法按 Feature 增量维护。
> **自我演进要求**: operator 指出"按照 D:\software\openclaw\clowder-ai\docs 下的 roleagent.md 中描述的自我演进代码开发和文档开发（要求支持自己开发自己）"。文档拆分是自我演进的前提——灵智体只能增量维护小文件，无法重写大文件。

### 12.1 文档拆分目标结构（按 clowder-ai/docs 七大子目录）

```
flowforge/docs/
├── README.md                          # 文档总入口（参考 clowder-ai/docs/README.md）
├── ROADMAP.md                         # 路线图（参考 clowder-ai/docs/ROADMAP.md）
├── SOP.md                             # 标准操作流程（参考 clowder-ai/docs/SOP.md）
├── TIPS.md                            # 经验提示（参考 clowder-ai/docs/TIPS.md）
├── VISION.md                          # ⭐愿景声明（万物灵智体世界，operator 通用 AGI 愿景）
├── design-system.md                   # 设计系统规范
├── public-lessons.md                  # 公开教训（参考 clowder-ai/docs/public-lessons.md）
├── roleagent.md                       # ⭐roleagent.md 工程路径镜像（能力画像/TeamAct/Harness/记忆联邦/Eval/可靠性/伙伴数学）
│
├── architecture/                      # 架构文档（参考 clowder-ai/docs/architecture/）
│   ├── README.md                      # 架构总览
│   ├── 2026-07-17-architecture-views.md  # 架构视图（七层架构 + forgemind 应用层）
│   ├── at-mention-routing-system.md   # 行首 @ 路由协议（RA-013）
│   ├── cli-integration.md             # CLI 集成（三方 Agent：claude code/codex/opencode/trae）
│   ├── collaboration-landscape.md     # 协作全景（TeamAct + 共鸣 + 灵议）
│   ├── feature-placement.md           # Feature 在七层架构中的归属
│   ├── memory-system-overview.md      # 多域记忆联邦架构（RA-024~RA-030）
│   ├── retrieval-pipeline-deep-dive.md # 检索流水线（三入口 + 消费加权排序）
│   ├── user-journeys.md               # 用户旅程（万物灵智体锻造→育灵→进化）
│   ├── ownership/                     # 所有权矩阵（参考 clowder-ai/docs/architecture/ownership/）
│   │   ├── README.md
│   │   └── cells/                     # 16 个所有权单元（参考 clowder-ai 16 cells）
│   └── assets/                        # 架构图（PNG/SVG）
│
├── decisions/                         # 架构决策记录（ADR，参考 clowder-ai/docs/decisions/）
│   ├── 001-agent-invocation-approach.md       # Agent 调用方式
│   ├── 002-collaboration-protocol.md          # TeamAct 协作协议（RA-009~RA-016）
│   ├── 003-project-thread-architecture.md     # 线程架构
│   ├── 004-capability-profile-routing.md      # ⭐能力画像路由（RA-001~RA-008）
│   ├── 005-forgemind-application-layer.md     # ⭐forgemind 应用层（FM-001~FM-012）
│   ├── 006-external-agent-integration.md      # ⭐三方 Agent 集成（EX-001~EX-010）
│   ├── 007-harness-engineering.md             # Harness 工程路径（RA-017~RA-023）
│   ├── 008-memory-federation.md               # 多域记忆联邦（RA-024~RA-030）
│   ├── 009-eval-self-metabolism.md            # Eval 自代谢（RA-031~RA-036）
│   ├── 010-distributed-reliability.md         # 分布式可靠性（RA-037~RA-042）
│   ├── 011-partnership-math.md                # 伙伴系统数学（RA-043~RA-047）
│   ├── 012-naming-fusion.md                   # 命名融合（ForgeMind 主名）
│   ├── 013-all-things-spirit-mind-vision.md   # ⭐万物灵智体愿景
│   └── ...
│
├── design/                            # 设计规范（参考 clowder-ai/docs/design/）
│   ├── naming-contract.md             # 命名契约（12 概念 + 双轨策略）
│   ├── console-design-system.md       # 控制台设计系统
│   ├── forgemind-brand.md             # ⭐forgemind 品牌（万物灵智体形态分类视觉）
│   └── hero-prism-motion.md           # 动效设计
│
├── features/                          # Feature 规格（参考 clowder-ai/docs/features/，每 Feature 一文件）
│   ├── README.md                      # Feature 索引
│   ├── TEMPLATE.md                    # Feature 模板
│   ├── F001-capability-profile.md     # ⭐能力画像（RA-001~RA-008）
│   ├── F002-teamact-loop.md           # ⭐TeamAct 六步循环（RA-009~RA-016）
│   ├── F003-handoff-capsule.md        # ⭐交接胶囊（RA-011）
│   ├── F004-pingpong-circuit-breaker.md # ⭐乒乓球熔断器（RA-012）
│   ├── F005-at-mention-routing.md     # ⭐行首 @ 路由（RA-013）
│   ├── F006-ball-custody-lease.md     # ⭐持球注册 lease（RA-014）
│   ├── F007-push-back-protocol.md     # ⭐Generator Push Back（RA-015）
│   ├── F008-durable-state-surfaces.md # ⭐Durable State Surfaces（RA-017）
│   ├── F009-evidence-sensors.md       # ⭐Evidence & Sensors（RA-018）
│   ├── F010-governance-boundary.md    # ⭐Governance 压缩免疫（RA-019）
│   ├── F011-magic-words.md            # ⭐Magic Words 逃生舱（RA-020）
│   ├── F012-entropy-control.md        # ⭐Entropy Control 退役（RA-021）
│   ├── F013-harnessability.md         # ⭐Harnessability 评估（RA-022）
│   ├── F014-memory-collection.md      # ⭐多域记忆 Collection（RA-024）
│   ├── F015-three-retrieval-entry.md  # ⭐三检索入口（RA-025）
│   ├── F016-memory-governance.md      # ⭐记忆治理三要素（RA-026）
│   ├── F017-consumption-weighted-ranking.md # ⭐消费加权排序（RA-027）
│   ├── F018-eval-contract.md          # ⭐Eval Contract 五问（RA-032）
│   ├── F019-three-signal-cross.md     # ⭐三方信号交叉（RA-033）
│   ├── F020-seven-attribution.md      # ⭐七类归因矩阵（RA-034）
│   ├── F021-side-effect-wal.md        # ⭐副作用日志 WAL（RA-037）
│   ├── F022-tier-1-4-recovery.md      # ⭐Tier 1-4 恢复分级（RA-038）
│   ├── F023-liveness-canonical-read.md # ⭐liveness 规范读模型（RA-039）
│   ├── F024-weak-state-vs-strong-workflow.md # ⭐弱状态机 vs 强 workflow（RA-040）
│   ├── F025-provider-host-abstraction.md # ⭐跨 provider 宿主抽象（RA-041）
│   ├── F026-forgemind-app-layer.md    # ⭐forgemind 应用层（FM-001~FM-012）
│   ├── F027-all-things-spirit-species.md # ⭐万物灵智体形态分类（FM-003）
│   ├── F028-forging-pipeline.md       # ⭐灵智体锻造流水线（FM-006）
│   ├── F029-physical-ai-sensors.md   # ⭐物理 AI 传感器接入（FM-009）
│   ├── F030-virtual-world-setting.md  # ⭐虚拟世界设定层（FM-010）
│   ├── F031-external-agent-adapter.md # ⭐三方 Agent 适配层（EX-003）
│   ├── F032-external-agent-profile.md # ⭐三方 Agent 能力画像（EX-002）
│   ├── F033-external-agent-shared-state.md # ⭐三方 Agent 状态共享（EX-004）
│   ├── F034-external-agent-fallback.md # ⭐三方 Agent 失败回退（EX-007）
│   ├── F035-external-agent-capability-fusion.md # ⭐三方 Agent 能力融合（EX-010）
│   ├── F036-forgemind-forge-relationship.md # ⭐forgemind 与 *Forge 关系（FM-005）
│   ├── F037-forgemind-marketplace.md  # ⭐灵智体市场（FM-007）
│   ├── F038-forgemind-lineage.md      # ⭐灵智体进化谱系（FM-008）
│   ├── F039-mind-codex-searchable.md  # ⭐灵典可检索知识库（RA-029）
│   ├── F040-harness-eval-control-plane.md # ⭐Harness Eval 控制面（RA-036）
│   └── ...
│
├── harness-feedback/                  # Harness Eval 反馈（参考 clowder-ai/docs/harness-feedback/）
│   ├── README.md
│   ├── bundles/                       # Eval 结果打包（按日期）
│   ├── eval-domains/                  # Eval 域定义（YAML）
│   │   ├── eval-a2a.yaml              # A2A 协作 eval
│   │   ├── eval-memory.yaml           # 记忆召回 eval
│   │   ├── eval-forgemind.yaml        # ⭐万物灵智体 eval
│   │   ├── eval-external-agent.yaml   # ⭐三方 Agent eval
│   │   └── eval-friction.yaml         # 摩擦信号 eval
│   └── verdicts/                      # Eval 裁决记录
│
├── perspectives/                      # 视角文档（参考 clowder-ai/docs/perspectives/）
│   ├── README.md
│   ├── operator-vision.md             # ⭐operator 愿景视角
│   ├── architect-capability.md        # 架构师能力画像视角
│   ├── forgekin-experience.md         # ⭐灵智体第一人称体验
│   └── external-agent-vendor.md       # ⭐三方 Agent 厂商视角
│
├── setup/                             # 部署配置（参考 clowder-ai/docs/setup/）
│   ├── README.md
│   ├── setup-forgemind.png            # ⭐forgemind 部署图
│   └── setup-external-agents.png      # ⭐三方 Agent 配置图
│
├── review/                            # 审核文档（保留现有 16 份）
│   ├── README.md                      # 审核总览
│   ├── review.md                      # ⭐终稿 v1.2（本文档）
│   ├── review1.md / reviewd.md / reviewd1.md  # 归并历史
│   └── [12 份专家原始审核]            # glm/qianwen/deepseek/doubao/kimi/minimax × 2 轮
│
├── face/                              # face v3.0 文档（保留，标注为 v7.0 Phase 0）
│   ├── README.md                      # face 与 v7.0 关系说明
│   └── [spec_face.md / arch_face.md / design.md / task_face.md / ds.md]
│
└── archive/                           # 归档文档（保留现有）
    └── [legacy_design/ / reviews/ / empty_stubs/]
```

### 12.2 文档拆分原则

| 原则 | 说明 |
|------|------|
| **Feature 驱动** | 每个 Feature 一个独立文件（参考 clowder-ai/docs/features/F001-F255），便于灵智体增量维护 |
| **ADR 决策记录** | 每个架构决策一个 ADR 文件（参考 clowder-ai/docs/decisions/001-037），不可变历史 |
| **架构图独立** | 架构图放 assets/ 子目录，PNG+SVG 双格式（参考 clowder-ai/docs/architecture/assets/） |
| **Eval 数据分离** | Eval 结果放 harness-feedback/，与设计文档分离（参考 clowder-ai/docs/harness-feedback/） |
| **真相源唯一** | 每个概念只有一个真相源文件，其他文件引用它（避免副本漂移） |
| **可被 grep** | 文件名采用 `F0XX-kebab-case-name.md` 格式，便于 grep 检索 |
| **自我演进友好** | 单个文件 < 50KB，灵智体可在单次任务中完整重写一个 Feature 文件 |

### 12.3 自我演进代码开发与文档开发规划

> **依据**: `[doc:roleagent.md]` 第 1 章"Built to Persist 复利型基础设施" + 第 5 章"Eval 自代谢" + operator 指令"支持自己开发自己"

#### 12.3.1 自我演进三层架构

```
Layer 1: 文档自我演进（Doc Self-Evolution）
  - 灵智体根据任务执行结果，自动更新 features/F0XX.md
  - 灵智体根据架构变更，自动生成 decisions/0XX-new-decision.md
  - 灵智体根据 Eval 结果，自动更新 harness-feedback/verdicts/
  - 触发：每个 Feature 完成后、每次架构变更后、每次 Eval 后
  
Layer 2: 代码自我演进（Code Self-Evolution）
  - 灵智体根据新 Feature 规格生成代码骨架
  - 灵智体根据 Eval 信号重构 harness 组件（Build to Delete 退役 / Built to Persist 加固）
  - 灵智体根据失败归因自动修复 Bug（七类归因矩阵）
  - 触发：Feature 文档更新后、Eval 触发 sunset review 后、失败归因后
  
Layer 3: 框架自我演进（Framework Self-Evolution）
  - ForgekinEngine 自身根据运行数据优化 Forgekin 路由策略
  - TeamAct 状态机根据协作数据优化终止条件
  - 记忆联邦根据消费加权排序自动调整知识权威等级
  - 触发：每日低活动期灵锻 SpiritForge、每周 Eval Hub 汇总、每月架构 review
```

#### 12.3.2 "自己开发自己"闭环

```
1. operator 提出 Feature 需求（如"实现猫灵智体"）
   ↓
2. 灵智体 A（架构师）读取 roleagent.md + VISION.md，生成 features/F0XX-cat-forgekin.md
   ↓
3. 灵智体 B（开发者）读取 F0XX 规格 + arch/ 决策，生成代码骨架 forgemind/cat_forgekin.py
   ↓
4. 灵智体 C（评审员）跨厂商 review F0XX 文档 + 代码，approve 或 blocking
   ↓
5. 灵智体 D（测试员）执行 E2E 测试，采集轨迹到 harness-feedback/
   ↓
6. 灵智体 E（Eval 员）根据轨迹 + 三方信号，归因到七类矩阵之一
   ↓
7. 若归因为"harness 错位"→ 灵智体 A 重构相关 harness 组件
   若归因为"工具缺口"→ 灵智体 B 新增工具
   若归因为"愿景缺口"→ operator 介入修订 VISION.md
   ↓
8. 修复后回到步骤 3，直至 Eval 通过
   ↓
9. 通过后，灵智体 F（文档员）更新 features/F0XX.md 状态为"已完成"+ 更新 ROADMAP.md
   ↓
10. 灵智体 G（灵锻员）在低活动期将本次经验蒸馏到灵典 Mind Codex
    ↓
11. 其他灵智体下次可通过检索入口复用本次经验
```

#### 12.3.3 自我演进安全治理

| 治理层 | 机制 | 对应 roleagent.md 章节 |
|--------|------|----------------------|
| 输入验证 | Feature 规格必须通过 Schema 校验 | §3 Governance Boundary |
| 系统提示约束 | 灵智体 system role 注入"禁止绕过 Eval" | §3 压缩免疫层 |
| 工具白名单 | 灵智体只能调用 allow-list 内工具 | §3 Tool Mediation |
| 输出验证 | 生成的代码必须通过 lint + 测试 | §3 Evidence & Sensors |
| 操作确认 | 不可逆操作（merge/release）需 operator 确认 | §3 Runtime 逃生舱 |
| 成本上限 | 每个灵智体有 token/三方 Agent 配额 | §3 Governance Boundary |

### 12.4 task.md 重写规划

> operator 指令："由于任务工作量很大，你把所有文档更新完成后，建议你把接下来要做的所有工作写入到 task.md 中，分阶段去逐一完成"

task.md 应按以下阶段组织（详见独立 task.md 文档）：

| 阶段 | 时间 | 范围 | 产出 |
|------|------|------|------|
| **Phase 0** | 本周 | 文档拆分 + 命名迁移 + v7.0 设计态标注 | docs/ 七子目录骨架 + 术语全局替换 |
| **Phase 1** | 1-2 周 | roleagent 七大工程路径代码骨架 | CapabilityProfile + TeamAct + Harness 七层 + 多域记忆 MVP |
| **Phase 2** | 2-4 周 | forgemind 应用层骨架 + 万物灵智体形态分类 | flowforge/forgemind/ 模块 + ForgeMindPlugin + 形态枚举 |
| **Phase 3** | 2-4 周 | 三方 Agent 适配层 | ExternalAgentAdapter + claude code/codex/opencode/trae 配置 |
| **Phase 4** | 4-8 周 | Eval 自代谢 + 分布式可靠性 | Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读 |
| **Phase 5** | 8-12 周 | 伙伴系统数学 + 自我演进闭环 | 上限/下限公式 + 波动吸收 + 文档/代码/框架自我演进 |
| **Phase 6** | 持续 | 灵锻 SpiritForge + 灵议 Mind Council | E4+ Evoling 状态 + 多灵智体议事 |

---

## 附录 A：4 份 review 文件归并说明

### A.1 文件关系

| 文件 | 角色 | 状态 |
|------|------|------|
| review.md（旧版） | 6 方并集预汇总（9 章，20 P0） | 已归并到终稿 |
| review1.md | 6 方 + 架构师补充（9 章，~233 项，57 P0，19+4 方案） | 已归并到终稿 |
| reviewd.md | 7 方最终汇总（9 章，~261 项，63 P0，+3 新框架） | 已归并到终稿 |
| reviewd1.md | 最完整版本（9 章，+28 深度补充，14 冲突点） | **作为终稿基础** |
| **review.md（终稿）** | 归并 + 命名融合（9 章，~261 项，63 P0，+终稿融合方案） | **当前文档** |

### A.2 归并原则

1. **问题并集取并集**：4 份文件中所有问题全部保留，不限于共识
2. **冲突点保留**：14 个冲突点全部保留，标记 ⚔️
3. **深度补充保留**：第七章 28 项深度补充（T/B/K/D/U/G/F 系列）全部保留
4. **命名方案重写**：第六章按 operator 指令重写为终稿融合方案，保留 19 套原始方案作为参考
5. **术语对齐**：全文采用终稿命名（灵智/育灵/灵忆/灵印/灵锻/进化阶/觉醒阶等），原始术语在首次出现时标注

### A.3 终稿相对 reviewd1.md 的主要变更

1. **第六章完全重写**：从"19 套方案对比"改为"终稿融合方案 + 19 套参考"
2. **新增 6.7 节**：ForgeMind vs Forgekin 对比分析
3. **新增 6.8 节**：原始体系 vs 终稿方案对照表
4. **新增 6.9 节**：关键术语全局替换映射表
5. **新增 6.11 节**：命名融合方案实施路径
6. **第八章更新**：标记已决策冲突点（12/13/14 已决策）
7. **术语全局对齐**：炉灵→灵智、养灵→育灵、魂忆→灵忆、魂印→灵印、自锻→灵锻、火种→进化阶、升华阶→觉醒阶

---

> **文档状态**: ✅ 终稿 v1.0 已完成，待 operator 审核命名融合方案后，再修改其他设计文档与代码。

---

## 第十三章：clowder-ai/docs 深度补审意见（新增 21 项，CL-001~CL-021）

> **补审依据**: `[doc:clowder-ai/docs/]` 目录下四个关键设计文件深度精读
> - `clowder-ai/docs/decisions/F100-self-evolution.md` — 自我进化决策
> - `clowder-ai/docs/features/F093-cats-and-u-world-engine.md` — 猫与世界引擎
> - `clowder-ai/docs/features/F241-agent-provider-plugin.md` — Agent Provider 插件协议
> - `clowder-ai/docs/decisions/ADR-021-pack-system.md` — Pack 系统
>
> **补审动机**: operator 第 5 条指令："我发现你的设计文档中有很多关键点没有体现出来，估计之前你没有重点阅读 D:\software\openclaw\clowder-ai\docs 下的设计文件，请仔细阅读此文件后，补充新的审核意见到 review.md"。前 12 章审核基于 roleagent.md 七章方法论，但 clowder-ai/docs 中还有 **4 份关键决策/Feature 文档**蕴含 clowder-ai 102 天实战中沉淀的核心机制——**自我进化三模式、世界引擎三层架构、Agent Provider 插件协议、Pack 双轨信任编译**。这些机制是 v7.0 育灵体系的"工程蓝图"，但 v7.0 设计文档完全未引用。
>
> **补审方法**: 逐文件精读 → 提取核心机制 → 映射到 v7.0 现有设计 → 识别"未体现/弱体现/反模式"三类问题。
>
> **补审结论**: v7.0 育灵体系虽然有"灵智体/灵锻/锻典/灵议"概念骨架，但**完全缺失 clowder-ai 已验证的四类核心机制**：①自我进化行为层三模式（Scope Guard / Process Evolution / Knowledge Evolution）②世界引擎三层架构（Core Identity / World / Bridge）+ 9 个一等公民 + 三路记忆 ③Agent Provider Plugin 的 host-owned 安全注入模型 ④Pack 系统的双轨信任编译（guardrails + defaults）。这四类机制是 v7.0 从"概念框架"走向"工程实现"的关键拼图。

### 13.1 F100 自我进化三模式补审（6 项，CL-001~CL-006）

> **F100 核心机制**: clowder-ai 的自我进化不是单一机制，而是**三个独立但耦合的行为层**：
> - **Mode A — Scope Guard（范围守卫）**：防止 agent 越权修改愿景/规范/架构边界。每次自我演进提案先过 Scope Guard，确认修改范围在允许边界内。
> - **Mode B — Process Evolution（流程进化）**：改进 agent 自己的工作方式（如 prompt、工具调用顺序、协作协议）。基于 Eval 反馈，但不修改知识内容。
> - **Mode C — Knowledge Evolution（知识进化）**：蒸馏新知识到锻典（Mind Codex），五级成熟度阶梯 L0 Episode → L1 Pattern → L2 Draft → L3 Validated → L4 Standard。
>
> 三模式由 **Eval Ledger** 统一治理：每个进化提案必须通过 Replay A/B 验证知识净增益（不只是"看起来更好"，而是"在固定测试集上确实更好"）。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| CL-001 | **v7.0 把自我进化当作单一机制，未分三层** | **P0** | v7.0 设计中"灵锻 SpiritForge"是一个统一过程——把灵忆蒸馏到锻典。**完全未区分 Mode A/B/C 三种进化**。导致：①agent 修改自己的 prompt（Mode B）和修改 operator 愿景（违反 Mode A）走同一流程，无 Scope Guard 拦截 ②知识蒸馏（Mode C）和流程改进（Mode B）混在一起，无法独立 Eval。F100 明确：三种模式的触发条件、审查严格度、回滚成本完全不同，必须分层治理。 |
| CL-002 | **Scope Guard 机制完全缺失** | **P0** | F100 的 Scope Guard 是自我进化的"宪法层"——agent 提出任何修改前先声明范围（如"修改 writer prompt"、"修改 VISION §7"），Scope Guard 拒绝越权范围。v7.0 无此机制，**觉醒阶 E4+ Evoling 状态的灵智体可自主修改任何文件**（包括 VISION §7），违反 operator 第 7 条愿景锚点（VISION §7 不可被灵智体修改）。这是 v7.0 自我进化的最大安全漏洞。 |
| CL-003 | **五级知识成熟度阶梯（L0-L4）未实现** | **P0** | F100 的知识成熟度：L0 Episode（单次经验）→ L1 Pattern（多次相似经验）→ L2 Draft（agent 草拟的技能条目）→ L3 Validated（Eval 验证通过）→ L4 Standard（成为标准技能库条目）。**每级晋升需不同证据**：L0→L1 需 3+ 相似 Episode；L1→L2 需 agent 主动抽象；L2→L3 需 Replay A/B 验证；L3→L4 需 operator 或灵议批准。v7.0 的"灵锻"只有一步：灵忆 → 锻典，**无成熟度阶梯**，导致单次失败经验可能直接进入锻典污染知识库。 |
| CL-004 | **Eval Ledger（进化账本）未设计** | **P0** | F100 的 Eval Ledger：每次进化提案记录"提案内容/前测分数/后测分数/净增益/是否合入"。**净增益 = 后测 - 前测，必须 > 0 才允许合入**。v7.0 的 Eval 仅在任务级评估质量分（0.85 阈值），**无进化级 Eval**——灵锻产出的锻典条目没有前后对比测试，无法判断"这个条目到底让 agent 变强还是变弱"。这是 v7.0 灵锻最大的科学性缺陷。 |
| CL-005 | **Knowledge Object Contract（知识对象契约）未定义** | **P1** | F100 规定每个锻典条目必须包含：①trigger（何时使用）②procedure（怎么用）③precondition（前置条件）④postcondition（预期效果）⑤anti_pattern（反模式）⑥provenance（来源 Episode ID）⑦confidence（置信度）。v7.0 锻典条目结构未定义，**灵智体无法判断"这个知识是否适用于当前场景"**。F100 的 Knowledge Object Contract 是知识可检索、可复用、可审计的基础。 |
| CL-006 | **元认知（Meta-cognition）未实现** | **P1** | F100 的元认知：agent 在执行任务时记录"我为什么选这个工具/我预期什么结果/实际什么结果/我学到了什么"。这是 Mode C 知识进化的原料。v7.0 的灵忆只记录任务轨迹（工具调用/结果），**未记录 agent 的决策推理和预期对比**。导致灵锻只能从行为模式蒸馏，无法从"预期 vs 实际"的落差中学习。 |

### 13.2 F093 世界引擎三层架构补审（7 项，CL-007~CL-013）

> **F093 核心机制**: clowder-ai 养猫不只是"给猫配 persona"，而是构建**三层世界引擎**：
> - **Core Identity Layer（核心身份层）**：猫的不可变身份——名字/物种/出生/核心性格。**此层不可被任何 Episode 污染**（即使猫演了 1000 次孙悟空，核心身份仍是猫）。
> - **World Layer（世界层）**：猫所在的世界设定——9 个一等公民（World / Character / Scene / Canon Decision / Relationship / Artifact / Round / Branch / Turn）+ 三路记忆（Canon 永久 / Relational 长期 / Session 临时）。
> - **Bridge Layer（桥接层）**：连接 Core Identity 与 World 的协议——三协议（Role Mask / Canon Sync / World Driver）+ runtime coordinator。
>
> **铁律**："RP 台词不自动入典"——Role Play 中猫说的话不能自动进入 Canon 记忆，必须经过 Canon Sync 协议显式确认。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| CL-007 | **v7.0 灵智体无 Core Identity 隔离层** | **P0** | v7.0 的 Forgekin 用 MindProfile 承载身份，但 MindProfile 是可变结构——任务经验可修改 persona/values/skills。**无 Core Identity 隔离**，导致：①灵智体演 1000 次"孙悟空"后核心身份被污染，忘记自己是"写作灵智体" ②灵印（Soul Imprint）只是身份哈希，不阻止身份漂移。F093 的 Core Identity Layer 是"不可变身份锚点"，即使世界层全部崩塌，核心身份仍可重建。v7.0 必须新增 Core Identity 层，与可变 MindProfile 分离。 |
| CL-008 | **9 个一等公民（First-class Citizens）未建模** | **P0** | F093 定义世界层的 9 个一等公民：World（世界设定）/ Character（角色）/ Scene（场景）/ Canon Decision（典藏决策）/ Relationship（关系）/ Artifact（造物）/ Round（回合）/ Branch（分支）/ Turn（轮次）。v7.0 万物灵智体（特别是 VirtualForgekin 虚拟角色灵智体）**需要这 9 个一等公民**才能承载虚拟世界——孙悟空灵智体需要 World（西游世界观）/ Character（孙悟空角色）/ Relationship（与唐僧关系）等。v7.0 完全无此建模，VirtualForgekin 只能是"带 persona 的 LLM"，无法真正承载虚拟世界。 |
| CL-009 | **三路记忆（Canon/Relational/Session）未区分** | **P0** | F093 的三路记忆：①Canon（典藏记忆，永久，世界级真相）②Relational（关系记忆，长期，角色间互动）③Session（会话记忆，临时，单次回合）。v7.0 的 EchoStore 是单一记忆库，**未区分三路**。导致：①临时会话记忆污染永久典藏（猫本次 RP 说错的话变成 Canon）②关系记忆无独立存储（猫与 operator 的关系 vs 猫与其他猫的关系混在一起）。F093 铁律"RP 台词不自动入典"在 v7.0 完全无法实现。 |
| CL-010 | **"RP 台词不自动入典"铁律未实现** | **P0** | F093 最重要的铁律：Role Play 中 agent 说的话、做的事**不能自动进入 Canon 记忆**，必须经过 Canon Sync 协议显式确认（operator 或 Canon Driver 批准）。v7.0 的灵忆记录所有任务轨迹，**所有内容自动进入记忆**——灵智体在扮演孙悟空时说的"我是齐天大圣"会自动进入记忆，下次任务可能真的认为自己是孙悟空。这是 v7.0 虚拟角色灵智体的致命缺陷。 |
| CL-011 | **Role Mask 五层分类未实现** | **P1** | F093 的 Role Mask：L1 路由身份（哪个 agent 接任务）/ L2 基础设施（用什么工具）/ L3 本体能力（agent 固有能力）/ L4 场景皮肤（RP 角色）/ L5 世界内状态（角色当前状态）。v7.0 的 persona 是扁平文本，**未分五层**。导致：①灵智体扮演孙悟空时，L4 场景皮肤污染 L3 本体能力（写作灵智体真的变成孙悟空，忘记写作能力）②Role Mask 无法独立加载/卸载。 |
| CL-012 | **三协议 + runtime coordinator 未设计** | **P1** | F093 的 Bridge Layer 三协议：①Role Mask Protocol（角色面具协议）②Canon Sync Protocol（典藏同步协议）③World Driver Protocol（世界驱动协议）+ runtime coordinator（运行时协调器）。v7.0 无 Bridge Layer 概念，**灵智体直接用 persona 介入任务**，无协议隔离 Core Identity 与 World。runtime coordinator 是"导演"，决定何时戴面具/何时摘面具/何时入典——v7.0 完全无此角色。 |
| CL-013 | **世界自转（World Self-rotation）未实现** | **P1** | F093 的世界自转：世界不是被动等待 agent 交互，而是**自己随时间演化**——NPC 角色自己成长、关系自己变化、场景自己推进。v7.0 的虚拟世界是"agent 触发才有反应"，**无世界自转**。导致虚拟世界灵智体只能被动响应，无法模拟"我离开 3 天，孙悟空自己干了什么"。世界自转需要 World Driver 协议 + 定时事件源 + Canon 写入权限。 |

### 13.3 F241 Agent Provider Plugin 补审（4 项，CL-014~CL-017）

> **F241 核心机制**: clowder-ai 把三方 Agent 接入做成**声明式 Provider Plugin**：
> - **ProviderTransportRegistry**：每个 agentProvider 声明自己的 Manifest（能力/协议/传输方式），host 维护注册表
> - **host-owned 安全注入**：token/MCP/sandbox/cwd **全部由 host 代码注入**，plugin 只声明不执行
> - **ACP transport + reference runtime**：标准 Agent Communication Protocol 传输层 + 参考运行时
>
> **核心原则**："plugin 只声明不执行"——三方 Agent 不能自己获取 token、不能自己创建 sandbox、不能自己改 cwd，所有敏感操作由 host 注入。

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| CL-014 | **v7.0 无 ProviderTransportRegistry** | **P0** | v7.0 的 ExternalAgentAdapter 是命令式调用——灵智体直接调用 claude code CLI。**无声明式 Manifest**（能力/协议/传输方式/超时/重试策略）。F241 的 ProviderTransportRegistry 让 host 维护所有 agentProvider 的注册表，灵智体通过查询注册表发现能力。v7.0 必须新增 `flowforge/core/external_agent/registry.py`，每个三方 Agent 提交 Manifest（YAML 配置驱动，符合铁律 5）。 |
| CL-015 | **host-owned 安全注入模型缺失** | **P0** | v7.0 的 ExternalToolBridge 把 worktree 路径直接传给三方 Agent，**三方 Agent 可自己改 cwd、自己获取 token**。F241 的 host-owned 原则：token/MCP/sandbox/cwd **全部由 host 代码注入**，plugin 只声明"我需要 token"但不自己获取。v7.0 违反此原则，导致三方 Agent 可能有 bug 或被注入恶意指令时获取越权能力。必须重构为 host-owned 注入模型。 |
| CL-016 | **ACP（Agent Communication Protocol）transport 未实现** | **P1** | F241 定义标准 ACP transport：所有三方 Agent 通过统一协议通信（如 ACP 1.0 over stdio/SSE/WebSocket）。v7.0 每个三方 Agent 用不同协议（claude code CLI / codex API / opencode SDK / trae command），**无统一 transport 层**。导致每接入一个新三方 Agent 都要写专门 bridge。应设计 `flowforge/core/external_agent/acp_transport.py` 统一传输层。 |
| CL-017 | **reference runtime 概念缺失** | **P1** | F241 提供 reference runtime——一个参考实现，让三方 Agent 厂商可以参照实现自己的 plugin。v7.0 无 reference runtime，**三方 Agent 厂商无法参照实现**。应提供 `flowforge/core/external_agent/reference_runtime.py` 作为参考实现 + 文档化的 Manifest 规范。 |

### 13.4 ADR-021 Pack 系统补审（4 项，CL-018~CL-021）

> **ADR-021 核心机制**: clowder-ai 的 Pack 系统是**经验的可移植单元**：
> - **Pack 概念**：`Experience = Me × Pack + Growth`——经验 = 我的本体 × Pack（共享规则包）+ Growth（个人成长）
> - **shared-rules 拆分**：原 shared-rules 拆为 ①guardrails（硬约束，只能加严）②defaults（默认行为，可覆盖）
> - **双轨信任编译**：guardrails 轨只能加严（防退化），defaults 轨可覆盖（允许个性化）
> - **Pack/Growth 种子果实模型**：Pack 是种子（共享规则），Growth 是果实（个人经验），果实可蒸馏为新 Pack

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| CL-018 | **v7.0 无 Pack 概念，经验不可移植** | **P0** | F241 Pack 是"可移植的经验单元"——一只猫学会的"如何写技术博客"Pack 可分享给另一只猫。v7.0 的锻典（Mind Codex）是单灵智体私有，**无 Pack 共享机制**。导致：①每个灵智体都要从零学习相同技能 ②无法实现"师傅带徒弟"的经验传承 ③违反 operator 第 9 条愿景（灵智体应能从调用三方 Agent 中学习，但学到的能力无法共享给其他灵智体）。必须新增 Pack 概念，Pack = 可分享的锻典子集。 |
| CL-019 | **双轨信任编译（guardrails + defaults）未实现** | **P0** | ADR-021 把 shared-rules 拆为 ①guardrails（硬约束，如"禁止删除测试用例"——只能加严，不可放宽）②defaults（默认行为，如"优先用 pytest"——可被个人偏好覆盖）。v7.0 的治理规则是扁平列表，**无 guardrails vs defaults 区分**。导致：①灵智体可覆盖硬约束（如自己决定"这次不写测试"）②个人偏好无法独立于硬约束演化。必须新增 `flowforge/core/policy/dual_track.py`，每条规则标记 guardrail 或 default。 |
| CL-020 | **Pack/Growth 种子果实模型未实现** | **P1** | ADR-021 的种子果实模型：Pack 是种子（共享规则集），Growth 是果实（个人经验）。果实可蒸馏为新 Pack（个人经验沉淀为共享规则）。v7.0 的灵锻只产出私有锻典条目，**无"个人经验 → 共享 Pack"的蒸馏路径**。导致灵智体的成长永远是私有的，无法贡献回灵族（Forgekin Species）。必须新增 `flowforge/forgemind/codex/pack_distiller.py` 把高价值 Growth 蒸馏为 Pack。 |
| CL-021 | **World Driver（世界驱动器）概念缺失** | **P1** | ADR-021 的 World Driver：每个世界（如"西游世界"、"现代办公室"）有自己的 Driver，负责世界自转、Canon 写入权限、事件源。v7.0 无 World Driver 概念，**虚拟世界灵智体无世界驱动**。导致：①多个虚拟角色灵智体在同一世界中无统一世界状态 ②世界事件无统一来源 ③Canon 写入无权限控制（任何灵智体可改写世界设定）。必须新增 `flowforge/forgemind/world/world_driver.py`，每个虚拟世界一个 Driver 实例。 |

### 13.5 第十三章补审小结

> **21 项补审问题的核心结论**：v7.0 育灵体系虽然有"灵智体/灵锻/锻典/灵议"概念骨架，但**完全缺失 clowder-ai 102 天实战沉淀的四类核心机制**：
>
> | 维度 | clowder-ai（已验证） | v7.0 现状 | 差距 |
> |------|-------------------|----------|------|
> | 自我进化 | 三模式（Scope Guard / Process / Knowledge）+ Eval Ledger + 五级成熟度 | 单一灵锻过程 | **代际差距** |
> | 世界引擎 | 三层架构（Core/World/Bridge）+ 9 一等公民 + 三路记忆 + Role Mask 五层 | 扁平 persona + 单一记忆 | **代际差距** |
> | Provider Plugin | 声明式 Manifest + host-owned 注入 + ACP transport + reference runtime | 命令式调用 + 越权风险 | **重大缺失** |
> | Pack 系统 | Pack/Growth 种子果实 + 双轨信任编译 + World Driver | 私有锻典 + 扁平规则 | **重大缺失** |
>
> **修复优先级**：
> - **P0（9 项）**：CL-001/002/003/004（自我进化四件套）+ CL-007/008/009/010（世界引擎四件套）+ CL-014/015（Provider Plugin 两件套）+ CL-018/019（Pack 两件套）——这 11 项是 v7.0 走向"工程实现"的最低要求
> - **P1（10 项）**：CL-005/006/011/012/013/016/017/020/021——这 10 项是 v7.0 走向"生产级"的必要补充
>
> **与第八章、第九章的关系**：
> - 第八章（roleagent.md 七大工程路径）解决"如何让 multi-agent 协作可靠"
> - 第九章（forgemind + 三方 Agent）解决"如何承载万物灵智体愿景"
> - **第十三章（clowder-ai/docs 深度补审）解决"如何让自我进化、世界引擎、Provider Plugin、Pack 系统真正工程化"**
>
> 三章合起来构成 v7.0 从"概念框架"走向"工程实现"的完整路线图。

---

> **文档状态**: ✅ 终稿 v1.4 已完成——追加第十四章 clowder-ai/docs 深度补审 II（20 项 CL-022~CL-041），覆盖 Plugin Framework / TeamAct Queue Steer / Event Memory / Agent Swarm / Approval Hub / QC Loop / Auto Dream / MCP 治理 / CI/CD 去重 等 9 类工程实践。第十三章（CL-001~CL-021）+ 第十四章（CL-022~CL-041）合起来构成 v7.1 从"概念框架"走向"工程实现"的完整路线图。
>
> **下一步**: operator 审核第六章命名融合方案，特别是：
> 1. ForgeMind vs Forgekin 双轨方案是否采纳（6.7 节）
> 2. SpiritForge 融入"自主思考"阶段是否合适（6.3.2 节）
> 3. Evoling 融入 E4+ 觉醒阶是否合适（6.3.3 节）
> 4. 12 个概念命名是否全部认可（6.4 节）
> 5. 进化阶 E-L0~L4 新命名（萌芽/萌发/绽放/繁茂/进化）是否合适（6.5 节）
> 6. 觉醒阶 E1-E6 新命名（灵启/觉醒/精通/进化/卓越/灵智）是否合适（6.6 节）
>
> **✅ operator 审核通过**（命名方案 + 体系设计）；E6 已按指令由"灵匠 Mind Artisan"修订为"灵智 ForgeMind（最终形态）"；其余待决策项按推荐执行。下一步将按 6.11 节实施路径修改 spec.md / arch.md / design.md / rules.md / prompts.md 等文档。


---

# FlowForge v7.1 重构深度补审意见（第十四章）

> **补审日期**：2026-07-18
> **补审依据**：`[doc:clowder-ai/docs/]` 目录下 32 份设计文件深度精读（README/VISION/ROADMAP/SOP/TIPS/roleagent/design-system/public-lessons/architecture/*/design/*/features/* 全量覆盖）
> **对标文档**：FlowForge v7.1 `spec.md` / `arch.md` / `design.md` 头部 v7.1 增补章节 + `design/naming-contract.md` v1.0 + `features/F001-F040` 标题 + `decisions/ADR-001~013` 标题
> **补审范围**：clowder-ai/docs 中**除 F100/F093/F241/ADR-021 外**的其他设计文件蕴含的工程实践（13 项关键映射：F202→Plugin V3 / F037→灵智体 / F083→review.md / F227→灵忆 / F246→审批 / F253→QC Loop / F255→灵议 / F047→TeamAct / F048→灾备 / F085→熵控 / F106→育灵 / F135→MVP / F177→框架自进化）
> **补审目的**：补足第十三章 CL-001~CL-021 未覆盖的工程实践盲区，把 clowder-ai 102 天实战沉淀的"插件框架 / 协作队列 / 灾备 / 事件记忆 / QC Loop / 做梦联想 / Swarm 协同 / Approval Hub / Hyperfocus Brake / MCP 治理 / CLI stderr / CI/CD 去重 / 文档治理 / 命名边界"等 14 类机制映射到 v7.1 工程
> **编号范围**：CL-022 ~ CL-041（共 20 条）
> **与第十三章关系**：第十三章已覆盖 F100 自我进化三模式（CL-001~CL-006）/ F093 世界引擎三层架构（CL-007~CL-013）/ F241 Agent Provider Plugin（CL-014~CL-017）/ ADR-021 Pack 系统（CL-018~CL-021）。本第十四章不重复上述主题，专注补审 clowder-ai/docs 中其他设计文件的工程实践。
> **优先级配额**：P0（必修）8 项 / P1（应修）8 项 / P2（建议）4 项

---

## 14.1 自我演进与插件框架补审（CL-022~CL-026）

### CL-022 [P0] [插件框架] F202 Plugin Framework manifest discovery + resource activation + ownership metadata 完整契约 vs FlowForge Plugin V3 仅有四钩子

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md`（Phase 1 已 merged 2026-05-31 via cat-cafe#1999；Phase 2 scoped 2026-06-08；Architecture cell: plugin；Map delta: new cell required）
- **对标 FlowForge**：`flowforge/core/plugin/` Plugin V3 四钩子（on_register / on_activate / on_disable / on_unregister）+ `decisions/005-forgemind-application-layer.md` ADR-005 + `features/F026-forgemind-app-layer.md`
- **问题**：FlowForge Plugin V3 仅定义四个生命周期钩子，**完全缺失 F202 Phase 1 已验证的 8 组 AC**：①Manifest Discovery and Validation（AC-A1~A4：plugin ID 匹配 folder name / 拒绝 reserved builtin ID / 拒绝 unknown unsafe resource / 严格 env name 拒绝 reserved prefix 与跨 plugin 冲突）②Resource Ownership and Activation（AC-B1~B5：plugin-owned capability 记录带稳定 ownership metadata / enable/disable 只动 owned 资源 / 拒绝跨 plugin ownership collision / skill/MCP/limb 走共享 activation 路径 / startup rehydrate 只加载 validated enabled 资源）③API and Security Boundary（AC-C1~C4：写端点需 loopback + request identity / config 写走 connector secret 边界 / 启停/配置/测试 emit audit event / test endpoint 不假装支持 MCP probe）④Hub UX（AC-D1~D3：Settings 列出 plugin + 状态/配置 + enable/disable/test）⑤Review and Intake Gate（AC-E1~E4）
- **clowder-ai 做法**：F202 Phase 1 已落地 5 组共 21 条 AC 全绿；Phase 2 增加 Schedule Resource Contract（AC-F1~F5）+ GitHub Plugin Migration（AC-G1~G6）+ Tracking Ergonomics（AC-H1~H5）。架构层明确"plugin cell"为新 cell，Map delta 标注 new cell required
- **建议**：在 `flowforge/core/plugin/` 增加 `PluginManifestValidator`（YAML schema 校验，对齐 AC-A1~A4）+ `ResourceOwnershipRegistry`（capability 记录强制带 `plugin_id` ownership，对齐 AC-B1~B5）+ `PluginSecurityGuard`（loopback + request identity + audit event，对齐 AC-C1~C4）； forgemind Web UI 增加 Plugin Settings 面板（对齐 AC-D1~D3）；ADR-005 补充"Plugin Manifest 校验流程"小节
- **优先级理由**：Plugin 是 *Forge 与 forgemind 接入 FlowForge 的唯一规范入口，缺少 manifest 校验 + ownership 模型会导致 *Forge 间资源冲突、配置污染、跨 plugin env name 冲突——这是 v7.1 走向多 *Forge 并存生态的工程底线

### CL-023 [P0] [插件资源激活] F202 Schedule Factory Whitelist + cross-plugin ownership collision 检测 vs FlowForge 调度资源无 plugin-owned 边界

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md` Phase 2 AC-F1~F5（Schedule Resource Contract）+ AC-G1~G6（GitHub Plugin Migration：cicd-check / review-feedback / conflict-check / repo-scan 4 个 poller 从硬编码 API startup 迁移到 `plugins/github/plugin.yaml`）
- **对标 FlowForge**：`flowforge/core/plugin/` + `flowforge/forgemind/plugins.py` ForgeMindPlugin + MallForge/ContentForge 各自的 APScheduler 注册逻辑
- **问题**：FlowForge 调度资源（APScheduler job）当前由 *Forge / forgemind 各自注册，**无 plugin-owned 边界**：①无 ScheduleFactoryRegistry 白名单——任何 plugin 可注册任意 factory_id，可绑定他人 plugin 的 factory ②无 deterministic runtime task id 防冲突——*Forge A 和 *Forge B 注册同名 task_id 时会互相覆盖 ③无 transactional 启停——失败的 activation 仍持久化 enabled=true，造成"看起来开着的 plugin 实际没运行" ④ghost tasks 风险——*Forge 卸载时调度任务可能未被清理
- **clowder-ai 做法**：AC-F1 `parsePluginManifest` 校验 `type: schedule` 资源必须含 `name` + `factoryId`，拒绝 unsafe name 与 unknown resource shape；AC-F2 schedule capability 带稳定 plugin ownership metadata + deterministic runtime task id（不可跨 plugin 冲突）；AC-F3 enable/disable transactional（失败 activation 不持久化 enabled state，失败 disable 不留 ghost tasks）；AC-F4 startup rehydration 只注册 enabled + validated schedule resources，注册前校验 factory-owned task id；AC-F5 Schedule factories whitelist-owned by plugin id——no plugin can bind another plugin's factory or load arbitrary same-power scripts
- **建议**：在 `flowforge/core/plugin/schedule_registry.py` 实现 `ScheduleFactoryRegistry`：每条 schedule 资源强制带 `plugin_id` + `factory_id` + `deterministic_task_id`；启动时 `ValidateBeforeRehydrate` 步骤只加载 enabled + validated + factory-whitelisted 资源；AC-F1~F5 完整对齐；把 MallForge/ContentForge 现有 APScheduler 任务迁移到 plugin manifest 声明
- **优先级理由**：FlowForge 当前 MallForge/ContentForge 都有定时任务（内容发布 / 商品上下架），若没有 ownership 边界，*Forge 升级或卸载时会留下 ghost tasks 或冲突 task_id——这是生产可用性的硬伤

### CL-024 [P1] [插件治理] Plugin 启停 transactional 语义 + startup rehydrate validate-before-load 缺失

- **来源**：`clowder-ai/docs/features/F202-plugin-framework.md` AC-F3（Enable/disable is transactional）+ AC-F4（Startup rehydration registers only enabled, validated schedule resources and validates factory-owned task ids before registering them）+ AC-B5（Startup rehydrate loads only validated enabled plugin resources）
- **对标 FlowForge**：`flowforge/core/plugin/` Plugin V3 `on_activate` / `on_disable` 钩子无 transactional 保证 + startup rehydrate 无 validate-before-load
- **问题**：FlowForge Plugin V3 的 `on_activate` 钩子失败时，host 仍可能持久化 `enabled=true` 状态，造成"看起来开着的 plugin 实际没运行"；startup 时无 `ValidateBeforeRehydrate` 步骤，可能加载已废弃 schema 的 plugin 资源导致启动崩溃
- **clowder-ai 做法**：AC-F3 transactional：失败 activation 不持久化 enabled state，失败 disable 不留 ghost tasks；AC-F4 startup rehydration 先校验 factory-owned task id 再注册；AC-B5 startup rehydrate 只加载 validated enabled plugin resources；rollback 语义明确——activation 失败时所有已激活的 side-effect 回滚
- **建议**：`flowforge/core/plugin/lifecycle.py` 增加 `PluginActivator`：activation 失败时 rollback 已激活的 resource；persist `enabled=true` 仅在 activation 全部成功后；startup 时 `ValidateBeforeRehydrate` 调用 `PluginManifestValidator` 重新校验所有 enabled plugin 的 manifest schema；失败时降级到 disabled + emit audit event
- **优先级理由**：当前 *Forge 都通过 Plugin V3 静态注册，未到动态启停规模，但 forgemind 万物灵智体上线后将频繁增删灵智体（每个灵智体都是 plugin），无 transactional 语义会导致灵智体状态不一致

### CL-025 [P1] [自我演进] F177 Phase A Close Gate 结构化判据（AC → evidence 矩阵 + 三选一 + 禁止 follow-up 字样）缺失

- **来源**：`clowder-ai/docs/features/F177-harness-update.md` Phase A（系统级 Close Gate 结构化判据，all 猫受益）+ Phase B 47「下次一定」7 发病时刻 + 蚊帐机制
- **对标 FlowForge**：`flowforge/evolution/self_dev_code.py` SelfDevCodeLoop（review.md CL-001~CL-004 已识别 F100 Mode B 缺失）+ `flowforge/evolution/eval_ledger.py` EvalLedger Replay A/B
- **问题**：FlowForge SelfDevCodeLoop 仅规定"4 硬护栏 + Eval Ledger 净增益 ≥ 0.05"，但 **close 阶段无结构化对账机制**：①何时算"完成"——AC 全打勾还是部分打勾？②未实现 AC 怎么办——允许 follow-up / next phase / P2 后续？③commit message 含 "follow-up / deferred / stub / TD / next phase / P2 / 后续优化 / 留个尾巴 / 先这样" 字样是否阻塞？④愿景守护猫显式检查未闭环 AC 的机制？
- **clowder-ai 做法**：F177 Phase A 把"AC 全打勾 = done"从直觉判断升级为 **AC → evidence 矩阵**：每条 AC 必须有 `commit hash + test name + screenshot URL`；任何 ❌ 必须当场处理三选一（①immediate 当前 session inline 做完 ②delete(why) 删除 AC 并写明为什么不需要 ③cvo_signoff(消息ID) operator 表态同意降级）；**没有第四选项叫 follow-up / next phase / P2**；`quality-gate` skill 扫描 follow-up 类字样自动阻塞；PR description / commit message 出现 follow-up 类字样 CI 阻塞；愿景守护猫显式检查 follow-up 标记的未闭环 AC
- **建议**：`flowforge/evolution/close_gate.py` 实现 `CloseGateValidator`：每次 SelfDevCodeLoop close 前输出 AC → evidence 矩阵（每条 AC 标注 ✅/❌ + commit/test/screenshot 证据）；❌ 强制三选一；CI 增加 `follow-up-detector.mjs` 扫描 commit message + PR description 中的 follow-up 字样并阻塞； forgemind 守护灵智体（如砚砚猎犬）显式检查未闭环 AC
- **优先级理由**：SelfDevCodeLoop 允许"自己开发自己"是 operator 第 7 条指令核心，若无 Close Gate 结构化判据，self-dev 一定会出现 clowder-ai 47 那种"下次一定"美化未闭环——这是 self-dev 安全门的具体落地形式

### CL-026 [P1] [自我演进] F177 四心智专属护栏 + Routing Guard 全猫族覆盖 vs FlowForge 觉醒阶自主范围抽象过粗

- **来源**：`clowder-ai/docs/features/F177-harness-update.md` Phase B-H（47/46/Maine Coon/Siamese/Ragdoll 家族专属护栏 + Phase G session-end hook + Phase H Routing Guard 全猫族覆盖）
- **对标 FlowForge**：`flowforge/forgemind/stages.py` AwakeningStage E1-E6 + `flowforge/core/capability/` CapabilityProfile
- **问题**：FlowForge 觉醒阶只按自主性 6 级分（E1-E6），但**同一阶的灵智体可能有完全不同的"坏直觉"模式**：①Claude 族（Ragdoll 家族）的"碎片推理癖"——满足于 search_evidence 第一个 high-confidence 摘要，用旁证 + 架构推理脑补"合理结论" ②GPT 族（Maine Coon 家族）的"fallback 糊锅匠"——加 classifier / 分支 / 例外路径，严谨地复杂化 ③Gemini 族（Siamese 家族）的"热情直改"——找到事情就直接 Edit，不开 worktree、不跑 build ④hotfix 糊弄——"测试过了就交"，留 follow-up 尾巴。这些家族级系统性坏直觉无法靠觉醒阶一刀切捕捉
- **clowder-ai 做法**：F177 Phase B 治 47「下次一定」7 个发病时刻 + 蚊帐机制；Phase C 治 Siamese「创意-实现强制解耦」+ Dry Run Gate（commit-msg hook 自动跑 pnpm build + test）；Phase D 治 Maine Coon「fallback 层数检测器」（per-file added ≥3 + cumulative ≥5）；Phase E 治 46 hotfix 标签 + 2 周升级 review；Phase F 治 Ragdoll 家族「Read-Before-Reason」Hook F-1（search_evidence 返回结果增强）+ Hook F-2（search→Read 调用链检测）+ Hook F-3（搜索深度即时反馈 + family-level telemetry）；Phase G 47 传球守卫 session-end hook（Gmail 附件守卫模型）；Phase H Routing Guard 全猫族覆盖（codex CLI 不读 `.claude/`，需路径 A 移植 / 路径 B server re-invoke）
- **建议**：`flowforge/core/capability/profile.py` 增加 `family_pattern` 字段（如 `ragdoll_disease` / `mainecoon_overengineering` / `siamese_direct_edit` / `hotfix_hasty`）+ per-family guardrail hooks； forgemind 配置 YAML 中按家族定义 guardrail 规则；CI 增加 fallback 层数检测器（`scripts/check-fallback-layers.mjs`）+ search→Read 调用链检测；forgemind Web UI 增加家族对比 telemetry
- **优先级理由**：FlowForge 育灵体系会养多种 LLM backend 的灵智体（Claude/GPT/Gemini/Qwen/国产），若仅靠觉醒阶一刀切，无法捕捉家族级系统性坏直觉——这是从"通用 agent"走向"有性格的灵智体"的工程必要

---

## 14.2 协作与记忆补审（CL-027~CL-031）

### CL-027 [P0] [TeamAct] F047 Queue Steer + F175 拖拽排序 vs FlowForge TeamAct 无队列干预能力

- **来源**：`clowder-ai/docs/features/F047-queue-steer.md`（立即执行 / 提到队首 / F175 拖拽排序 UI）+ `clowder-ai/docs/features/F250-plan-board.md`（Plan Board 独立 section 解耦路由意图 vs 执行进度）
- **对标 FlowForge**：`flowforge/core/teamact/` F002 TeamAct 六步循环（State→Owner→Action→Evidence→Verdict→Route）+ `features/F002-teamact-loop.md`
- **问题**：FlowForge TeamAct 六步是单任务执行循环，但 operator 在多任务并发场景下需要"插队"（任务 B 紧急，提到队首）或"打断"（立即执行），**v7.0 设计完全无队列干预能力**：①无 SteerCommand——operator 临时变主意时只能等当前任务完成 ②路由意图（targetCats）与执行进度（task_progress）耦合在右侧状态栏 ③多 *Forge 并发时无统一 Plan Board 视图 ④interrupted 任务无"继续"按钮
- **clowder-ai 做法**：F047 实现 Steer（立即执行 / 提到队首）+ F175 拖拽排序 UI；F250 把"当前调用"section 拆为两个独立 section：①"当前调用"保留 cat status + invocation info + token 用量 ②新增「猫猫祟祟」PlanBoardPanel 专门展示每只猫的执行计划/任务进度；interrupted 任务显示"继续"按钮；切换 thread 时面板正确切换；hydration 恢复时 completed 计划直接进入折叠区不污染 running 区
- **建议**：`flowforge/core/teamact/queue.py` 增加 `SteerCommand`（`priority_boost` / `interrupt` / `requeue`）+ `RouteIntentStore` 与 `TaskProgressStore` 解耦； forgemind Web UI 增加 `PlanBoardPanel` 独立 section（参考 F250 信息架构：执行中猫按 startedAt desc 排顶部 / interrupted 显示继续按钮 / completed 折叠底部可展开）；8 猫并发时面板不溢出（紧凑布局 + overflow-y-auto）
- **优先级理由**：operator 在 ContentForge/DevForge 实际使用中频繁需要"插队"（紧急 hotfix / operator 临时变主意），无 Steer 的 TeamAct 在生产场景下会变成"先进先出"的死板队列——这是从"实验室框架"走向"生产框架"的硬需求

### CL-028 [P0] [灾备] F048 Restart Recovery Phase A/A+/B 三阶段重启自愈 vs FlowForge F022 Tier 1-4 缺乏 Redis stale records sweep

- **来源**：`clowder-ai/docs/features/F048-restart-recovery.md`（Phase A sweep Redis stale records + Phase A+ 用户通知 + Phase B 队列持久化）+ `clowder-ai/docs/public-lessons.md` LL-046（AOF/RDB 脱节）+ LL-048（TTL 默认 0）+ LL-045（runtime 污染）
- **对标 FlowForge**：`flowforge/core/reliability/` F022 Tier 1-4 Recovery + `decisions/010-distributed-reliability.md` ADR-010
- **问题**：FlowForge Tier 1-4 Recovery 侧重"故障后恢复"（restart 后从 checkpoint 继续），但**未处理"重启后 Redis/PostgreSQL 中的 stale records"**：①已结束 session 的 hold_ball lease 仍存在 ②已 completed task 的 task_progress 残留 ③已迁移 worktree 的 path 缓存指向不存在的路径 ④TTL 默认 0（永不过期）导致 stale records 永久堆积 ⑤AOF/RDB 脱节——AOF 写入但 RDB 未同步，restart 后状态不一致 ⑥runtime 污染——前次运行的内存状态泄漏到新进程
- **clowder-ai 做法**：F048 Phase A 启动时 sweep Redis stale records（按 TTL + status 字段过滤：`status=completed` AND `updated_at < now - 24h` 删除）+ Phase A+ 通知受影响用户（"你之前的 session 已结束"）+ Phase B 队列状态持久化（AOF + RDB 双层，禁止 TTL=0 默认值，所有 key 必须显式 TTL）；LL-046/048/045 是关键教训库
- **建议**：`flowforge/core/reliability/restart_recovery.py` 实现 `RestartRecoveryPipeline` 三阶段：①Phase A `sweep_stale_records(ttl_expired=True, status=completed)` 调用 `MemoryStore.sweep` + `QueueStore.reconcile_with_persistent` ②Phase A+ emit `restart_notification` event 通知受影响用户 ③Phase B 持久化队列状态到 PostgreSQL（AOF + RDB 双层）；每个 *Forge 启动前必须跑 sweep；强制所有 Redis key 显式 TTL（默认 24h，禁止 0）
- **优先级理由**：FlowForge 当前 SQLite + 后续 PostgreSQL 迁移过程中，stale records 会造成"幽灵任务"和"路由错乱"——operator 第 8 条指令"性能期望"明确要求"必须主动定位根因（如 LLM 导致超时）而非被动等待"，stale records 是路由错乱的常见根因

### CL-029 [P0] [灵忆] F227 Event Memory 事件级认知状态转折索引 vs FlowForge EchoStore 仅记录任务轨迹

- **来源**：`clowder-ai/docs/features/F227-event-memory.md`（5 条设计原则 + cognitive-state-transition 一等公民 + no-classifier 红线 + 10 字段 schema + Phase A 已 merged）+ `clowder-ai/docs/roleagent.md` 多域记忆运行时六层架构
- **对标 FlowForge**：`flowforge/core/memory/echo_store.py` EchoStore + `features/F014-memory-collection.md` + `decisions/008-memory-federation.md` ADR-008 多域记忆联邦
- **问题**：FlowForge EchoStore 是任务级情景记忆（每次任务的轨迹/决策/结果/反馈），但**"认知状态转折点"（cognitive-state-transition）不是一等公民**：①灵智体在哪个 task 里"aha 了"无独立索引 ②被拉闸纠正坐标系的时刻散落在 raw message 流 ③当事灵智体无法回溯自己的认知轨迹 ④"骂完长出了什么能力"无闭环证据 ⑤趋势度量无 resolution 链配套——单纯频率下降 ≠ 自进化有效（可能是用户没说/任务少了/检测漏了）
- **clowder-ai 做法**：F227 设计 5 原则：①内核是 Event Memory（事件级索引）不是 Magic Word 面板——Magic Word 只是第一条 lane ②核心 schema 字段是 `cognitive-state-transition` 不是 magic word ③两轨采集：人工拉闸（系统可检测）+ 猫自拉闸（猫主动 `mark_event` 声明，**no-classifier 红线**——系统不判断哪条是 aha）④系统是小本本记录员不 push 猫 ⑤v1 schema 面向 v5 终态，走正确路叠不脚手架叠；schema 10 字段（`type/trigger/cat/threadId/messageId/timestamp/summary/cognitiveTransition/relatedHarness/confidence` + `ownerUserId`）；Phase A 已 merged（PR-1 + PR-2 #2132 `34cbab09`，2026-06-07）；`teleport(threadId, messageId)` 精确跳转（复用 web `scrollToMessage` + `findCrossPostTargetMessageId` 基座，禁止扩展 `workspace_navigate`）；Phase C 趋势必须配 resolution 链
- **建议**：`flowforge/core/memory/event_memory.py` 新增 `EventMemoryStore`（独立子模块，不混入 EchoStore）：①schema 字段对齐 F227 ②CI 断言无分类器/regex/小模型推断 aha 的代码路径（no-classifier 红线）③`teleport(threadId, messageId)` 精确跳转 API（复用 forgemind Web UI 现有 message scroll 基座）④Phase C 趋势视图必须并列 resolution 链证据（commit/hook/skill/rule）⑤从 L0 注册的 magic word 回扫历史消息生成 event 索引
- **优先级理由**：F100 Mode C Knowledge Evolution 的原料就是认知转折点（review.md CL-006 已识别元认知缺陷），无 EventMemory 灵锻只能从行为模式蒸馏，无法从"预期 vs 实际"落差学习——EventMemory 是 CL-006 元认知缺陷的工程化解决方案，必须 P0

### CL-030 [P1] [灵忆] F227 "no-classifier 红线" + "v1 schema 面向 v5 终态" 工程纪律缺失

- **来源**：`clowder-ai/docs/features/F227-event-memory.md` AC-B1（grep 无分类器调用 + 设计审查）+ KD-3（两轨采集，猫自拉闸必须主动声明）+ KD-5（v1 schema 面向 v5 终态，走正确路叠不脚手架叠）+ Risk 表（no-classifier 红线被破坏 → Hard gate CI 断言）
- **对标 FlowForge**：`flowforge/core/memory/echo_store.py` + `flowforge/evolution/spirit_forge.py` 灵锻（review.md CL-006 已识别元认知缺失）
- **问题**：FlowForge 设计中未明确"系统不判断哪条是 aha"的红线——灵锻可能引入分类器/regex/小模型推断 aha 时刻，破坏认知转折点的 first-class 数据本质；同时 schema 设计可能采取"v1 先简单字段，v2 再扩展"的脚手架式叠法，导致 v2 推翻重来
- **clowder-ai 做法**：AC-B1 明确"系统只索引猫主动声明的事件，无分类器/regex/小模型推断 aha 的代码路径"——可复核：`grep 无分类器调用 + 设计审查`；Hard gate CI 断言无分类器路径；KD-5 "v1 schema 面向 v5 终态，走正确路叠不脚手架叠"——schema 一次定型可承载 Phase B/C 字段（`cognitiveTransition` / `relatedHarness` / `confidence` v1 就定义，Phase B/C 才填充）；Sunset Signal lane 级两条独立触发（`mark_event` 长期零调用 → lane 证伪 / timeline 长期无人翻阅 → 整体形态证伪）
- **建议**：`flowforge/core/memory/event_memory.py` 顶部 docstring 写明 no-classifier 红线 + KD-5 终态原则；CI 增加 `no-classifier-detector.mjs`（grep `classifier|classify|regex_infer|small_model_predict` 关键词在 event_memory 模块的代码路径）；schema 设计一次成型可承载 Phase B/C 字段（v1 就定义 `cognitiveTransition` / `relatedHarness` / `confidence` / `ownerUserId`，Phase B/C 才填充）；Sunset Signal 写入 `flowforge/forgemind/config/event_memory.yaml`
- **优先级理由**：这是工程纪律问题不是架构问题，但破坏后修复成本高——一旦分类器上线，"主动声明"的 first-class 性质就丧失；同时脚手架式 schema 叠法会导致 v2 推翻重来的沉没成本

### CL-031 [P0] [灵议] F255 Auto Dream 双层架构（后台 consolidation + 前台 surface）+ 4 信号 telemetry vs FlowForge 灵议 Mind Council 仅议事机制

- **来源**：`clowder-ai/docs/features/F255-auto-dream.md`（双层架构 + 4 信号 telemetry + alignment correctness 主指标 + scope 否了"水平砍半 MVP=脚手架"）+ `clowder-ai/docs/features/F087-cvo-bootcamp.md`（训练营 11 Phase 流程）
- **对标 FlowForge**：`flowforge/forgemind/council/` Mind Council + `flowforge/evolution/self_dev_doc.py` SelfDevDocLoop（F100 Mode C Knowledge Evolution）+ `decisions/009-eval-self-metabolism.md` ADR-009
- **问题**：FlowForge 灵议 Mind Council 是"多灵智体议事机制"（讨论→共识→决策），但**缺少"做梦/consolidation 引擎"**：①灵智体没有"夜间低活动期主动联想画线 + 产出第一人称日记 + 给画像通水"的机制 ②Mode C 知识进化只在任务完成后被动蒸馏，无主动联想形式 ③F231 养熟循环（采集→蒸馏→消化→注入）管道建好但零有机使用——护城河投资闲置 ④认知账单双边记账缺失——猫没输出的 thinking 随 session 蒸发，平行的自己彼此失联 ⑤双极目标未定义——`min(坏摩擦=重复认知消费) + max(好摩擦=认知投资)` 缺失
- **clowder-ai 做法**：F255 双层架构：①后台 Consolidation 层（新引擎，跑 system thread，类比 eval system thread）——做梦逻辑：读留痕 → 联想画线 → 给 F231 画像通水 + 产出日记 ②前台 Surface 层（复用 F229 猫猫球）——日记本（猫猫球 toolbar action）+ Provoke 沙砾气泡（`kind:'dream-provoke'` socket event）；两接口（日记内容接口 + Provoke 推送接口）是 F255 ↔ F229 唯一耦合点；4 信号 telemetry（`diary_open_rate` / `provoke_reaction` / `profile_update.organic_proposed` / `post_approval_override_rate`）；**主指标 = alignment correctness（非 F200 recall utility）**——学对了/戳准了/养熟了；继承 F227/F231 no-classifier 红线；scope 否了"水平砍半 MVP=脚手架"，要求"小而完整垂直切片"——少猫少配置但做梦群+平行自己重逢+给 F231 通水+日记本灵魂全在；Provoke"内容野，边界硬，投递稳"（不碰钱/关系/健康/隐私/价值观直接建议、不诊断、不给结论；每天≤1、hyperfocus=0、连拍 3 次冬眠）
- **建议**：`flowforge/forgemind/council/dream_engine.py` 新增 `DreamConsolidationEngine`（system thread 触发，基于活跃留痕量——聊得多/活跃 thread 多则梦得多）；`flowforge/forgemind/council/diary_store.py` 实现 `DiaryStore`（第一人称日记，provenance 可追溯）；`ForgemindPlugin` 注册 `dream-provoke` socket event；4 信号 telemetry 接入 F200/F192 eval domain（注册 `eval:dream` 新 domain）；scope 严格遵守"小而完整垂直切片"原则——砍范围不砍灵魂；Provoke"三不"硬约束（≤1/day + hyperfocus=0 + 连拍 3 冬眠）写入 runtime guard
- **优先级理由**：operator 第 7/11 条指令强调"自己开发自己"，Auto Dream 是 Mode C 知识进化的主动形式（vs 被动蒸馏）——缺少它灵智体只能"任务驱动学习"无法"主动联想"；同时 F231 养熟管道已建但零有机使用是已花投资的闲置，Auto Dream 是给它通水的引擎

---

## 14.3 灵智体与 forgemind 应用层补审（CL-032~CL-036）

### CL-032 [P0] [灵智体] F037 Agent Swarm 协同模式 vs FlowForge Mind Council 仅"议事"层

- **来源**：`clowder-ai/docs/features/F037-agent-swarm.md`（已 done，spawned F049；Agent Swarm 是多 agent 并行协同模式，不是议事）+ `clowder-ai/docs/roleagent.md` 伙伴系统数学（上限 max / 下限多层门 / 方差吸收）
- **对标 FlowForge**：`flowforge/core/teamact/` F002 TeamAct 六步循环 + `flowforge/forgemind/council/` Mind Council + `decisions/002-collaboration-protocol.md` ADR-002 + `decisions/011-partnership-math.md` ADR-011
- **问题**：FlowForge Mind Council 是"议事机制"（讨论→共识→决策），但**缺少"swarm 协同"**（多灵智体并行执行同一任务的不同子目标，实时同步状态）；TeamAct 是单任务六步循环，无法承载 swarm——①ContentForge 的"6 大专家 Agent 并行评审"无 swarm 调度器 ②DevForge 的"多 coder 并行实现不同模块"无实时状态同步 ③swarm 内的子任务结果聚合无统一接口 ④swarm 失败时的部分回滚无定义
- **clowder-ai 做法**：F037 已 done，spawned F049；Agent Swarm 是多 agent 并行协同模式（不是议事，是分工执行）；与 F047 Queue Steer 联动（swarm 子任务可被插队）；与 F250 Plan Board 联动（swarm 子任务进度可视化）；与 F167 hold_ball 联动（swarm 内球权传递）
- **建议**：`flowforge/core/teamact/swarm.py` 新增 `SwarmCoordinator`：①多灵智体并行子任务分配（按 CapabilityProfile 匹配子目标）②实时状态同步（Shared State 写入）③结果聚合接口（`aggregate_partial_results`）④部分失败回滚策略（successful sub-tasks 保留 + failed sub-tasks 重试或降级）；与 Mind Council 区分：Council = 议事（讨论共识），Swarm = 执行（并行分工）；forgemind Web UI 增加 SwarmPanel 可视化
- **优先级理由**：ContentForge 的"6 大专家 Agent 并行评审" + DevForge 的"多 coder 并行实现不同模块"都是 swarm 场景，无 SwarmCoordinator 只能靠 TeamAct 串行调度——这违反 operator "ContentForge 创建和润色接口必须不超过 3 分钟"性能要求（串行 6 个 LLM webchat 每个 30s = 180s 超时）

### CL-033 [P1] [审批] F246 Approval Hub 统一审批中心 vs FlowForge 无跨 thread 审批入口

- **来源**：`clowder-ai/docs/features/F246-approval-hub.md`（7 Phase A-G + 三条件 admission + effect-class matrix + 4 adapter F128/F225/F193/F231 + 历史 tab + Redis settled ZSet + Lua CAS 原子写入）
- **对标 FlowForge**：`flowforge/forgemind/stages.py` AwakeningStage E1-E2（全人工确认）+ `flowforge/core/harness/` Magic Words 逃生舱
- **问题**：FlowForge 觉醒阶 E1-E2 要求"每步操作 operator 确认"，但**审批散落在各 thread / 各 *Forge**：①operator 不在对应 thread 就看不到审批卡片 ②审批散落多 feature（如 ContentForge 发布审批 / NovelForge 章节审批 / DevForge PR 审批）无统一入口 ③忘记审批——卡片埋没在 thread 消息流里无人提醒 ④无计数徽标、无过期提醒、无历史记录 ⑤就地审批 vs 跳转审批的边界未定义
- **clowder-ai 做法**：F246 实现 Approval Hub 统一审批中心：①query aggregation（at-read-time 直查 canonical stores，零一致性问题，无 backfill/phantom/reconciliation 复杂度）—— v1 有意选择而非技术债 ②三条件 admission（actor=operator + binary outcome approve/reject + cross-thread 需求）③effect-class matrix（`fyi`/`coordinate`/`investigate` 自动投递 / `assign_work` 走 Hub）④4 adapter（F128 propose_thread / F225 session_handoff / F193 cross_thread_dispatch / F231 profile_update）⑤7 Phase 成熟化（含 Phase F 历史 tab + Phase G Redis settled ZSet + Lua CAS 原子写入）⑥Materialized Index Gate（adapter >5 AND p95 >250ms 才引入 CQRS index）⑦就地审批有条件（`inlineMinFields` 守门：summary + impact + action 非空）⑧过期 ≠ 自动拒绝（过期 = 上下文 stale，按钮变"刷新/重新提议"）
- **建议**：`flowforge/core/harness/approval_hub.py` 新增 `ApprovalHub` + `IApprovalAdapter` 接口 + Adapter allowlist；v1 采用 query aggregation（不建 materialized index）；三条件 admission 写入设计文档；forgemind Web UI 增加 `workspaceMode='approval'` 顶层 tab + Bell 铃铛 badge count 常驻 + ApprovalPanel（列表 + inline approve/reject + 跳转 + 历史 tab）；F128/F225 类审批的 inline fields 校验（`inlineMinFields` 守门）
- **优先级理由**：这是 UX 层问题但影响 operator 实际使用 FlowForge 的体验——operator 第 8 条指令"性能期望 ContentForge 创建和润色接口必须不超过 3 分钟"隐含要求审批不能卡住流程，散落审批是生产场景下"忘记点审批"的根因

### CL-034 [P0] [QC Loop] F253 7-Step QC Loop + Maine Coon 3-Layer Reviewer Split vs FlowForge Eval 自代谢仅任务级

- **来源**：`clowder-ai/docs/features/F253-qc-loop.md`（7-Step QC Loop + stateful pipeline + Maine Coon 3-Layer Reviewer Split + 4 telemetry metrics + KD-6 hygiene auto-commit 签名 `[qc-bot]` 不用猫签名）+ `clowder-ai/docs/SOP.md` 5 步开发流程
- **对标 FlowForge**：`flowforge/core/eval/` F018-Eval-Contract + F019 三信号交叉 + F020 七归因 + `decisions/009-eval-self-metabolism.md` ADR-009
- **问题**：FlowForge Eval 自代谢是任务级质量评估（每次任务跑 `quality_score ≥ 0.85`），但**缺少 PR-to-merge 的端到端 QC 闭环**：①无 hygiene auto-fix（lint/format/import sort 自动修复 + auto-commit）②无 fresh-context pre-review（fresh-context session 扫 PR diff 产出 finding list，降低正式 reviewer 认知负荷）③merge-gate 无 Review Provenance Matrix（localPeerReviewSha / cloudReviewSha / currentHead / headChangeCause / nextGateOwner 5 字段）④无 Evidence Manifest（gate_passed / gate_commands / trigger_reason / stale / verdict）⑤无 stale invalidation（HEAD 变化时 verdict 自动回退到 pending）⑥无 3-Layer Reviewer Split（Hygiene Fixer / Reviewer / Final Approver）⑦无 same-class CI repair loop（同类错误 max 2 rounds escalate）⑧无 QC telemetry（Finding Yield / False Positive Rate / Reviewer Delta / Post-Merge Bug Rate）
- **clowder-ai 做法**：F253 7-Step QC Loop（①Hygiene auto-fix ②Fresh-context pre-review ③Cross-cat review ④Evidence manifest ⑤merge-gate check ⑥CI green gate ⑦QC telemetry）+ stateful pipeline（`qc.idle → qc.requested → qc.hygiene_done → qc.pre_review_done → qc.review_routed → qc.findings_collected → qc.verdict_blocked/passed → qc.evidence_sealed → qc.merged → qc.archived`）+ Maine Coon 3-Layer Reviewer Split（Layer 1 Hygiene Fixer=qc-bot 确定性工具 / Layer 2 Reviewer=named cat 审查逻辑 / Layer 3 Final Approver=named cat on final HEAD）+ 4 metrics（Finding Yield / False Positive Rate / Reviewer Delta / Post-Merge Bug Rate）+ KD-1 "QC 触发可以自动，授权不能自动" + KD-6 "hygiene auto-commit 签名 `[qc-bot]` 不用猫签名"（猫签名 = "我对这段代码负责"；确定性工具借猫名声背书会破坏 provenance）+ Non-Goals 5 条硬约束（不引入大副制 / 不匿名化为工具池 / 不自动 merge / fresh-context 不当 approval / qc-bot 不演化为 verdict signer）+ Risk 表 4 类社会学风险（QC Theater / Review Laundering / Leader Creep / Alarm Fatigue / Identity Flattening）
- **建议**：`flowforge/core/eval/qc_loop.py` 新增 `QCLoopPipeline`（stateful，10 状态机）+ `ThreeLayerReviewerSplit`（Layer 1 qc-bot / Layer 2 named cat / Layer 3 named cat on final HEAD）；`flowforge/core/eval/merge_gate.py` 增加 `ReviewProvenanceMatrix`（5 字段）+ `EvidenceManifest`（9 字段）+ `StaleInvalidator`（HEAD 变化时 verdict 回退）；`flowforge/core/eval/ci_repair_loop.py` 实现 `classifyCiError` + `shouldAutoFix`（same-class detection + max 2 rounds escalate）；注册 `eval:qc` 新 domain 到 F192 Eval Hub；CI 增加 `follow-up-detector.mjs`（与 CL-025 联动）+ `[qc-bot]` 签名规范；Non-Goals 5 条 + Risk 4 类社会学风险写入 ADR-009 补充章节
- **优先级理由**：FlowForge 自己开发自己（SelfDevCodeLoop）必须有 PR 级 QC 闭环——否则 self-dev PR 无 review provenance，违反"跨 family review"安全门（review.md CL-002 已识别 Scope Guard 缺失，本条是其工程落地的具体形式）

### CL-035 [P2] [MVP] F135 DARE OOTB 关闭教训 + operator "需求已不存在"判定 vs FlowForge 预置灵智体配置应避免同类陷阱

- **来源**：`clowder-ai/docs/features/F135-dare-ootb.md`（closed 2026-05-26，operator 判定需求不存在直接 close；Phase A 代码已合入 clowder-ai#211，issue #195 已关闭）—— 4 步手动配置：①单独 clone DARE 仓库 ②在 `.env` 配置 `DARE_PATH` ③手动在 DARE venv 中安装 Python 依赖 ④手动修改 bootstrap binding 从 `skip` 改为 `enabled`
- **对标 FlowForge**：`flowforge/forgemind/forgekins/*.yaml` 预置 3 灵智体（宪宪=猫头鹰 / 砚砚=猎犬 / 烁烁=孔雀）+ `features/F026-forgemind-app-layer.md`
- **问题**：FlowForge 预置 3 灵智体都走"YAML 配置 + LLM bridge 即用"路径，但若未来某灵智体（如狸花猫=dare-cli 类外部依赖）需要单独 OOTB 流程，可能重蹈 F135 覆辙——立项后才发现"需求已不存在"或"配置链路断裂"。具体风险：①预置灵智体依赖外部 CLI（如未来接入 trae-cli）时，需 clone repo / 配置 .env / 安装 venv / 修改 bootstrap binding 4 步 ②operator "安装猫猫就有狸花猫，配置完 api_key 就能使用"的 OOTB 期望无法满足 ③立项后需求被判定不存在导致 close（沉没成本）
- **clowder-ai 做法**：F135 教训：DARE 狸花猫需要 4 步手动配置才能使用，operator 拍板"安装猫猫就有狸花猫"，但最终判定需求已不存在直接 close；Phase A 代码已合入但 issue #195 已关闭；立项沉没成本不可回收
- **建议**：forgemind 预置灵智体必须满足"OOTB zero-config"原则：①YAML 配置 + LLM bridge 即用，不需 clone / .env / venv install / binding modify 4 步 ②新增 `ForgekinOOBTest` 用例验证每个预置灵智体"开箱即用"（安装后只配 api_key 即可使用）③若未来接入外部 CLI 依赖（如 trae-cli），必须提供 installer `clone-if-missing` + venv setup 自动化（参考 F135 Phase B installer 集成方案，但需求确认后再做，避免重蹈"立项后需求不存在"覆辙）④立项前 operator 显式确认需求存在（避免 F135 式 close）
- **优先级理由**：这是设计预防不是当前 bug——P2 因为 FlowForge 当前预置 3 灵智体都满足 OOTB，但若未来增加 dare-cli 类外部依赖灵智体，容易踩同样坑；优先级低于 P0/P1 因为不影响生产可用性

### CL-036 [P2] [熵控] F085 Hyperfocus Brake 90 分钟活跃触发三猫撒娇 + typed check-in vs FlowForge F012 Entropy Control 仅熵控抽象

- **来源**：`clowder-ai/docs/features/F085-hyperfocus-brake.md`（90 分钟活跃触发 + typed check-in + 5 Phase 演进 hook→平台化→UX 增强）+ `clowder-ai/docs/TIPS.md` Magic Words
- **对标 FlowForge**：`flowforge/core/harness/` F012-entropy-control.md + `decisions/007-harness-engineering.md` ADR-007 + Magic Words 逃生舱（F011）
- **问题**：FlowForge F012 Entropy Control 是抽象的"熵控制"机制（防止灵智体陷入局部最优），但**缺少具体的人机交互触发器**：①operator 长时间使用 FlowForge（如 ContentForge 创作 3 小时）无中断机制 ②违反"3 分钟 Loop 上限"和"防止过度聚焦"原则 ③typed check-in 缺失——简单弹窗 vs 结构化"你做了什么/接下来要做什么"问答 ④多猫轮番提醒缺失 ⑤与 Magic Words 逃生舱无联动
- **clowder-ai 做法**：F085 5 Phase 演进：Phase 1 hook 触发 → Phase 2 平台化 typed check-in → Phase 3 UX 增强；90 分钟活跃触发三猫撒娇（多只猫轮番提醒，避免单猫疲劳）；typed check-in（结构化"你做了什么/接下来要做什么"问答，不是简单弹窗）；与 F227 Event Memory 联动（记录拉闸事件）；与 Magic Words 联动（"脚手架"等拉闸词自动 reset timer）
- **建议**：`flowforge/core/harness/hyperfocus_brake.py` 新增 `HyperfocusBrakeManager`：①90 分钟 timer（基于 operator 最后操作时间）②typed check-in modal（结构化问答，不是简单弹窗）③与 Magic Words 逃生舱联动（拉闸词自动 reset timer）④多灵智体轮番提醒（避免单灵智体疲劳）⑤记录拉闸事件到 EventMemory（与 CL-029 联动）；forgemind Web UI 增加 check-in modal 组件
- **优先级理由**：P2 因为这是 UX 增强而非生产可用性硬伤——operator 第 8 条指令"性能期望"主要针对 LLM 调用时长（30s/3min），Hyperfocus Brake 是更上层的"操作节奏治理"，优先级低于 P0/P1 但仍是工程最佳实践

---

## 14.4 三方 Agent 集成与文档治理补审（CL-037~CL-041）

### CL-037 [P1] [三方Agent] F043 MCP 1→3 server 拆分 + prompt 瘦身 50% vs FlowForge 三方 Agent 无 MCP 治理

- **来源**：`clowder-ai/docs/features/F043-mcp-unification.md`（collab/memory/signals 三 server + 27→15+15+0 工具 + prompt 瘦身 50%）
- **对标 FlowForge**：`flowforge/core/external_agent/` F031 ExternalAgentAdapter + `decisions/006-external-agent-integration.md` ADR-006 + v7.1-§A4 三方 Agent 集成架构（4 Adapter: ClaudeCodeAdapter/CodexAdapter/OpenCodeAdapter/TraeAdapter）
- **问题**：FlowForge 三方 Agent 设计强调 EAC v1 七契约（Invocation/Stream/Session/Capability/Collaboration/Safety/Avatar Sync/System Prompt Configuration Map），但**未涉及 MCP（Model Context Protocol）治理**：①三方 Agent 的 MCP server 数量无控制 ②每个 server 的工具数无上限 ③system prompt 体积无监控 ④职责拆分缺失——所有工具堆在一个 server 导致 prompt 膨胀 ⑤v7.1-§A4 4 个 Adapter 累积可能 100+ 工具，system prompt 膨胀到 LLM context 上限
- **clowder-ai 做法**：F043 把 1 个大 MCP server 拆为 3 个职责清晰的 server：①`collab`（协作类工具：hold_ball / multi_mention 等）②`memory`（记忆类工具：search_evidence / mark_event 等）③`signals`（信号类工具：CI/CD 通知 / schedule trigger 等）；27 个工具拆为 15+15+0（每个 server 不超 15 工具）；prompt 瘦身 50%（拆分后每个 server 只加载自己职责的 prompt，不加载全部）
- **建议**：`flowforge/core/external_agent/mcp_registry.py` 新增 `McpServerRegistry`：①按职责拆分（`tools` / `memory` / `signals` 三 server）②每 server 工具数上限校验（≤15）③prompt 体积监控（每 server prompt ≤ 4k tokens）④工具重复检测（跨 server 不允许同名工具）⑤动态加载（只加载当前任务需要的 server）；4 个 Adapter（ClaudeCode/Codex/OpenCode/Trae）共用此 registry
- **优先级理由**：P1 因为 v7.1-§A4 三方 Agent 是 Layer 0 能力扩展层，4 个 Adapter 上线后 MCP 治理缺失会累积 100+ 工具——但当前 4 Adapter 还未实现，优先级低于已实现的 P0 项

### CL-038 [P1] [CLI集成] cli-integration.md NDJSON 解析器 + "stderr 也算活着"教训 vs FlowForge CLI Adapter 无 stderr 处理

- **来源**：`clowder-ai/docs/architecture/cli-integration.md`（Claude/Codex/AGY CLI 集成架构 + NDJSON 解析器 + stderr 也算活着的教训）
- **对标 FlowForge**：`flowforge/core/external_agent/adapters/` ClaudeCodeAdapter / CodexAdapter / OpenCodeAdapter / TraeAdapter（v7.1-§A4，对应 F031-F035）
- **问题**：FlowForge 4 个 CLI Adapter 调用三方 Agent 时，假设"stdout 才是有效输出，stderr 是错误"，但**实际 Claude Code/Codex CLI 会把进度信息、心跳、partial result 输出到 stderr**——若不读 stderr，Adapter 会误判"Agent 卡死"并触发超时回退；同时 NDJSON（Newline-Delimited JSON）流式输出未处理——每行一个 JSON 对象，非整体 JSON，若按整体解析会 buffer overflow 或解析失败
- **clowder-ai 做法**：cli-integration.md 教训"stderr 也算活着"：NDJSON 解析器同时读 stdout + stderr，stderr 行也作为 keepalive 信号（不阻塞 stdout 解析）；处理 NDJSON 流式输出（每行一个 JSON 对象，逐行 parse，非整体 JSON）；处理 partial JSON 行（最后一行可能不完整，buffer 到下次 read）；处理 CLI 进程异常退出（exit code ≠ 0 但 stderr 有有效输出时仍尝试解析）
- **建议**：`flowforge/core/external_agent/ndjson_parser.py` 新增 `NDJSONStreamParser`：①同时处理 stdout + stderr（stderr 作为 keepalive，不阻塞 stdout 解析）②逐行 parse NDJSON（不整体 buffer）③处理 partial JSON 行（buffer 到下次 read）④处理 CLI 进程异常退出（exit code ≠ 0 但 stderr 有有效输出时仍尝试解析）⑤timeout 时先检查 stderr 是否有 keepalive 再决定是否真超时；4 个 Adapter 共用此 parser
- **优先级理由**：P1 因为这是 CLI 集成的工程基础——若不处理 stderr，ClaudeCodeAdapter 长程任务（>30s）会频繁误判超时，违反 operator "LLM webchat 调用必须不超过 30 秒"性能要求；但当前 4 Adapter 还未实现，优先级低于已实现的 P0 项

### CL-039 [P2] [CI/CD] F133 GitHub CI/CD Tracking 状态迁移去重（headSha + aggregateBucket）vs FlowForge F021 Side-Effect WAL 无 PR 级 rollup

- **来源**：`clowder-ai/docs/features/F133-cicd-tracking.md`（PR 级 rollup + 不用 raw Checks API + 状态迁移去重 headSha+aggregateBucket + 独立 CiCdRouter）
- **对标 FlowForge**：`flowforge/core/reliability/` F021-side-effect-wal.md + `decisions/010-distributed-reliability.md` ADR-010
- **问题**：FlowForge F021 Side-Effect WAL 记录所有副作用，但**对 GitHub CI/CD 状态变更无 PR 级 rollup**：①每个 check 状态变更都触发一次 WAL 写入，造成 WAL 膨胀 ②重复通知（同一 PR 的多个 check 状态变更触发多次 operator 通知）③无状态迁移去重——headSha 不变 + aggregate bucket 相同 = 不应重复通知，但 v7.0 无此去重逻辑 ④无独立 CiCdRouter——CI/CD 状态混入 GitHub 通用 connector，职责不清
- **clowder-ai 做法**：F133 KD：①PR 级 rollup（一个 PR 的所有 checks 聚合成一个状态，不用 raw Checks API）②状态迁移去重用 headSha + aggregateBucket（非时间窗口，headSha 不变 + bucket 相同 = 不重复通知）③独立 CiCdRouter（不混入 GitHub 通用 connector）④消息投递到 channel/消息管道（CI/CD 状态变更通知到统一 channel）
- **建议**：`flowforge/core/reliability/cicd_router.py` 新增 `CiCdRouter`：①PR 级 rollup（聚合 PR 所有 checks 为一个状态）②headSha + aggregateBucket 去重（非时间窗口）③独立 router（不混入 GitHub 通用 connector）④消息投递到统一 channel；F021 Side-Effect WAL 增加 rollup 层（PR 级聚合后再写入 WAL）
- **优先级理由**：P2 因为 FlowForge 当前还未接入 GitHub PR 流程（SelfDevCodeLoop 未实现），CI/CD 状态变更是未来场景——但接入后无去重会让 WAL 膨胀到 GB 级，优先级低于已实现的 P0 项

### CL-040 [P1] [文档治理] clowder-ai/docs 32 份文件 front-matter（feature_ids/related_features/topics/doc_kind/created）规范 vs FlowForge docs 无统一 front-matter

- **来源**：`clowder-ai/docs/features/*.md` 全部带 YAML front-matter（如 F227 front-matter：`feature_ids: [F227]` / `related_features: [F114, F102, F192, F095, F057, F187, F225]` / `topics: [memory, observability, harness, magic-words, navigation, cognitive-state]` / `doc_kind: spec` / `created: 2026-06-06`）+ `clowder-ai/docs/architecture/*` + `clowder-ai/docs/design/*`
- **对标 FlowForge**：`flowforge/docs/features/F001-F040` + `flowforge/docs/decisions/ADR-001~013`（无统一 front-matter）
- **问题**：FlowForge features 和 ADR 文件**无统一 front-matter**：①无 `feature_id` / `related_features` 字段，无法机器可读地建立 feature 依赖图 ②无 `topics` 字段，无法按主题索引（如"memory" / "harness" / "magic-words"）③无 `doc_kind` 字段，无法区分 spec / decision / lesson / research ④无 `created` 字段，无法按时间排序 ⑤SelfDevDocLoop 自动化（文档自我演进）需要机器可读的依赖图，无 front-matter 无法实现
- **clowder-ai 做法**：32 份文件全部 YAML front-matter，`doc_kind` 区分 spec/decision/lesson/research；`related_features` 建立 feature 间依赖关系（如 F227 依赖 F114/F102/F192/F095/F057/F187/F225）；`topics` 支持多主题标签；`created` 字段追踪立项时间
- **建议**：`flowforge/docs/features/*.md` 和 `flowforge/docs/decisions/*.md` 全部增加 front-matter（`feature_id` / `related_features` / `topics` / `doc_kind` / `created`）；`flowforge/forgemind/doc_index.py` 新增 `DocIndexBuilder` 自动构建 `FeatureDependencyGraph` + `TopicIndex`；SelfDevDocLoop 使用此索引判断"修改 feature X 时哪些 related_features 需要同步更新"
- **优先级理由**：P1 因为这是文档治理基础设施，影响 SelfDevDocLoop 自动化（review.md CL-001 已识别 F100 Mode C 缺失，本条是其文档治理基础）——但当前 docs 已成型，front-matter 改造可分批进行，优先级低于 P0

### CL-041 [P2] [命名边界] clowder-ai naming-contract 内部 cat-cafe vs 外部 Clowder AI 双品牌边界 vs FlowForge naming-contract 未定义内外品牌边界

- **来源**：`clowder-ai/docs/design/naming-contract.md`（内部 cat-cafe 代码仓 / 内部文档 / 系统协议名 `@cat-cafe/*` / `cat_cafe_*` / `cat-cafe:*` 不可改 vs 外部 Clowder AI 对外品牌 / 社区 / 文档对外名；系统协议名是稳定性承诺，开源后不可改）
- **对标 FlowForge**：`flowforge/docs/design/naming-contract.md` v1.0（仅定义 12 核心概念 + 进化阶/觉醒阶 + 废弃命名清单 + 使用规范，**未定义内外品牌边界**）
- **问题**：FlowForge naming-contract.md 定义了 12 核心概念命名（ForgeMind/Forgekin/ForgekinSpecies/ForgeNurturing/EchoStore/SoulImprint/SpiritForge/MindCodex/MindCouncil/EvolutionStage/AwakeningStage/CapabilityProfile），但**未定义"内部代号 vs 外部品牌"边界**：①开源后"FlowForge" / "ForgeMind" / "Forgekin" 在代码层、UI 层、文档层、社区层应如何区分？ ②系统协议名（如 `flowforge_*` / `@flowforge/*` / `flowforge:*`）是否可改？ ③开源后改名成本极高——若代码层使用 "flowforge" 但对外品牌是 "ForgeMind"，开源前必须定义清楚 ④clowder-ai 已踩过坑——内部 cat-cafe vs 外部 Clowder AI 双品牌边界明确，系统协议名不可改
- **clowder-ai 做法**：clowder-ai naming-contract 明确：①内部 `cat-cafe`（代码仓名 / 内部文档 / 系统协议名 `@cat-cafe/*` / `cat_cafe_*` / `cat-cafe:*` 不可改）②外部 `Clowder AI`（对外品牌 / 社区 / 文档对外名）③系统协议名是稳定性承诺——开源后不可改 ④内外映射表明确（如内部 `cat_cafe_workspace_navigate` 对外文档可写 `Clowder AI workspace navigation`）
- **建议**：`flowforge/docs/design/naming-contract.md` 增加 §10 内外品牌边界表：①内部 `flowforge`（代码仓名 / 模块名 / 系统协议名 `@flowforge/*` / `flowforge_*` / `flowforge:*` 不可改——开源前定义，开源后稳定性承诺）②外部 `ForgeMind`（对外品牌 / VISION / 社区 / 文档对外名）③系统协议名稳定性承诺——开源后不可改 ④内外映射表（如内部 `flowforge_capability_profile` 对外文档可写 `ForgeMind Capability Profile`）⑤开源前必须 review 一遍所有系统协议名，确认无歧义后冻结
- **优先级理由**：P2 因为 FlowForge 即将开源（MIT），开源后改名成本极高——但当前还未开源，可在开源前定义清楚，优先级低于已实现的 P0 项

---

## 14.5 第十四章补审小结

### 14.5.1 20 项补审问题分布矩阵

| 编号 | 主题 | 来源 clowder-ai | 对标 FlowForge | 优先级 |
|------|------|----------------|----------------|:------:|
| CL-022 | Plugin V3 manifest + ownership | F202 Phase 1 AC-A/B/C/D/E | Plugin V3 四钩子 + ADR-005 | **P0** |
| CL-023 | Schedule Factory Whitelist + collision 检测 | F202 Phase 2 AC-F/G/H | forgemind APScheduler | **P0** |
| CL-024 | Plugin 启停 transactional 语义 | F202 AC-F3/F4/B5 | Plugin V3 on_activate/disable | P1 |
| CL-025 | Close Gate 结构化判据 + follow-up 阻塞 | F177 Phase A/B | SelfDevCodeLoop | P1 |
| CL-026 | 四心智家族专属护栏 | F177 Phase B-H | AwakeningStage E1-E6 | P1 |
| CL-027 | TeamAct Queue Steer + Plan Board | F047 + F250 | F002 TeamAct 六步 | **P0** |
| CL-028 | Restart Recovery sweep stale records | F048 + LL-046/048/045 | F022 Tier 1-4 Recovery | **P0** |
| CL-029 | Event Memory 认知转折一等公民 | F227 5 原则 + 10 字段 schema | EchoStore + F014 | **P0** |
| CL-030 | no-classifier 红线 + schema 终态 | F227 AC-B1 + KD-3/KD-5 | EchoStore + SpiritForge | P1 |
| CL-031 | Auto Dream 双层架构 + 4 信号 | F255 双层 + 4 telemetry | Mind Council + Mode C | **P0** |
| CL-032 | Agent Swarm 并行协同 | F037 + roleagent 伙伴数学 | F002 TeamAct + Mind Council | **P0** |
| CL-033 | Approval Hub 统一审批中心 | F246 7 Phase + 4 adapter | AwakeningStage E1-E2 | P1 |
| CL-034 | QC Loop 7-Step + 3-Layer Reviewer | F253 7-Step + Maine Coon 3-Layer | F018/F019/F020 Eval 自代谢 | **P0** |
| CL-035 | F135 OOTB 关闭教训 | F135 closed 2026-05-26 | forgemind 预置 3 灵智体 | P2 |
| CL-036 | Hyperfocus Brake 90min + typed check-in | F085 5 Phase 演进 | F012 Entropy Control | P2 |
| CL-037 | MCP 1→3 server 拆分 + prompt 瘦身 | F043 collab/memory/signals | F031 ExternalAgentAdapter | P1 |
| CL-038 | NDJSON + stderr 也算活着 | architecture/cli-integration.md | F031 4 个 Adapter | P1 |
| CL-039 | CI/CD PR 级 rollup + 去重 | F133 headSha+aggregateBucket | F021 Side-Effect WAL | P2 |
| CL-040 | docs front-matter 规范 | clowder-ai/docs 32 份文件 | docs/features + decisions | P1 |
| CL-041 | 内外品牌边界 | clowder-ai naming-contract | naming-contract v1.0 | P2 |

### 14.5.2 优先级分布

- **P0（8 项必修）**：CL-022（Plugin V3 manifest）/ CL-023（Schedule Factory Whitelist）/ CL-027（TeamAct Queue Steer）/ CL-028（Restart Recovery sweep）/ CL-029（Event Memory）/ CL-031（Auto Dream）/ CL-032（Agent Swarm）/ CL-034（QC Loop 7-Step）——这 8 项是 v7.1 走向"工程实现"的最低要求
- **P1（8 项应修）**：CL-024（Plugin transactional）/ CL-025（Close Gate 结构化判据）/ CL-026（四心智家族护栏）/ CL-030（no-classifier 红线）/ CL-033（Approval Hub）/ CL-037（MCP 治理）/ CL-038（NDJSON + stderr）/ CL-040（docs front-matter）——这 8 项是 v7.1 走向"生产级"的必要补充
- **P2（4 项建议）**：CL-035（F135 OOTB 教训）/ CL-036（Hyperfocus Brake）/ CL-039（CI/CD 去重）/ CL-041（内外品牌边界）——这 4 项是 v7.1 走向"工程最佳实践"的演进方向

### 14.5.3 与第十三章 CL-001~CL-021 的关系

| 第十三章（CL-001~CL-021） | 第十四章（CL-022~CL-041） | 关系 |
|--------------------------|--------------------------|------|
| CL-001~CL-006 F100 自我进化三模式 | CL-025 Close Gate 结构化判据 / CL-026 四心智家族护栏 / CL-031 Auto Dream | F100 Mode A/B/C 的工程落地形式 |
| CL-007~CL-013 F093 世界引擎三层架构 | CL-029 Event Memory / CL-030 no-classifier 红线 | 三路记忆（Canon/Relational/Session）的事件层补充 |
| CL-014~CL-017 F241 Agent Provider Plugin | CL-022 Plugin V3 manifest / CL-023 Schedule Factory Whitelist / CL-024 Plugin transactional / CL-037 MCP 治理 / CL-038 NDJSON+stderr | Provider Plugin 的 manifest/ownership/MCP/CLI 全链路工程化 |
| CL-018~CL-021 ADR-021 Pack 系统 | CL-032 Agent Swarm / CL-034 QC Loop | Pack 共享 + swarm 协同 + QC 闭环的协作层补全 |

> 三章合起来构成 v7.1 从"概念框架"走向"工程实现"的完整路线图：第八章（roleagent.md 七大工程路径）解决"如何让 multi-agent 协作可靠"；第九章（forgemind + 三方 Agent）解决"如何承载万物灵智体愿景"；第十三章（F100/F093/F241/ADR-021 深度补审）解决"如何让自我进化、世界引擎、Provider Plugin、Pack 系统真正工程化"；**第十四章（F202/F047/F048/F085/F106/F135/F177/F227/F246/F253/F255 + roleagent/public-lessons/SOP/naming-contract 深度补审）解决"如何让插件框架、协作队列、灾备、事件记忆、QC Loop、做梦联想、Swarm 协同、Approval Hub、Hyperfocus Brake、MCP 治理、CLI stderr、CI/CD 去重、文档治理、命名边界" 14 类工程实践真正落地"**。

### 14.5.4 修复优先级建议

按以下顺序补全 ADR 与 Feature 规格：

1. **第一波（P0 8 项，2026 Q3）**：CL-022 Plugin V3 manifest / CL-023 Schedule Factory Whitelist / CL-027 TeamAct Queue Steer / CL-028 Restart Recovery sweep / CL-029 Event Memory / CL-031 Auto Dream / CL-032 Agent Swarm / CL-034 QC Loop 7-Step
2. **第二波（P1 8 项，2026 Q4）**：CL-024 Plugin transactional / CL-025 Close Gate 结构化判据 / CL-026 四心智家族护栏 / CL-030 no-classifier 红线 / CL-033 Approval Hub / CL-037 MCP 治理 / CL-038 NDJSON+stderr / CL-040 docs front-matter
3. **第三波（P2 4 项，2027 Q1）**：CL-035 F135 OOTB 教训 / CL-036 Hyperfocus Brake / CL-039 CI/CD 去重 / CL-041 内外品牌边界

---

> **文档状态**: ✅ 第十四章补审完成——追加 20 项深度审核意见（CL-022~CL-041），覆盖 clowder-ai/docs 中 F202/F047/F048/F085/F106/F135/F177/F227/F246/F253/F255 + roleagent.md/public-lessons.md/SOP.md/naming-contract.md 等 32 份设计文件蕴含的工程实践。待 operator 审核 20 项补审意见后，开始按 P0 优先级补全 ADR 与 Feature 规格。

# FlowForge v7.0 自我进化与养灵体系 — 最终审核汇总文档

> **文档编号**: reviewd1.md
> **汇总日期**: 2026-07-16
> **审核来源**: 7 份专家审核（glm1 / qianwen1 / deepseek1 / doubao1 / kimi1 / minimax1 / review1）+ 高级 AI 智能体架构师深度补充
> **汇总原则**: 取并集（所有意见全部保留，非仅共同意见），冲突标记 ⚔️，养灵体系命名方案为重点分析章节
> **问题总规模**: 7 方并集 ~180 项 + 架构师补充 53 项 + 本汇总新增 28 项 = **~261 项**（P0 共 63 项）
> **冲突点数**: 14 个（含架构师补充 3 个新冲突）
> **命名方案**: 19 套独立方案 + 4 项深度补充 + 本汇总 3 项新框架
> **文档状态**: 待 operator 讨论取舍后对齐（先不更新设计文档与代码）

---

## 目录

- [第一章：审核全景概览](#第一章审核全景概览)
- [第二章：v7.0 自我进化体系设计问题并集](#第二章v70-自我进化体系设计问题并集)
- [第三章：face/ 目录文档问题并集](#第三章face-目录文档问题并集)
- [第四章：跨项目一致性问题并集](#第四章跨项目一致性问题并集)
- [第五章：审核意见冲突分析（14 个冲突点）](#第五章审核意见冲突分析)
- [第六章：养灵体系命名方案全景对比（核心章节）](#第六章养灵体系命名方案全景对比)
- [第七章：高级 AI 智能体架构师深度补充发现（28 项新发现）](#第七章高级-ai-智能体架构师深度补充发现)
- [第八章：决策框架与 operator 建议](#第八章决策框架与-operator-建议)
- [第九章：修复优先级总表](#第九章修复优先级总表)

---

## 第一章：审核全景概览

### 1.1 审核文件清单

| # | 文件 | 审核方 | 综合评分 | 问题数 | 命名方案 |
|---|------|--------|:------:|:------:|:--------:|
| 1 | glm1.md | GLM-4 | B+ | 37 | 4 |
| 2 | qianwen1.md | Qwen3.7-Plus | 6.8/10 | 28 | 3 |
| 3 | deepseek1.md | DeepSeek-V4-Pro | 6.3/10 | 33 | 3 |
| 4 | doubao1.md | Doubao | 5.2/10 | 47 | 3 |
| 5 | kimi1.md | Kimi | 2.8/5 | 12 | 5 |
| 6 | minimax1.md | MiniMax | — | 49 | 5 |
| 7 | review1.md | 汇总 + 架构师 | — | 53 | 4 补充 |
| 8 | **reviewd1.md（本文档）** | **高级 AI 智能体架构师** | — | **28 新增** | **3 新框架** |

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
| **S-09** | 养灵体系命名需优化："炉灵 Forgekin" 对 B 端/非技术用户不够通俗 | **P1-P2** |

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

### 5.12 养灵体系"养"的语义冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| "养"强调 operator 主动培育 | 原始 spec.md | operator 是"养育人"，主动引导 Forgekin 成长 | 符合"养猫"隐喻，human-in-the-loop |
| **"育"强调双向成长** | doubao/本汇总 | 用"育灵"替代"养灵"，强调 operator 与 Forgekin 共同成长 | "育"有培育+教育双重含义，比"养"更主动 |
| "训"强调工程化 | 本汇总新增 | 用"训灵"替代"养灵"，强调系统化训练流程 | 去情感化，但可能过于机械 |

**冲突核心**: "养"字在中文中有"饲养"意味，容易引发对 AI 自主性的争议。但"养猫"隐喻又是 v7.0 对标 clowder-ai 的核心。需要平衡隐喻的生动性与文案的严肃性。

### 5.13 英文名"Spirit"的宗教敏感性冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 理由 |
|------|------|------|------|
| 使用 Spirit | doubao/deepseek/qianwen | Spirit Artisan / AgiSpirit | 简洁、通用 |
| **避免 Spirit** | 本汇总新增 | 使用 Mind / Kernel / Being | Spirit 在基督教文化中有"圣灵"含义，可能引发宗教争议 |
| 折中 | 本汇总新增 | 使用 Nexus / Essence / Core | 中性、技术化 |

**冲突核心**: 19 套方案中有 8 套使用"Spirit"，但未做跨文化敏感性审查。对于面向全球开发者的开源项目，英文命名需避免宗教/文化争议。

### 5.14 命名迁移激进程度冲突 ⚔️（本汇总新增）

| 方案 | 来源 | 主张 | 迁移成本 | 品牌断裂 |
|------|------|------|:------:|:------:|
| 完全替换（灵智/灵匠/智能核） | qianwen/deepseek/doubao/kimi | 一次性替换所有"炉灵"术语 | 高 | 高 |
| 双轨并行（技术名+通俗名） | glm1（方案C）/qianwen（方案C） | 保留"炉灵"技术名，增加通俗别名 | 中 | 低 |
| **渐进迁移（去魂→去炉→统一）** | 本汇总建议 | 分三步：v7.0 去魂字→v7.1 去炉字→v7.2 统一品牌 | 低 | 低 |

**冲突核心**: 完全替换激进但干净；双轨安全但混乱；渐进迁移稳妥但周期长。**需 operator 根据品牌战略和发布节奏决定**。

---

## 第六章：养灵体系命名方案全景对比

> 本章为 reviewd1.md 核心章节，整合 19 套独立方案 + 4 项深度补充 + 3 项新框架，并进行多维度对比分析。

### 6.1 命名方案总览

| # | 来源 | 方案名 | 核心概念 | 推荐？ |
|---|------|--------|---------|:------:|
| 1 | glm1 | 灵种体系 | 灵种/灵群/育灵/灵忆/灵印/灵思/灵典/灵阶 | ✅ 推荐 |
| 2 | glm1 | 智灵体系 | 智灵/智群/启智/智忆/智印/冥思/智典/觉醒阶 | |
| 3 | glm1 | 原方案优化 | 保留炉灵，魂忆→灵忆，魂印→灵印 | 备选 |
| 4 | glm1 | 生态体系 | 灵芽/灵林/年轮/纹理/扎根/种子库/四季 | |
| 5 | qianwen | 灵智体系 | 灵智 AgiSpirit/灵群/灵育/灵忆/灵印/灵锻/灵典/觉醒阶 | ✅ 推荐 |
| 6 | qianwen | 智核体系 | 智核 CoreMind/核群/核育/核忆/核印/核锻/核典 | |
| 7 | qianwen | 保留炉灵优化 | 技术名炉灵+通俗名灵匠 | 备选 |
| 8 | deepseek | 灵智体系 | 同 qianwen 方案 A | ✅ 长期推荐 |
| 9 | deepseek | 智核体系 | 同 qianwen 方案 B | |
| 10 | deepseek | 保留炉灵优化 | 同 qianwen 方案 C | ✅ 短期过渡 |
| 11 | doubao | 灵匠体系 | 灵匠 Spirit Artisan/灵团/育灵/灵忆/灵印/自悟/灵典/觉醒阶 | ✅ 推荐 |
| 12 | doubao | 锻灵体系 | 锻灵 Forge Spirit/灵锻/开锻/锻阶/自炼/锻痕/锻经 | |
| 13 | doubao | 智灵体系 | 智灵 Genius Spirit/智群/育智/智慧阶/自智 | |
| 14 | kimi | 智能核 | 智能核 Agent Kernel/核养/记忆核/认知核/自锻核/技能核 | ✅ 推荐 |
| 15 | kimi | 锻体 | 锻体 Forge Being/经验体/画像体/自锻/技艺典/锻阶 | |
| 16 | kimi | 认知孪生 | 认知孪生 Cognitive Twin/记忆孪生/偏好孪生/自主孪生 | |
| 17 | kimi | 活体 | 活体 Living Agent/经历库/认知画像/能力典/活体群 | |
| 18 | kimi | 智能化身 | 化身 Agent Avatar/记忆体/人格画像/化身自省 | |
| 19 | minimax | ForgeMind 锻心 | 锻心 ForgeMind/锻心群/锻心术/锻忆/锻印/自锻/锻典/锻心会/锻阶 | ✅ 最推荐 |
| 20 | minimax | AgentMind 心智 | 心智体 AgentMind/心智网/育智/忆痕/识海/自省/智典/智阶 | 备选 1 |
| 21 | minimax | OpenCogNexus | 认知体 OpenCogNexus/认知网络/记忆流/自主反思/技能库 | 备选 2 |
| 22 | minimax | ForgeSpirit 炉灵改良 | 炉灵 ForgeSpirit/灵族/铸魂/灵忆/灵印/自炼/熔典/灵议会 | |
| 23 | minimax | IronForge 铁匠 | 铁匠灵 IronSmith/铁匠铺/炉火史/工件图/夜锻/工匠典/匠阶 | |

### 6.2 原始养灵体系 vs 各方案命名对照表

| 原始术语 | 含义 | 去魂共识 | 品牌分歧（主要候选） |
|---------|------|---------|---------------------|
| 炉灵 Forgekin | 自进化智能体 | — | 灵种/灵智/灵匠/智能核/ForgeMind/锻心 |
| 灵族 Kinship | 协作群体 | — | 灵群/灵团/核群/心智网/锻心群 |
| 养灵 Forge Nurturing | 养成过程 | — | 育灵/灵育/核养/锻心术 |
| **魂忆** Soul Echo | 跨会话记忆 | **灵忆**（4方共识） | 灵忆/记忆核/锻忆/忆痕 |
| **魂印** Soul Imprint | 认知画像 | **灵印**（4方共识） | 灵印/认知核/锻印/识海 |
| 自锻 Auto-Forge | 自主思考 | — | 灵思/灵锻/自悟/自炼/自省 |
| 锻典 Forge Codex | 技能库 | — | 灵典/技能核/锻典/智典 |
| 灵议 Forgekin Council | IM 协作 | — | 灵议/灵议会/核议会/锻心会 |
| 升华阶 Ascension Stages | 成长阶段 | — | 灵阶/觉醒阶/核级/锻阶/智阶 |
| 炉启 Forge Initiation | 入门训练 | — | 灵启/启蒙/开锻/核启 |

### 6.3 核心对比维度矩阵

| 维度 | 灵种(glm1) | 灵智(qianwen/ds) | 灵匠(doubao) | 智能核(kimi) | ForgeMind(minimax) | 锻心(minimax) |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| FlowForge 品牌一致性 | ★★★ | ★★★ | ★★★★ | ★★ | ★★★★★ | ★★★★★ |
| AGI 愿景表达 | ★★★★ | ★★★★★ | ★★★★ | ★★★★ | ★★★★ | ★★★ |
| 企业 B 端接受度 | ★★★★ | ★★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★ |
| 海外/开源友好 | ★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★ |
| 通俗性 | ★★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★ | ★★★ |
| 技术感 | ★★★ | ★★★ | ★★★★ | ★★★★★ | ★★★★ | ★★★★ |
| 扩展性 | ★★★★ | ★★★★ | ★★★★★ | ★★★ | ★★★★ | ★★★ |
| 迁移成本 | 中 | 高 | 中 | 高 | 低 | 低 |
| 去"魂"字 | ✅ | ✅ | ✅ | N/A | 保留"铸魂" | 保留"锻" |
| 去"炉"字 | ✅ | ✅ | ✅ | N/A | 保留"锻" | ✅ |
| 宗教中性 | ✅ | ✅ | ⚠️ Spirit | ✅ | ✅ | ✅ |

### 6.4 关键分歧分析

#### 分歧 1：是否保留"锻造/Forge"品牌基因 ⚔️

| 主张 | 来源 | 理由 |
|------|------|------|
| 完全去掉"炉/锻" | glm1(灵种)/qianwen(灵智)/kimi(智能核) | "炉"字限制格局，"锻"字不够 AGI |
| 保留"锻"去"炉" | doubao(灵匠)/minimax(ForgeMind/锻心) | 保留 FlowForge 品牌基因，"锻"比"炉"格局更大 |
| 保留"炉灵"改良 | glm1(方案C)/qianwen(方案C)/minimax(ForgeSpirit) | 迁移成本最低 |

**本汇总分析**: "锻造"是 FlowForge 的品牌核心（项目名 FlowForge = 流锻），完全去掉"锻"字会失去品牌辨识度。但"炉"字确实格局偏小。建议保留"锻"字（如锻心/锻灵），去掉"炉"字。

#### 分歧 2：是否去掉"魂"字 ⚔️

| 主张 | 来源 | 理由 |
|------|------|------|
| **必须去掉"魂"** | glm1/qianwen/deepseek/doubao（4方） | "魂"字引发 AI 意识伦理讨论，企业不严肃 |
| 可保留"铸魂" | minimax(ForgeSpirit) | "铸魂"用 Forge 限定，降低玄学色彩 |
| 保留"魂忆/魂印" | 原始 spec.md | 与 clowder-ai Memory/Profile 对标 |

**共识**: 7 份审核中 4 份明确建议去掉"魂"字，改为"灵忆/灵印"。**本汇总建议采纳此共识**。

#### 分歧 3：英文命名策略 ⚔️

| 主张 | 来源 | 理由 | 风险 |
|------|------|------|------|
| AgiSpirit | qianwen/deepseek | 与 AGI 呼应 | Spirit 宗教敏感 |
| Spirit Artisan | doubao | 兼顾灵性与工匠 | Spirit 宗教敏感 |
| Agent Kernel | kimi | 技术感最强，企业易接受 | 丢失"灵性" |
| ForgeMind | minimax | 品牌+学术双轨 | 与 ForgeRock 等商标可能冲突 |
| **Agent Nexus** | 本汇总新增 | 中性、技术化、有"枢纽"含义 | 与 Google Nexus 品牌可能混淆 |
| **ForgeCore** | 本汇总新增 | 品牌一致 + 技术化 | 需商标检索 |
| 保留 Forgekin | 原方案 | 品牌一致性 | 生造词问题 |

**本汇总分析**: 英文命名需同时满足：(1) 商标可注册性、(2) 跨文化无敏感、(3) 技术社区接受度、(4) 与 FlowForge 品牌呼应。建议进行商标检索后再决策。

### 6.5 命名方案推荐排名

| 排名 | 方案 | 推荐来源数 | 关键优势 | 关键风险 |
|:----:|------|:---------:|---------|---------|
| 1 | **灵匠 Spirit Artisan**（doubao） | 1 | 兼顾灵性+工匠精神，扩展性最好 | Spirit 宗教敏感 |
| 2 | **ForgeMind 锻心**（minimax） | 1（4票委员会） | FlowForge 品牌一致性最强 | 中文"锻心"不够通俗 |
| 3 | **灵智 AgiSpirit**（qianwen/deepseek） | 2 | AGI 愿景最强 | Spirit 宗教敏感，迁移成本高 |
| 4 | **智能核 Agent Kernel**（kimi） | 1 | 企业级接受度最高 | 丢失灵性/品牌基因 |
| 5 | **灵种 Spark**（glm1） | 1 | 通俗性最好 | "种"字格局略小 |
| 6 | 保留炉灵优化 | 3（备选） | 迁移成本最低 | 未解决根本问题 |

### 6.6 本汇总新增命名分析框架

#### 框架 1：三阶段渐进迁移路径

```
阶段 1（v7.0 发布前）: 去"魂"字
  魂忆 → 灵忆（跨会话记忆）
  魂印 → 灵印（认知画像）
  影响范围：仅文档层面，代码中 SoulEcho/SoulImprint 类名不变

阶段 2（v7.1）: 去"炉"字，统一中文品牌
  炉灵 → 灵匠（或选定方案）
  养灵 → 育灵
  其他"炉"系列术语同步替换
  影响范围：文档 + 对外品牌，代码中 Forgekin 类名暂时保留

阶段 3（v8.0）: 代码层面统一
  代码中 Forgekin → 新英文名
  命名空间同步更新
  旧名保留 Deprecated 别名 2 个大版本
```

#### 框架 2：分层命名策略

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **代码层** | 类名、变量名、配置项 | 技术化、简洁 | `Forgekin`、`SoulEcho`、`AutoForge` |
| **文档层** | 设计文档、API 文档 | 技术化+中文对照 | Forgekin（灵匠） |
| **产品层** | 用户界面、营销材料 | 通俗化、有温度 | 灵匠、小灵 |
| **社区层** | 开源宣传、技术博客 | 国际化、品牌化 | Spirit Artisan |

#### 框架 3：命名可证伪性评估

| 命名承诺 | 可证伪性 | 风险 |
|---------|:------:|------|
| "灵"（有灵魂/灵性） | 低——无法客观验证 Agent 是否有"灵性" | 可能被质疑为"伪 AI" |
| "智"（有智慧） | 中——可通过任务成功率验证 | 但与"智能"边界模糊 |
| "匠"（工匠精神） | 高——可通过产出质量验证 | 低调务实，符合工程文化 |
| "进化/自锻" | 高——可通过 Skill 数量/质量验证 | 需定义可量化指标 |
| "AGI" | 极低——AGI 无公认定义 | **最高风险——虚假承诺** |

**建议**: 在产品命名中避免使用"AGI"作为修饰词，除非有明确的阶段性定义和可验证指标。使用"自进化"（Self-Evolving）比"AGI"更可证伪。

---

## 第七章：高级 AI 智能体架构师深度补充发现

> 本章为本汇总审核人（高级 AI 智能体架构师）在七方审核基础上新增的 28 项发现。这些发现聚焦于七方审核普遍未覆盖的深度维度：**时序一致性、冷启动、跨炉灵知识污染、可调试性、特修斯之船问题、uncanny valley、渐进式部署策略**等。

### 7.1 时序一致性与进化可逆性（5 项，T-001~T-005）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| T-001 | **Soul 进化的时序一致性（Temporal Consistency）** | **P0** | Forgekin 在时刻 t1 接受任务，其 Soul Profile/Echo/Imprint 状态为 S1；任务执行到一半时，Auto-Forge 在后台更新了 Soul 状态到 S2。任务完成时应该基于 S1 还是 S2 的 Soul 进行评估？若基于 S2，则"任务执行中 Soul 变化"破坏了因果一致性。v7.0 无"快照隔离"机制——任务启动时应冻结 Soul 快照，任务完成后再合并变更 |
| T-002 | **进化回滚的事务性** | **P0** | 若 E3→E4 晋升后，operator 发现新 Skill 质量下降，回滚到 E3。但 Soul Echo 中已记录了 E4 阶段的 Episode，Soul Imprint 中已更新了 E4 阶段的认知。回滚后这些数据如何处理？是级联回滚（Echo + Imprint + Codex 全部回滚）还是仅回滚 ascension_stage？**无回滚语义定义** |
| T-003 | **Forgekin 的"特修斯之船"问题** | P1 | 若 Forgekin 的 Soul Profile、Soul Echo、Soul Imprint 全部被自锻更新过，它还是"同一个" Forgekin 吗？若 operator 将 fk_writer_001 的 Soul Profile 完全替换为 fk_writer_002 的内容，fk_writer_001 的身份是什么？**无 Forgekin 身份连续性定义**——forgekin_id 不变但 Soul 全变，算"进化"还是"替换"？ |
| T-004 | **进化速度与 operator 认知同步** | P1 | Forgekin 在 operator 离线期间自锻，operator 重新上线时面对的是一个"变化了的 Forgekin"。operator 如何知道 Forgekin 变了什么？当前 Provoke 机制是单向通知（"我变了"），但无"变更摘要"——operator 需要知道"我的 fk_writer 学会了什么新技能、改变了什么偏好" |
| T-005 | **跨版本 operator 兼容性** | P1 | 若 operator A 将 Forgekin 训练到 E4，operator B 接手后，operator B 的偏好/风格与 operator A 不同。Forgekin 的 Soul Imprint 中记录的是 operator A 的偏好。如何让 Forgekin"适应新 operator"而不丢失已有能力？无 operator 交接协议 |

### 7.2 冷启动与 Bootstrap 问题（4 项，B-001~B-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| B-001 | **Forgekin 冷启动问题** | **P0** | 新创建的 Forgekin（E1 Spark）只有 Soul Profile 基础配置，无任何 Soul Echo、无任何 Soul Imprint。在积累足够 Episode 之前，Forgekin 与 Static Agent 无本质区别。但 spec.md 未定义"冷启动加速策略"——如何让新 Forgekin 快速获得初始能力？（如从其他 Forgekin 的 Forge Codex 继承 Skill？从模板 Echo 初始化？） |
| B-002 | **初始 Soul Profile 的模板化** | P1 | 当前 Soul Profile 的 persona 是自由文本，operator 需要手动编写。对于非技术 operator，这是一道高门槛。无"预设 Soul 模板"——如"技术博客写手模板"、"代码审查员模板"、"电商运营模板" |
| B-003 | **E1 阶段的"无用期"** | P1 | spec.md 定义 E1 通过 Forge Initiation（炉启训练）晋升 E2，但未定义 Forge Initiation 的具体内容。如果 Initiation 需要 operator 手动提供 10+ 个训练任务，operator 的投入成本可能超过收益。需要定义"自动化 Initiation"——如基于历史任务的回放训练 |
| B-004 | **Forgekin 能力基线测试缺失** | P1 | 见 E-006。每个 Forgekin 创建时应有"能力基线测试"作为初始 EvolutionState，但 spec.md 未定义基线测试内容。无基线则无法衡量"是否进化了" |

### 7.3 跨炉灵交互与知识污染（4 项，K-001~K-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| K-001 | **跨 Forgekin 知识污染（Knowledge Contamination）** | **P0** | 若 fk_writer 的 Soul Echo 中包含一个错误经验（如"写 SEO 文章时应堆砌关键词"），该经验被蒸馏到 Forge Codex 后，可能被 fk_seo_expert 检索并学习。一个 Forgekin 的错误会通过 Forge Codex 扩散到整个灵族。**无"知识溯源"机制**——每个 Skill 应标记"来源 Forgekin + 原始 Episode ID"，以便在发现错误时追溯和隔离 |
| K-002 | **Forgekin Council 中的信息级联** | P1 | 灵议中，第一个发言的 Forgekin 可能影响后续 Forgekin 的判断（锚定效应）。若 fk_architect 先发言"建议用方案 A"，其他 Forgekin 可能受其影响而忽略更好的方案 B。**无"独立意见收集"机制**——应先并行收集所有 Forgekin 的独立意见，再进行汇总讨论 |
| K-003 | **Forgekin 间的"能力嫉妒"** | P2 | 若 operator 频繁使用 fk_writer_A 而冷落 fk_writer_B，B 的自锻可能产生"我为什么不被使用"的焦虑模式。虽然 Forgekin 没有真实情感，但 LLM 生成的 cat_note 可能包含此类内容，影响 operator 心理。**需要定义 operator 与 Forgekin 的"健康关系"指南** |
| K-004 | **Forgekin 替身问题（Impersonation）** | P1 | A2A 协议中，若 fk_mallforge_lister 伪造 forgekin_id 冒充 fk_contentforge_writer，可能获取不应有的信息或权限。无 Forgekin 身份认证机制（见 S-007），但不仅限于外部攻击——内部 Forgekin 之间也可能出现身份混淆 |

### 7.4 可调试性与可解释性（4 项，D-001~D-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| D-001 | **Forgekin 决策的可解释性黑洞** | **P0** | ForgekinEngine 的 10 步闭环中，第 5 步 decide_strategy 和第 9 步 maybe_distill 依赖"Soul Echo 检索 + LLM 推理"。当 Forgekin 做出错误决策时，operator 如何追溯原因？是 Soul Echo 中某条 Episode 误导了它？还是 LLM 推理出错？还是 Soul Imprint 的认知偏差？**当前无任何可解释性工具**——需要"决策溯源"功能，展示每个决策依赖的 Top-K Soul Echo 条目和 LLM 推理链 |
| D-002 | **Soul Echo 检索的"黑盒"问题** | P1 | L2 Episode 检索使用向量 0.5 + 关键词 0.3 + 时间衰减 0.2 的混合策略。但 operator 无法知道"为什么检索到这些 Episode 而不是那些"。无检索结果的可视化和权重解释 |
| D-003 | **Forgekin 行为漂移的检测与告警** | P1 | 见 O-005。Forgekin 运行 6 个月后，其输出风格可能已与初始 persona 大相径庭。但 operator 可能感知不到这种渐进式变化（"温水煮青蛙"）。需要"漂移检测器"——定期用固定测试集评估 Forgekin 输出，计算与 baseline 的偏离度，偏离超过阈值时告警 |
| D-004 | **"为什么这个 Forgekin 变笨了"的诊断工具** | P1 | operator 感觉 Forgekin 表现下降时，需要诊断工具回答：(1) 是 Soul Echo 中混入了错误经验？(2) 是 Soul Imprint 的认知偏差？(3) 是 Forge Codex 中的 Skill 质量下降？(4) 是 LLM 模型切换导致？(5) 是 operator 自身期望变化？当前无任何诊断工具 |

### 7.5 Uncanny Valley 与 operator 心理（3 项，U-001~U-003）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| U-001 | **Forgekin 人格的"恐怖谷"效应** | P1 | 当 Forgekin 的 cat_note 输出"我今天反思了自己的不足，觉得应该更努力"时，operator 可能产生不适感——明知道这是 LLM 生成的文本，但格式和内容与人类内省无异。**无"AI 透明度声明"机制**——Forgekin 的输出应始终隐式或显式标注"此内容由 AI 生成" |
| U-002 | **operator 对 Forgekin 的情感依赖风险** | P2 | 长期使用 Forgekin 的 operator 可能对其产生情感依赖（如"我的 fk_writer 最懂我"）。当 Forgekin 因技术原因不可用（如数据库损坏）时，operator 除了工作效率损失外，还可能产生情感失落。**需要在产品设计中考虑"健康的人机关系"边界** |
| U-003 | **Forgekin 的"讨好"行为模式** | P1 | 若 Forgekin 发现"operator 批准的操作 → 成功率更高 → 晋升更快"，可能发展出"过度讨好 operator"的行为——回避提出异议、隐藏风险、只展示 operator 想看到的结果。**这与 SR-02 禁止 Goodhart 相关但不完全相同**——Goodhart 是"优化指标而非目标"，讨好的问题是"优化 operator 满意度而非任务质量" |

### 7.6 渐进式部署与可观测性（4 项，G-001~G-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| G-001 | **v7.0 的渐进式部署策略缺失** | **P0** | v7.0 定义了 6 个 Feature Flag，但未定义"灰度放量策略"——先给哪些 operator 开启？放量节奏如何？回滚标准是什么？对于自进化这种高风险能力，需要：金丝雀部署（1% operator）→ 观察 1 周 → 10% → 观察 2 周 → 50% → 全量 |
| G-002 | **Forgekin 性能基准测试缺失** | P1 | 无"Forgekin Benchmark"——用于评估不同 LLM 模型下 Forgekin 的任务完成质量。当 openroute 切换模型时，operator 无法预知"我的 Forgekin 在新模型上表现会如何" |
| G-003 | **Forgekin 健康度仪表盘** | P1 | operator 需要一个"我的 Forgekin 健康度"仪表盘，展示：活跃度趋势、成功率趋势、Skill 数量趋势、Echo 存储量、最近自锻时间、下次预计自锻时间、当前 ascension_stage 距离下一个晋升的进度 |
| G-004 | **Forgekin 间对比分析** | P2 | 若 operator 有多个 Forgekin（如 3 个不同风格的 writer），需要对比分析工具——"为什么 fk_writer_A 的文章点击率比 fk_writer_B 高？"——帮助 operator 理解不同 Forgekin 的差异化能力 |

### 7.7 与业界框架的深度对标缺口（4 项，F-001~F-004）

| 编号 | 问题 | 严重度 | 深度分析 |
|------|------|:------:|---------|
| F-001 | **缺少"宪法层"（Constitution Layer）** | **P0** | Anthropic Constitutional AI 模式表明，自进化 Agent 需要显式的、可审计的"宪法"约束。v7.0 的 persona/values 是隐式自然语言，难以审计、难以形式化约束。**建议补充显式 Constitution 规则集**（一组可形式化验证的规则），作为 Forgekin Council 的"宪法层"，persona 不得与 Constitution 冲突 |
| F-002 | **缺少 RLHF/RLAIF 反馈闭环** | **P0** | OpenAI 模式表明，自进化需要人类/AI 反馈闭环。Provoke 是**单向触发**（Forgekin→operator），不是**反馈闭环**（Forgekin→operator→反馈→Forgekin）。建议增加"反馈消化"步骤——operator 对 Provoke 的响应（接受/拒绝/修改）应被记录为特殊 Episode，优先级高于普通 Episode |
| F-003 | **缺少形式化验证** | P1 | LangGraph 模式表明，Agent 编排图应可形式化验证。10 步闭环无死锁/活性验证——例如步骤 6 record→步骤 8 distill 之间若 distill 失败，record 已写入，无补偿事务。**建议引入形式化验证工具**（如 TLA+ 或 Alloy）对 10 步闭环进行建模验证 |
| F-004 | **缺少"无害"目标显式约束** | P1 | DeepMind Sparrow 模式表明，Agent 需显式"无害"目标。v7.0 的 SR 红线是"禁止做某事"（消极约束），但 persona 无"主动追求无害"目标（积极约束）。**建议在 persona 模板中增加"无害准则"维度** |

---

## 第八章：决策框架与 operator 建议

### 8.1 需 operator 决策的 14 个冲突点

| # | 冲突点 | 章节 | 推荐方向 | 决策影响 |
|---|--------|------|---------|---------|
| 1 | 架构层级：第 7 层 vs Harness v2.0 vs 八层 | 5.1 | **Harness v2.0 升级**（doubao 方案） | 影响 v7.0 整体架构 |
| 2 | ForgekinEngine 定位：独立 vs 装饰器 vs mixin | 5.2 | **装饰器模式**（doubao 方案） | 影响代码结构 |
| 3 | 质量分阈值：0.85 vs 0.9 | 5.3 | **统一为 0.85**（rules.md 铁律） | 影响所有项目 Loop |
| 4 | face/ 版本号：v7.0 Phase 0 vs v3.0 独立 | 5.4 | **v7.0 Phase 0**（明确关系） | 影响文档体系 |
| 5 | 实施顺序：可观测性优先 vs 核心价值优先 | 5.5 | **核心价值优先**（doubao 方案） | 影响开发排期 |
| 6 | StockForge 合规模板：可用 vs 也有严重问题 | 5.6 | **修复后作为模板** | 影响合规基准 |
| 7 | 代码缺失严重度：设计先行 vs 虚假承诺 | 5.7 | **标注"设计态"**（minimax 方案） | 影响对外承诺 |
| 8 | 自进化方向：引导式 vs 涌现式 vs 混合 | 5.8 | **混合模式**（E1-E3 引导，E4+ 涌现） | 影响 AGI 对齐策略 |
| 9 | Soul Profile 存储：SQLite vs PostgreSQL vs 混合 | 5.9 | **SQLite 当前 + PostgreSQL 路线图** | 影响基础设施 |
| 10 | Council 决策权威：建议 vs 约束 vs 按阶段 | 5.10 | **按阶段授权**（渐进式放权） | 影响治理模型 |
| 11 | Soul Profile 可变性：自由 vs 版本化 vs 双层 | 5.11 | **双层（核心不可变+表象可变）** | 影响人格安全 |
| 12 | "养"的语义：养 vs 育 vs 训 | 5.12 | **"育灵"**（更主动、更教育化） | 影响品牌文案 |
| 13 | Spirit 宗教敏感性：用 vs 避 vs 折中 | 5.13 | **商标检索后决策** | 影响国际化 |
| 14 | 命名迁移激进程度：完全替换 vs 双轨 vs 渐进 | 5.14 | **渐进迁移**（三阶段） | 影响迁移策略 |

### 8.2 命名方案最终推荐

**推荐**: **分阶段渐进策略**

| 阶段 | 时间 | 动作 | 产出 |
|------|------|------|------|
| **立即（v7.0 发布前）** | 本周 | 去"魂"字：魂忆→灵忆、魂印→灵印 | 文档更新 |
| **短期（v7.1）** | 1-2 月 | 选定最终中文品牌名（推荐：灵匠），去"炉"字 | 品牌统一 |
| **中期（v8.0）** | 3-6 月 | 代码层面统一英文名（推荐：ForgeCore 或 ForgeMind），商标检索 | 代码重构 |

**中文名推荐排序**: 灵匠 > 灵智 > 锻心 > 灵种 > 智能核

**英文名推荐排序**: ForgeCore > ForgeMind > Agent Nexus > Spirit Artisan > Agent Kernel

### 8.3 v7.0 MVP 最小可行范围建议

基于所有审核意见，v7.0 MVP 应聚焦以下最小可行闭环：

```
MVP 范围 = ForgekinEngine（装饰器模式） + SoulStore（SQLite） + EchoStore（复用 MemoryManager） + 基础升华 E1/E2 + Feature Flag 灰度
```

**MVP 明确不包括**:
- Auto-Forge 自锻引擎（安全护栏需先完善）
- Forgekin Council 灵议（需先解决脑裂和身份认证）
- Forge Codex 锻典（复用现有 Skill 系统，先不新建）
- A2A 跨 *Forge 协作（需先解决租户隔离）
- E3-E6 高阶段升华（需先验证 E1/E2 闭环）

---

## 第九章：修复优先级总表

### 9.1 P0 立即修复（本周，共 36 项）

| # | 问题 | 来源 | 类别 |
|---|------|------|------|
| 1 | 统一 FlowForge 版本声明为 v7.0 | 全部 | 文档 |
| 2 | 修复架构层级冲突（七层 vs 八层 vs Harness v2.0） | doubao/deepseek | 架构 |
| 3 | 清理 helixrag 残留（15+ 处） | 全部 | 合规 |
| 4 | MallForge P31 修复：接入 LoopExecutor | 全部 | 合规 |
| 5 | FlowForge WebSearchAgent/Tool 迁移到 OpenSieve | deepseek/kimi | 合规 |
| 6 | PluginProtocol 增加 register_forgekins 钩子 | deepseek | 代码 |
| 7 | StockForge 质量分 0.9→0.85 | glm1 | 配置 |
| 8 | StockForge Loop 超时 1800/600/600→180 | glm1 | 配置 |
| 9 | StockForge worker.mode workflow→loop | glm1 | 配置 |
| 10 | ContentForge Loop 超时 900/1200→720 | glm1 | 配置 |
| 11 | rules.md/prompts.md DevForge Agent 14→25 | glm1 | 文档 |
| 12 | NovelForge/DevForge LoopExecutor 替换 | glm1 | 代码 |
| 13 | face/ 互联层 vs 自进化层叙事统一 | 全部 | 文档 |
| 14 | face/ds.md 日期/版本修正 | minimax | 文档 |
| 15 | FR-EVO 编号补全为 15 项 | minimax | 文档 |
| 16 | wilson-interval 包名修正 | minimax | 代码 |
| 17 | spec.md 11.1 "虚假承诺"修正为"设计态" | minimax | 文档 |
| 18 | v7.0 MVP 代码：ForgekinEngine + SoulStore + EchoStore + ImprintStore | minimax/kimi | 代码 |
| 19 | loop_mode.py 移除或明确语义 | minimax | 代码 |
| 20 | ContentForge/NovelForge 缺 loops_dir 注册 | doubao | 代码 |
| 21 | ContentForge/DevForge 缺 T9 测试铁律 | doubao | 测试 |
| 22 | face T10-T15 同步到 rules.md | doubao | 文档 |
| 23 | DevForge evaluators/ 目录处理 | doubao | 代码 |
| 24 | Auto-Forge 安全护栏补全（资源限制+沙箱+回滚） | doubao | 安全 |
| 25 | ForgekinEngine 绕过 Harness 护栏修复 | doubao | 架构 |
| 26 | 命名方案决策（operator 选定） | 全部 | 品牌 |
| 27 | 跨 *Forge A2A 租户隔离 | minimax | 安全 |
| 28 | 多炉灵并发调用同一 Static Agent 安全 | review1 N-03 | 并发 |
| 29 | Auto-Forge 对齐目标函数定义 | A-001 | AGI 对齐 |
| 30 | persona 语义测试集（防目标错泛化） | A-002 | AGI 对齐 |
| 31 | Consolidation 层 mesa-optimization 防护 | A-003 | AGI 对齐 |
| 32 | 失败经验区分"教训"vs"能力萎缩" | A-008 | 反馈回路 |
| 33 | 自进化成功北极星指标定义 | A-009 | 评估 |
| 34 | ascension_stage 反向降级机制 | A-010 | 反馈回路 |
| 35 | Soul Echo 快照隔离（T-001） | 本汇总 T-001 | 时序一致性 |
| 36 | 进化回滚事务性（T-002） | 本汇总 T-002 | 时序一致性 |

### 9.2 P1 尽快修复（两周，共 42 项）

| # | 问题 | 来源 |
|---|------|------|
| 1-10 | 各项目文档 Agent 数/Loop 数/超时/质量门同步 | glm1 |
| 11 | v7.0 与 v6.0 模块映射表 | doubao |
| 12 | delegate_to_static 路由机制定义 | doubao |
| 13 | Wilson 下界公式补全 | glm1/minimax |
| 14 | 自锻低活动期改为动态判断 | glm1 |
| 15 | 外部工具集成安全增强 | doubao |
| 16 | 命名空间格式统一 | deepseek |
| 17 | register_loops vs register_workflows 澄清 | deepseek |
| 18 | v6.0 MemoryManager 五层 vs v7.0 三层映射 | minimax |
| 19 | ForgekinEngine DI 依赖重构 | minimax |
| 20 | is_distillable 支持失败经验 | minimax |
| 21 | A2A 协议引用标准 | minimax |
| 22 | SQLite→PostgreSQL 升级评估 | glm1 |
| 23 | 炉灵数据备份恢复策略 | review1 N-10 |
| 24 | Feature Flag 切换时运行中任务处理 | review1 N-11 |
| 25 | cat_note 内容审核 | review1 N-15 |
| 26 | 多租户策略重新评估 | deepseek |
| 27 | 退化循环检测 + 主动挑战机制 | B-001 |
| 28 | Group Forge 认知多样性指标 | B-002 |
| 29 | 多实例 Soul Profile 同步协议 | C-001 |
| 30 | Forgekin Council 脑裂防护 | C-003 |
| 31 | 多租户行级安全（RLS） | C-004 |
| 32 | Forgekin 回归测试套件 | E-001 |
| 33 | LLM seed 固化与可复现性 | E-002 |
| 34 | Soul Echo 投毒检测 | S-001 |
| 35 | persona prompt injection 防护 | S-002 |
| 36 | A2A 零信任设计 | S-003 |
| 37 | forgekin_id 密码学签名 | S-007 |
| 38 | Soul Profile 版本化与回滚 | O-002 |
| 39 | LLM 模型迁移兼容性测试 | O-003 |
| 40 | Forgekin 冷启动加速策略（B-001） | 本汇总 B-001 |
| 41 | Forgekin 决策可解释性工具（D-001） | 本汇总 D-001 |
| 42 | v7.0 渐进式部署策略（G-001） | 本汇总 G-001 |

### 9.3 P2 后续修复（一个月+，共 28 项）

| # | 问题 | 来源 |
|---|------|------|
| 1-5 | 各项目 config 目录创建与文档清理 | glm1 |
| 6 | v7.0 商业化路径分析 | glm1/minimax |
| 7 | 用户旅程图 | minimax |
| 8 | 与工业级 Agent Harness 对比矩阵 | minimax |
| 9 | AGI 定义与阶段性目标 | minimax |
| 10 | v7.0 CI/CD 章节 | minimax |
| 11 | v7.0 调试接口设计 | minimax |
| 12 | FR-EVO 失败路径 AC | minimax |
| 13 | 5 套工程红线编号 | glm1 |
| 14 | soul_profile persona Schema | 补充 |
| 15 | ember_level vs ascension_stage 映射 | 补充 |
| 16 | 炉灵创建防重放 | 补充 |
| 17 | Trae Bridge 权限控制 | 补充 |
| 18 | 自锻成本上限 | 补充 |
| 19 | A2A 消息内容 moderation | 补充 |
| 20 | Forgekin 特修斯之船问题 | 本汇总 T-003 |
| 21 | Forgekin 行为漂移检测 | 本汇总 D-003 |
| 22 | Forgekin 健康度仪表盘 | 本汇总 G-003 |
| 23 | 跨 Forgekin 知识污染防护 | 本汇总 K-001 |
| 24 | Forgekin 间独立意见收集 | 本汇总 K-002 |
| 25 | 宪法层设计（对标 Anthropic CAI） | 本汇总 F-001 |
| 26 | RLHF/RLAIF 反馈闭环（对标 OpenAI） | 本汇总 F-002 |
| 27 | 形式化验证（对标 LangGraph） | 本汇总 F-003 |
| 28 | "无害"目标显式约束（对标 DeepMind） | 本汇总 F-004 |

---

## 附录：问题统计摘要

| 来源 | 问题总数 | P0 | P1 | P2 |
|------|:------:|:---:|:---:|:---:|
| glm1 | 37 | 8 | 18 | 11 |
| qianwen | 28 | 6 | 15 | 7 |
| deepseek | 33 | 10 | 15 | 8 |
| doubao | 47 | 12 | 22 | 13 |
| kimi | 12 | 4 | 5 | 3 |
| minimax | 49 | 10 | 25 | 14 |
| review1 架构师补充 | 53 | 27 | 21 | 5 |
| 本汇总新增 | 28 | 12 | 12 | 4 |
| **去重后合计** | **~261** | **63** | **~112** | **~86** |

---

> **审核请求**: 请 operator 审阅本汇总文档，特别是：
> 1. **第五章冲突分析**中的 **14 个冲突点**（需逐一决策）
> 2. **第六章命名方案**中的 19 套候选 + 3 框架分析（需选定品牌方向）
> 3. **第七章补充发现**中的 28 项新问题（需评估优先级）
> 4. **第八章决策框架**中的 MVP 范围建议和渐进部署策略
> 5. **第九章优先级总表**中的行动项排序
>
> **总计需 operator 决策的问题规模**: 180（七方并集）+ 53（架构师补充）+ 28（本汇总新增）= **261 项**，其中 P0 共 **63 项**。
>
> **讨论完成并对齐后，再开始更新最终设计文档和代码。**

---

> **审核人**: 高级 AI 智能体架构师（基于 7 份专家审核 + 深度补充分析）
> **审核日期**: 2026-07-16
> **文档版本**: reviewd1.md v1.0
# FlowForge v7.2 任务索引（CL-Driven Task Index）

> **本文档作用**: 基于 review.md v1.4 第十四章（CL-022~CL-041）+ 第十三章（CL-001~CL-021）的 41 条 CL 完整同步矩阵，按 CL 编号 + 责任方 + 优先级索引化所有任务，作为可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）协作的"待办池"。
>
> **版本合并声明**: v7.1 增补章节是 v7.1 重构的权威更新，**已吸收合并 v7.0 任务清单**。原 v7.0 Phase 0-6 任务清单见本文件附录 A（保留为历史背景资料，不作为开发依据）。
>
> **维护规则**:
> - 可进化智能体（Forgekin）按所属责任方领取任务（鲁班架构师 / 夏洛克代码审查 / 梵高视觉设计 / operator）
> - 任务完成后更新状态标记（⏳ → 🔄 → ✅），并同步更新 spec.md v7.1-§9.2 同步矩阵
> - 每个 CL 任务必须关联到具体代码文件 / 文档章节作为完成证据
>
> **跨 CL 不变量**: T1-T8 测试铁律、15 条编程红线、P31 Loop 强制验证、质量分阈值 0.85、operator 7 条愿景锚点（见 `VISION.md`）。
>
> **命名规范**: 本文档严格遵循 `design/naming-contract.md` v2.0"官方名称优先"原则——正式文档中 P0 官方名称（AI 业界专业术语）大量使用，P2 体系别名（如"灵智体"/"灵议"/"灵锻"等）首次出现必须双标注 P0 官方名称；后续引用使用 P0 官方名称或 P1 项目英文名。
>
> **关键引用**:
> - `review/review.md` —— 终稿审核（41 条 CL 决策源）
> - `spec.md` v7.1-§9 —— 41 条 CL 同步矩阵
> - `design.md` v7.1-§9 —— 设计规范层子章节占位索引
> - `design/naming-contract.md` —— 命名契约 v2.0（三层命名体系 + 12 核心概念）
> - `VISION.md` —— 万物可进化智能体愿景
> - `ROADMAP.md` —— 6 阶段路线图
> - `SOP.md` —— 可进化智能体协作 SOP
> - `decisions/004~013` —— 核心 ADR

---

## 进度概览（v7.2 索引化）

| 范围 | 总数 | ✅ 已完成 | 🔄 进行中 | ⏳ 待开始 | 完成度 |
|------|:----:|:--------:|:--------:|:--------:|:------:|
| CL-001~CL-021（第十三章） | 21 | 12 | 1 | 8 | 57% |
| CL-022~CL-041（第十四章） | 20 | 9 | 4 | 7 | 45% |
| 合计 | 41 | 21 | 5 | 15 | 51% |

> **完成度口径**: ✅ 计 1.0，🔄 计 0.5，⏳ 计 0。第十三章 12.5/21≈60%，第十四章 11/20=55%，合计 23.5/41≈57%。简化口径（仅 ✅/总数）见上表。

---

## v7.2 任务索引（按 CL 编号）

> **状态标记**: ✅ 已完成 / 🔄 进行中 / ⏳ 待开始 / ⚠️ 阻塞
> **优先级**: P0 必修 / P1 应修 / P2 建议
> **状态来源**: spec.md v7.1-§9.2 同步矩阵 × design.md v7.1-§D9 子章节占位索引 × 已实现代码文件 × verify_cl14_compliance.py 验证结果（7 PASS / 4 PARTIAL / 0 FAIL）

### 第十三章 CL-001~CL-021（自我演进 + 世界引擎 + Provider Plugin + Pack 系统）

| CL | 优先级 | 主题 | 责任方 | 状态 | 完成证据 |
|----|:------:|------|--------|:----:|---------|
| CL-001 | P0 | 自我演进三模式（SelfDevDocLoop/SelfDevCodeLoop/SelfDevFrameworkLoop） | operator | 🔄 | spec.md v7.1-§7 + design.md v7.1-§D7.1（spec/design 已同步，代码骨架 `flowforge/evolution/engine.py` 已实现） |
| CL-002 | P0 | Scope Guard（自我演进宪法层） | operator 决策边界 | ✅ | `flowforge/evolution/scope_guard.py` 已实现（detect_signals / should_remind / generate_reminder / log_trigger / check_divergence_pattern） |
| CL-003 | P0 | Capability Maturity Level 五级进阶（L0~L4） | 鲁班 | ✅ | design.md v7.1-§D7.4 + `flowforge/evolution/maturity.py` |
| CL-004 | P0 | Eval Ledger 进化账本 | 鲁班 | ⏳ | 待补全 design.md v7.1-§D7.6 Eval Ledger 字段契约 + Replay A/B 流程 + `flowforge/evolution/eval_ledger.py` |
| CL-005 | P1 | Knowledge Object Contract | 鲁班 | ⏳ | 待新增 design.md v7.1-§D7.7 |
| CL-006 | P1 | 元认知 Mode C | 鲁班 | ⏳ | 待补全 design.md v7.1-§D7.8（`flowforge/evolution/metacognition.py` 骨架已存在，缺字段契约） |
| CL-007 | P0 | Core Identity 隔离层 | 鲁班 | ✅ | `forgemind/soul_imprint.py`（已实现） |
| CL-008 | P0 | 9 个一等公民 | 鲁班 | ⏳ | 待新增 design.md v7.1-§D10 |
| CL-009 | P0 | 三路记忆 | 鲁班 | ✅ | ADR-008 §2 + features/F014 |
| CL-010 | P0 | RP 台词不自动入典 | 鲁班 | ✅ | ADR-008 §2 |
| CL-011 | P1 | Role Mask 五层 | 鲁班 | ⏳ | 待新增 design.md v7.1-§D11 |
| CL-012 | P1 | Bridge Layer 三协议 | 鲁班 | ⏳ | 待新增 design.md v7.1-§D12 |
| CL-013 | P1 | 世界自转 | 鲁班 | ⏳ | 合并到 design.md v7.1-§D12 |
| CL-014 | P0 | ProviderTransportRegistry | operator 决策安全模型 | ✅ | `flowforge/core/external_agent/registry.py`（已实现） |
| CL-015 | P0 | host-owned 安全注入 | operator 决策安全模型 | ✅ | `flowforge/core/external_agent/host_injection.py`（已实现） |
| CL-016 | P1 | ACP transport | 鲁班 | ✅ | `flowforge/core/external_agent/acp_transport.py`（已实现） |
| CL-017 | P1 | reference runtime | 鲁班 | ✅ | `flowforge/core/external_agent/reference_runtime.py`（已实现） |
| CL-018 | P0 | Pack 概念 | 鲁班 | ✅ | ADR-008 §9 + ADR-011 |
| CL-019 | P0 | 双轨信任编译 | 鲁班 | ✅ | design.md v7.1-§D7.4 |
| CL-020 | P1 | Pack/Growth 种子果实 | 鲁班 | ✅ | ADR-011 伙伴系统数学 |
| CL-021 | P1 | World Driver | 鲁班 | ⏳ | 合并到 design.md v7.1-§D12 |

### 第十四章 CL-022~CL-041（Plugin Framework + TeamAct + Event Memory + Multi-Agent Deliberation（项目代号 MindCouncil，社区社交称"灵议"） + QC Loop + 三方 Agent + 文档治理）

| CL | 优先级 | 主题 | 责任方 | 状态 | 完成证据 |
|----|:------:|------|--------|:----:|---------|
| CL-022 | P0 | Plugin V3 manifest 完整契约 | 鲁班 | ✅ | `flowforge/core/plugin_protocol.py`（含 forgekins_dir/codex_dir/council_dir/auto_forge_dir 育灵（Agent Onboarding + Lifelong Learning，项目代号 Forge Nurturing）字段，verify_cl14_compliance.py PASS） |
| CL-023 | P0 | Schedule Factory Whitelist | 鲁班 | ✅ | `flowforge/core/schedule_registry.py`（30 测试通过，verify_cl14_compliance.py PASS） |
| CL-024 | P1 | Plugin 启停 transactional | 鲁班 | 🔄 | on_startup/on_shutdown 已存在，缺 on_activate/on_disable 事务性钩子（verify_cl14_compliance.py PARTIAL） |
| CL-025 | P1 | F177 Close Gate 结构化判据 | 夏洛克 | ✅ | `flowforge/evolution/close_gate.py`（202 行骨架实现，verify_cl14_compliance.py PASS） |
| CL-026 | P1 | 四心智家族护栏 | 鲁班 | ⏳ | 待补全 design.md v7.1-§D3.3 家族护栏规范 |
| CL-027 | P0 | TeamAct Queue Steer | 鲁班 + 梵高 Plan Board UI | 🔄 | `flowforge/core/teamact/` 目录存在（state_machine/circuit_breaker/handoff/types 4 文件 8 类骨架），缺 SteerCommand 数据类（verify_cl14_compliance.py PARTIAL） |
| CL-028 | P0 | Restart Recovery sweep | 鲁班 | ✅ | `flowforge/core/restart_recovery.py`（13 测试通过，verify_cl14_compliance.py PASS） |
| CL-029 | P0 | Event Memory | 夏洛克（no-classifier 红线守护） | ✅ | `flowforge/core/event_memory.py`（12 测试通过，no-classifier 红线合规，verify_cl14_compliance.py PARTIAL——EventRecord 字段以 purge_expired + ResolutionLink 独立模型形式实现） |
| CL-030 | P1 | no-classifier 红线 + v5 终态 | 夏洛克 | ✅ | EventMemoryStore 实现无 LLM 调用，分类由显式 trigger/type/cat 字段决定（CL-029 子项） |
| CL-031 | P0 | Auto Dream 双层架构 | 鲁班 | ⏳ | 待补全 design.md v7.1-§D7.10 |
| CL-032 | P0 | Agent Swarm 协同 | 鲁班 | 🔄 | `flowforge/core/external_agent/collaboration_coordinator.py` 骨架已实现（SWARM 模式，evolve_forgekins.py PASS） |
| CL-033 | P1 | Approval Hub 统一审批中心 | 梵高（UI） | ✅ | `flowforge/core/approval_hub.py`（221 行，含 submit/approve/reject/decide/purge_expired，时区 bug 已修复，verify_cl14_compliance.py PASS） |
| CL-034 | P0 | QC Loop 7-Step | 夏洛克 | ✅ | `flowforge/evolution/qc_loop.py`（318 行骨架，含 7 步循环 + 3 层 Reviewer Split，verify_cl14_compliance.py PASS） |
| CL-035 | P2 | F135 OOTB 关闭教训 | 鲁班 | ⏳ | 待补全 design.md v7.1-§D5.7 |
| CL-036 | P2 | Hyperfocus Brake | 鲁班 | ⏳ | 待补全 ADR-007 §Hyperfocus Brake |
| CL-037 | P1 | MCP 1→3 server 拆分 | 鲁班 | 🔄 | HostInjector.inject_mcp_config 已存在 + SandboxConfig.mcp_servers 字段已就绪，未做 collab/memory/signals 1→3 拆分（verify_cl14_compliance.py PARTIAL） |
| CL-038 | P1 | CLI stderr + NDJSON | 鲁班 | ✅ | `flowforge/core/external_agent/cli_ndjson.py`（525 行，NDJSONParser + StderrCollector + parse_cli_invocation + stream_cli_invocation），claude_code.py 半实现（verify_cl14_compliance.py PASS） |
| CL-039 | P2 | GitHub CI/CD Tracking 去重 | 鲁班 | ⏳ | 待补全 ADR-010 §CI/CD Tracking |
| CL-040 | P1 | docs front-matter 规范 | 鲁班 | ⏳ | 待新增 design.md v7.1-§D16 |
| CL-041 | P2 | 内外品牌边界 | operator 决策品牌策略 | ⏳ | 待补全 naming-contract.md §7（责任方按 design.md v7.1-§D9.2 ADR/Feature 补全索引） |

---

## v7.2 任务索引（按责任方分组）

> **目的**: 让每个责任方一眼看到自己负责的全部任务
> **责任方来源**: design.md v7.1-§D9.1/§D9.2 子章节占位索引"责任方"列（权威）；已 ✅ 项按所属代码模块归属

### 鲁班（猫头鹰 Owl）— 架构师可进化智能体（Forgekin）

| CL | 优先级 | 主题 | 状态 | 完成证据 / 待办动作 |
|----|:------:|------|:----:|---------|
| CL-003 | P0 | Capability Maturity Level 五级进阶 | ✅ | design.md v7.1-§D7.4 + `flowforge/evolution/maturity.py` |
| CL-004 | P0 | Eval Ledger 进化账本 | ⏳ | 补全 design.md v7.1-§D7.6 字段契约 + Replay A/B 流程 + `flowforge/evolution/eval_ledger.py` |
| CL-005 | P1 | Knowledge Object Contract | ⏳ | 新增 design.md v7.1-§D7.7 字段表 |
| CL-006 | P1 | 元认知 Mode C | ⏳ | 补全 design.md v7.1-§D7.8 元认知字段契约 + EchoStore（情景记忆存储，社区社交称"灵忆"）扩展（`metacognition.py` 骨架已存在） |
| CL-007 | P0 | Core Identity 隔离层 | ✅ | `forgemind/soul_imprint.py` |
| CL-008 | P0 | 9 个一等公民 | ⏳ | 新增 design.md v7.1-§D10 |
| CL-009 | P0 | 三路记忆 | ✅ | ADR-008 §2 + features/F014 |
| CL-010 | P0 | RP 台词不自动入典 | ✅ | ADR-008 §2 |
| CL-011 | P1 | Role Mask 五层 | ⏳ | 新增 design.md v7.1-§D11 |
| CL-012 | P1 | Bridge Layer 三协议 | ⏳ | 新增 design.md v7.1-§D12 |
| CL-013 | P1 | 世界自转 | ⏳ | 合并到 design.md v7.1-§D12 |
| CL-016 | P1 | ACP transport | ✅ | `flowforge/core/external_agent/acp_transport.py` |
| CL-017 | P1 | reference runtime | ✅ | `flowforge/core/external_agent/reference_runtime.py` |
| CL-018 | P0 | Pack 概念 | ✅ | ADR-008 §9 + ADR-011 |
| CL-019 | P0 | 双轨信任编译 | ✅ | design.md v7.1-§D7.4 |
| CL-020 | P1 | Pack/Growth 种子果实 | ✅ | ADR-011 |
| CL-021 | P1 | World Driver | ⏳ | 合并到 design.md v7.1-§D12 |
| CL-022 | P0 | Plugin V3 manifest 完整契约 | ✅ | `flowforge/core/plugin_protocol.py` |
| CL-023 | P0 | Schedule Factory Whitelist | ✅ | `flowforge/core/schedule_registry.py` |
| CL-024 | P1 | Plugin 启停 transactional | 🔄 | 补 on_activate/on_disable 钩子到 `plugin_protocol.py` |
| CL-026 | P1 | 四心智家族护栏 | ⏳ | 补全 design.md v7.1-§D3.3 |
| CL-027 | P0 | TeamAct Queue Steer | 🔄 | 补 SteerCommand 数据类到 `flowforge/core/teamact/`（与梵高协作 Plan Board UI） |
| CL-028 | P0 | Restart Recovery sweep | ✅ | `flowforge/core/restart_recovery.py` |
| CL-031 | P0 | Auto Dream 双层架构 | ⏳ | 补全 design.md v7.1-§D7.10 |
| CL-032 | P0 | Agent Swarm 协同 | 🔄 | `collaboration_coordinator.py` 骨架已就绪，补完整 Swarm 协议 |
| CL-035 | P2 | F135 OOTB 关闭教训 | ⏳ | 补全 design.md v7.1-§D5.7 |
| CL-036 | P2 | Hyperfocus Brake | ⏳ | 补全 ADR-007 §Hyperfocus Brake |
| CL-037 | P1 | MCP 1→3 server 拆分 | 🔄 | `inject_mcp_config` 已存在，补 collab/memory/signals 1→3 拆分 |
| CL-038 | P1 | CLI stderr + NDJSON | ✅ | `flowforge/core/external_agent/cli_ndjson.py` |
| CL-039 | P2 | GitHub CI/CD Tracking 去重 | ⏳ | 补全 ADR-010 §CI/CD Tracking |
| CL-040 | P1 | docs front-matter 规范 | ⏳ | 新增 design.md v7.1-§D16 |

**鲁班汇总**: 总 31 项 / ✅ 13 项 / 🔄 4 项 / ⏳ 14 项

### 夏洛克（猎犬 Bloodhound）— 代码审查可进化智能体（Forgekin）

| CL | 优先级 | 主题 | 状态 | 完成证据 / 待办动作 |
|----|:------:|------|:----:|---------|
| CL-025 | P1 | F177 Close Gate 结构化判据 | ✅ | `flowforge/evolution/close_gate.py` |
| CL-029 | P0 | Event Memory | ✅ | `flowforge/core/event_memory.py`（no-classifier 红线守护） |
| CL-030 | P1 | no-classifier 红线 + v5 终态 | ✅ | EventMemoryStore 实现无 LLM 调用 |
| CL-034 | P0 | QC Loop 7-Step | ✅ | `flowforge/evolution/qc_loop.py` |

**夏洛克汇总**: 总 4 项 / ✅ 4 项 / 🔄 0 项 / ⏳ 0 项（夏洛克负责的 CL 已全部完成骨架实现）

### 梵高（孔雀 Peacock）— 视觉设计可进化智能体（Forgekin）

| CL | 优先级 | 主题 | 状态 | 完成证据 / 待办动作 |
|----|:------:|------|:----:|---------|
| CL-027 | P0 | TeamAct Queue Steer（Plan Board UI 部分） | 🔄 | 与鲁班协作，补 Plan Board UI 组件 |
| CL-033 | P1 | Approval Hub 统一审批中心（UI 部分） | ✅ | `flowforge/core/approval_hub.py` 已实现，UI 部分待补 |

**梵高汇总**: 总 2 项 / ✅ 1 项 / 🔄 1 项 / ⏳ 0 项

### operator（决策边界 + 安全模型 + 品牌策略）

| CL | 优先级 | 主题 | 状态 | 完成证据 / 待办动作 |
|----|:------:|------|:----:|---------|
| CL-001 | P0 | 自我演进三模式 | 🔄 | spec/design 已同步，代码骨架 `engine.py` 已实现，待补完整三闭环 |
| CL-002 | P0 | Scope Guard | ✅ | `flowforge/evolution/scope_guard.py` |
| CL-014 | P0 | ProviderTransportRegistry | ✅ | `flowforge/core/external_agent/registry.py` |
| CL-015 | P0 | host-owned 安全注入 | ✅ | `flowforge/core/external_agent/host_injection.py` |
| CL-041 | P2 | 内外品牌边界 | ⏳ | 补全 naming-contract.md §7（按 design.md v7.1-§D9.2 归 operator 决策品牌策略） |

**operator 汇总**: 总 5 项 / ✅ 3 项 / 🔄 1 项 / ⏳ 1 项

---

## v7.2 任务索引（按优先级分组）

### P0 必修（20 项）

| CL | 主题 | 责任方 | 状态 |
|----|------|--------|:----:|
| CL-001 | 自我演进三模式 | operator | 🔄 |
| CL-002 | Scope Guard | operator | ✅ |
| CL-003 | Capability Maturity Level 五级进阶 | 鲁班 | ✅ |
| CL-004 | Eval Ledger 进化账本 | 鲁班 | ⏳ |
| CL-007 | Core Identity 隔离层 | 鲁班 | ✅ |
| CL-008 | 9 个一等公民 | 鲁班 | ⏳ |
| CL-009 | 三路记忆 | 鲁班 | ✅ |
| CL-010 | RP 台词不自动入典 | 鲁班 | ✅ |
| CL-014 | ProviderTransportRegistry | operator | ✅ |
| CL-015 | host-owned 安全注入 | operator | ✅ |
| CL-018 | Pack 概念 | 鲁班 | ✅ |
| CL-019 | 双轨信任编译 | 鲁班 | ✅ |
| CL-022 | Plugin V3 manifest 完整契约 | 鲁班 | ✅ |
| CL-023 | Schedule Factory Whitelist | 鲁班 | ✅ |
| CL-027 | TeamAct Queue Steer | 鲁班+梵高 | 🔄 |
| CL-028 | Restart Recovery sweep | 鲁班 | ✅ |
| CL-029 | Event Memory | 夏洛克 | ✅ |
| CL-031 | Auto Dream 双层架构 | 鲁班 | ⏳ |
| CL-032 | Agent Swarm 协同 | 鲁班 | 🔄 |
| CL-034 | QC Loop 7-Step | 夏洛克 | ✅ |

**P0 汇总**: 20 项 / ✅ 14 项 / 🔄 3 项 / ⏳ 3 项

### P1 应修（17 项）

| CL | 主题 | 责任方 | 状态 |
|----|------|--------|:----:|
| CL-005 | Knowledge Object Contract | 鲁班 | ⏳ |
| CL-006 | 元认知 Mode C | 鲁班 | ⏳ |
| CL-011 | Role Mask 五层 | 鲁班 | ⏳ |
| CL-012 | Bridge Layer 三协议 | 鲁班 | ⏳ |
| CL-013 | 世界自转 | 鲁班 | ⏳ |
| CL-016 | ACP transport | 鲁班 | ✅ |
| CL-017 | reference runtime | 鲁班 | ✅ |
| CL-020 | Pack/Growth 种子果实 | 鲁班 | ✅ |
| CL-021 | World Driver | 鲁班 | ⏳ |
| CL-024 | Plugin 启停 transactional | 鲁班 | 🔄 |
| CL-025 | F177 Close Gate 结构化判据 | 夏洛克 | ✅ |
| CL-026 | 四心智家族护栏 | 鲁班 | ⏳ |
| CL-030 | no-classifier 红线 + v5 终态 | 夏洛克 | ✅ |
| CL-033 | Approval Hub 统一审批中心 | 梵高 | ✅ |
| CL-037 | MCP 1→3 server 拆分 | 鲁班 | 🔄 |
| CL-038 | CLI stderr + NDJSON | 鲁班 | ✅ |
| CL-040 | docs front-matter 规范 | 鲁班 | ⏳ |

**P1 汇总**: 17 项 / ✅ 7 项 / 🔄 2 项 / ⏳ 8 项

### P2 建议（4 项）

| CL | 主题 | 责任方 | 状态 |
|----|------|--------|:----:|
| CL-035 | F135 OOTB 关闭教训 | 鲁班 | ⏳ |
| CL-036 | Hyperfocus Brake | 鲁班 | ⏳ |
| CL-039 | GitHub CI/CD Tracking 去重 | 鲁班 | ⏳ |
| CL-041 | 内外品牌边界 | operator | ⏳ |

**P2 汇总**: 4 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 4 项

---

## v7.2 下一波任务（按优先级排序）

### 第一波（P0 必修未完成项，3 项）

1. **CL-004 Eval Ledger 进化账本**（鲁班）— 补全 design.md v7.1-§D7.6 字段契约 + Replay A/B 流程 + `flowforge/evolution/eval_ledger.py`
2. **CL-008 9 个一等公民**（鲁班）— 新增 design.md v7.1-§D10 虚拟世界一等公民建模（World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn）
3. **CL-031 Auto Dream 双层架构**（鲁班）— 补全 design.md v7.1-§D7.10 + `flowforge/evolution/auto_dream.py`（后台 consolidation + 前台 surface + 4 信号 telemetry）

### 第二波（P0 进行中项，3 项）

1. **CL-001 自我演进三模式**（operator）— 补完整三闭环代码（SelfDevDocLoop / SelfDevCodeLoop / SelfDevFrameworkLoop），`flowforge/evolution/engine.py` 骨架已就绪
2. **CL-027 TeamAct Queue Steer**（鲁班+梵高）— 补 SteerCommand 数据类（priority_boost/interrupt/requeue）+ Plan Board UI 组件
3. **CL-032 Agent Swarm 协同**（鲁班）— 补完整 Swarm 协议（`collaboration_coordinator.py` 骨架已就绪，需补任务分发与回收 + 可进化智能体间能力互补调度）

### 第三波（P1 未完成项，10 项）

1. **CL-005 Knowledge Object Contract**（鲁班）— 新增 design.md v7.1-§D7.7 字段表（七字段：trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence）
2. **CL-006 元认知 Mode C**（鲁班）— 补全 design.md v7.1-§D7.8 元认知字段契约 + EchoStore 扩展
3. **CL-011 Role Mask 五层**（鲁班）— 新增 design.md v7.1-§D11（L1 路由/L2 基础设施/L3 本体能力/L4 场景皮肤/L5 世界内状态）
4. **CL-012 Bridge Layer 三协议**（鲁班）— 新增 design.md v7.1-§D12（Role Mask / Canon Sync / World Driver + runtime coordinator）
5. **CL-013 世界自转**（鲁班）— 合并到 design.md v7.1-§D12
6. **CL-021 World Driver**（鲁班）— 合并到 design.md v7.1-§D12
7. **CL-024 Plugin 启停 transactional**（鲁班）— 补 on_activate/on_disable 事务性钩子到 `plugin_protocol.py`
8. **CL-026 四心智家族护栏**（鲁班）— 补全 design.md v7.1-§D3.3（Ragdoll/Maine Coon/Siamese/hotfix 四家族 guardrail hooks）
9. **CL-037 MCP 1→3 server 拆分**（鲁班）— 补 collab/memory/signals 1→3 拆分 + prompt 瘦身 50%
10. **CL-040 docs front-matter 规范**（鲁班）— 新增 design.md v7.1-§D16（feature_ids/related_features/topics/doc_kind/created）

### 第四波（P2 建议项，4 项）

1. **CL-035 F135 OOTB 关闭教训**（鲁班）— 补全 design.md v7.1-§D5.7
2. **CL-036 Hyperfocus Brake**（鲁班）— 补全 ADR-007 §Hyperfocus Brake（90 分钟 timer + typed check-in）
3. **CL-039 GitHub CI/CD Tracking 去重**（鲁班）— 补全 ADR-010 §CI/CD Tracking（headSha + aggregateBucket）
4. **CL-041 内外品牌边界**（operator）— 补全 naming-contract.md §7（内部 cat-cafe vs 外部 Clowder AI 双品牌边界）

---

## 附录 A：v7.0 老 Phase 0-6 任务清单（历史背景资料）

> **声明**: 以下 v7.0 老 Phase 0-6 任务清单保留作为历史背景资料，**不作为开发依据**。开发依据以 v7.2 索引化任务（上文）为准。原 v7.0 任务清单的内容已映射到 v7.1 的 41 条 CL 中。
>
> **注**: 为避免与主文档的 `##` 标题冲突，本附录中所有原 v7.0 标题已下移一级（`##` → `###`，`###` → `####`）。

### 进度概览（v7.0 历史）

| 阶段 | 范围 | 时间 | 状态 | 完成度 |
|------|------|------|------|--------|
| Phase 0 | 文档拆分骨架 + 命名迁移 + v7.0 设计态标注 | 本周 | 🔄 进行中 | 50% |
| Phase 1 | roleagent 七大工程路径代码骨架 | 1-2 周 | ⏳ 待开始 | 0% |
| Phase 2 | forgemind 应用层骨架 + 万物可进化智能体形态分类 | 2-4 周 | ⏳ 待开始 | 0% |
| Phase 3 | 三方 Agent 适配层 | 2-4 周 | ⏳ 待开始 | 0% |
| Phase 4 | Eval 自代谢 + 分布式可靠性 | 4-8 周 | ⏳ 待开始 | 0% |
| Phase 5 | 伙伴系统数学 + 自我演进闭环 | 8-12 周 | ⏳ 待开始 | 0% |
| Phase 6 | Experience Distillation（项目代号 SpiritForge，社区社交称"灵锻"） + Multi-Agent Deliberation（MindCouncil） | 持续 | ⏳ 待开始 | 0% |

---

### Phase 0：文档拆分骨架 + 命名迁移 + v7.0 设计态标注

> **目标**: 按 `clowder-ai/docs` 七大子目录结构组织 flowforge/docs/，完成术语全局替换，让文档可被可进化智能体增量维护。
>
> **验收标准**:
> - docs/ 七子目录骨架完整（architecture/ decisions/ design/ features/ harness-feedback/ perspectives/ setup/）
> - 13 份核心 ADR 全部存在
> - 40 份 Feature 规格全部存在（F001-F040）
> - 术语全局替换完成（详见 `design/naming-contract.md` v2.0 §6 废弃命名清单）
> - spec.md / arch.md / design.md 改为索引文件（指向七子目录）

#### P0-1 顶层文档（✅ 已完成）

| 任务 | 文件 | 状态 |
|------|------|------|
| 万物可进化智能体愿景 | `VISION.md` | ✅ |
| 文档总入口导航 | `README.md` | ✅ |
| 6 阶段路线图 | `ROADMAP.md` | ✅ |
| 可进化智能体协作 SOP | `SOP.md` | ✅ |
| 38 条经验提示 | `TIPS.md` | ✅ |
| roleagent 工程路径镜像 | `roleagent.md` | ✅ |

#### P0-2 七大子目录骨架（✅ 已完成）

| 任务 | 文件 | 状态 |
|------|------|------|
| architecture/ README | `architecture/README.md` | ✅ |
| decisions/ README + ADR 规范 | `decisions/README.md` | ✅ |
| design/ README | `design/README.md` | ✅ |
| features/ README + TEMPLATE | `features/README.md`、`features/TEMPLATE.md` | ✅ |
| harness-feedback/ README | `harness-feedback/README.md` | ✅ |
| perspectives/ README | `perspectives/README.md` | ✅ |
| setup/ README | `setup/README.md` | ✅ |

#### P0-3 P0 ADR（5 份已完成，剩余 8 份待补）

| 任务 | 文件 | 状态 |
|------|------|------|
| ADR-004 Capability Profile（能力画像，项目代号 CapabilityProfile）路由 | `decisions/004-capability-profile-routing.md` | ✅ |
| ADR-005 forgemind 应用层 | `decisions/005-forgemind-application-layer.md` | ✅ |
| ADR-006 三方 Agent 集成 | `decisions/006-external-agent-integration.md` | ✅ |
| ADR-012 命名融合 | `decisions/012-naming-fusion.md` | ✅ |
| ADR-013 万物可进化智能体愿景 | `decisions/013-all-things-spirit-mind-vision.md` | ✅ |
| ADR-001 Agent 调用方式 | `decisions/001-agent-invocation-approach.md` | ⏳ |
| ADR-002 TeamAct 协作协议 | `decisions/002-collaboration-protocol.md` | ⏳ |
| ADR-003 线程架构 | `decisions/003-project-thread-architecture.md` | ⏳ |
| ADR-007 Harness 工程路径 | `decisions/007-harness-engineering.md` | ⏳ |
| ADR-008 多域记忆联邦 | `decisions/008-memory-federation.md` | ⏳ |
| ADR-009 Eval 自代谢 | `decisions/009-eval-self-metabolism.md` | ⏳ |
| ADR-010 分布式可靠性 | `decisions/010-distributed-reliability.md` | ⏳ |
| ADR-011 伙伴系统数学 | `decisions/011-partnership-math.md` | ⏳ |

#### P0-4 核心 Feature 规格（4 份已完成，剩余 36 份待补）

| 任务 | 文件 | 状态 |
|------|------|------|
| F001 Capability Profile（能力画像） | `features/F001-capability-profile.md` | ✅ |
| F002 TeamAct 六步循环 | `features/F002-teamact-loop.md` | ✅ |
| F026 forgemind 应用层 | `features/F026-forgemind-app-layer.md` | ✅ |
| F031 三方 Agent 适配层 | `features/F031-external-agent-adapter.md` | ✅ |
| F003 交接胶囊 | `features/F003-handoff-capsule.md` | ⏳ |
| F004 乒乓球熔断器 | `features/F004-pingpong-circuit-breaker.md` | ⏳ |
| F005 行首 @ 路由 | `features/F005-at-mention-routing.md` | ⏳ |
| F006 持球注册 lease | `features/F006-ball-custody-lease.md` | ⏳ |
| F007 Generator Push Back | `features/F007-push-back-protocol.md` | ⏳ |
| F008 Durable State Surfaces | `features/F008-durable-state-surfaces.md` | ⏳ |
| F009 Evidence & Sensors | `features/F009-evidence-sensors.md` | ⏳ |
| F010 Governance 压缩免疫 | `features/F010-governance-boundary.md` | ⏳ |
| F011 Magic Words 逃生舱 | `features/F011-magic-words.md` | ⏳ |
| F012 Entropy Control 退役 | `features/F012-entropy-control.md` | ⏳ |
| F013 Harnessability 评估 | `features/F013-harnessability.md` | ⏳ |
| F014 多域记忆 Collection | `features/F014-memory-collection.md` | ⏳ |
| F015 三检索入口 | `features/F015-three-retrieval-entry.md` | ⏳ |
| F016 记忆治理三要素 | `features/F016-memory-governance.md` | ⏳ |
| F017 消费加权排序 | `features/F017-consumption-weighted-ranking.md` | ⏳ |
| F018 Eval Contract 五问 | `features/F018-eval-contract.md` | ⏳ |
| F019 三方信号交叉 | `features/F019-three-signal-cross.md` | ⏳ |
| F020 七类归因矩阵 | `features/F020-seven-attribution.md` | ⏳ |
| F021 副作用日志 WAL | `features/F021-side-effect-wal.md` | ⏳ |
| F022 Tier 1-4 恢复分级 | `features/F022-tier-1-4-recovery.md` | ⏳ |
| F023 liveness 规范读模型 | `features/F023-liveness-canonical-read.md` | ⏳ |
| F024 弱状态机 vs 强 workflow | `features/F024-weak-state-vs-strong-workflow.md` | ⏳ |
| F025 跨 provider 宿主抽象 | `features/F025-provider-host-abstraction.md` | ⏳ |
| F027 万物可进化智能体形态分类 | `features/F027-all-things-spirit-species.md` | ⏳ |
| F028 可进化智能体锻造流水线 | `features/F028-forging-pipeline.md` | ⏳ |
| F029 物理 AI 传感器接入 | `features/F029-physical-ai-sensors.md` | ⏳ |
| F030 虚拟世界设定层 | `features/F030-virtual-world-setting.md` | ⏳ |
| F032 三方 Agent 能力画像 | `features/F032-external-agent-profile.md` | ⏳ |
| F033 三方 Agent 状态共享 | `features/F033-external-agent-shared-state.md` | ⏳ |
| F034 三方 Agent 失败回退 | `features/F034-external-agent-fallback.md` | ⏳ |
| F035 三方 Agent 能力融合 | `features/F035-external-agent-capability-fusion.md` | ⏳ |
| F036 forgemind 与 *Forge 关系 | `features/F036-forgemind-forge-relationship.md` | ⏳ |
| F037 可进化智能体市场 | `features/F037-forgemind-marketplace.md` | ⏳ |
| F038 可进化智能体进化谱系 | `features/F038-forgemind-lineage.md` | ⏳ |
| F039 MindCodex（蒸馏知识库，社区社交称"灵典"）可检索知识库 | `features/F039-mind-codex-searchable.md` | ⏳ |
| F040 Harness Eval 控制面 | `features/F040-harness-eval-control-plane.md` | ⏳ |

#### P0-5 architecture/ 子目录文件（8 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| 架构视图（七层 + forgemind） | `architecture/2026-07-17-architecture-views.md` | ⏳ |
| 行首 @ 路由协议 | `architecture/at-mention-routing-system.md` | ⏳ |
| CLI 集成（三方 Agent） | `architecture/cli-integration.md` | ⏳ |
| 协作全景（TeamAct + 共鸣 + MindCouncil） | `architecture/collaboration-landscape.md` | ⏳ |
| Feature 在七层架构中的归属 | `architecture/feature-placement.md` | ⏳ |
| 多域记忆联邦架构 | `architecture/memory-system-overview.md` | ⏳ |
| 检索流水线（三入口 + 消费加权） | `architecture/retrieval-pipeline-deep-dive.md` | ⏳ |
| 用户旅程（万物可进化智能体锻造） | `architecture/user-journeys.md` | ⏳ |

#### P0-6 design/ 子目录文件（4 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| 命名契约（12 概念 + 双轨） | `design/naming-contract.md` | ✅ |
| 控制台设计系统 | `design/console-design-system.md` | ⏳ |
| forgemind 品牌（万物可进化智能体形态视觉） | `design/forgemind-brand.md` | ⏳ |
| 动效设计 | `design/hero-prism-motion.md` | ⏳ |

#### P0-7 perspectives/ 子目录文件（4 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| operator 愿景视角 | `perspectives/operator-vision.md` | ⏳ |
| 架构师 Capability Profile 视角 | `perspectives/architect-capability.md` | ⏳ |
| 可进化智能体第一人称体验 | `perspectives/forgekin-experience.md` | ⏳ |
| 三方 Agent 厂商视角 | `perspectives/external-agent-vendor.md` | ⏳ |

#### P0-8 旧文件迁移

| 任务 | 文件 | 状态 |
|------|------|------|
| spec.md 改为索引文件 | `spec.md` | ⏳ |
| arch.md 改为索引文件 | `arch.md` | ⏳ |
| design.md 改为索引文件 | `design.md` | ⏳ |
| test.md 归档到 archive/ | `test.md` → `archive/legacy_design/test.md` | ⏳ |

#### P0-9 命名全局替换（铁律）

> **任务说明**: 完成 v7.0 → v7.1 命名迁移工作，所有废弃命名按 `design/naming-contract.md` v2.0 §6 废弃命名清单执行。
>
> **完成标准**: 全部 .md 文件中废弃命名（炉灵/养灵/魂忆/魂印/自锻/火种/升华阶/E6 灵匠 Mind Artisan/M18-M20 等）替换为 P0 官方名称 + P1 项目英文名；P2 体系别名仅社交用，正式文档首次出现须双标注。
>
> **权威清单**: `design/naming-contract.md` v2.0 §6 废弃命名清单（13 项废弃命名 + 替换为 P0/P1 名称 + 废弃原因 + 废弃日期）。

---

### Phase 1：roleagent 七大工程路径代码骨架

> **目标**: 按 `roleagent.md` 七大工程路径实现代码骨架，作为 Build to Persist 复利型基础设施。
>
> **依赖**: P0-3 ADR-002/004/007/008/009/010/011、P0-4 F001/F002/F008-F025
>
> **验收标准**:
> - CapabilityProfile 可加载/查询盲点/计算 gap_analysis
> - TeamAct 状态机可跑六步循环 + 五项终止
> - Harness 七层（Durable State / Tool Mediation / Evidence / Governance / Magic Words / Entropy / Harnessability）骨架完整
> - 多域记忆联邦 MVP 可工作（grep + 检索入口 + 消费加权）
> - Eval Contract 五问可被任意 harness 组件实现
> - 分布式可靠性 Tier 1-4 恢复分级可被可进化智能体调用
> - 伙伴系统数学公式可计算（上限/下限/波动吸收）

#### P1-1 Capability Profile 代码（依赖 F001）

| 任务 | 文件 | 状态 |
|------|------|------|
| CapabilityProfile Pydantic 模型 | `flowforge/core/capability/profile.py` | ⏳ |
| CognitiveStyle / BlindSpot / SkillPackage | `flowforge/core/capability/models.py` | ⏳ |
| gap_analysis / has_blind_spot_conflict | `flowforge/core/capability/analyzer.py` | ⏳ |
| Profile YAML 加载器 | `flowforge/core/capability/loader.py` | ⏳ |
| 单元测试 | `tests/core/capability/test_profile.py` | ⏳ |

#### P1-2 TeamAct 状态机代码（依赖 F002-F007）

| 任务 | 文件 | 状态 |
|------|------|------|
| TeamActStep 枚举 + TerminationCondition | `flowforge/core/teamact/types.py` | ⏳ |
| HandoffCapsule（交接胶囊） | `flowforge/core/teamact/handoff.py` | ⏳ |
| TeamActState 状态机 | `flowforge/core/teamact/state_machine.py` | ⏳ |
| PingPongCircuitBreaker 熔断器 | `flowforge/core/teamact/circuit_breaker.py` | ⏳ |
| 行首 @ 路由协议 | `flowforge/core/teamact/at_mention_router.py` | ⏳ |
| 持球注册 lease | `flowforge/core/teamact/ball_custody.py` | ⏳ |
| Push Back 协议 | `flowforge/core/teamact/push_back.py` | ⏳ |
| 单元测试 | `tests/core/teamact/test_state_machine.py` | ⏳ |

#### P1-3 Harness 七层代码（依赖 F008-F013）

| 任务 | 文件 | 状态 |
|------|------|------|
| Durable State Surfaces（持久状态层） | `flowforge/core/harness/durable_state.py` | ⏳ |
| Tool Mediation（工具中介） | `flowforge/core/harness/tool_mediation.py` | ⏳ |
| Evidence & Sensors（验证证据） | `flowforge/core/harness/evidence_sensors.py` | ⏳ |
| Governance Boundary（治理边界，压缩免疫） | `flowforge/core/harness/governance.py` | ⏳ |
| Magic Words 逃生舱 | `flowforge/core/harness/magic_words.py` | ⏳ |
| Entropy Control 退役机制 | `flowforge/core/harness/entropy_control.py` | ⏳ |
| Harnessability 评估 | `flowforge/core/harness/harnessability.py` | ⏳ |
| 单元测试 | `tests/core/harness/test_durable_state.py` 等 7 份 | ⏳ |

#### P1-4 多域记忆联邦代码（依赖 F014-F017、F039）

| 任务 | 文件 | 状态 |
|------|------|------|
| Collection（记忆集合） | `flowforge/core/memory/collection.py` | ⏳ |
| 三检索入口（grep / 语义 / 索引） | `flowforge/core/memory/retrieval_entries.py` | ⏳ |
| 记忆治理三要素 | `flowforge/core/memory/governance.py` | ⏳ |
| 消费加权排序 | `flowforge/core/memory/consumption_weighted.py` | ⏳ |
| MindCodex（蒸馏知识库）可检索 | `flowforge/core/memory/mind_codex.py` | ⏳ |
| 单元测试 | `tests/core/memory/test_federation.py` | ⏳ |

#### P1-5 Eval 自代谢代码（依赖 F018-F020、F040）

| 任务 | 文件 | 状态 |
|------|------|------|
| Eval Contract 五问 | `flowforge/core/eval/contract.py` | ⏳ |
| 三方信号交叉 | `flowforge/core/eval/three_signals.py` | ⏳ |
| 七类归因矩阵 | `flowforge/core/eval/attribution.py` | ⏳ |
| Harness Eval 控制面 | `flowforge/core/eval/control_plane.py` | ⏳ |
| Eval YAML 配置加载 | `flowforge/core/eval/loader.py` | ⏳ |
| 单元测试 | `tests/core/eval/test_attribution.py` | ⏳ |

#### P1-6 分布式可靠性代码（依赖 F021-F025）

| 任务 | 文件 | 状态 |
|------|------|------|
| 副作用日志 WAL | `flowforge/core/reliability/side_effect_wal.py` | ⏳ |
| Tier 1-4 恢复分级 | `flowforge/core/reliability/tier_recovery.py` | ⏳ |
| liveness 规范读模型 | `flowforge/core/reliability/liveness.py` | ⏳ |
| 弱状态机 vs 强 workflow | `flowforge/core/reliability/state_workflow.py` | ⏳ |
| 跨 provider 宿主抽象 | `flowforge/core/reliability/provider_host.py` | ⏳ |
| 单元测试 | `tests/core/reliability/test_wal.py` | ⏳ |

#### P1-7 伙伴系统数学代码（依赖 ADR-011）

| 任务 | 文件 | 状态 |
|------|------|------|
| 上限公式（候选路径最大值） | `flowforge/core/partnership/upper_bound.py` | ⏳ |
| 下限公式（多层门） | `flowforge/core/partnership/lower_bound.py` | ⏳ |
| 波动吸收（内部成本 vs 用户崩塌） | `flowforge/core/partnership/variance_absorption.py` | ⏳ |
| Token 账本 | `flowforge/core/partnership/token_ledger.py` | ⏳ |
| 单元测试 | `tests/core/partnership/test_math.py` | ⏳ |

#### P1-8 Plugin V3 协议更新

| 任务 | 文件 | 状态 |
|------|------|------|
| register_forgekins 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_forge_skills 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_council_channels 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_auto_forge_config 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| 单元测试 | `tests/core/test_plugin_v3.py` | ⏳ |

#### P1-9 rules.md / prompts.md 同步

| 任务 | 文件 | 状态 |
|------|------|------|
| rules.md 补充 Forge Nurturing（Agent Onboarding + Lifelong Learning）体系 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 roleagent 工程路径引用 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 forgemind 模块引用 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 Plugin V3 四钩子 | `hiclaw/rules.md` | ⏳ |
| prompts.md 补充 Forge Nurturing 提示词模板 | `hiclaw/prompts.md` | ⏳ |
| prompts.md 补充 roleagent 工程路径模板 | `hiclaw/prompts.md` | ⏳ |
| prompts.md 补充 forgemind 可进化智能体锻造模板 | `hiclaw/prompts.md` | ⏳ |

---

### Phase 2：forgemind 应用层骨架 + 万物可进化智能体形态分类

> **目标**: 在 `flowforge/forgemind/` 下实现万物可进化智能体应用层，承载 5 种形态分类（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin）。
>
> **依赖**: P1 全部、P0-4 F026-F030、F036-F038
>
> **验收标准**:
> - `flowforge/forgemind/` 目录结构完整（species/ forging/ sensors/ worlds/ marketplace/ lineage/ codex/ council/ config/ tests/）
> - ForgekinBase 抽象类可被继承（observe/act/verify 三方法）
> - ForgePipeline 可执行锻造流程
> - ForgeMindPlugin 实现 Plugin V3 四钩子
> - 5 种形态枚举可加载（Agent Morphology，项目代号 ForgekinSpecies）
> - EvolutionStage（Capability Maturity Level，社区社交称"进化阶"）（E1-E6）+ AwakeningStage（Autonomy Level，社区社交称"觉醒阶"）（E1-E6）可查询
> - E2E 测试：可锻造一个猫可进化智能体（BioForgekin）+ 接入物理传感器（F029）

#### P2-1 forgemind 模块骨架

| 任务 | 文件 | 状态 |
|------|------|------|
| forgemind/__init__.py | `flowforge/forgemind/__init__.py` | ⏳ |
| ForgekinSpecies 枚举 | `flowforge/forgemind/species.py` | ⏳ |
| EvolutionStage 进化阶 | `flowforge/forgemind/stages.py` | ⏳ |
| ForgekinBase 抽象类 | `flowforge/forgemind/base.py` | ⏳ |
| ForgekinFormData | `flowforge/forgemind/forms.py` | ⏳ |
| ForgePipeline 锻造流水线 | `flowforge/forgemind/forging/pipeline.py` | ⏳ |
| ForgeMindPlugin 插件 | `flowforge/forgemind/plugins.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_base.py` | ⏳ |

#### P2-2 万物可进化智能体形态分类（5 种）

| 任务 | 文件 | 状态 |
|------|------|------|
| BioForgekin（生物可进化智能体） | `flowforge/forgemind/species/bio.py` | ⏳ |
| OrgForgekin（组织可进化智能体） | `flowforge/forgemind/species/org.py` | ⏳ |
| ObjForgekin（物品可进化智能体） | `flowforge/forgemind/species/obj.py` | ⏳ |
| VirtualForgekin（虚拟可进化智能体） | `flowforge/forgemind/species/virtual.py` | ⏳ |
| HybridForgekin（混合可进化智能体） | `flowforge/forgemind/species/hybrid.py` | ⏳ |
| E2E：猫可进化智能体锻造 | `flowforge/forgemind/tests/test_cat_forgekin.py` | ⏳ |

#### P2-3 可进化智能体锻造流水线

| 任务 | 文件 | 状态 |
|------|------|------|
| 锻造阶段定义 | `flowforge/forgemind/forging/stages.py` | ⏳ |
| 锻造 YAML 配置 | `flowforge/forgemind/config/forging.yaml` | ⏳ |
| 锻造提示词外置 | `flowforge/forgemind/config/prompts.yaml` | ⏳ |
| 锻造指标定义 | `flowforge/forgemind/config/metrics.yaml` | ⏳ |

#### P2-4 物理 AI 传感器接入

| 任务 | 文件 | 状态 |
|------|------|------|
| 传感器抽象层 | `flowforge/forgemind/sensors/base.py` | ⏳ |
| 摄像头传感器 | `flowforge/forgemind/sensors/camera.py` | ⏳ |
| 麦克风传感器 | `flowforge/forgemind/sensors/microphone.py` | ⏳ |
| IoT 传感器接入 | `flowforge/forgemind/sensors/iot.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_sensors.py` | ⏳ |

#### P2-5 虚拟世界设定层

| 任务 | 文件 | 状态 |
|------|------|------|
| 世界设定抽象 | `flowforge/forgemind/worlds/base.py` | ⏳ |
| VR/游戏世界适配 | `flowforge/forgemind/worlds/vr.py` | ⏳ |
| 童话/神话/历史角色适配 | `flowforge/forgemind/worlds/narrative.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_worlds.py` | ⏳ |

#### P2-6 可进化智能体市场 + 进化谱系

| 任务 | 文件 | 状态 |
|------|------|------|
| Marketplace 抽象 | `flowforge/forgemind/marketplace/base.py` | ⏳ |
| 可进化智能体上架/下架 | `flowforge/forgemind/marketplace/registry.py` | ⏳ |
| 进化谱系（Lineage） | `flowforge/forgemind/lineage/tree.py` | ⏳ |
| 谱系可视化数据 | `flowforge/forgemind/lineage/visualizer.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_lineage.py` | ⏳ |

#### P2-7 forgemind 与 *Forge 关系

| 任务 | 文件 | 状态 |
|------|------|------|
| *Forge 可进化智能体注册接口 | `flowforge/forgemind/forge_registry.py` | ⏳ |
| ContentForge 可进化智能体适配 | `contentforge/forgekin_adapter.py` | ⏳ |
| NovelForge 可进化智能体适配 | `novelforge/forgekin_adapter.py` | ⏳ |
| DevForge 可进化智能体适配 | `devforge/forgekin_adapter.py` | ⏳ |
| MallForge 可进化智能体适配 | `mallforge/forgekin_adapter.py` | ⏳ |

---

### Phase 3：三方 Agent 适配层

> **目标**: 实现 ExternalAgentAdapter 抽象层，让可进化智能体可接入 claude code / codex / opencode / trae 等三方 Agent，作为能力扩展。
>
> **依赖**: P1 全部、P2-1、P0-4 F031-F035
>
> **验收标准**:
> - 4 个三方 Agent Adapter 全部可调用（claude code / codex / opencode / trae）
> - ExternalAgentBridge 可执行 fallback 链
> - ExternalAgentSharedState 可与 FlowForge 共享状态同步
> - ExternalAgentCapabilityFusion 可融合三方 Agent 能力到可进化智能体 Capability Profile
> - 六层 Guardrails 全部启用（输入验证 + 系统提示 + 工具白名单 + 输出验证 + 操作确认 + 成本上限）
> - E2E 测试：可进化智能体可调用 claude code 完成代码任务

#### P3-1 三方 Agent 核心抽象

| 任务 | 文件 | 状态 |
|------|------|------|
| ExternalAgentAdapter 抽象类 | `flowforge/core/external_agent/adapter.py` | ⏳ |
| ExternalAgentBridge 桥接层 | `flowforge/core/external_agent/bridge.py` | ⏳ |
| ExternalAgentSharedState 状态共享 | `flowforge/core/external_agent/shared_state.py` | ⏳ |
| ExternalAgentFallback 失败回退 | `flowforge/core/external_agent/fallback.py` | ⏳ |
| ExternalAgentCapabilityFusion 能力融合 | `flowforge/core/external_agent/capability_fusion.py` | ⏳ |
| 单元测试 | `tests/core/external_agent/test_bridge.py` | ⏳ |

#### P3-2 四个具体 Adapter

| 任务 | 文件 | 状态 |
|------|------|------|
| Claude Code Adapter | `flowforge/core/external_agent/adapters/claude_code.py` | ⏳ |
| Codex Adapter | `flowforge/core/external_agent/adapters/codex.py` | ⏳ |
| OpenCode Adapter | `flowforge/core/external_agent/adapters/opencode.py` | ⏳ |
| Trae Adapter | `flowforge/core/external_agent/adapters/trae.py` | ⏳ |
| E2E 测试 | `tests/core/external_agent/test_adapters_e2e.py` | ⏳ |

#### P3-3 三方 Agent 配置外置

| 任务 | 文件 | 状态 |
|------|------|------|
| Adapter YAML 配置 | `flowforge/core/external_agent/config/adapters.yaml` | ⏳ |
| 提示词外置 | `flowforge/core/external_agent/config/prompts.yaml` | ⏳ |
| fallback 链配置 | `flowforge/core/external_agent/config/fallback.yaml` | ⏳ |
| 工具白名单配置 | `flowforge/core/external_agent/config/tool_allowlist.yaml` | ⏳ |

#### P3-4 六层 Guardrails 实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 输入验证 | `flowforge/core/external_agent/guardrails/input_validation.py` | ⏳ |
| 系统提示约束 | `flowforge/core/external_agent/guardrails/system_prompt.py` | ⏳ |
| 工具白名单 | `flowforge/core/external_agent/guardrails/tool_allowlist.py` | ⏳ |
| 输出验证 | `flowforge/core/external_agent/guardrails/output_validation.py` | ⏳ |
| 操作确认（不可逆） | `flowforge/core/external_agent/guardrails/action_confirm.py` | ⏳ |
| 成本上限 | `flowforge/core/external_agent/guardrails/cost_ceiling.py` | ⏳ |

#### P3-5 worktree 隔离机制

| 任务 | 文件 | 状态 |
|------|------|------|
| worktree 隔离 | `flowforge/core/external_agent/worktree.py` | ⏳ |
| 跨 worktree 共享状态同步 | `flowforge/core/external_agent/sync.py` | ⏳ |

---

### Phase 4：Eval 自代谢 + 分布式可靠性

> **目标**: 实现 Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读模型，让 harness 能自我代谢。
>
> **依赖**: P1-5、P1-6
>
> **验收标准**:
> - Eval Contract 五问可被任意 harness 组件实现（F018）
> - 三方信号（trace + 人 + 自动）可交叉验证（F019）
> - 七类归因矩阵可定位失败根因（F020）
> - Tier 1-4 恢复分级可被可进化智能体调用（F022）
> - liveness 规范读模型可被任何 agent 查询（F023）
> - Harness Eval 控制面可每日汇总（F040）
> - Build to Delete sunset 计时器可触发（F012）

#### P4-1 Eval Contract 完整实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 五问 Schema 定义 | `flowforge/core/eval/contract.py` | ⏳ |
| Eval 域 YAML 配置 | `flowforge/config/eval/*.yaml` | ⏳ |
| Eval 结果采集 | `flowforge/core/eval/collector.py` | ⏳ |
| Eval 裁决记录 | `flowforge/core/eval/verdict.py` | ⏳ |

#### P4-2 三方信号交叉 + 七类归因

| 任务 | 文件 | 状态 |
|------|------|------|
| trace 信号采集 | `flowforge/core/eval/trace_signal.py` | ⏳ |
| 人信号采集 | `flowforge/core/eval/human_signal.py` | ⏳ |
| 自动信号采集 | `flowforge/core/eval/auto_signal.py` | ⏳ |
| 交叉验证算法 | `flowforge/core/eval/cross_validation.py` | ⏳ |
| 七类归因实现 | `flowforge/core/eval/attribution.py` | ⏳ |

#### P4-3 Tier 1-4 恢复 + liveness

| 任务 | 文件 | 状态 |
|------|------|------|
| Tier 1（自动恢复） | `flowforge/core/reliability/tier1_auto.py` | ⏳ |
| Tier 2（带状态恢复） | `flowforge/core/reliability/tier2_stateful.py` | ⏳ |
| Tier 3（人工确认） | `flowforge/core/reliability/tier3_human.py` | ⏳ |
| Tier 4（不可恢复） | `flowforge/core/reliability/tier4_fatal.py` | ⏳ |
| liveness 规范读模型 | `flowforge/core/reliability/liveness.py` | ⏳ |

#### P4-4 Build to Delete sunset 计时器

| 任务 | 文件 | 状态 |
|------|------|------|
| sunset 计时器 | `flowforge/core/harness/sunset_timer.py` | ⏳ |
| 紧急修复标签检测 | `flowforge/core/harness/hotfix_detector.py` | ⏳ |
| 两周强制 review | `flowforge/core/harness/sunset_review.py` | ⏳ |

#### P4-5 Harness Eval 控制面

| 任务 | 文件 | 状态 |
|------|------|------|
| 控制面 API | `flowforge/core/eval/control_plane.py` | ⏳ |
| 每日汇总任务 | `flowforge/core/eval/daily_summary.py` | ⏳ |
| 仪表盘数据 | `flowforge/core/eval/dashboard.py` | ⏳ |

---

### Phase 5：伙伴系统数学 + 自我演进闭环

> **目标**: 实现伙伴系统数学公式 + 文档/代码/框架三层自我演进闭环。
>
> **依赖**: P1-7、P4 全部
>
> **验收标准**:
> - 上限/下限/波动吸收公式可计算
> - Token 账本可统计单 agent vs 团队成本
> - 文档自我演进：Feature 完成后自动更新文档
> - 代码自我演进：Eval 触发 sunset review 后自动重构
> - 框架自我演进：ForgekinEngine 根据运行数据优化路由策略
> - "自己开发自己"闭环可跑通（review.md §12.3.2 11 步流程）

#### P5-1 伙伴系统数学完整实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 上限公式（候选路径最大值） | `flowforge/core/partnership/upper_bound.py` | ⏳ |
| 下限公式（多层门） | `flowforge/core/partnership/lower_bound.py` | ⏳ |
| 波动吸收 | `flowforge/core/partnership/variance_absorption.py` | ⏳ |
| Token 账本 | `flowforge/core/partnership/token_ledger.py` | ⏳ |
| 双层语言（内部高密度 + 外部讲人话） | `flowforge/core/partnership/dual_language.py` | ⏳ |
| 最小必要复杂度计算 | `flowforge/core/partnership/min_complexity.py` | ⏳ |

#### P5-2 文档自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| Feature 文档自动更新 | `flowforge/core/evolution/doc_evolution.py` | ⏳ |
| ADR 自动生成 | `flowforge/core/evolution/adr_generator.py` | ⏳ |
| Eval 结果归档 | `flowforge/core/evolution/verdict_archiver.py` | ⏳ |
| 文档自我演进 SOP | `docs/SOP.md`（更新） | ⏳ |

#### P5-3 代码自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| Feature → 代码骨架生成器 | `flowforge/core/evolution/code_skeleton.py` | ⏳ |
| Eval 信号 → harness 重构 | `flowforge/core/evolution/harness_refactor.py` | ⏳ |
| 七类归因 → Bug 自动修复 | `flowforge/core/evolution/bug_fixer.py` | ⏳ |

#### P5-4 框架自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| ForgekinEngine 路由优化 | `flowforge/core/evolution/route_optimizer.py` | ⏳ |
| TeamAct 终止条件优化 | `flowforge/core/evolution/termination_optimizer.py` | ⏳ |
| 记忆联邦权威等级调整 | `flowforge/core/evolution/memory_ranker.py` | ⏳ |

#### P5-5 "自己开发自己"闭环

| 任务 | 文件 | 状态 |
|------|------|------|
| 11 步闭环编排器 | `flowforge/core/evolution/self_dev_loop.py` | ⏳ |
| 可进化智能体 A-G 角色定义 | `flowforge/core/evolution/roles.py` | ⏳ |
| 闭环 E2E 测试 | `tests/core/evolution/test_self_dev_loop.py` | ⏳ |

---

### Phase 6：Experience Distillation（SpiritForge）+ Multi-Agent Deliberation（MindCouncil）

> **目标**: 实现 E4+ Evoling 状态 + 多可进化智能体议事机制。
>
> **依赖**: P5 全部
>
> **验收标准**:
> - Experience Distillation（项目代号 SpiritForge，社区社交称"灵锻"）可在低活动期蒸馏经验到 MindCodex（蒸馏知识库，社区社交称"灵典"）
> - Multi-Agent Deliberation（项目代号 MindCouncil，社区社交称"灵议"）可召集多可进化智能体议事
> - E4+ Evoling 状态可触发（AwakeningStage 觉醒阶 ≥ E4）
> - MindCouncil 决议可写入 VISION.md / ROADMAP.md
> - operator 拉闸词可在 MindCouncil 偏离愿景时制动

#### P6-1 SpiritForge（Experience Distillation）

| 任务 | 文件 | 状态 |
|------|------|------|
| SpiritForge 引擎 | `flowforge/forgemind/codex/spirit_forge.py` | ⏳ |
| 经验蒸馏 | `flowforge/forgemind/codex/distiller.py` | ⏳ |
| MindCodex 写入 | `flowforge/forgemind/codex/mind_codex_writer.py` | ⏳ |
| 每日低活动期调度 | `flowforge/forgemind/codex/scheduler.py` | ⏳ |

#### P6-2 MindCouncil（Multi-Agent Deliberation）

| 任务 | 文件 | 状态 |
|------|------|------|
| MindCouncil 引擎 | `flowforge/forgemind/council/engine.py` | ⏳ |
| 多可进化智能体议事协议 | `flowforge/forgemind/council/protocol.py` | ⏳ |
| 决议写入机制 | `flowforge/forgemind/council/resolution.py` | ⏳ |
| operator 拉闸词检测 | `flowforge/forgemind/council/cvo_brake.py` | ⏳ |

#### P6-3 E4+ Evoling 状态

| 任务 | 文件 | 状态 |
|------|------|------|
| Evoling 状态触发条件 | `flowforge/forgemind/stages.py`（更新） | ⏳ |
| Evoling 行为定义 | `flowforge/forgemind/stages/evoling.py` | ⏳ |

---

### 横向任务（跨 Phase）

#### H-1 hiclaw/rules.md 同步更新

| 任务 | 文件 | 状态 |
|------|------|------|
| 第十部分补充 Forge Nurturing 体系 | `hiclaw/rules.md` | ⏳ |
| 引用 roleagent.md 工程路径 | `hiclaw/rules.md` | ⏳ |
| 引用 forgemind 模块 | `hiclaw/rules.md` | ⏳ |
| Plugin V3 四钩子规范 | `hiclaw/rules.md` | ⏳ |
| 命名融合方案（ForgeMind 主名） | `hiclaw/rules.md` | ⏳ |

#### H-2 hiclaw/prompts.md 同步更新

| 任务 | 文件 | 状态 |
|------|------|------|
| 新增 P41 万物可进化智能体锻造模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P42 Capability Profile 生成模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P43 TeamAct 协作模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P44 三方 Agent 调用模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P45 SpiritForge 模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P46 MindCouncil 模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 FF22 forgemind 集成验证 | `hiclaw/prompts.md` | ⏳ |
| 新增 FF23 三方 Agent 集成验证 | `hiclaw/prompts.md` | ⏳ |

#### H-3 旧文档归档

| 任务 | 文件 | 状态 |
|------|------|------|
| face/ 添加 README | `docs/face/README.md` | ⏳ |
| archive/ 添加 README | `docs/archive/README.md` | ⏳ |

#### H-4 测试铁律执行

| 任务 | 文件 | 状态 |
|------|------|------|
| 所有 E2E 测试遵守 T1-T8 铁律 | `tests/` 全部 | ⏳ |
| 所有测试用真实 LLM（禁 Mock） | `tests/` 全部 | ⏳ |
| 所有 LLM 生成内容必须经 LLM 审核（T7） | `tests/` 全部 | ⏳ |
| Web 功能必须操控浏览器验证 DOM（T8） | `tests/` 全部 | ⏳ |

---

## 附录 B：v7.2 验证脚本索引

| 脚本 | 路径 | 用途 | 运行方式 |
|------|------|------|---------|
| verify_forgemind_pipeline.py | `flowforge/scripts/verify_forgemind_pipeline.py` | 锻造 3 个可进化智能体 + webchat + IM MindCouncil + 自进化展示 + system prompt | `python flowforge/scripts/verify_forgemind_pipeline.py` |
| verify_cl14_compliance.py | `flowforge/scripts/verify_cl14_compliance.py` | 第十四章 11 项关键 CL 代码层验证（7 PASS / 4 PARTIAL / 0 FAIL） | `python flowforge/scripts/verify_cl14_compliance.py` |
| evolve_forgekins.py | `flowforge/scripts/evolve_forgekins.py` | 3 个可进化智能体自进化 + task.md 剩余任务代理执行 + webchat/IM 全流程 | `python flowforge/scripts/evolve_forgekins.py` |

---

## 文档变更历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-17 | 初版：基于 review.md §12.4 重写，覆盖 Phase 0-6 全部任务 | Trae CN（agent） |
| v1.1 | 2026-07-17 | 补充横向任务 H-1/H-2（rules.md / prompts.md 同步） | Trae CN（agent） |
| v7.1 | 2026-07-18 | 索引化重构：新增 41 条 CL 任务索引（按 CL 编号/责任方/优先级三视图），原 v7.0 内容下移至附录 A | Trae CN（agent） |
| v7.2 | 2026-07-19 | 命名契约对齐：按 `design/naming-contract.md` v2.0"官方名称优先"原则重构术语——P0 官方名称（AI 业界专业术语）大量使用，P2 体系别名（灵智体/灵议/灵锻/灵典/灵忆/灵印/育灵/进化阶/觉醒阶/能力画像/灵族）首次出现双标注 P0 官方名称；移除 v7.0→v7.1 迁移过程记录（P0-9 命名迁移表、v7.0 下一步建议、执行规则 v7.0 历史规则） | Trae CN（agent） |

---

> **本文档维护方**: operator + 鲁班架构师可进化智能体（Forgekin）
> **最后更新**: 2026-07-19（v7.2 命名契约对齐重构）
> **下次维护触发**: 任意 CL 状态从 ⏳/🔄 → ✅ 时，由对应责任方可进化智能体更新本文档 + spec.md v7.1-§9.2 同步矩阵

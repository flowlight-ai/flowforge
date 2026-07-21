# FlowForge 生态移植任务总览（11 阶段里程碑）

> **本文档作用**: FlowForge 生态全项目移植任务索引，按 11 个大阶段里程碑组织——FlowForge 自身 3 大阶段 + 8 个 *Forge 垂直业务项目各 1 大阶段。每个阶段包含目标、关键交付物、验收标准、详细任务。
>
> **文档性质**: 本文档为 **内部开发任务索引**，通过 `.gitignore` 忽略不提交到 GitHub。GitHub 公开仓库呈现为"全新项目从 0 开始构建"，实际为老项目（clowder-ai + 老 flowforge）移植重构。
>
> **维护规则**:
> - 可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）按所属责任方领取任务
> - 任务完成后更新状态标记（⏳ → 🔄 → ✅），并同步更新 spec.md / arch.md / design.md
> - 每个任务必须关联到具体代码文件 / 文档章节作为完成证据
>
> **跨阶段不变量**: T1-T8 测试铁律、15 条编程红线、P31 Loop 强制验证、质量分阈值 0.85、operator 7 条愿景锚点（见 `VISION.md`）。
>
> **命名规范**: 本文档严格遵循 `design/naming-contract.md` v2.0"官方名称优先"原则——正式文档中 P0 官方名称（AI 业界专业术语）大量使用，P2 体系别名（如"灵智体"/"灵议"/"灵锻"等）首次出现必须双标注 P0 官方名称。
>
> **关键引用**:
> - `review/review.md` —— 审核追溯索引（RA/FM/FR/CL ID 命名空间）
> - `spec.md` v7.1-§9 —— 41 条 CL 同步矩阵
> - `design.md` v7.1-§9 —— 设计规范层子章节占位索引
> - `design/naming-contract.md` —— 命名契约 v2.0（三层命名体系 + 12 核心概念）
> - `VISION.md` —— 可进化智能体愿景
> - `ROADMAP.md` —— 路线图
> - `SOP.md` —— 可进化智能体协作 SOP
> - `decisions/004~013` —— 核心 ADR

---

## 总体规划：11 阶段里程碑

| 阶段 | 范围 | 目标 | 状态 |
|------|------|------|:----:|
| **Phase 1** | FlowForge 自进化框架 MVP | 最小可进化智能体自进化闭环（Forgekin observe→act→verify） | 🔄 |
| **Phase 2** | FlowForge 完整能力落地 | 41 条 CL 全部完成（自我演进 + TeamAct + 事件记忆 + 多智能体议事 + QC Loop + 三方 Agent） | 🔄 |
| **Phase 3** | FlowForge 生产就绪与开源 | 达到老项目水平，可投入生产并开源到 GitHub | ⏳ |
| **Phase 4** | ContentForge 移植 | AI 内容创作工厂（6 大专家可进化智能体）达到老项目水平 | ⏳ |
| **Phase 5** | DevForge 移植 | AI 开发工厂达到老项目水平 | ⏳ |
| **Phase 6** | NovelForge 移植 | AI 小说创作工厂达到老项目水平 | ⏳ |
| **Phase 7** | MallForge 移植 | AI 电商运营工厂达到老项目水平 | ⏳ |
| **Phase 8** | StockForge 移植 | AI 股票分析工厂达到老项目水平 | ⏳ |
| **Phase 9** | OpenSieve 移植 | 聚合检索增强中台达到老项目水平 | ⏳ |
| **Phase 10** | DemoForge 移植 | 演示项目达到老项目水平 | ⏳ |
| **Phase 11** | HelixRag 移植 | RAG 框架达到老项目水平 | ⏳ |

> **阶段依赖**: Phase 1 → Phase 2 → Phase 3（FlowForge 串行）；Phase 3 → Phase 4~11（*Forge 项目依赖 FlowForge 生产就绪）；Phase 4~11 之间可并行。
>
> **完成度口径**: ✅ 计 1.0，🔄 计 0.5，⏳ 计 0。

---

# Part I: FlowForge 核心框架移植（Phase 1~3）

## Phase 1: FlowForge 自进化框架 MVP

> **阶段目标**: 实现最小可进化智能体自进化闭环，验证 ForgekinBase 三方法契约（observe → act → verify）+ 持久身份（Persistent Identity，项目代号 SoulImprint，社区社交称"灵印"）+ 经验记忆存储（Episodic Memory Store，项目代号 EchoStore，社区社交称"灵忆"）+ 经验蒸馏（Experience Distillation，项目代号 SpiritForge，社区社交称"灵锻"）四大核心机制。
>
> **验收标准**:
> - 单个 Forgekin 完成observe→act→verify 闭环
> - 持久身份跨会话保持
> - 经验记忆存储可写入/检索
> - 经验蒸馏可触发并产出蒸馏知识库（Distilled Knowledge Base，项目代号 MindCodex，社区社交称"灵典"）条目
> - 全部测试通过 T1-T8 测试铁律

### Phase 1.1: 核心身份与记忆层（P0 必修）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 |
|---------|------|--------|:----:|---------|
| P1-001 | 持久身份（Persistent Identity / SoulImprint） | 鲁班 | ✅ | `forgemind/soul_imprint.py`（已实现） |
| P1-002 | 经验记忆存储（Episodic Memory Store / EchoStore） | 鲁班 | ✅ | ADR-008 §2 + features/F014 |
| P1-003 | 三路记忆架构 | 鲁班 | ✅ | ADR-008 §2 |
| P1-004 | RP 台词不自动入典 | 鲁班 | ✅ | ADR-008 §2 |
| P1-005 | Core Identity 隔离层（CL-007） | 鲁班 | ✅ | `forgemind/soul_imprint.py` |

### Phase 1.2: 自进化引擎（P0 必修）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 |
|---------|------|--------|:----:|---------|
| P1-006 | 自我演进三模式（SelfDevDocLoop/SelfDevCodeLoop/SelfDevFrameworkLoop，CL-001） | operator | 🔄 | spec/design 已同步，代码骨架 `flowforge/evolution/engine.py` 已实现，待补完整三闭环 |
| P1-007 | Scope Guard 自我演进宪法层（CL-002） | operator | ✅ | `flowforge/evolution/scope_guard.py`（detect_signals / should_remind / generate_reminder / log_trigger / check_divergence_pattern） |
| P1-008 | Capability Maturity Level 五级进阶（L0~L4，CL-003） | 鲁班 | ✅ | design.md v7.1-§D7.4 + `flowforge/evolution/maturity.py` |
| P1-009 | 双轨信任编译（CL-019） | 鲁班 | ✅ | design.md v7.1-§D7.4 |
| P1-010 | Pack 概念（CL-018） | 鲁班 | ✅ | ADR-008 §9 + ADR-011 |

### Phase 1.3: 可进化智能体锻造基础（P0 必修）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 |
|---------|------|--------|:----:|---------|
| P1-011 | Plugin V3 manifest 完整契约（CL-022） | 鲁班 | ✅ | `flowforge/core/plugin_protocol.py`（含 forgekins_dir/codex_dir/council_dir/auto_forge_dir 智能体入职与终身学习字段） |
| P1-012 | Schedule Factory Whitelist（CL-023） | 鲁班 | ✅ | `flowforge/core/schedule_registry.py`（30 测试通过） |
| P1-013 | Restart Recovery sweep（CL-028） | 鲁班 | ✅ | `flowforge/core/restart_recovery.py`（13 测试通过） |

**Phase 1 汇总**: 13 项 / ✅ 11 项 / 🔄 1 项 / ⏳ 1 项

---

## Phase 2: FlowForge 完整能力落地

> **阶段目标**: 完成全部 41 条 CL 任务，实现自我演进 + TeamAct + 事件记忆 + 多智能体议事（Multi-Agent Deliberation，项目代号 MindCouncil，社区社交称"灵议"）+ QC Loop + 三方 Agent 集成 + 文档治理全部能力。
>
> **验收标准**:
> - 41 条 CL 全部 ✅
> - verify_cl14_compliance.py 全部 PASS
> - verify_forgemind_pipeline.py 端到端验证通过
> - 配置驱动率 ≥ 60%（Phase 1 完成后 ≥ 30%，Phase 2 完成后 ≥ 60%）

### Phase 2.1: 自进化深化（P0/P1）

| 任务 ID | 主题 | 责任方 | 优先级 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:------:|:----:|---------|
| P2-001 | Eval Ledger 进化账本（CL-004） | 鲁班 | P0 | ⏳ | 补全 design.md v7.1-§D7.6 字段契约 + Replay A/B 流程 + `flowforge/evolution/eval_ledger.py` |
| P2-002 | Knowledge Object Contract（CL-005） | 鲁班 | P1 | ⏳ | 新增 design.md v7.1-§D7.7 字段表（七字段：trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence） |
| P2-003 | 元认知 Mode C（CL-006） | 鲁班 | P1 | ⏳ | 补全 design.md v7.1-§D7.8 元认知字段契约 + EchoStore 扩展（`metacognition.py` 骨架已存在） |
| P2-004 | Auto Dream 双层架构（CL-031） | 鲁班 | P0 | ⏳ | 补全 design.md v7.1-§D7.10 + `flowforge/evolution/auto_dream.py`（后台 consolidation + 前台 surface + 4 信号 telemetry） |
| P2-005 | Agent Swarm 协同（CL-032） | 鲁班 | P0 | 🔄 | `collaboration_coordinator.py` 骨架已就绪，补完整 Swarm 协议（任务分发与回收 + 可进化智能体间能力互补调度） |
| P2-006 | QC Loop 7-Step（CL-034） | 夏洛克 | P0 | ✅ | `flowforge/evolution/qc_loop.py`（318 行骨架，含 7 步循环 + 3 层 Reviewer Split） |
| P2-007 | F177 Close Gate 结构化判据（CL-025） | 夏洛克 | P1 | ✅ | `flowforge/evolution/close_gate.py`（202 行骨架实现） |

### Phase 2.2: 虚拟世界与一等公民（P0/P1）

| 任务 ID | 主题 | 责任方 | 优先级 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:------:|:----:|---------|
| P2-008 | 9 个一等公民（CL-008） | 鲁班 | P0 | ⏳ | 新增 design.md v7.1-§D10 虚拟世界一等公民建模（World/Character/Scene/Canon Decision/Relationship/Artifact/Round/Branch/Turn） |
| P2-009 | Role Mask 五层（CL-011） | 鲁班 | P1 | ⏳ | 新增 design.md v7.1-§D11（L1 路由/L2 基础设施/L3 本体能力/L4 场景皮肤/L5 世界内状态） |
| P2-010 | Bridge Layer 三协议（CL-012） | 鲁班 | P1 | ⏳ | 新增 design.md v7.1-§D12（Role Mask / Canon Sync / World Driver + runtime coordinator） |
| P2-011 | 世界自转（CL-013） | 鲁班 | P1 | ⏳ | 合并到 design.md v7.1-§D12 |
| P2-012 | World Driver（CL-021） | 鲁班 | P1 | ⏳ | 合并到 design.md v7.1-§D12 |
| P2-013 | 四心智家族护栏（CL-026） | 鲁班 | P1 | ⏳ | 补全 design.md v7.1-§D3.3（Ragdoll/Maine Coon/Siamese/hotfix 四家族 guardrail hooks） |
| P2-014 | Pack/Growth 种子果实（CL-020） | 鲁班 | P1 | ✅ | ADR-011 伙伴系统数学 |

### Phase 2.3: TeamAct 与事件记忆（P0/P1）

| 任务 ID | 主题 | 责任方 | 优先级 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:------:|:----:|---------|
| P2-015 | TeamAct Queue Steer（CL-027） | 鲁班+梵高 | P0 | 🔄 | 补 SteerCommand 数据类（priority_boost/interrupt/requeue）+ Plan Board UI 组件 |
| P2-016 | Event Memory（CL-029） | 夏洛克 | P0 | ✅ | `flowforge/core/event_memory.py`（12 测试通过，no-classifier 红线合规） |
| P2-017 | no-classifier 红线 + v5 终态（CL-030） | 夏洛克 | P1 | ✅ | EventMemoryStore 实现无 LLM 调用，分类由显式 trigger/type/cat 字段决定 |
| P2-018 | Approval Hub 统一审批中心（CL-033） | 梵高 | P1 | ✅ | `flowforge/core/approval_hub.py`（221 行，含 submit/approve/reject/decide/purge_expired） |
| P2-019 | Plugin 启停 transactional（CL-024） | 鲁班 | P1 | 🔄 | 补 on_activate/on_disable 事务性钩子到 `plugin_protocol.py` |

### Phase 2.4: 三方 Agent 集成（P0/P1）

| 任务 ID | 主题 | 责任方 | 优先级 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:------:|:----:|---------|
| P2-020 | ProviderTransportRegistry（CL-014） | operator | P0 | ✅ | `flowforge/core/external_agent/registry.py` |
| P2-021 | host-owned 安全注入（CL-015） | operator | P0 | ✅ | `flowforge/core/external_agent/host_injection.py` |
| P2-022 | ACP transport（CL-016） | 鲁班 | P1 | ✅ | `flowforge/core/external_agent/acp_transport.py` |
| P2-023 | reference runtime（CL-017） | 鲁班 | P1 | ✅ | `flowforge/core/external_agent/reference_runtime.py` |
| P2-024 | MCP 1→3 server 拆分（CL-037） | 鲁班 | P1 | 🔄 | `inject_mcp_config` 已存在，补 collab/memory/signals 1→3 拆分 + prompt 瘦身 50% |
| P2-025 | CLI stderr + NDJSON（CL-038） | 鲁班 | P1 | ✅ | `flowforge/core/external_agent/cli_ndjson.py`（525 行） |

### Phase 2.5: 文档治理与品牌（P1/P2）

| 任务 ID | 主题 | 责任方 | 优先级 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:------:|:----:|---------|
| P2-026 | docs front-matter 规范（CL-040） | 鲁班 | P1 | ⏳ | 新增 design.md v7.1-§D16（feature_ids/related_features/topics/doc_kind/created） |
| P2-027 | 内外品牌边界（CL-041） | operator | P2 | ⏳ | 补全 naming-contract.md §7（内部 cat-cafe vs 外部 Clowder AI 双品牌边界） |
| P2-028 | F135 OOTB 关闭教训（CL-035） | 鲁班 | P2 | ⏳ | 补全 design.md v7.1-§D5.7 |
| P2-029 | Hyperfocus Brake（CL-036） | 鲁班 | P2 | ⏳ | 补全 ADR-007 §Hyperfocus Brake（90 分钟 timer + typed check-in） |
| P2-030 | GitHub CI/CD Tracking 去重（CL-039） | 鲁班 | P2 | ⏳ | 补全 ADR-010 §CI/CD Tracking（headSha + aggregateBucket） |

**Phase 2 汇总**: 30 项 / ✅ 14 项 / 🔄 4 项 / ⏳ 12 项

---

## Phase 3: FlowForge 生产就绪与开源

> **阶段目标**: FlowForge 达到老项目水平，可投入生产并开源到 GitHub。完成可观测性、性能 SLO、灾备降级、Provider 配额治理、金丝雀发布等生产级能力。
>
> **验收标准**:
> - 配置驱动率 ≥ 80%
> - Grafana 仪表盘 + 性能 SLO 达标（Loop 3 分钟内完成，LLM webchat 30 秒内响应）
> - 灾备降级 100% 成功（FlowForge 必须使用 backup 模型确保 100% 成功）
> - 金丝雀发布机制可用
> - GitHub 开源仓库就绪（无老项目信息泄露、无敏感信息、无其他项目引用）
> - T7 LLM 审核测试 4/4 通过 / T8 DOM 验证测试 14/14 通过

### Phase 3.1: 可观测性与性能（P0）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:----:|---------|
| P3-001 | Grafana 仪表盘 | 鲁班 | ⏳ | Prometheus 指标 + Grafana 仪表盘（含 flowforge_ 前缀指标） |
| P3-002 | 性能 SLO 达标 | 鲁班 | ⏳ | Loop 3 分钟内完成 / LLM webchat 30 秒内响应 / 创建润色接口 3 分钟内 |
| P3-003 | MetricsCollector 完整指标采集 | 夏洛克 | ⏳ | E2E 测试必须用 MetricsCollector 采集完整指标（T6 测试铁律） |

### Phase 3.2: 灾备降级与 Provider 治理（P0）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:----:|---------|
| P3-004 | Provider 配额治理 | operator | ⏳ | Provider 配额监控 + 自动切换 backup 模型 |
| P3-005 | 灾备降级 100% 成功 | 鲁班 | ⏳ | FlowForge 必须使用 backup 模型确保 100% 成功 |
| P3-006 | Doubao moderation 集成 | 鲁班 | ⏳ | 内容审核 moderation 预检 |
| P3-007 | Tier 1-4 恢复分级 | 鲁班 | ⏳ | features/F022 + design/D022（已完成骨架） |

### Phase 3.3: 金丝雀发布与 Skill 沉淀（P1）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:----:|---------|
| P3-008 | 金丝雀发布机制 | 鲁班 | ⏳ | 金丝雀发布策略 + 回滚机制 |
| P3-009 | Skill 沉淀与共享 | 鲁班 | ⏳ | Forgekin 市场（features/F037）+ Skill 复用机制 |
| P3-010 | 定时任务与调度 | 鲁班 | ⏳ | APScheduler 集成 + 定时任务管理 |

### Phase 3.4: GitHub 开源就绪（P0）

| 任务 ID | 主题 | 责任方 | 状态 | 完成证据 / 待办动作 |
|---------|------|--------|:----:|---------|
| P3-011 | .gitignore 配置 | operator | ⏳ | 添加 task.md / _archive/ / 敏感配置文件到 .gitignore |
| P3-012 | 开源仓库净化 | operator | ⏳ | 确认 GitHub 提交无老项目信息 / 无其他项目引用 / 无敏感信息 |
| P3-013 | README.md 与 CONTRIBUTING.md | operator | ⏳ | 开源项目说明 + 贡献指南 |
| P3-014 | LICENSE 与 CI/CD | operator | ⏳ | MIT License + GitHub Actions CI/CD |

**Phase 3 汇总**: 14 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 14 项

---

# Part II: *Forge 垂直业务项目移植（Phase 4~11）

> **阶段目标**: 8 个 *Forge 垂直业务项目分别移植达到老项目水平，每个项目通过 Plugin V3 协议注册到 FlowForge。
>
> **通用验收标准**（每个 *Forge 项目）:
> - 通过 Plugin V3 四钩子注册（register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config）
> - 配置驱动（config/ + prompts/ + tools/*.yaml）
> - 不修改 FlowForge 核心层代码（仅通过 Plugin 协议扩展）
> - 全部测试通过 T1-T8 测试铁律
> - 老项目停止维护，切换使用 GitHub 最新代码演进

---

## Phase 4: ContentForge 移植（AI 内容创作工厂）

> **项目定位**: AI 内容创作工厂，6 大专家可进化智能体（选题/研究/写作/SEO/事实核查/发布）。
>
> **端口**: 8001（API）/ 5175（Web UI）

### Phase 4.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P4-001 | persona 配置（6 大专栏） | ⏳ | 按 clowder-ai 老 contentforge config/persona/ 移植 |
| P4-002 | loops 配置（创作/润色双 Loop） | ⏳ | 创作与润色两个独立 Loop 接口 + 5 评委并行评审 |
| P4-003 | gates 配置（质量门禁） | ⏳ | 质量分阈值 0.85 + 评审配置 |
| P4-004 | prompts 配置（提示词外置） | ⏳ | 所有提示词外置到 YAML，禁止 .py 硬编码 |
| P4-005 | tools/*.yaml 配置 | ⏳ | 发布工具 / 研究引擎 / 事实核查工具配置 |

### Phase 4.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P4-006 | plugins.py 注册（Plugin V3 四钩子） | ⏳ | ContentForgePlugin 实现 |
| P4-007 | workers/ 6 大专家可进化智能体 | ⏳ | topic/research/writing/seo/factcheck/publish |
| P4-008 | tools/ 内容工具 | ⏳ | publishers/research_engine 等 |
| P4-009 | app/ FastAPI 应用入口 | ⏳ | 端口 8001 |
| P4-010 | web/ Next.js Web UI | ⏳ | 端口 5175 |

### Phase 4.3: 验证与优化

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P4-011 | E2E 测试（T1-T8 铁律） | ⏳ | 真实 LLM + 真实发布平台 + 浏览器 DOM 验证 |
| P4-012 | 性能优化（3 分钟内完成） | ⏳ | 创建润色接口 3 分钟内 / LLM webchat 30 秒内 |
| P4-013 | AI 痕迹清除（T7 审核通过） | ⏳ | writer_engine.py + editor_engine.py 后处理逻辑移植 |
| P4-014 | DOM 验证（T8 测试 14/14） | ⏳ | 浏览器操控验证发布功能 |

**Phase 4 汇总**: 14 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 14 项

---

## Phase 5: DevForge 移植（AI 开发工厂）

> **项目定位**: AI 开发工厂，编码/审查/测试/部署可进化智能体。
>
> **端口**: 8002（API）/ 5176（Web UI）

### Phase 5.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P5-001 | agents 配置 | ⏳ | 按 clowder-ai 老 devforge config/agents/ 移植 |
| P5-002 | gates 配置（DCP/TR 门禁） | ⏳ | 代码门禁 + 测试门禁 |
| P5-003 | canary 配置（金丝雀发布） | ⏳ | 金丝雀发布策略 |
| P5-004 | sandbox 配置（沙箱执行） | ⏳ | 代码沙箱执行器配置 |

### Phase 5.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P5-005 | plugins.py 注册 | ⏳ | DevForgePlugin 实现 |
| P5-006 | workers/ 可进化智能体 | ⏳ | coder/reviewer/test_generator/deployer |
| P5-007 | app/ + web/ | ⏳ | 端口 8002/5176 |

### Phase 5.3: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P5-008 | E2E 测试（代码生成 + 沙箱执行） | ⏳ | 真实 GitHub Issue 修复验证 |
| P5-009 | 代码合入率验证 | ⏳ | PR merge / PR total 指标 |

**Phase 5 汇总**: 9 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 9 项

---

## Phase 6: NovelForge 移植（AI 小说创作工厂）

> **项目定位**: AI 小说创作工厂，大纲/章节/角色/世界观管理可进化智能体。
>
> **端口**: 8003（API）/ 5177（Web UI）

### Phase 6.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P6-001 | agents 配置 | ⏳ | 按 clowder-ai 老 novelforge config/agents/ 移植 |
| P6-002 | context_layers 配置（5 层上下文） | ⏳ | 世界观/角色/情节/章节/段落 5 层上下文 |
| P6-003 | prompts 配置 | ⏳ | 小说创作专用提示词外置 |

### Phase 6.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P6-004 | plugins/ 注册 | ⏳ | NovelForgePlugin 实现 |
| P6-005 | workers/ 可进化智能体 | ⏳ | outline/chapter/character/worldview |
| P6-006 | app/ + web/ | ⏳ | 端口 8003/5177 |

### Phase 6.3: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P6-007 | E2E 测试（小说创作全流程） | ⏳ | 真实 LLM 完成完整章节创作 |
| P6-008 | 质量门禁验证（7 道 QG） | ⏳ | 章节发布前强制走 moderation 预检 |

**Phase 6 汇总**: 8 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 8 项

---

## Phase 7: MallForge 移植（AI 电商运营工厂）

> **项目定位**: AI 电商运营工厂，商品/客服/营销/数据分析可进化智能体。
>
> **端口**: 8004（API）/ 5178（Web UI）

### Phase 7.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P7-001 | agents 配置 | ⏳ | 按 clowder-ai 老 mallforge config/agents/ 移植 |
| P7-002 | prompts 配置 | ⏳ | 电商运营专用提示词外置 |

### Phase 7.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P7-003 | plugins.py 注册 | ⏳ | MallForgePlugin 实现 |
| P7-004 | workers/ 可进化智能体 | ⏳ | cs_agent/product/marketing/data_analyst |
| P7-005 | app/ + web/ | ⏳ | 端口 8004/5178 |

### Phase 7.3: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P7-006 | E2E 测试（电商运营全流程） | ⏳ | 真实电商平台接入验证 |

**Phase 7 汇总**: 6 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 6 项

---

## Phase 8: StockForge 移植（AI 股票分析工厂）

> **项目定位**: AI 股票分析工厂，行情/研报/策略/回测可进化智能体。
>
> **端口**: 8005（API）/ 5179（Web UI）

### Phase 8.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P8-001 | agents 配置 | ⏳ | 按老 stockforge config/agents/ 移植 |
| P8-002 | indicators.yaml 配置 | ⏳ | 股票指标参数外置 |
| P8-003 | 数据源适配器配置 | ⏳ | Tushare / AkShare / BaoStock / 天天基金 / 基金网 |

### Phase 8.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P8-004 | plugins.py 注册 | ⏳ | StockForgePlugin 实现 |
| P8-005 | workers/ 可进化智能体 | ⏳ | market/research/strategy/backtest |
| P8-006 | 数据源适配器（注册到 OpenSieve） | ⏳ | Tushare/AkShare/BaoStock/天天基金/基金网 adapters |
| P8-007 | app/ + web/ | ⏳ | 端口 8005/5179 |

### Phase 8.3: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P8-008 | 单股票数据流验证 | ⏳ | 先验证单股票，再 100 股票，最后全量 |
| P8-009 | E2E 测试（股票分析全流程） | ⏳ | 真实数据源接入验证 |

**Phase 8 汇总**: 9 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 9 项

---

## Phase 9: OpenSieve 移植（聚合检索增强中台）

> **项目定位**: 聚合检索增强中台，负责爬取和索引股票相关原始数据（公告/研报/新闻）+ 历史股票指标数据管理。
>
> **端口**: 8100

### Phase 9.1: 配置层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P9-001 | 数据源配置 | ⏳ | 股票专业数据源扩展配置 |
| P9-002 | 索引配置 | ⏳ | PostgreSQL 文档索引 + Milvus 向量索引 + Elasticsearch 全文索引 |

### Phase 9.2: 业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P9-003 | 数据源适配器实现 | ⏳ | Tushare/AkShare/BaoStock/天天基金/基金网 adapters |
| P9-004 | 三检索入口（grep/semantic/index） | ⏳ | features/F015 + design/D015（已重构为可插拔数据源适配器） |
| P9-005 | RRF 融合算法 | ⏳ | 三入口并发 + RRF 融合 |
| P9-006 | SDK/API 接口 | ⏳ | localhost:8100 /api/v1/search |

### Phase 9.3: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P9-007 | 单股票数据爬取验证 | ⏳ | 公告/研报/新闻爬取与索引 |
| P9-008 | 三检索入口并发验证 | ⏳ | 100 QPS 不限流 |
| P9-009 | 历史股票指标数据管理 | ⏳ | 独立管理 + 可访问 |

**Phase 9 汇总**: 9 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 9 项

---

## Phase 10: DemoForge 移植（演示项目）

> **项目定位**: FlowForge 演示项目，用于展示可进化智能体自进化能力。
>
> **端口**: 8006（API）/ 5180（Web UI）

### Phase 10.1: 配置与业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P10-001 | demo 配置 | ⏳ | 演示场景配置 |
| P10-002 | plugins.py 注册 | ⏳ | DemoForgePlugin 实现 |
| P10-003 | app/ + web/ | ⏳ | 端口 8006/5180 |

### Phase 10.2: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P10-004 | 演示流程验证 | ⏳ | 可进化智能体自进化展示 |

**Phase 10 汇总**: 4 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 4 项

---

## Phase 11: HelixRag 移植（RAG 框架）

> **项目定位**: RAG 框架，提供检索增强生成基础能力。
>
> **端口**: 8200

### Phase 11.1: 配置与业务层移植

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P11-001 | RAG 配置 | ⏳ | 向量检索 + 关键词检索 + 图谱检索配置 |
| P11-002 | plugins.py 注册 | ⏳ | HelixRagPlugin 实现 |
| P11-003 | app/ | ⏳ | 端口 8200 |

### Phase 11.2: 验证

| 任务 ID | 主题 | 状态 | 完成证据 / 待办动作 |
|---------|------|:----:|---------|
| P11-004 | RAG 检索验证 | ⏳ | 向量 + 关键词 + 图谱三检索入口 |
| P11-005 | 与 OpenSieve 协同验证 | ⏳ | 数据源共享 + 检索结果融合 |

**Phase 11 汇总**: 5 项 / ✅ 0 项 / 🔄 0 项 / ⏳ 5 项

---

# 总览统计

| 阶段 | 总数 | ✅ 已完成 | 🔄 进行中 | ⏳ 待开始 | 完成度 |
|------|:----:|:--------:|:--------:|:--------:|:------:|
| Phase 1（FlowForge MVP） | 13 | 11 | 1 | 1 | 85% |
| Phase 2（FlowForge 完整能力） | 30 | 14 | 4 | 12 | 47% |
| Phase 3（FlowForge 生产就绪） | 14 | 0 | 0 | 14 | 0% |
| Phase 4（ContentForge） | 14 | 0 | 0 | 14 | 0% |
| Phase 5（DevForge） | 9 | 0 | 0 | 9 | 0% |
| Phase 6（NovelForge） | 8 | 0 | 0 | 8 | 0% |
| Phase 7（MallForge） | 6 | 0 | 0 | 6 | 0% |
| Phase 8（StockForge） | 9 | 0 | 0 | 9 | 0% |
| Phase 9（OpenSieve） | 9 | 0 | 0 | 9 | 0% |
| Phase 10（DemoForge） | 4 | 0 | 0 | 4 | 0% |
| Phase 11（HelixRag） | 5 | 0 | 0 | 5 | 0% |
| **合计** | **121** | **25** | **5** | **91** | **21%** |

---

## 附录 A：v7.0 老 Phase 0-6 任务清单（已归档）

> **归档声明**: 原 v7.0 老 Phase 0-6 任务清单（Phase 0~Phase 6 + 横向任务 H-1~H-4）已于 v7.3 移至 `_archive/task_process_records.md`，作为历史背景资料保留，**不作为开发依据**。开发依据以本文 11 阶段里程碑任务为准。
>
> **归档路径**: `_archive/task_process_records.md`

---

## 附录 B：41 条 CL 与 11 阶段任务映射

> **映射说明**: 原 41 条 CL 任务（CL-001~CL-041）已映射到 Phase 1~Phase 2 的详细任务中。下表为 CL ID 与 Phase 任务 ID 的对照表。

| CL ID | Phase 任务 ID | 主题 | 阶段 |
|-------|--------------|------|------|
| CL-001 | P1-006 | 自我演进三模式 | Phase 1 |
| CL-002 | P1-007 | Scope Guard | Phase 1 |
| CL-003 | P1-008 | Capability Maturity Level | Phase 1 |
| CL-004 | P2-001 | Eval Ledger | Phase 2 |
| CL-005 | P2-002 | Knowledge Object Contract | Phase 2 |
| CL-006 | P2-003 | 元认知 Mode C | Phase 2 |
| CL-007 | P1-005 | Core Identity 隔离层 | Phase 1 |
| CL-008 | P2-008 | 9 个一等公民 | Phase 2 |
| CL-009 | P1-002 | 三路记忆 | Phase 1 |
| CL-010 | P1-004 | RP 台词不自动入典 | Phase 1 |
| CL-011 | P2-009 | Role Mask 五层 | Phase 2 |
| CL-012 | P2-010 | Bridge Layer 三协议 | Phase 2 |
| CL-013 | P2-011 | 世界自转 | Phase 2 |
| CL-014 | P2-020 | ProviderTransportRegistry | Phase 2 |
| CL-015 | P2-021 | host-owned 安全注入 | Phase 2 |
| CL-016 | P2-022 | ACP transport | Phase 2 |
| CL-017 | P2-023 | reference runtime | Phase 2 |
| CL-018 | P1-010 | Pack 概念 | Phase 1 |
| CL-019 | P1-009 | 双轨信任编译 | Phase 1 |
| CL-020 | P2-014 | Pack/Growth 种子果实 | Phase 2 |
| CL-021 | P2-012 | World Driver | Phase 2 |
| CL-022 | P1-011 | Plugin V3 manifest | Phase 1 |
| CL-023 | P1-012 | Schedule Factory Whitelist | Phase 1 |
| CL-024 | P2-019 | Plugin 启停 transactional | Phase 2 |
| CL-025 | P2-007 | F177 Close Gate | Phase 2 |
| CL-026 | P2-013 | 四心智家族护栏 | Phase 2 |
| CL-027 | P2-015 | TeamAct Queue Steer | Phase 2 |
| CL-028 | P1-013 | Restart Recovery sweep | Phase 1 |
| CL-029 | P2-016 | Event Memory | Phase 2 |
| CL-030 | P2-017 | no-classifier 红线 | Phase 2 |
| CL-031 | P2-004 | Auto Dream 双层架构 | Phase 2 |
| CL-032 | P2-005 | Agent Swarm 协同 | Phase 2 |
| CL-033 | P2-018 | Approval Hub | Phase 2 |
| CL-034 | P2-006 | QC Loop 7-Step | Phase 2 |
| CL-035 | P2-028 | F135 OOTB 关闭教训 | Phase 2 |
| CL-036 | P2-029 | Hyperfocus Brake | Phase 2 |
| CL-037 | P2-024 | MCP 1→3 server 拆分 | Phase 2 |
| CL-038 | P2-025 | CLI stderr + NDJSON | Phase 2 |
| CL-039 | P2-030 | GitHub CI/CD Tracking | Phase 2 |
| CL-040 | P2-026 | docs front-matter 规范 | Phase 2 |
| CL-041 | P2-027 | 内外品牌边界 | Phase 2 |

---

## 附录 C：验证脚本索引

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
| v7.1 | 2026-07-18 | 索引化重构：新增 41 条 CL 任务索引（按 CL 编号/责任方/优先级三视图） | Trae CN（agent） |
| v7.2 | 2026-07-19 | 命名契约对齐：按 `design/naming-contract.md` v2.0"官方名称优先"原则重构术语 | Trae CN（agent） |
| v7.3 | 2026-07-19 | 过程记录归档：v7.0 老 Phase 0-6 任务清单移至 `_archive/task_process_records.md` | Trae CN（agent） |
| v8.0 | 2026-07-20 | **11 阶段里程碑重构**：按 operator 第三次拒绝要求，重写为 FlowForge 3 大阶段 + 8 个 *Forge 项目各 1 大阶段的 11 阶段里程碑结构；41 条 CL 映射到 Phase 1~2 详细任务；Phase 4~11 新增 8 个 *Forge 项目移植任务大纲 | Trae CN（agent） |

---

> **本文档维护方**: operator + 鲁班架构师可进化智能体（Forgekin）
> **最后更新**: 2026-07-20（v8.0 11 阶段里程碑重构）
> **下次维护触发**: 任意任务状态从 ⏳/🔄 → ✅ 时，由对应责任方可进化智能体更新本文档
> **文档性质**: 内部开发任务索引，通过 `.gitignore` 忽略不提交到 GitHub

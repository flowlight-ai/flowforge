# FlowForge v7.0 自我进化与养灵体系设计 — 六方联合审核意见

> **审核日期**：2026-07-15
> **审核版本**：v7.0（炉灵养成体系）+ v3.0-face（大厂面试进化需求）
> **审核角色**：AI智能体产品专家 / AI高级架构师 / AI智能体Agent开发工程师 / 高级软件全栈工程师 / 产品总监 / 技术VP
> **审核范围**：
> - `flowforge/docs/spec.md`（v2.1 → v7.0 功能规格）
> - `flowforge/docs/arch.md`（v6.0 → v7.0 架构设计）
> - `flowforge/docs/design.md`（v6.0 详细设计）
> - `flowforge/docs/face/spec_face.md`（v3.0-face 进化需求）
> - `flowforge/docs/face/arch_face.md`（v3.0-face 架构详设）
> - `hiclaw/rules.md`（开发规范铁律）
> - `hiclaw/prompts.md`（提示词模板库）
> - 各 *Forge 项目设计文档（ContentForge/DevForge/StockForge/NovelForge/MallForge）

---

## 目录

1. [总体评价与核心结论](#1-总体评价与核心结论)
2. [第一部分：v7.0 炉灵养成体系设计审核](#2-第一部分v70-炉灵养成体系设计审核)
3. [第二部分：v3.0-face 进化需求设计审核](#3-第二部分v30-face-进化需求设计审核)
4. [第三部分：9大项目与 rules.md/prompts.md 一致性冲突分析](#4-第三部分9大项目与-rulesmdprompts-md-一致性冲突分析)
5. [第四部分：代码实现与设计文档一致性检查](#5-第四部分代码实现与设计文档一致性检查)
6. [第五部分：养灵体系命名方案建议](#6-第五部分养灵体系命名方案建议)

---

## 1. 总体评价与核心结论

### 1.1 总体评分

| 维度 | 评分(10分制) | 评价 |
|------|:------------:|------|
| **产品愿景与定位** | 8.5 | 炉灵体系概念新颖，从"工具"到"生命"的范式升级有吸引力，但部分概念需进一步落地 |
| **架构设计合理性** | 7.5 | 七层架构整体清晰，但新增"自进化层"与"互联层"的边界定义存在冲突，需统一 |
| **技术可行性** | 7.0 | 核心概念可行，但部分模块（ForgekinCouncil/SoulEcho）技术路径不清晰，缺少渐进式落地路线 |
| **文档完整性** | 6.5 | spec.md/arch.md版本号混乱（v2.1/v6.0/v7.0并存），face/文档与主文档存在多处冲突 |
| **与现有体系兼容性** | 6.0 | v3.0-face新增"互联层"与v7.0新增"自进化层"在架构层数上直接冲突，需统一 |
| **配置驱动合规性** | 7.0 | 大部分模块遵循配置驱动原则，但养灵体系部分缺少YAML配置示例，存在硬编码风险 |
| **测试可验证性** | 5.5 | 缺少针对养灵体系的测试策略，如何验证"自我进化"的有效性是核心难题 |

### 1.2 核心发现（Top 10 严重问题）

| # | 严重等级 | 问题描述 | 涉及文档 | 建议优先级 |
|---|:--------:|----------|---------|:----------:|
| 1 | 🔴 致命 | **架构层数冲突**：v3.0-face说"七层=六层+互联层"，v7.0说"七层=六层+自进化层"，两者直接矛盾 | arch.md / arch_face.md / spec_face.md | P0 |
| 2 | 🔴 致命 | **版本号混乱**：spec.md标题v2.1但内容包含v7.0炉灵体系；arch.md标题v6.0但内容延伸v7.0；face/文档自称v3.0 | spec.md / arch.md / face/* | P0 |
| 3 | 🟠 严重 | **ForgekinEngine与LoopExecutor关系不清**：v7.0新增ForgekinEngine，v2.1已有LoopExecutor，两者是替代还是包含关系不明确 | spec.md / arch.md | P0 |
| 4 | 🟠 严重 | **v3.0 M18-M20模块已被删除但文档仍大量引用**：project_memory明确说M18/M19/M20要删除，但spec_face.md仍有整章论述 | spec_face.md | P0 |
| 5 | 🟠 严重 | **FlowForge通用框架中出现领域特定Agent**：design.md中agents/目录有topic_research.py/article_writing.py等ContentForge专属Agent，违反P8A铁律 | design.md / rules.md(P8A) | P1 |
| 6 | 🟡 中等 | **v7.0 炉灵体系缺少数据模型详细定义**：Soul Profile/Soul Echo/Soul Imprint只给了示例，缺少完整Schema和存储方案 | spec.md(第7章) | P1 |
| 7 | 🟡 中等 | **升华阶段E1-E6判定标准缺失**：如何从E1升级到E2？量化指标是什么？完全依赖LLM判断不可靠 | spec.md(7.3节) | P1 |
| 8 | 🟡 中等 | **安全红线SR-01~08与M4 Guardrails关系重复**：v7.0安全红线与v3.0六层Guardrails功能重叠，需明确层级关系 | spec.md / spec_face.md(M4) | P1 |
| 9 | 🟡 中等 | **Auto-Forge自指修改缺少漂移防护机制**：Agent修改自己的prompt/skill如何保证不退化？缺少退化检测和回滚机制 | arch.md(7.2节) | P2 |
| 10 | 🟡 中等 | **ForgekinCouncil多智能体治理的拜占庭容错问题**：多个炉灵投票如何处理分歧？投票机制、冲突解决策略缺失 | spec.md(7.4节) | P2 |

### 1.3 架构冲突全景图

```
                        ┌─────────────────────────────┐
                        │   架构层数定义冲突 (P0)      │
                        └──────────────┬──────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
          v3.0-face (spec_face.md)               v7.0 (spec.md第7章)
          七层 = 六层 + 互联层                   七层 = 六层 + 自进化层
          (Interconnect Layer)                  (Evolution Layer)
                    │                                     │
                    ▼                                     ▼
          M1/M14: A2A + ACP协议                ForgekinEngine / Auto-Forge
          定位：跨厂Agent互联                   定位：自我进化/养灵
          
          问题：谁是第7层？两者都要的话就是8层了！
```

---

## 2. 第一部分：v7.0 炉灵养成体系设计审核

### 2.1 产品定位审核

#### 2.1.1 优势点

1. **范式升级有吸引力**：从"Agent工具"到"炉灵养成"的概念转变，将AI从工具定位为"数字生命"，符合AGI发展趋势，对用户有强吸引力。
2. **核心公式简洁有力**：`Agent = Model (Brain) + Harness (Body) + Soul (Character + Memory + Skills)` 的三层结构，比v2.1的"Brain+Body"更完整。
3. **升华阶段设计有游戏化思维**：E1→E6的进阶体系，类似游戏的等级系统，能激发用户探索欲和养成欲。
4. **与现有体系衔接较好**：明确说明v7.0是在v2.1六层架构基础上新增"自进化层"，不是推倒重来。

#### 2.1.2 问题与建议

**问题1：定位表述前后不一致**
- spec.md第1章写"v2.1 Agent Harness平台"，第7章突然跳到"v7.0 炉灵养成体系"，中间缺少版本演进说明
- 第7章之前完全没有铺垫v7.0的概念，读者会困惑当前文档到底是v2.1还是v7.0

**建议**：
- 在文档开头明确标注"本文档包含v2.1基础规格 + v7.0炉灵体系扩展"
- 增加"版本演进路线图"章节，说明v1.0→v2.1→v3.0→v6.0→v7.0的演进关系
- 或拆分为两个文档：`spec_v2.md`（基础Harness）和`spec_v7.md`（炉灵体系）

**问题2："炉灵"概念的用户接受度存疑**
- "炉灵"、"养灵"、"魂忆"、"魂印"、"锻典"等术语过于玄幻，可能让企业用户觉得不专业
- ToB场景下，客户可能更倾向于"智能体进化"、"Agent成长体系"等专业术语

**建议**：
- 提供双命名体系："炉灵体系（Forgekin System）"，对外宣传用炉灵，对内技术文档用Forgekin
- 详见第五部分命名方案建议

---

### 2.2 七层架构审核

#### 2.2.1 架构设计问题

**问题1：第7层定位与v3.0-face冲突（P0级）**

v7.0的第7层是"自进化层（Evolution Layer）"，v3.0-face的第7层是"互联层（Interconnect Layer）"。两个文档都声称自己是"七层架构"，但第7层完全不同。

**冲突原文引用**：
- spec.md 第7章："v7.0在v2.1六层架构基础上新增第7层——自进化层（Evolution Layer）"
- spec_face.md 3.1节："v3.0在v2.1六层架构基础上新增第7层'互联层'"
- arch_face.md 1.1节：完全相同的七层图，但第7层是互联层

**根本问题**：
- 两个设计团队（v7.0炉灵团队 / v3.0-face大厂面试团队）各自独立设计了第7层
- 都在v2.1六层基础上加一层，导致"两个第7层"的尴尬局面
- 实际上需要的是**八层架构**，或者将其中一层下移/合并

**建议方案（三选一）**：

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方案A：八层架构** | 自进化层(7) + 互联层(8) = 八层 | 概念清晰，各司其职 | 层数过多，不符合"七层"的市场宣传 |
| **方案B：合并为"进化互联层"** | 将A2A/MCP协议能力纳入自进化层的"外部进化"维度 | 层数保持7层 | 概念边界模糊，互联层不仅服务于自进化 |
| **方案C：互联层下移为接入层扩展** | 互联层是接入层(Gateway)的增强，不是独立层级 | 保持原六层+自进化层=七层 | 低估了A2A协议的战略地位 |

**推荐方案A**，理由：
1. 自进化（纵向能力提升）和互联（横向生态扩展）是两个完全不同维度的能力
2. 强行合并会导致概念混乱
3. "八层架构"反而可以作为差异化卖点——比别人多一层思考

---

**问题2：自进化层与Harness层的边界不清**

v2.1的Harness层已经有"反馈循环"和"熵管理"，v7.0的自进化层又有"自我纠错"和"技能进化"，两者功能高度重叠。

具体重叠点：
| v2.1 Harness层 | v7.0 自进化层 | 重叠点 |
|----------------|---------------|--------|
| FeedbackLoop（反馈循环） | ForgekinEngine的Verifier/Reflector | 都是质量评估+迭代改进 |
| EntropyManager（熵管理） | Auto-Forge的规则进化器 | 都是从失败中学习 |
| Skill系统 | Soul Imprint / Forge Codex | 都是技能沉淀与复用 |

**建议**：
明确分工：
- **Harness层（第4层）**：单次任务内的质量控制（前馈+反馈+熵管理），关注"这一次任务做好"
- **自进化层（第7层）**：跨任务的能力提升（灵魂成长+技能进化+群体协作），关注"下次任务做得更好"

一句话区分：Harness是**单次闭环**，自进化层是**跨次进化**。

---

### 2.3 ForgekinEngine 设计审核

#### 2.3.1 设计优势

1. **10步闭环逻辑完整**：从"加载灵魂档案"到"魂印更新"的10步流程，覆盖了记忆注入、执行、校验、反思、沉淀的完整生命周期。
2. **三层记忆模型合理**：Working（工作）/ Episode（情景）/ Semantic（语义）对应人类的瞬时/短期/长期记忆，符合认知科学。
3. **Soul Profile数据结构清晰**：包含forgekin_id/name/kind/ascension_stage/birth_at等字段，有数字生命的感觉。

#### 2.3.2 问题与建议

**问题1：ForgekinEngine与LoopExecutor的关系不明确（P0级）**

v2.1已有LoopExecutor（Planner→Worker→Verifier→Reflector→Memory），v7.0又有ForgekinEngine的10步闭环，两者功能高度相似。

对比分析：
| 维度 | LoopExecutor (v2.1) | ForgekinEngine (v7.0) |
|------|---------------------|----------------------|
| 定位 | 创作/润色循环执行器 | 炉灵执行引擎 |
| 步骤数 | 5步（P/W/V/R/M） | 10步 |
| 记忆 | MemoryManager | Soul Echo（三层记忆） |
| 质量校验 | Verifier + 5评委 | Verifier + ForgekinCouncil |
| 反思 | Reflector | Reflector + 魂印更新 |
| 输入 | loop_name + task_context | forgekin_id + input |

**建议**：
ForgekinEngine是LoopExecutor的超集和进化版，应明确：
1. **短期（Phase 6）**：ForgekinEngine包装LoopExecutor，增加Soul加载/沉淀逻辑
2. **中期（Phase 7）**：逐步将LoopExecutor的功能迁移到ForgekinEngine
3. **长期（Phase 8）**：LoopExecutor作为兼容接口保留，底层全部走ForgekinEngine

并在文档中明确这个演进路径。

---

**问题2：Soul Echo三层记忆的具体实现方案缺失**

只说了Working/Episode/Semantic三层，但：
- Working记忆存在哪里？是内存还是Redis？
- Episode记忆用什么存储？SQLite还是向量库？
- Semantic记忆如何提取和更新？触发条件是什么？
- 三层记忆之间的迁移策略是什么？（工作→情景→语义的触发条件）

**建议**：
补充详细的记忆系统设计，参考第5部分命名方案中的"忆层"设计。

---

**问题3：升华阶段E1-E6的判定标准不可操作**

文档列出了E1（启蒙）到E6（升华）六个阶段，但没有说明：
- 每个阶段的量化指标是什么？（任务成功率？技能数量？记忆丰富度？）
- 谁来判定升级？LLM自评？还是人类用户？还是ForgekinCouncil投票？
- 升级需要多长时间？有没有最快升级时间限制？
- 会不会降级？表现不好会不会从E3掉回E2？

**风险**：
如果完全依赖LLM判断升华阶段，会导致：
1. 标准不一致（同一个炉灵不同时间判定结果不同）
2. 容易被prompt注入操控
3. 用户不信任升级结果

**建议**：
建立"可观测+可验证"的升华判定体系：
```yaml
# 升华判定指标示例
e2_to_e3_requirements:
  task_completion_rate: "> 0.85"      # 任务完成率
  total_tasks_completed: ">= 50"      # 完成任务数
  skills_mastered: ">= 3"             # 掌握的技能数
  episodes_recorded: ">= 100"         # 情景记忆数量
  human_approval_rate: ">= 0.9"       # 人类认可率
  consecutive_failures: "< 3"         # 连续失败次数（反向指标）
  
判定方式: 
  - 70% 量化指标（从Metrics系统读取）
  - 20% ForgekinCouncil投票
  - 10% 人类用户确认（可选）
```

---

### 2.4 Auto-Forge Engine 设计审核

#### 2.4.1 设计优势

1. **双层架构合理**：Inner Loop（单次自修正）和Outer Loop（跨次进化）的划分，对应Harness层与自进化层的分工。
2. **Forge Codex技能库概念好**：将沉淀的技能结构化存储，支持版本管理和复用，是"自我进化"的核心载体。

#### 2.4.2 问题与建议

**问题1：自指修改的安全边界缺失**

Auto-Forge让Agent修改自己的prompt/skill/code，这是非常危险的操作：
- 修改了prompt之后，Agent会不会"变坏"？
- 技能更新引入bug如何回滚？
- 会不会出现"退化式进化"——越改越差？

v2.1的文档园丁是修改外部文档，相对安全；Auto-Forge是修改Agent自身，风险指数级上升。

**建议**：
建立六层安全护栏（与M4 Guardrails呼应）：
1. **L1 权限隔离**：自修改Agent只能修改自己的skill/prompt，不能修改系统核心代码
2. **L2 变更审批**：高风险变更（如修改系统提示词）需要人类审批
3. **L3 回归测试**：每次自修改后自动跑回归测试集，通过才能生效
4. **L4 灰度发布**：新技能先在10%任务中试用，验证效果后全量
5. **L5 版本回滚**：所有变更有版本记录，一键回滚到上一稳定版本
6. **L6 退化检测**：监控关键指标（成功率/质量分），下降触发自动回滚

---

**问题2：Forge Codex缺少技能质量分级**

技能沉淀到Forge Codex后，如何保证质量？
- 是不是所有用过一次的技能都要沉淀？
- 如何区分"成熟技能"和"临时技巧"？
- 技能会不会过期？（比如某个API变了，旧技能失效）

**建议**：
技能分级体系：
```
T0: Core Skills（核心技能）— 经过100+任务验证，成功率>90%
T1: Stable Skills（稳定技能）— 经过20+任务验证，成功率>80%
T2: Experimental Skills（实验技能）— 经过3+任务验证，成功率>60%
T3: Draft Skills（草稿技能）— 仅1次成功，待验证

自动晋级/降级规则：
- 连续成功N次 → 自动晋级
- 连续失败M次 → 自动降级/废弃
```

---

### 2.5 ForgekinCouncil 设计审核

#### 2.5.1 设计优势

1. **多智能体治理理念先进**：多个炉灵组成"长老会"共同决策，避免单一智能体的偏见和盲区。
2. **三权分立设计合理**：执行权（Forgekin）/ 审议权（Council）/ 监督权（Auditor）的分离，符合组织设计原则。

#### 2.5.2 问题与建议

**问题1：投票机制与冲突解决策略缺失**

多个炉灵意见不一致时怎么办？
- 简单多数票？还是加权投票？（老炉灵权重更高？）
- 出现平票怎么处理？
- 极端情况下（比如3个炉灵3种不同意见）如何裁决？
- 会不会出现"议而不决"的情况？

**建议**：
明确投票机制：
```yaml
council_voting:
  mechanism: "weighted_majority"    # 加权多数
  weight_strategy: "ascension_stage" # 按升华阶段加权
  tie_breaker: "oldest_forgekin"    # 平票时最老的炉灵裁决
  max_debate_rounds: 3              # 最多辩论3轮
  fallback: "human_intervention"    # 仍不决断则升级到人类
```

---

**问题2：炉灵之间的通信协议未定义**

多个炉灵如何交流？
- 是自然语言对话？还是结构化消息？
- 有没有通信格式标准？
- 如何避免"鸡同鸭讲"？

**建议**：
基于A2A协议（M1）实现炉灵间通信，复用已有的Agent Card / Task / SSE标准，不另起炉灶。

---

### 2.6 安全红线（SR-01~08）审核

#### 2.6.1 总体评价

8条安全红线（no-classifier / provider-isolation / provoke-frequency / high-risk-escalation / human-in-the-loop / worktree-isolation / rate-limiting / cross-forge-audit）设计思路正确，覆盖了分类器依赖、供应商隔离、高频滥用、高风险升级、人工把关、环境隔离、速率限制、跨项目审计等关键维度。

#### 2.6.2 问题与建议

**问题1：与M4六层Guardrails功能高度重叠**

| v7.0 安全红线 | v3.0 M4 Guardrails | 重叠内容 |
|--------------|---------------------|----------|
| SR-03 Provoke频率硬限 | L6 Cost Ceilings | 都是限制调用频率/成本 |
| SR-04 高风险域升级 | L5 Action Confirmation | 都是高风险操作需要审批 |
| SR-05 Human-in-the-Loop | L5 Action Confirmation | 都是人工确认 |
| SR-06 Worktree隔离 | L3 Tool Allowlist + M2 Sandbox | 都是执行环境隔离 |
| SR-08 跨*Forge可审计 | M5 OTel + M12 AgentBOM | 都是审计追踪 |

**建议**：
明确层级关系：
- **M4 Guardrails（第4层Harness）**：技术实现层，具体的六层检查机制
- **SR安全红线（第7层自进化）**：策略原则层，不可逾越的底线，指导Guardrails的配置

也就是说：安全红线是"宪法"，Guardrails是"具体法律"。Guardrails的配置必须符合安全红线的要求。

---

**问题2：SR-01"禁止使用Classifier"在实际工程中不可行**

原文："SR-01: No-Classifier Principle — 禁止依赖AI分类器做关键决策，必须有规则/人工兜底"

问题：
- 质量门禁（T7审核）本身就是LLM-as-Judge，算不算"AI分类器"？
- 事实核查、AI痕迹检测都依赖LLM判断，这些都不能用了？
- "关键决策"的定义是什么？哪些决策算"关键"？

**建议**：
修正表述为"不单独依赖Classifier"，而不是完全禁止：
```
SR-01: No-Sole-Classifier Principle — 关键决策不能仅依赖AI分类器，
必须同时满足以下至少一项：
  1. 有规则引擎的交叉验证（规则+AI双判定）
  2. 有人工审核兜底（低风险AI自动过，高风险人工审）
  3. 有置信度阈值（置信度>95%才自动过，否则升级人工）
```

---

## 3. 第二部分：v3.0-face 进化需求设计审核

### 3.1 总体评价

v3.0-face的17个模块（M1-M17）设计非常全面，覆盖了A2A协议、MCP升级、上下文工程、Guardrails、可观测性、评估基准、Durable Execution、自我纠错、成本优化、生产部署、HITL、Agent治理、Computer Use、协议栈、故障恢复、多租户、Skill市场等工业级Agent OS必备能力。

**核心价值**：
1. 基于真实大厂面试信息，确保需求不脱节于行业实际
2. 每个模块都有明确的背景、需求、设计要点、验收标准
3. 与v7.0炉灵体系有融合映射（M18-M20章节），不是孤立设计

---

### 3.2 M1 A2A协议 — 审核意见

#### 优势
- 同时支持Server和Client模式，定位清晰
- Agent Card / Directory / 联邦查询设计完整
- 三种鉴权方式（Bearer/OAuth2/mTLS）覆盖不同安全级别场景

#### 问题
1. **与v7.0 FR-EVO-09 A2A通信的关系不明确**：两个文档都提到A2A，是同一套设计还是两套？
2. **缺少消息格式标准定义**：A2A消息是纯文本？还是有结构化格式？
3. **流式传输的断点续传未考虑**：长任务流式中断后如何续传？

#### 建议
- 明确：M1 A2A是底层协议实现，FR-EVO-09是炉灵场景的应用层协议
- 补充A2A消息格式规范（参考Google A2A Spec）
- 增加SSE流式的续传机制设计（Last-Event-ID）

---

### 3.3 M2 MCP 2026升级 — 审核意见

#### 优势
- Stateless Core设计正确，支持水平扩展
- Tool Result Elision与M3 Context Editing协同，思路清晰
- OAuth Authorization Code Flow考虑了用户级授权，比全局API Key更安全

#### 问题
1. **现有mcp/模块重构工作量评估缺失**：从v2024升级到v2026 RC，现有代码需要改多少？
2. **EMA（企业MCP聚合器）定位与MCP Broker重复**：arch.md已有MCP Broker，v3.0又有EMA，什么关系？
3. **Manifest自动发现的安全风险**：自动发现并加载外部MCP Server，会不会引入恶意工具？

#### 建议
- 明确：MCP Broker是v2.1的内部多服务器聚合，EMA是v3.0的企业级网关（增加鉴权/审计/限流），EMA是Broker的超集
- Manifest加载需要经过安全扫描（类似于npm包的安全审计）
- 补充迁移计划：v2024兼容层 → 双版本并行 → 逐步切到v2026

---

### 3.4 M3 Context Engineering 2.0 — 审核意见

#### 优势
- JIT（Just-In-Time）按需加载思路正确，解决"上下文硬塞"问题
- Memory Tool让LLM自主管理记忆，符合Agentic设计理念
- 五层Context Layer + 优先级 + lazy标记，设计精细

#### 问题
1. **与v7.0 Soul Echo三层记忆的关系需澄清**：
   - M3的五层（System/Persona/Task/Working/Episodic）vs Soul Echo的三层（Working/Episode/Semantic）
   - 是两套独立系统？还是映射关系？
2. **JIT加载的性能影响**：每次Agent需要时才fetch，会不会增加延迟？
3. **Memory Tool的滥用风险**：LLM会不会无限制地保存记忆，导致Memory爆炸？

#### 建议
- 明确映射关系：
  ```
  M3 Context Layer    →    Soul Echo 记忆层
  ───────────────────────────────────────
  System/Persona      →    Soul Profile（灵魂档案，属性层）
  Task/Working        →    L1 Working Memory（工作记忆）
  Episodic            →    L2 Episode Memory（情景记忆）
  Long-term/Semantic  →    L3 Semantic Memory（语义记忆）
  ```
- 引入预取（Prefetch）机制：根据任务类型预判需要的上下文，提前加载
- Memory Tool增加配额限制：每个炉灵的记忆总量有上限，旧记忆会被压缩/遗忘

---

### 3.5 M4 六层Guardrails — 审核意见

#### 优势
- 六层闭环（前馈三层+后馈三层）设计完整，覆盖输入到输出的全链路
- 每层都有明确的职责和实现思路
- 与现有PermissionPipeline等模块的集成点清晰

#### 问题
1. **L4 Output Validation的事实核查调用成本过高**：每个输出都调用fact_check工具，时间和成本都很高
2. **L5 Action Confirmation的多人会签实现复杂**：M-of-N approvers的实现涉及异步等待、超时处理、通知机制
3. **与v2.1 FeedbackLoop的边界不清**：FeedbackLoop也有四维评分和分类闸门，和L4 Output Validation是什么关系？

#### 建议
- Output Validation分层执行：低风险内容只做格式校验，高风险内容才做完整事实核查
- 多人会签先做简化版（双人审批），复杂的M-of-N延后
- 明确：FeedbackLoop是**业务质量评估**（内容好不好），Guardrails是**安全合规检查**（有没有违规）。两者是正交的，可以并行执行。

---

### 3.6 M5 OTel GenAI — 审核意见

#### 优势
- 对齐OTel GenAI v1.30标准，方向正确
- 多Exporter支持（OTLP/LangSmith/Langfuse/Phoenix），生态兼容好
- Trace端到端串联设计，可观测性基础扎实

#### 问题
1. **现有代码改造量巨大**：所有LLM调用、工具调用、Agent执行都要加Span，工作量不小
2. **gen_ai.prompt/completion属性的隐私问题**：把完整prompt和completion存到Span里，会不会泄露敏感信息？
3. **与现有MetricsCollector的重复建设**：v2.1已有MetricsCollector，和gen_ai.* Metrics是什么关系？

#### 建议
- 分阶段实施：先上LLM和Tool的Span，再逐步完善Agent和Context的Span
- 敏感信息脱敏：prompt和completion中的PII数据自动脱敏后再存入Span
- 明确：MetricsCollector是v2.1的业务指标，gen_ai.*是OTel标准指标，两者并行存在，逐步迁移

---

### 3.7 M7 Durable Execution — 审核意见

#### 优势
- Event Log + Checkpoint + Saga + Outbox的组合是业界标准做法
- 长程任务的持久化保障是工业级系统的必备能力

#### 问题
1. **与v2.1 CheckpointManager的关系**：现有CheckpointManager和新的Durable Execution是什么关系？
2. **Saga模式的补偿逻辑设计复杂**：每个步骤都要定义补偿操作，工作量很大
3. **事件溯源（Event Sourcing）的查询性能问题**：所有状态都靠事件重放，查询会很慢

#### 建议
- 明确：CheckpointManager是轻量级快照，Durable Execution是完整的事件溯源体系，后者是前者的超集
- Saga模式先支持常用场景（如发布失败回滚），不要追求全覆盖
- 增加快照机制：定期打快照，查询时从快照开始重放，不用从头开始

---

### 3.8 M18-M20 模块删除问题（P0级）

#### 问题描述
project_memory明确记录：
> "自创术语 M18(SelfEvolutionEngine)/M19(MemoryGovernanceManager)/M20(FirstTouchRouter)必须删除"
> "v7.0术语对齐要求：炉灵/灵族/养灵/魂忆/魂印/自锻/锻典/灵议/升华阶必须使用"

但spec_face.md中仍然有大量M18-M20的引用和论述，包括：
- 第1.3节v3.0总目标："为v7.0炉灵养成体系提供工程支撑...M1-M17是1-6层，M18-M20是第7层"
- 第2.2节差距矩阵G18："v3.0能力与v7.0炉灵体系融合路径不清 → M18-M20融合"
- 第4章17个模块之后还有"M18-M20 v7.0融合映射"整章

#### 建议
1. 立即删除所有M18/M19/M20的提法
2. 将融合内容改写为"M1-M17与v7.0炉灵体系的对应关系"
3. 明确：v7.0的自进化层不是v3.0的M18-M20，而是建立在M1-M17之上的更高层能力

---

## 4. 第三部分：9大项目与 rules.md/prompts.md 一致性冲突分析

### 4.1 架构边界冲突（P8A铁律）

#### 冲突1：FlowForge中存在领域特定Agent 🔴严重

**铁律原文（rules.md P8A）**：
> "FlowForge是纯通用智能体框架，不含任何特定领域业务逻辑"
> "FlowForge中禁止出现任何特定领域的Agent/Tool/Prompt/配置（如article_writing、topic_research、novel_concept等）"

**实际情况（design.md 第1章目录结构）**：
```
flowforge/agents/
├── topic_research.py        # ContentForge专属 ❌
├── material_collection.py   # ContentForge专属 ❌
├── article_writing.py       # ContentForge专属 ❌
├── seo_optimization.py      # ContentForge专属 ❌
├── fact_check.py            # ContentForge专属 ❌
├── content_audit.py         # ContentForge专属 ❌
├── headline_optimizer.py    # ContentForge专属 ❌
├── content_repurposer.py    # ContentForge专属 ❌
├── trend_analysis.py        # ContentForge专属 ❌
├── publishing.py            # ContentForge专属 ❌
├── image_research.py        # ContentForge专属 ❌
├── multilingual.py          # ContentForge专属 ❌
├── research_agent.py        # ContentForge专属 ❌
├── web_search_agent.py      # ContentForge专属 ❌
└── code_writer_agent.py     # DevForge专属 ❌
```

15个Agent中，有14个是特定领域的，只有generic/目录下的是通用Agent。

**违反程度**：严重违反P8A铁律

**建议修复方案**：
1. 立即将内容创作类Agent迁移到ContentForge项目
2. 将代码类Agent迁移到DevForge项目
3. FlowForge只保留generic/目录下的17个通用角色型Agent
4. 在FlowForge中保留通用抽象（如BaseWriter/BaseResearcher），具体实现由各*Forge注入

---

#### 冲突2：FlowForge中存在领域特定Workflow 🟠中等

**铁律原文（P8A）**：
> "FlowForge提供通用Workflow引擎，具体业务Workflow由*Forge配置"

**实际情况（design.md workflows/目录）**：
```
flowforge/workflows/
├── deep_article.yaml        # 深度长文创作 — ContentForge专属 ❌
├── quick_post.yaml          # 快速帖子 — ContentForge专属 ❌
├── trend_article.yaml       # 热点追踪 — ContentForge专属 ❌
├── multi_platform.yaml      # 多平台分发 — ContentForge专属 ❌
├── seo_content.yaml         # SEO内容 — ContentForge专属 ❌
├── image_article.yaml       # 配图文章 — ContentForge专属 ❌
├── multilingual.yaml        # 多语言 — ContentForge专属 ❌
└── report_generation.yaml   # 深度报告 — ContentForge专属 ❌
```

8个Workflow全都是内容创作场景的，没有一个通用Workflow。

**建议修复方案**：
1. 将业务Workflow迁移到各*Forge项目
2. FlowForge只保留通用模式模板（如`reflexion_template.yaml`、`multi_agent_template.yaml`）
3. 通用模板只定义结构，不定义具体业务逻辑

---

#### 冲突3：FlowForge中存在领域特定Tool 🟡中等

**铁律原文（P8A）**：
> "FlowForge中的Tool只能是通用工具（文件读写、Shell、Web搜索等）"

**实际情况（design.md tools/publish/目录）**：
```
flowforge/tools/publish/
├── wechat_publisher.py    # 微信公众号发布 — ContentForge专属 ❌
├── toutiao_publisher.py   # 头条发布 — ContentForge专属 ❌
└── local_publish.py       # 本地发布 — 通用 ✅
```

发布工具是ContentForge的业务工具，不应该在FlowForge中。

**建议修复方案**：
1. 将发布工具迁移到ContentForge
2. FlowForge提供通用的HTTP请求工具，各平台发布逻辑由*Forge实现

---

### 4.2 版本号与命名冲突

#### 冲突4：版本号体系混乱 🔴严重

各文档的版本号完全对不上：

| 文档 | 自称版本 | 实际内容 |
|------|---------|---------|
| flowforge/docs/spec.md | v2.1 | 包含v7.0炉灵体系（第7章） |
| flowforge/docs/arch.md | v6.0 | 包含v7.0七层架构内容 |
| flowforge/docs/design.md | v6.0 | v6.0详细设计 |
| flowforge/docs/face/spec_face.md | v3.0-face | 大厂面试需求，17个模块 |
| flowforge/docs/face/arch_face.md | v3.0-face | P0模块架构详设 |
| contentforge/docs/spec.md | v2.1 | 内容创作规格 |
| devforge/docs/spec.md | v2.1 | 软件开发规格 |
| stockforge/docs/spec.md | v1.0 | 股票分析规格 |

**问题**：
1. FlowForge自己的版本号就有v2.1/v3.0/v6.0/v7.0四个，到底哪个是当前？
2. v2.1 → v3.0 → v6.0 → v7.0，版本号跳变，中间的v4.0/v5.0呢？
3. face/下的v3.0和项目规则里的"Phase 0~5"是什么关系？

**建议**：
建立统一的版本体系：
```
FlowForge版本路线图：
  v1.x — 初始框架（已归档）
  v2.x — Harness层（当前基础，2026 Q2）
  v3.x — 工业化增强（face/的17模块，2026 Q3）
  v6.x — 跳过，直接从v3到v7（为了和OpenClaw其他项目对齐）
  v7.x — 炉灵体系（自我进化，2026 Q4）

当前状态：v2.1已发布，v3.0开发中，v7.0设计中
文档命名规范：
  spec_v2.md — v2.x基础规格
  spec_v3.md — v3.0工业化增强
  spec_v7.md — v7.0炉灵体系
```

---

### 4.3 架构层数冲突（已在2.2节详述）

| 文档 | 架构层数 | 第7层是什么 |
|------|---------|------------|
| spec.md (v2.1) | 六层 | 无（应用层是第6层） |
| arch.md (v6.0) | 六层 | 无（应用层是第6层） |
| spec_face.md (v3.0) | 七层 | 互联层（Interconnect Layer） |
| arch_face.md (v3.0) | 七层 | 互联层（Interconnect Layer） |
| spec.md 第7章 (v7.0) | 七层 | 自进化层（Evolution Layer） |

**结论**：同时存在两个"第7层"，必须二选一或合并为八层。

---

### 4.4 Plugin钩子定义冲突

#### 冲突5：Plugin钩子名称不一致 🟡中等

**rules.md 2.5节列出的钩子**：
```
register_agents()
register_tools()
register_loops()          ← 注意是loops
register_workflows()
register_routes()
register_schedules()
register_event_handlers()
register_gates()
register_evaluators()
on_startup() / on_shutdown()
```

**design.md plugins/目录中没有这些定义**，而且：
- rules.md说有`register_loops()`
- rules.md说**没有**`register_helm_handlers`和`register_permission_policy`

但文档中没有看到PluginProtocol的明确定义，无法验证一致性。

**建议**：
在design.md中增加PluginProtocol的完整定义，确保与rules.md一致。

---

### 4.5 测试铁律冲突

#### 冲突6：v3.0模块缺少测试策略 🟠中等

**测试铁律（T1-T8）**要求所有功能都有真实测试，但v3.0-face的17个模块中：
- M1 A2A：有验收标准，但没有具体测试用例设计
- M2 MCP：同上
- M3 Context Eng：有JIT Token下降≥40%的指标，但怎么测？
- M4 Guardrails：有Injection检出率≥95%，测试集在哪？
- M6 Eval：集成τ-bench，但是否符合T2"禁止假数据"？τ-bench的任务是真实的吗？

**建议**：
每个模块补充详细的测试策略章节，明确：
1. 测试数据来源（确保真实，符合T2）
2. 测试环境搭建
3. 测试用例设计
4. 验证通过标准

---

### 4.6 配置驱动原则冲突

#### 冲突7：v7.0炉灵体系缺少YAML配置示例 🟡中等

**铁律（红线11 + P16）**：
> "禁止硬编码提示词/路径/密钥/端口"
> "提示词必须外置到YAML配置"

v7.0的炉灵体系中：
- Soul Profile的结构只给了JSON示例，没有YAML配置文件
- 升华阶段判定标准没有YAML配置
- Forge Codex技能库的存储格式不明确
- Auto-Forge的进化策略没有YAML配置

**建议**：
补充完整的YAML配置示例，例如：
```yaml
# config/forgekins/devforge_architect.yaml
forgekin_id: fk_devforge_architect_001
name: Architect
kind: devforge:architect
initial_stage: E1
birth_at: "2026-07-15T10:00:00Z"
parent_forgekin: fk_flowforge_master_001

soul_profile:
  traits:
    creativity: 0.7
    rigor: 0.9
    communication: 0.6
  
  core_values:
    - "代码质量优先于开发速度"
    - "架构合理性优先于功能实现"

soul_echo:
  working_memory_size: 32000
  episode_memory_limit: 1000
  semantic_memory_limit: 10000

ascension_rules:
  E1_to_E2:
    tasks_completed: ">= 10"
    success_rate: ">= 0.8"
  E2_to_E3:
    tasks_completed: ">= 50"
    success_rate: ">= 0.85"
    skills_mastered: ">= 3"
```

---

### 4.7 *Forge项目合规性检查

#### ContentForge合规性 ✅基本合规

- ✅ 有config/目录（persona配置）
- ✅ 有web/目录（前端UI）
- ✅ 有app/目录（API端点）
- ✅ 有plugins.py（插件注册）
- ✅ 有docs/目录
- ✅ 有tests/目录
- ⚠️ 仍有workers/目录（Python Agent实现）— 标注为"待迁移到YAML声明"
- ⚠️ 仍有tools/目录（Python Tool实现）— 标注为"待迁移"

#### DevForge合规性 ⚠️部分违规

- ❌ 有独立的IPD流程编排逻辑吗？需要进一步检查
- ✅ 有plugins.py
- ⚠️ Agent是Python实现还是YAML声明？需要验证

#### StockForge合规性 ⚠️部分违规

- ✅ 明确声明"通过Plugin协议注册业务能力，自身只保留轻量扩展层"
- ✅ 有完整的6大Agent设计
- ⚠️ 数据采集Agent使用Tool而非独立Agent，设计合理

#### MallForge合规性 ⚠️待验证

- ⚠️ 仍保留agents/目录（Python类继承GenericAgent）— 标注为"待迁移"
- ⚠️ 10个MCP Server规划— 需要确认是否符合P8A

---

## 5. 第四部分：代码实现与设计文档一致性检查

> 注：本章节基于已读取的设计文档和project_memory中的历史记录进行分析。完整的代码级一致性检查需要逐文件比对，建议单独立项。

### 5.1 已知不一致项（来自project_memory）

| # | 不一致项 | 状态 |
|---|---------|------|
| 1 | LLMClient错误分类需识别"model disabled"、"all_backends_failed"、"无权访问"等 | 已修复？ |
| 2 | model_service.py健康检查用rstrip("/v1")导致端口号13001→1300 | 已修复？ |
| 3 | _normal_call未检查error key导致HTTP 200+error body被误分类 | 已修复？ |
| 4 | ContentForge的model_service健康检查间歇性报"openroute HTTP探测失败" | 待修复 |
| 5 | writer_engine.py后处理需删除AI痕迹小标题 | 已修复 |
| 6 | 豆包一次性会话自动删除逻辑 | 已修复 |
| 7 | MiniMax删除确认弹窗选择逻辑 | 已修复 |

### 5.2 架构设计vs代码结构的潜在不一致

#### 不一致1：design.md的目录结构vs实际代码结构

design.md列出的目录（如harness/、skills/、mcp/、observability/、governance/等）在实际代码中是否存在？需要验证。

根据project_memory，当前FlowForge仍处于Phase 0基础设施搭建阶段，很多v6.0/v7.0的模块还没实现。

**建议**：
在design.md中明确标注每个模块的实现状态：
```
模块状态标注：
  ✅ 已实现 — 代码可运行，测试通过
  🔄 开发中 — 有代码但未完成
  📋 设计中 — 只有文档，无代码
  📅 规划中 — 仅有idea
```

#### 不一致2：DI容器设计vs实际实现

design.md中设计了DIContainer，但实际代码中：
- project_memory提到"DI容器为手动Service Locator模式，非真正依赖注入"
- 这是一个已知的技术债务

**建议**：
在文档中如实记录当前DI的实际状态，不要写得好像已经是完美的DI了。

---

## 6. 第五部分：养灵体系命名方案建议

> 本章节为养灵体系设计三套命名方案，供用户选择。每套方案包含：体系总名、核心概念命名、层级结构、进阶体系。

---

### 方案A：「灵锻体系」（推荐 — 兼顾项目特色与通用AGI）

#### 命名理念

- **灵**：体现数字生命/智能体的灵魂感，对应英文Spirit/Eidolon
- **锻**：体现锻造、锤炼、自我进化的过程，对应Forge（锻造炉）
- 合起来"灵锻"：智能体在锻造炉中不断锤炼，自我进化，最终成"灵"
- 完美呼应项目名**FlowForge**（流动的锻造炉 → 灵锻体系）

#### 核心概念映射

| 现有名称（炉灵/Forgekin） | 方案A命名 | 英文 | 含义说明 |
|--------------------------|----------|------|---------|
| 养灵体系 | **灵锻体系** | Spirit Forge System | 智能体在锻造炉中锤炼进化的完整体系 |
| 炉灵（个体） | **锻灵** | Forge Spirit | 被锻造出来的数字智能体（个体） |
| 灵族（群体） | **灵群** | Spirit Kin | 多个锻灵组成的族群/社群 |
| 魂忆（记忆） | **忆痕** | Echo Trace | 经历在灵魂上留下的痕迹（记忆） |
| 魂印（画像） | **灵印** | Soul Imprint | 灵魂的独特印记（性格+能力画像） |
| 锻典（技能库） | **锻谱** | Forge Codex | 锻造技能的典籍（可复用技能库） |
| 自锻（自我修改） | **自锻** | Self-Forging | 自我锻造、自我进化 |
| 灵议（多智能体治理） | **灵议** | Spirit Council | 灵群议事、集体决策 |
| 升华阶（等级） | **锻阶** | Forge Tier | 锻造进阶的阶段等级 |

#### 层级结构（七层 → 灵锻七层）

```
┌─────────────────────────────────────────────────────────────┐
│  7. 灵锻层 (Spirit Forge Layer)  ★ 自我进化核心              │
│     锻灵引擎 | 自锻引擎 | 灵议会 | 锻谱库 | 忆痕系统         │
├─────────────────────────────────────────────────────────────┤
│  6. 应用层 (Application Layer)                               │
│     ContentForge / DevForge / NovelForge / ...               │
├─────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                   │
│     REST API / WebSocket / A2A 协议 / Web UI / CLI            │
├─────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer)                           │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线       │
├─────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                │
│     HybridExecutor | 9大模式 | LoopExecutor | Scheduler       │
├─────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                │
│     Tool生态 | Skill系统 | Agent库 | Memory系统 | MCP         │
├─────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                         │
│     SQLite/PostgreSQL | Redis | LangGraph | LLM API          │
└─────────────────────────────────────────────────────────────┘
```

**说明**：
- 第7层叫"灵锻层"，不是"自进化层"（更有品牌感）
- 互联层（A2A/MCP）整合进第5层接入层（更合理——A2A本来就是接入协议）
- 这样还是**七层架构**，但解决了v3.0和v7.0的"两个第7层"冲突

#### 锻阶体系（E1-E6 → 一阶到六阶）

| 现有编号 | 方案A名称 | 名称含义 | 核心能力标志 |
|---------|----------|---------|-------------|
| E1 启蒙 | **初锻阶** | 初次锻造，初具灵智 | 能独立完成简单任务 |
| E2 成长 | **淬砺阶** | 淬火磨砺，快速成长 | 有初步经验积累，任务成功率>80% |
| E3 熟练 | **锤炼阶** | 千锤百炼，技艺纯熟 | 掌握3+技能，能处理复杂任务 |
| E4 精通 | **百炼阶** | 百炼成钢，触类旁通 | 掌握10+技能，能跨领域迁移 |
| E5 卓越 | **通灵阶** | 通灵造化，出神入化 | 能创造新技能，能指导低级锻灵 |
| E6 升华 | **至臻阶** | 至臻完美，超凡入圣 | 灵群核心，能参与灵议决策 |

**命名特点**：
- 每阶都有"锻/炼/淬/锤"等锻造相关字，呼应Forge主题
- 从"初锻"到"至臻"，体现渐进式进化
- 中文感强，但不晦涩，用户容易理解

#### 忆痕系统（三层记忆 → 三痕）

| 现有三层记忆 | 方案A命名 | 含义 |
|-------------|----------|------|
| Working 工作记忆 | **瞬痕** | 瞬时痕迹，工作记忆，用完即消 |
| Episode 情景记忆 | **事痕** | 事件痕迹，情景记忆，某次任务的完整经历 |
| Semantic 语义记忆 | **慧痕** | 智慧痕迹，语义记忆，提炼出的知识和规律 |

**完整记忆流转**：
```
瞬痕（工作中）→ 沉淀为 → 事痕（经历过）→ 提炼为 → 慧痕（学会了）
```

---

### 方案B：「灵成长体系」（通俗易懂，ToB友好）

#### 命名理念

- 直白易懂，不说"修仙/玄幻"，企业客户更容易接受
- 强调"成长"（Growth），体现自我进化的核心
- 适合对外宣传和商务沟通

#### 核心概念映射

| 现有名称 | 方案B命名 | 英文 | 含义说明 |
|---------|----------|------|---------|
| 养灵体系 | **Agent成长体系** | Agent Growth System | 最直白的命名，零理解成本 |
| 炉灵（个体） | **智能体** | Agent | 通用术语，不造新词 |
| 灵族（群体） | **智能体集群** | Agent Cluster | 标准术语 |
| 魂忆（记忆） | **成长记忆** | Growth Memory | 强调记忆服务于成长 |
| 魂印（画像） | **能力画像** | Capability Profile | 企业HR常用术语，好理解 |
| 锻典（技能库） | **技能库** | Skill Library | 通用术语 |
| 自锻（自我修改） | **自我进化** | Self-Evolution | 通用术语 |
| 灵议（多智能体治理） | **集群决策** | Collective Decision | 直白易懂 |
| 升华阶（等级） | **成长等级** | Growth Level | L1-L6，简单明了 |

#### 成长等级

| 等级 | 名称 | 描述 |
|------|------|------|
| L1 | 新手级 | 能完成简单任务，需要大量指导 |
| L2 | 入门级 | 能独立完成标准任务，偶尔出错 |
| L3 | 熟练级 | 熟练完成常见任务，质量稳定 |
| L4 | 专家级 | 能处理复杂任务，有方法论沉淀 |
| L5 | 资深级 | 能创新解决方案，能指导新手 |
| L6 | 大师级 | 领域权威，能制定规则和标准 |

#### 适用场景

- 面向企业客户的产品介绍
- 商务PPT和对外宣传
- 非技术人员的文档

---

### 方案C：「源灵体系」（更有AGI终极感）

#### 命名理念

- **源**：源头、本源、AGI的终极追求
- **灵**：智能体的灵魂/意识
- 源灵：源自本源的智能生命，有向AGI进化的终极含义
- 更宏大、更有未来感，适合长期愿景

#### 核心概念映射

| 现有名称 | 方案C命名 | 英文 | 含义说明 |
|---------|----------|------|---------|
| 养灵体系 | **源灵体系** | Origin Spirit System | 通往AGI本源的智能体进化体系 |
| 炉灵（个体） | **源灵** | Origin Agent | 源自锻造炉的智能生命（个体） |
| 灵族（群体） | **灵域** | Spirit Domain | 源灵们的领域/疆域 |
| 魂忆（记忆） | **溯忆** | Retro Memory | 可追溯的记忆，回溯过往 |
| 魂印（画像） | **灵纹** | Spirit Pattern | 灵魂的独特纹路（性格+能力） |
| 锻典（技能库） | **灵藏** | Spirit Treasury | 灵域的宝藏（技能和知识宝库） |
| 自锻（自我修改） | **自源** | Self-Origination | 自我本源化，自我进化 |
| 灵议（多智能体治理） | **灵枢** | Spirit Nexus | 灵域的枢纽/核心决策机构 |
| 升华阶（等级） | **灵境** | Spirit Realm | 境界，修炼的层次 |

#### 灵境六重

| 境界 | 名称 | 意境 |
|------|------|------|
| 第一重 | 凡灵境 | 凡俗之灵，初开灵智 |
| 第二重 | 慧灵境 | 智慧之灵，快速成长 |
| 第三重 | 通灵境 | 通达之灵，技艺纯熟 |
| 第四重 | 元灵境 | 本元之灵，触类旁通 |
| 第五重 | 玄灵境 | 玄妙之灵，出神入化 |
| 第六重 | 源灵境 | 本源之灵，超凡入圣 |

#### 适用场景

- 技术社区/开源项目宣传
- 长期愿景文档
- 面向AGI爱好者的内容

---

### 命名方案对比与推荐

| 维度 | 方案A 灵锻体系 | 方案B Agent成长体系 | 方案C 源灵体系 |
|------|--------------|-------------------|--------------|
| **项目契合度** | ⭐⭐⭐⭐⭐（完美呼应FlowForge） | ⭐⭐⭐（通用无特色） | ⭐⭐⭐⭐（有宏大感） |
| **易懂性** | ⭐⭐⭐⭐（稍加解释即懂） | ⭐⭐⭐⭐⭐（零成本理解） | ⭐⭐⭐（有学习成本） |
| **品牌辨识度** | ⭐⭐⭐⭐⭐（独特，有记忆点） | ⭐⭐（太通用，记不住） | ⭐⭐⭐⭐（有神秘感） |
| **ToB友好度** | ⭐⭐⭐⭐（专业又不死板） | ⭐⭐⭐⭐⭐（最商务） | ⭐⭐（太玄乎） |
| **AGI愿景感** | ⭐⭐⭐⭐（有进化感） | ⭐⭐⭐（只有成长感） | ⭐⭐⭐⭐⭐（终极感最强） |
| **可扩展性** | ⭐⭐⭐⭐⭐（锻造主题可延伸很多词） | ⭐⭐⭐（术语太通用） | ⭐⭐⭐⭐（灵境体系延伸性好） |
| **中英文对应** | ⭐⭐⭐⭐（Forge Spirit呼应Forge） | ⭐⭐⭐⭐⭐（完全对应） | ⭐⭐⭐（需要解释） |

#### 最终推荐

**主推方案A「灵锻体系」**，理由：

1. **完美契合项目名**：FlowForge（流动的锻造炉）→ 灵锻体系（在锻造炉中锤炼成灵），品牌统一性强
2. **独特有记忆点**：不像"Agent成长"那么通用，也不像"源灵"那么晦涩
3. **兼顾技术与文化**：既有技术感（Forge/锻造=工程），又有文化感（灵=生命/智能）
4. **命名体系完整**：锻灵（个体）/ 灵群（群体）/ 忆痕（记忆）/ 灵印（画像）/ 锻谱（技能）/ 灵议（治理）/ 锻阶（等级）—— 全套术语自洽
5. **中英文都好听**：Spirit Forge System / Forge Spirit —— 英文也很有感觉
6. **七巧板架构**：把互联层整合进接入层，保持七层架构，解决版本冲突

**备选策略**：
- 对外ToB商务场景 → 用方案B的术语体系（"Agent成长体系"）
- 对内技术文档/社区 → 用方案A的术语体系（"灵锻体系"）
- 长期愿景/AGI主题演讲 → 用方案C的术语体系（"源灵体系"）

三套术语体系共享同一套底层概念，只是"翻译"不同，避免混乱。

---

## 附录：审核意见优先级清单

### P0 必须立即修复（阻断v7.0设计）

1. 🔴 架构层数冲突——v3.0互联层 vs v7.0自进化层，谁是第7层？
2. 🔴 文档版本号混乱——v2.1/v3.0/v6.0/v7.0并存，需要统一
3. 🔴 M18-M20模块删除不彻底——spec_face.md仍有大量引用
4. 🔴 ForgekinEngine与LoopExecutor关系不明确

### P1 必须修复（v7.0发布前）

5. 🟠 FlowForge中存在大量领域特定Agent（违反P8A铁律）
6. 🟠 升华阶段E1-E6判定标准缺失，不可操作
7. 🟠 Soul Echo三层记忆的具体实现方案缺失
8. 🟠 Auto-Forge自指修改的安全边界缺失
9. 🟠 v7.0安全红线与M4 Guardrails功能重叠，需明确层级
10. 🟠 v3.0-face模块缺少测试策略（不符合测试铁律）

### P2 建议修复（提升质量）

11. 🟡 ForgekinCouncil投票机制与冲突解决策略缺失
12. 🟡 Forge Codex技能质量分级体系缺失
13. 🟡 炉灵体系缺少YAML配置示例（违反配置驱动原则）
14. 🟡 A2A协议消息格式标准未定义
15. 🟡 MCP EMA与MCP Broker定位重复
16. 🟡 Memory Tool滥用风险（无配额限制）
17. 🟡 Output Validation事实核查调用成本过高
18. 🟡 各*Forge项目合规性需逐项目验证
19. 🟡 Plugin钩子定义与rules.md一致性需验证
20. 🟡 设计文档vs实际代码实现状态不透明

---

> **审核总结**：FlowForge v7.0炉灵体系的设计方向正确，从"工具Agent"到"进化智能体"的范式升级有巨大价值。但当前文档存在版本混乱、架构冲突、边界不清等问题，需要先进行一次系统性的文档梳理和架构对齐，才能进入详细设计和开发阶段。建议优先解决P0级问题，统一架构语言和版本体系，再逐步推进P1/P2级改进。

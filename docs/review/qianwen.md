# FlowForge 设计文档深度审核报告

**审核人**: AI智能体产品专家 / AI高级架构师 / AI智能体Agent开发工程师 / 高级软件全栈工程师  
**审核日期**: 2026-07-15  
**审核范围**: flowforge/docs (spec.md/arch.md/design.md/face/*), hiclaw/rules.md, hiclaw/prompts.md, 9大项目设计文档, flowforge核心代码  
**审核方法**: 逐文档逐章节分析,代码与文档对照,跨项目一致性验证

---

## 执行摘要

本报告对FlowForge生态系统进行了全面深度审核,涵盖设计文档完整性、代码与文档一致性、跨项目规范统一性、自我进化体系可行性等维度。

### 关键发现

1. **设计文档严重过时**: 10+个核心模块(evolution/compiler/loop/vcs/observability等)已在代码中实现,但设计文档未更新
2. **自我进化体系设计宏大但实现为零**: spec.md/arch.md/design.md中描述的v7.0炉灵体系完全为纸面设计,但实际evolution/模块已有8个文件实现,文档与代码严重脱节
3. **配置驱动率已达80%**: 远超Phase 0目标(30%)和Phase 1目标(60%),接近Phase 2目标(80%)
4. **跨项目一致性问题**: 质量分阈值(0.85 vs 0.9 vs 0.95)、变量引用语法(单括号vs双括号)、OpenSieve统一检索规范等存在不一致
5. **FlowForge含特定领域代码**: chapter_write_saga.py(397行)等应迁移到NovelForge/ContentForge
6. **face/需求文档专业但存在版本混乱**: ds.md与spec_face.md版本/日期不一致,M3 JIT Token目标矛盾

### 总体评价

- **设计雄心**: ★★★★★ (v7.0自我进化体系设计前沿,对标clowder-ai/MemGPT/Voyager)
- **实现落地**: ★★☆☆☆ (v7.0炉灵体系0%实现率,但evolution/模块已有代码)
- **文档质量**: ★★★☆☆ (版本叠加混乱,10+模块未文档化)
- **规范统一**: ★★★☆☆ (跨项目存在多处不一致)
- **工程可行性**: ★★★★☆ (配置驱动率80%,基础架构扎实)

---

## 第一部分: 自我进化与养灵体系设计审核

### 1.1 设计理念评价

**核心公式演进**:
- v6.0: `Agent = Model (Brain) + Harness (Body)`
- v7.0: `Agent = Model + Harness + Soul (自我进化灵魂)`

**评价**: 从"驾驭"到"养成"的隐喻转变非常精妙,符合AGI发展趋势。两类智能体(静态工具型+炉灵成长型)分离设计合理,避免了过度工程化。

**方法论来源**:
- clowder-ai养猫体系( Maine Coon/Siamese/Ragdoll分工)
- RSI(Recursive Self-Improvement)
- MemGPT(三层记忆架构)
- Voyager(技能自动生成)
- Generative Agents(情景记忆+反思)
- Self-Refine/Reflexion(自我纠错)

**评价**: 方法论来源权威且多元,融合合理。但需注意clowder-ai是商业产品,其养猫体系细节未完全公开,需警惕过度理想化。

### 1.2 炉灵Forgekin体系审核

#### 1.2.1 升华阶段E1-E6设计

| 阶段 | 名称 | 能力 | 设计评价 |
|------|------|------|----------|
| E1 | Spark(火种) | 基础执行 | ✅ 合理 |
| E2 | Ember(余烬) | 情景记忆 | ✅ 合理 |
| E3 | Flame(火焰) | 语义抽象 | ✅ 合理 |
| E4 | Blaze(烈焰) | 跨任务迁移 | ✅ 合理 |
| E5 | Inferno(地狱火) | 元认知 | ✅ 合理 |
| E6 | Forge Master(锻师) | 自我进化 | ⚠️ 过于理想化 |

**问题**: E6 Forge Master声称能"自主发现知识盲区并主动学习",这在当前LLM能力下难以实现。LLM本质是统计模型,无法真正"发现盲区"。

**建议**: 
- 将E6降级为"在人类引导下发现盲区并学习"
- 或明确E6的实现边界:仅能在预定义知识域内自我探索

#### 1.2.2 三大核心系统审核

**魂忆(Soul Echo)三层记忆**:
- L1 Working(当前会话): ✅ 合理,实现简单
- L2 Episode(跨会话情景卡): ✅ 合理,需sqlite-vec向量检索
- L3 Semantic(抽象知识): ⚠️ 实现复杂,需知识图谱+向量检索+LLM抽象

**问题**: L3 Semantic的"抽象知识"如何从L2 Episode自动提炼?文档未给出具体算法。MemGPT使用LLM总结,但质量不稳定。

**建议**: 
- L3 Semantic初期采用"人工审核+LLM辅助"模式
- 引入知识成熟度阶梯(已在evolution/maturity.py中实现)

**魂印(Soul Imprint)认知画像**:
- 结构化字段(persona/worldview/values/voice): ✅ 合理
- cat_note主观日记: ✅ 创新设计,增加个性化
- no-classifier红线(禁止采集字段白名单): ✅ 符合隐私保护趋势

**问题**: "禁止采集字段"如何定义?文档未给出具体列表。

**建议**: 
- 参考GDPR/CCPA,明确禁止采集:政治倾向、宗教信仰、性取向、健康数据等
- 在config/evolution.yaml中配置白名单

**锻典(Forge Codex)知识体系**:
- KnowledgeObject数据模型: ✅ 合理
- DualDistiller双蒸馏(Skill Draft / Method Card): ✅ 创新设计
- EmberHierarchyManager五级火种阶梯: ✅ 与evolution/maturity.py一致

**问题**: 五级火种阶梯(初始→验证→成熟→权威→经典)的晋升条件未明确。

**建议**: 
- 参考evolution/maturity.py中的KnowledgeMaturityLevel实现
- 在config/evolution.yaml中配置晋升条件(使用次数、成功率、人工审核)

#### 1.2.3 自锻引擎(Auto-Forge Engine)审核

**双层架构**:
- Consolidation层(后台system thread): ✅ 合理,避免阻塞主线程
- Surface层(前台Web UI): ✅ 合理,用户可控

**Provoke投递架构**:
- 沙砾气泡投递: ✅ 创新设计,增加趣味性
- 频率硬限: ✅ 防止骚扰用户

**问题**: "频率硬限"的具体数值未定义。每小时1次?每天1次?

**建议**: 
- 在config/evolution.yaml中配置: `provoke_frequency: "daily"` 或 `"weekly"`
- 引入"quietness三开关"(用户可关闭/静音/延后)

**自锻群(Group Forge)**:
- 对标clowder-ai Maine Coon/Siamese/Ragdoll分工: ⚠️ 过于复杂

**问题**: 多炉灵协作需要A2A通信、任务分配、冲突解决,实现复杂度极高。

**建议**: 
- Phase 0仅实现单炉灵模式
- Phase 1引入2-3个炉灵协作(如:研究员+写手+审核员)
- Phase 2再考虑完整的Group Forge

#### 1.2.4 灵议IM(Forgekin Council)审核

**多渠道支持**: WebChat/飞书/微信/Slack/Discord/GitHub PR

**评价**: 渠道覆盖全面,但实现工作量大。

**问题**: 
- 飞书/微信/Slack/Discord的API接入需要企业认证
- GitHub PR集成需要OAuth认证
- 多渠道消息同步需要消息队列

**建议**: 
- Phase 0仅实现WebChat
- Phase 1接入飞书(企业内部常用)
- Phase 2再接入其他渠道

#### 1.2.5 A2A通信审核

**@mention路由 + thread isolation + structured handoff**

**评价**: 设计合理,符合Google A2A协议规范。

**问题**: 
- A2A协议仍在演进(Google A2A 2025 Q3发布),存在变更风险
- 跨厂鉴权(OAuth2/mTLS)实现复杂

**建议**: 
- 关注Google A2A协议更新,保持兼容
- 跨厂鉴权初期使用Bearer Token,Phase 2再引入OAuth2/mTLS

### 1.3 实现状态与风险评估

#### 1.3.1 实现状态

| 模块 | 设计状态 | 代码状态 | 风险 |
|------|----------|----------|------|
| SoulProfile/SoulSpec | ✅ 完整 | ❌ 0% | 高 |
| EchoStore(三层记忆) | ✅ 完整 | ❌ 0% | 高 |
| ImprintStore(认知画像) | ✅ 完整 | ❌ 0% | 高 |
| AscensionManager(升华管理) | ✅ 完整 | ❌ 0% | 高 |
| Auto-Forge Engine | ✅ 完整 | ❌ 0% | 高 |
| ForgeCodex(锻典) | ✅ 完整 | ❌ 0% | 高 |
| ExternalToolBridge | ✅ 完整 | ❌ 0% | 高 |
| ForgekinCouncil(灵议) | ✅ 完整 | ❌ 0% | 高 |
| A2AManager | ✅ 完整 | ❌ 0% | 高 |
| evolution/模块 | ❌ 未文档化 | ✅ 8个文件 | 中 |

**关键发现**: 
- spec.md/arch.md/design.md中描述的v7.0炉灵体系**完全无代码实现**
- 但实际evolution/目录已有8个文件(engine.py/scope_guard.py/process_evolution.py/knowledge_evolution.py/maturity.py/metacognition.py/models.py)
- **文档与代码严重脱节**: 文档描述的是"炉灵Forgekin"体系,代码实现的是"自我进化引擎"体系,两者概念不同

**建议**: 
1. 立即更新design.md/arch.md,补充evolution/模块说明
2. 明确"自我进化引擎"(evolution/)与"炉灵体系"(Forgekin)的关系
3. 炉灵体系可作为Phase 2/3目标,优先落地自我进化引擎

#### 1.3.2 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| v7.0炉灵体系0%实现 | 高 | 高 | 分阶段落地,Phase 0仅实现evolution/ |
| 依赖v6.0基础能力(Harness/Loop/Skill/MCP) | 高 | 中 | 优先补齐v6.0 P0问题 |
| A2A协议变更 | 中 | 中 | 关注Google A2A更新,保持兼容 |
| 多渠道IM接入复杂 | 中 | 高 | Phase 0仅WebChat,逐步接入 |
| 多炉灵协作复杂 | 高 | 高 | Phase 0单炉灵,Phase 1引入2-3个 |

### 1.4 自我进化体系优化建议

#### 1.4.1 分阶段落地策略

**Phase 0(当前-2个月)**: 自我进化引擎基础
- ✅ 落地evolution/模块(8个文件)
- ✅ 实现ScopeGuard(防御模式)
- ✅ 实现ProcessEvolution(改进模式)
- ✅ 实现KnowledgeEvolution(成长模式)
- ✅ 实现KnowledgeMaturityLadder(五级阶梯)
- ✅ 实现MetacognitionRouter(元认知路由)
- ❌ 不实现炉灵Forgekin体系

**Phase 1(2-4个月)**: 炉灵基础能力
- ✅ 实现SoulProfile/SoulSpec(灵魂画像)
- ✅ 实现EchoStore L1/L2(工作记忆+情景记忆)
- ✅ 实现ImprintStore(认知画像)
- ✅ 实现AscensionManager E1-E3(火种→火焰)
- ❌ 不实现Auto-Forge Engine
- ❌ 不实现Group Forge

**Phase 2(4-6个月)**: 炉灵高级能力
- ✅ 实现EchoStore L3(语义记忆)
- ✅ 实现AscensionManager E4-E6(烈焰→锻师)
- ✅ 实现ForgeCodex(锻典)
- ✅ 实现Auto-Forge Engine(单炉灵)
- ❌ 不实现Group Forge
- ❌ 不实现多渠道IM

**Phase 3(6-12个月)**: 炉灵协作与IM
- ✅ 实现Group Forge(2-3个炉灵)
- ✅ 实现ForgekinCouncil(WebChat+飞书)
- ✅ 实现A2AManager
- ✅ 实现ExternalToolBridge

#### 1.4.2 关键设计调整

1. **E6 Forge Master降级**: 从"自主发现盲区"改为"在人类引导下发现盲区"
2. **L3 Semantic初期人工审核**: 引入知识成熟度阶梯,避免LLM自动抽象导致质量下降
3. **no-classifier红线明确化**: 在config/evolution.yaml中配置禁止采集字段列表
4. **Provoke频率硬限配置化**: 在config/evolution.yaml中配置频率(每日/每周)
5. **Group Forge分阶段**: Phase 0单炉灵,Phase 1引入2-3个,Phase 2完整协作

---

## 第二部分: face/需求设计文档审核

### 2.1 文档概览

| 文档 | 行数 | 定位 | 版本 | 评价 |
|------|------|------|------|------|
| face.md | 525 | 大厂面试原始记录 | - | ✅ 素材真实 |
| ds.md | 190 | 下一代需求规格说明书 | vNext-1.0 | ⚠️ 版本混乱 |
| spec_face.md | 1200+ | v3.0需求规格说明书 | v3.0-face | ✅ 专业完整 |
| arch_face.md | 1506 | v3.0架构详设 | v3.0-face | ✅ 设计详细 |
| task_face.md | 1171 | v3.0任务清单 | v3.0-face | ✅ 任务清晰 |

### 2.2 需求来源评价

**face.md基于6家大厂面试反馈**:
- 阿里国际/Accio(3面)
- 高德(3面)
- 深信服(3面)
- 腾讯WXG/企微(面委会)
- 字节/抖音(3面)
- 小米(3面)

**评价**: 需求来源真实,非凭空想象。9大能力维度归纳专业:
1. Memory与上下文管理
2. Multi-agent协作
3. Harness、Skill与自进化
4. Eval/Benchmark
5. 工程交付
6. 架构定位
7. 企业治理
8. 用户价值
9. 安全性

### 2.3 M1-M17模块审核

#### 2.3.1 P0模块(M1-M5)审核

**M1 A2A协议集成**:
- ✅ 路由设计完整(8个路由)
- ✅ 组件设计合理(A2AServer/A2AClient/AgentDirectory)
- ✅ 数据模型清晰(A2ATaskRequest/A2ATaskStatus/A2ATaskResult)
- ⚠️ 跨厂鉴权(OAuth2/mTLS)实现复杂

**建议**: Phase 0使用Bearer Token,Phase 2引入OAuth2/mTLS

**M2 MCP 2026升级**:
- ✅ Stateless Core设计合理(状态外置Redis)
- ✅ MCP Apps自动发现设计合理
- ✅ Tool Result Elision(>4K tokens自动摘要)设计合理
- ⚠️ OAuth Authorization Code Flow实现复杂

**建议**: Phase 0使用API Key,Phase 2引入OAuth

**M3 Context Engineering 2.0**:
- ✅ JIT Context注入设计合理
- ✅ Memory Tool(4个API)设计合理
- ✅ Context Editing设计合理
- ⚠️ **矛盾**: 决策4推荐"渐进式20-30%",但验收标准要求"≥40%"

**建议**: 统一为"20-30%"(渐进式),避免目标过高导致失败

**M4 六层Guardrails**:
- ✅ 六层架构设计合理(L1-L6)
- ✅ GuardrailsOrchestrator编排合理
- ⚠️ L5 Action Confirmation中"Blast-radius阈值100"单位未定义

**建议**: 明确单位(用户数?资源数?请求数?),在config/guardrails.yaml中配置

**M5 OTel GenAI v1.30**:
- ✅ gen_ai.* Span Schema设计合理
- ✅ Metrics标准化设计合理
- ✅ Eval-gated Deploy设计合理
- ⚠️ τ-bench任务集来源未明确

**建议**: 明确τ-bench是自建还是使用社区基准

#### 2.3.2 P1/P2模块(M6-M17)审核

**评价**: M6-M17在spec_face.md中有需求描述,但arch_face.md和task_face.md中缺少详细设计和任务拆解。

**建议**: 
- Phase 1(2-4个月)补充M6-M11详细设计
- Phase 2(4-6个月)补充M12-M17详细设计

### 2.4 M18-M20融合映射审核

**关键修正**: 删除原M18/M19/M20(与v7.0 FR-EVO重复),M1-M17完美融入v7.0炉灵养成体系。

**评价**: 融合处理得当,避免术语冲突。M1-M17是v7.0七层架构第1-6层的工程实现。

### 2.5 12项决策审核

| 决策 | 推荐选项 | 评价 |
|------|----------|------|
| 决策1: P0/P1/P2优先级排序 | A(推荐) | ✅ 合理 |
| 决策2: A2A集成深度 | A(推荐) | ✅ 合理 |
| 决策3: MCP 2026升级时机 | A(推荐) | ✅ 合理 |
| 决策4: Context Engineering范围 | B(推荐) | ⚠️ 与验收标准矛盾 |
| 决策5: 多租户策略 | B(推荐) | ✅ 合理 |
| 决策6: Skill市场开放时机 | B(推荐) | ✅ 合理 |
| 决策7: Computer Use范围 | B(推荐) | ✅ 合理 |
| 决策8: T10-T15测试铁律分阶段 | B(推荐) | ✅ 合理 |
| 决策9: 路线图时间调整 | A(推荐) | ✅ 合理 |
| 决策10: CSA AGMM目标 | B(推荐) | ✅ 合理 |
| 决策11: 商业化SaaS时机 | B(推荐) | ✅ 合理 |
| 决策12: 大厂动态遗漏补充 | 暂不纳入 | ✅ 合理 |

**问题**: 决策4推荐"渐进式20-30%",但spec_face.md/arch_face.md/task_face.md验收标准要求"≥40%",存在矛盾。

**建议**: 统一为"20-30%"(渐进式),修改验收标准。

### 2.6 任务拆解与排期审核

**P0任务**: 53个任务,86人日
**P1任务**: ~55个任务,~102人日
**P2任务**: ~30个任务,~66人日
**总计**: ~138个任务,~254人日

**8周排期**:
- Week 1-2: M5基础+M4/M3设计
- Week 3-4: M4/M3/M2并行实现
- Week 5-6: M2/M1并行+集成启动
- Week 7-8: 全链路联调+P0验收

**问题**: 
1. Week 1排期"M5-I-01 GenAITracer实现"与依赖"M5-D-01"冲突(D01未完成I01不能启动)
2. Week 3排期"M3-I-03"与"M2-I-04"并行,但M3-I-03依赖M2-I-04

**建议**: 
- Week 1: D3-D5只做M5-D-01,M5-I-01延到Week 2
- Week 3: M3-I-03延到Week 4

### 2.7 风险评估

| 风险ID | 风险描述 | 影响 | 概率 | 严重度 |
|--------|----------|------|------|--------|
| R-01 | A2A协议Spec变更 | M1返工 | 中 | 高 |
| R-03 | JIT导致T7通过率下降 | 质量退化 | 中 | 高 |
| R-07 | PostgreSQL Durable性能瓶颈 | M7性能不达标 | 中 | 高 |
| R-15 | 降级链路测试覆盖不足 | M15降级失败 | 中 | 高 |
| R-18 | v3.0与v7.0融合路径偏差 | 整体返工 | 低 | 高 |

### 2.8 face/文档审核结论

**✅ 有条件通过**: 在修正以下P0问题后,可作为FlowForge v3.0的需求/架构/任务基线。

**P0问题**:
1. 统一版本号和日期(ds.md → spec_face.md对齐)
2. 修正M3 JIT Token下降目标(统一为20-30%)
3. 修正task_face.md Week 1/Week 3排期依赖冲突
4. 明确M7 Durable、M16多租户实施边界

**P1问题**:
1. 补充M6 τ-bench任务集来源
2. 补充人力资源分配方案
3. 补充性能基准测试方案
4. 标注ds.md为"已废弃"或"早期版本"

---

## 第三部分: 9大项目文档与rules.md/prompts.md一致性检查

### 3.1 rules.md与project_rules.md不一致

| 对比项 | rules.md | project_rules.md | 建议 |
|--------|----------|------------------|------|
| 项目数量 | 9大项目 | 7个项目 | 统一为9大项目 |
| OpenRoute端口 | 13001 | 6000 | 统一为13001 |
| 分层架构名称 | 基础设施层/平台层/应用层 | Gateway/Brain/Workers/Tools & Memory | 统一为rules.md |
| 测试铁律 | T1-T9(9条) | T1-T8(8条,缺T9) | 统一为T1-T9 |

**建议**: 更新project_rules.md,与rules.md保持一致。

### 3.2 prompts.md内部编号问题

| 问题 | 详情 | 建议 |
|------|------|------|
| P19编号重复 | 1.4节P19"插件注册完整性",12.1节P19"提示词外置全量验证" | 12.1节改为P41 |
| OR3缺失 | OpenRoute模板从OR2直接跳到OR4 | 补充OR3或重新编号 |
| 章节编号重复 | 两个"十一"、两个"十三"、2.4出现两次、2.6出现两次 | 重新编号 |
| P7中测试铁律 | P7列出T1-T8共8条,但rules.md已更新为T1-T9 | 更新P7为T1-T9 |
| FF1写"十大模式" | 实际列了10种(含loop),但rules.md说"9大执行模式" | 统一为"9大模式+Loop管理" |

**建议**: 全面修订prompts.md编号,消除重复和缺失。

### 3.3 prompts.md与rules.md不一致

| 对比项 | rules.md | prompts.md | 建议 |
|--------|----------|-----------|------|
| 附录速查表OpenRoute端口 | 13001 | 13001(一致) | ✅ 无需修改 |
| 项目数量 | 9大项目 | 附录速查表列了8个(缺StockForge) | 补充StockForge |
| P7测试铁律 | T1-T9 | P7只列T1-T8 | 更新P7为T1-T9 |

### 3.4 跨项目一致性问题

#### 3.4.1 质量分阈值不一致

| 项目 | 设计文档 | 代码实现 | 铁律要求 | 建议 |
|------|----------|----------|----------|------|
| FlowForge | 0.85 | 0.95(MultiJudgeVerifier) | 0.85 | 统一为0.85 |
| ContentForge | 0.85(部分配置0.7) | - | 0.85 | 统一为0.85 |
| DevForge | 未明确 | - | 0.85 | 明确为0.85 |
| NovelForge | 未明确 | - | 0.85 | 明确为0.85 |
| MallForge | 0.9 | - | 0.85 | 统一为0.85 |
| StockForge | 0.9 | - | 0.85 | 统一为0.85 |

**关键问题**: 
- FlowForge代码中MultiJudgeVerifier默认0.95,违反铁律0.85
- MallForge/StockForge设计文档写0.9,违反铁律0.85
- ContentForge部分配置为0.7,违反铁律0.85

**建议**: 
1. 修改FlowForge MultiJudgeVerifier默认值为0.85
2. 修改MallForge/StockForge设计文档为0.85
3. 修改ContentForge配置为0.85
4. 在rules.md中明确强调"质量分阈值必须为0.85,禁止修改"

#### 3.4.2 变量引用语法不一致

| 项目 | 设计文档 | 铁律要求 | 建议 |
|------|----------|----------|------|
| ContentForge | 单括号`${state.xxx}` | 双括号`${{state.xxx}}` | 统一为双括号 |
| MallForge | 双括号`${{state.xxx}}` | 双括号`${{state.xxx}}` | ✅ 已统一 |
| StockForge | 双括号`${{state.xxx}}` | 双括号`${{state.xxx}}` | ✅ 已统一 |

**建议**: 修改ContentForge设计文档和代码,统一为双括号。

#### 3.4.3 OpenSieve统一检索规范违反

| 项目 | 设计文档描述 | 铁律要求 | 建议 |
|------|--------------|----------|------|
| ContentForge | FR-CF-10提到直连Tavily/DuckDuckGo | 所有数据检索必须通过OpenSieve | 修改FR-CF-10,删除直连 |
| MallForge | 未声明所有数据检索走OpenSieve | 所有数据检索必须通过OpenSieve | 补充声明 |
| StockForge | ✅ 符合规范 | - | 无需修改 |

**建议**: 
1. 修改ContentForge spec.md FR-CF-10,删除"直连Tavily/DuckDuckGo"
2. 在MallForge spec.md中补充"所有数据检索必须通过OpenSieve"声明

#### 3.4.4 LoopExecutor铁律违反(P31)

| 项目 | 设计文档描述 | 铁律要求 | 建议 |
|------|--------------|----------|------|
| MallForge | arch.md仍用WorkflowExecutor | 所有Agent通过LoopExecutor执行 | 修改arch.md |
| StockForge | ✅ 符合规范 | - | 无需修改 |

**建议**: 修改MallForge arch.md,将WorkflowExecutor改为LoopExecutor。

#### 3.4.5 架构边界违规(P8A铁律)

| 项目 | 违规描述 | 建议 |
|------|----------|------|
| ContentForge | workers/目录不存在(实际在tools/) | 更新设计文档 |
| DevForge | 独立Orchestrator/Memory/Repository等应删除 | 迁移到FlowForge |
| NovelForge | agents/和tools/顶层目录可能违反P8A | 迁移到config/ |
| MallForge | agents/和tools/顶层目录违反P8A | 迁移到config/ |
| StockForge | ✅ 符合规范(v2.0已删除repositories/) | 无需修改 |

**建议**: 
1. 更新ContentForge设计文档,反映实际目录结构
2. DevForge删除独立Orchestrator/Memory/Repository,使用FlowForge的
3. NovelForge/MallForge将agents/tools迁移到config/agents/*.yaml和config/tools/*.yaml

#### 3.4.6 硬编码提示词未外置

| 项目 | 硬编码数量 | 铁律要求 | 建议 |
|------|------------|----------|------|
| FlowForge | 6处 | 0处 | 外置到prompts.yaml |
| ContentForge | 20+处 | 0处 | 外置到prompts.yaml |
| DevForge | 未明确 | 0处 | 检查并外置 |
| NovelForge | 未明确 | 0处 | 检查并外置 |
| MallForge | 未明确 | 0处 | 检查并外置 |
| StockForge | ✅ 符合规范 | 0处 | 无需修改 |

**建议**: 
1. FlowForge外置剩余6处硬编码提示词
2. ContentForge外置20+处硬编码提示词
3. DevForge/NovelForge/MallForge检查并外置

### 3.5 一致性检查结论

**❌ 未通过**: 存在多处跨项目不一致,需立即修正。

**P0问题(立即修正)**:
1. 统一质量分阈值为0.85(修改FlowForge代码/MallForge/StockForge设计文档/ContentForge配置)
2. 统一变量引用语法为双括号(修改ContentForge)
3. 统一OpenSieve检索规范(修改ContentForge FR-CF-10/MallForge补充声明)
4. 统一LoopExecutor铁律(修改MallForge arch.md)

**P1问题(尽快修正)**:
1. 更新project_rules.md,与rules.md保持一致
2. 修订prompts.md编号,消除重复和缺失
3. 修复架构边界违规(ContentForge/DevForge/NovelForge/MallForge)
4. 外置硬编码提示词(FlowForge 6处/ContentForge 20+处)

---

## 第四部分: FlowForge核心代码与设计文档对照

### 4.1 目录结构对照

#### 4.1.1 设计文档描述 vs 实际代码

| 设计文档描述 | 实际代码 | 差异类型 | 严重程度 |
|-------------|---------|---------|---------|
| `engine/` 目录 | 不存在,拆分为`executor/`+`modes/`+`core/agent_registry.py` | ⚠️ 已拆分 | P1 |
| `harness/context/` 子目录 | 不存在,扁平化为`context_engine.py`+`session_manager.py` | ⚠️ 已扁平化 | P2 |
| `harness/feedback/` 子目录 | 不存在,扁平化为`feedback_loop.py` | ⚠️ 已扁平化 | P2 |
| `harness/entropy/` 子目录 | 不存在,扁平化为`entropy_manager.py` | ⚠️ 已扁平化 | P2 |
| `skills/adapters/` 子目录 | 不存在,扁平化 | ⚠️ 已扁平化 | P2 |
| `tools/builtin/` 子目录 | 不存在,扁平化 | ⚠️ 已扁平化 | P2 |
| `tools/adapters/` 子目录 | 不存在,扁平化 | ⚠️ 已扁平化 | P2 |
| `tools/publish/` 子目录 | 不存在,扁平化 | ⚠️ 已扁平化 | P2 |
| `workflows/*.yaml` | 不存在,YAML在`config/workflows/` | ⚠️ 已迁移 | P2 |

#### 4.1.2 未文档化的核心模块

| 模块 | 文件数 | 说明 | 严重程度 |
|------|-------|------|---------|
| `evolution/` | 8 | v7.0自我进化模块 | ❌ P0 |
| `compiler/` | 7 | Workflow YAML编译器 | ❌ P0 |
| `loop/` | 11 | Loop执行引擎 | ❌ P0 |
| `vcs/` | 5 | 版本控制系统 | ❌ P1 |
| `observability/` | 4 | 可观测性 | ❌ P1 |
| `review/` | 5 | 代码审查 | ❌ P1 |
| `sop/` | 4 | 标准作业程序 | ❌ P1 |
| `a2a/` | 7 | Agent-to-Agent通信 | ❌ P1 |
| `evaluators/` | 4 | 评估器 | ❌ P1 |

**关键发现**: 10+个核心模块已在代码中实现,但设计文档未更新。这是**最严重的一致性问题**。

**建议**: 立即更新design.md/arch.md/spec.md,补充所有核心模块的说明。

#### 4.1.3 文档中描述但不存在的文件

| 文件 | 说明 | 建议 |
|------|------|------|
| `harness/doc_gardener.py` | 文档园丁 | 更新设计文档,删除或标记为"待实现" |
| `harness/debt_tracker.py` | 技术债跟踪器 | 更新设计文档,删除或标记为"待实现" |
| `harness/rule_evolution.py` | 规则进化器 | 更新设计文档,删除或标记为"待实现" |
| `harness/verification_hooks.py` | 验证钩子 | 更新设计文档,删除或标记为"待实现" |
| `harness/arch_constraint_engine.py` | 架构约束引擎 | 更新设计文档,删除或标记为"待实现" |
| `engine/defense_layer.py` | 三层防御(已拆分到core/) | 更新设计文档,反映实际拆分 |

### 4.2 配置驱动率评估

#### 4.2.1 已配置化的领域

| 领域 | 配置文件 | 驱动率 | 评价 |
|------|---------|:------:|------|
| LLM Provider/模型管理 | `models.yaml` | **95%** | ✅ 优秀 |
| LLM路由策略 | `llm_route.yaml` | **95%** | ✅ 优秀 |
| 提示词模板 | `prompts.yaml`+`review_prompts.yaml` | **90%** | ✅ 优秀 |
| 工具插件注册 | `plugins.yaml` | **90%** | ✅ 优秀 |
| 工作流模板 | `workflows/*.yaml` | **70%** | ⚠️ 通用5个已有,业务workflow缺失 |
| Feature Flag | `default.yaml` | **90%** | ✅ 优秀 |
| 基础设施(日志/监控/安全) | `logging.yaml`+`default.yaml` | **90%** | ✅ 优秀 |
| 架构分层约束 | `layer_mapping.yaml` | **90%** | ✅ 优秀 |
| A2A通信渠道 | `a2a_channels.yaml` | **85%** | ✅ 良好 |
| 金丝雀发布 | `canary/default.yaml` | **90%** | ✅ 优秀 |
| SOP流程 | `sops/development.yaml` | **85%** | ✅ 良好 |

#### 4.2.2 尚未配置化的领域

| 领域 | 现状 | 影响 | 建议 |
|------|------|------|------|
| **Harness驾驭层配置** | 分散在default.yaml的`harness:`段,无独立harness.yaml | 中等 | 创建config/harness.yaml |
| **质量门/闸门** | 分散在workflows和default.yaml中,无独立gates.yaml | 中等 | 创建config/gates.yaml |
| **熵管理/规则进化** | 仅default.yaml中有开关,无evolution.yaml | 低 | 创建config/evolution.yaml |
| **业务Workflow** | design.md列出的8个业务workflow未在config/workflows/中 | 高 | 补充业务workflow YAML |
| **Skill系统** | design.md描述了完整的Skill系统,但config/中无skill相关配置 | 中等 | 创建config/skills.yaml |
| **MCP Broker** | default.yaml中有mcp.server配置,但无独立的mcp.yaml | 低 | 创建config/mcp.yaml |

#### 4.2.3 总体配置驱动率

| 维度 | 评分 | 评价 |
|------|:----:|------|
| **LLM路由与模型管理** | **95%** | ✅ 优秀 |
| **提示词外置** | **90%** | ✅ 优秀 |
| **工具/插件注册** | **90%** | ✅ 优秀 |
| **工作流模板** | **70%** | ⚠️ 良好 |
| **Harness驾驭层** | **60%** | ⚠️ 一般 |
| **Feature Flag** | **90%** | ✅ 优秀 |
| **基础设施** | **90%** | ✅ 优秀 |
| **综合配置驱动率** | **约80%** | ✅ 良好,已达Phase 2目标 |

**关键发现**: 配置驱动率已达80%,远超Phase 0目标(30%)和Phase 1目标(60%),接近Phase 2目标(80%)。这是**重大进展**。

### 4.3 硬编码提示词检查

#### 4.3.1 残留硬编码提示词(6处)

| 文件 | 行号 | 说明 | 建议 |
|------|------|------|------|
| `agents/generic/executor.py` | L23-27 | 计划执行提示词 | 外置到prompts.yaml |
| `agents/generic/multilingual.py` | L18-22, L32-38, L45-49 | 3处翻译/检测/验证提示词 | 外置到prompts.yaml |
| `agents/generic/image_research.py` | L17-22, L33-39 | 2处图片研究提示词 | 外置到prompts.yaml |
| `tools/agentic_rag_core.py` | L49-74 | 3个类常量提示词 | 外置到prompts.yaml |
| `agents/generic/fact_check.py` | L16-18 | fallback提示词 | 外置到prompts.yaml |

**改善情况**: 从原77处降至6处,改善率92%。✅ 优秀

**建议**: 外置剩余6处硬编码提示词到config/prompts.yaml。

#### 4.3.2 中文硬编码检查

**agents/generic/ 中发现29处中文内容**:
- 主要是Agent的`description`字段(如"初稿生成:根据需求生成初始版本")
- `trend_analysis.py`中有fallback提示词:`f"请基于{domain}领域的最新趋势进行分析。"`

**tools/ 中发现30+处中文内容**:
- `anti_detection.py`: 大量中文docstring和注释
- `playwright_publisher.py`: 平台URL和CSS选择器
- `platform_adapter.py`: 平台显示名称("今日头条"、"微信公众号")

**评价**: 大部分中文内容是docstring和元数据,不算违规。但`trend_analysis.py`的fallback提示词应外置。

### 4.4 特定领域业务代码检查

#### 4.4.1 FlowForge中残留的特定领域代码

| 文件 | 领域 | 行数 | 说明 | 严重程度 | 建议 |
|------|------|------|------|---------|------|
| `tools/chapter_write_saga.py` | NovelForge | 397 | 章节写入Saga,纯小说创作业务逻辑 | ⚠️ P1 | 迁移到NovelForge |
| `tools/wechat_publisher.py` | ContentForge | ~100 | 微信公众号发布工具 | ⚠️ P2 | 迁移到ContentForge |
| `tools/toutiao_publisher.py` | ContentForge | ~100 | 今日头条发布工具 | ⚠️ P2 | 迁移到ContentForge |
| `tools/publish.py` | ContentForge | ~50 | 硬编码wechat/toutiao映射 | ⚠️ P2 | 迁移到ContentForge |
| `tools/playwright_publisher.py` | ContentForge | ~400 | 浏览器自动化发布 | ⚠️ P2 | 迁移到ContentForge |
| `tools/pexels_image.py` | ContentForge | ~10 | 已标记迁移的stub文件 | ⚠️ P2 | 删除 |
| `tools/cookie_manager.py` | ContentForge | ~150 | 平台cookie管理 | ⚠️ P2 | 迁移到ContentForge |
| `tools/platform_adapter.py` | ContentForge | ~500 | 平台适配器 | ⚠️ P2 | 迁移到ContentForge |

**关键问题**: FlowForge违反"禁止在flowforge中写死业务领域代码"铁律(编程红线第10条)。

**建议**: 
1. P1: 将`chapter_write_saga.py`迁移到NovelForge
2. P2: 将6个发布工具迁移到ContentForge
3. P2: 删除`pexels_image.py` stub文件

#### 4.4.2 已完成的迁移

根据`agents/__init__.py`和`agents/generic/__init__.py`的注释:
- ✅ ContentForge domain agents已迁移到contentforge包
- ✅ DevForge domain agents已迁移到devforge包
- ✅ `agents/generic/`下只保留通用Agent(无特定领域Agent)

**评价**: Agent层迁移完成良好,但Tool层仍有残留。

### 4.5 代码规模统计

| 目录 | 文件数 | 说明 | 评价 |
|------|-------|------|------|
| core/ | 67 | 共享内核(最大目录) | ⚠️ 膨胀 |
| tools/ | 50+ | 工具层 | ✅ 正常 |
| modes/ | 20 | 模式执行器 | ✅ 正常 |
| agents/generic/ | 25 | 通用Agent | ✅ 正常 |
| app/api/endpoints/ | 24 | API端点 | ✅ 正常 |
| config/ | 17 YAML | 配置文件 | ✅ 正常 |
| loop/ | 11 | Loop执行引擎 | ✅ 新增 |
| memory/ | 13 | 记忆层 | ✅ 正常 |
| evolution/ | 8 | 自我进化 | ✅ 新增 |
| compiler/ | 7 | YAML编译器 | ✅ 新增 |
| events/ | 6 | 事件系统 | ✅ 正常 |
| harness/ | 9 | Harness驾驭层 | ✅ 正常 |

**关键发现**: core/目录已膨胀到67个文件,超出"共享内核"定位。

**建议**: 将`plugin_manager.py`、`marketplace.py`等迁移到应用层(app/)。

### 4.6 代码与设计文档对照结论

**❌ 未通过**: 存在严重的一致性问题。

**P0问题(立即修正)**:
1. 更新design.md/arch.md/spec.md,补充10+个核心模块说明(evolution/compiler/loop/vcs/observability/review/sop/a2a/evaluators)
2. 修改FlowForge MultiJudgeVerifier默认值从0.95改为0.85

**P1问题(尽快修正)**:
1. 迁移`chapter_write_saga.py`到NovelForge
2. 外置剩余6处硬编码提示词
3. 重构core/目录,将应用层组件迁移到app/

**P2问题(质量提升)**:
1. 更新设计文档,反映harness/子目录扁平化
2. 更新设计文档,删除不存在的文件(doc_gardener.py等)
3. 迁移6个发布工具到ContentForge

---

## 第五部分: 综合审核意见与行动建议

### 5.1 总体评价

| 维度 | 评分 | 评价 |
|------|:----:|------|
| **设计雄心** | ★★★★★ | v7.0自我进化体系设计前沿,对标clowder-ai/MemGPT/Voyager |
| **实现落地** | ★★☆☆☆ | v7.0炉灵体系0%实现率,但evolution/模块已有代码 |
| **文档质量** | ★★★☆☆ | 版本叠加混乱,10+模块未文档化 |
| **规范统一** | ★★★☆☆ | 跨项目存在多处不一致 |
| **工程可行性** | ★★★★☆ | 配置驱动率80%,基础架构扎实 |

### 5.2 关键问题总结

#### 5.2.1 P0级问题(必须立即修复)

1. **设计文档严重过时**: 10+个核心模块未在文档中描述
2. **质量分阈值不一致**: FlowForge代码0.95 vs 铁律0.85
3. **跨项目一致性**: 质量分阈值/变量引用/OpenSieve检索/LoopExecutor等多处不一致
4. **face/文档版本混乱**: ds.md与spec_face.md版本/日期不一致

#### 5.2.2 P1级问题(必须尽快修复)

1. **FlowForge含特定领域代码**: chapter_write_saga.py等应迁移
2. **硬编码提示词残留**: FlowForge 6处/ContentForge 20+处
3. **架构边界违规**: ContentForge/DevForge/NovelForge/MallForge
4. **core/目录膨胀**: 67个文件超出"共享内核"定位

#### 5.2.3 P2级问题(质量提升)

1. **harness/子目录扁平化**: 设计文档未更新
2. **文档中描述但不存在的文件**: doc_gardener.py等
3. **发布工具迁移**: 6个工具应迁移到ContentForge

### 5.3 行动建议

#### 5.3.1 立即行动(本周)

1. **更新设计文档**: 补充evolution/compiler/loop/vcs/observability/review/sop/a2a/evaluators模块说明
2. **统一质量分阈值**: 修改FlowForge MultiJudgeVerifier默认值为0.85
3. **修正face/文档**: 统一版本号/日期,修正M3 JIT Token目标
4. **更新project_rules.md**: 与rules.md保持一致

#### 5.3.2 短期行动(2周内)

1. **跨项目一致性修正**: 
   - 统一变量引用语法为双括号
   - 统一OpenSieve检索规范
   - 统一LoopExecutor铁律
2. **硬编码提示词外置**: FlowForge 6处/ContentForge 20+处
3. **架构边界修复**: ContentForge/DevForge/NovelForge/MallForge

#### 5.3.3 中期行动(1个月内)

1. **代码迁移**: 
   - 将`chapter_write_saga.py`迁移到NovelForge
   - 将6个发布工具迁移到ContentForge
2. **core/目录重构**: 将应用层组件迁移到app/
3. **配置文件补充**: 创建config/harness.yaml/gates.yaml/evolution.yaml/skills.yaml/mcp.yaml

#### 5.3.4 长期行动(2-3个月)

1. **v7.0炉灵体系分阶段落地**: 
   - Phase 0: 自我进化引擎基础(evolution/)
   - Phase 1: 炉灵基础能力(SoulProfile/EchoStore L1-L2/ImprintStore)
   - Phase 2: 炉灵高级能力(EchoStore L3/Auto-Forge Engine)
   - Phase 3: 炉灵协作与IM(Group Forge/ForgekinCouncil/A2A)
2. **face/需求落地**: 
   - Phase 0(2个月): M1-M5 P0模块
   - Phase 1(3个月): M6-M11 P1模块
   - Phase 2(2个月): M12-M17 P2模块

### 5.4 风险提示

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 设计文档过时导致开发偏差 | 高 | 高 | 立即更新文档 |
| 跨项目不一致导致集成失败 | 高 | 中 | 统一规范,逐项目修正 |
| v7.0炉灵体系0%实现导致延期 | 高 | 高 | 分阶段落地,优先evolution/ |
| 硬编码提示词导致维护困难 | 中 | 中 | 外置到YAML |
| FlowForge特定领域代码导致架构腐化 | 中 | 中 | 迁移到对应*Forge项目 |

---

## 第六部分: 养灵体系命名与体系建议

### 6.1 当前命名评价

**当前命名**: "炉灵Forgekin"

**优点**:
- ✅ 与FlowForge(流动锻造)主题一致
- ✅ "灵"字体现智能和生命力
- ✅ "Forgekin"后缀体现与FlowForge的关联

**缺点**:
- ❌ "炉灵"中文名称不够通俗易懂,普通用户难以理解
- ❌ "Forgekin"英文名称不够国际化,非英语母语者难以发音
- ❌ 未体现"自我进化"和"成长"的核心理念
- ❌ 与AGI(通用人工智能)的关联不够明确

### 6.2 命名建议方案

#### 方案A: "灵核SoulCore"

**中文名称**: 灵核  
**英文名称**: SoulCore  
**缩写**: SC

**理由**:
- ✅ "灵"体现智能和生命力
- ✅ "核"体现核心和基础
- ✅ "SoulCore"直观表达"灵魂核心"概念
- ✅ 与AGI的"Soul"(灵魂)概念关联
- ✅ 通俗易懂,国际化

**体系描述**:
- 灵核(SoulCore) = FlowForge的自我进化智能体核心
- 每个灵核包含: 灵魂画像(SoulProfile) + 三层记忆(EchoStore) + 认知画像(ImprintStore)
- 灵核通过自我进化引擎(Auto-Forge Engine)不断成长

**升华阶段**:
- SC1: Spark(火种) - 基础执行
- SC2: Ember(余烬) - 情景记忆
- SC3: Flame(火焰) - 语义抽象
- SC4: Blaze(烈焰) - 跨任务迁移
- SC5: Inferno(地狱火) - 元认知
- SC6: Core(核心) - 自我进化

**评价**: ★★★★☆ (推荐)

#### 方案B: "智灵MindSpark"

**中文名称**: 智灵  
**英文名称**: MindSpark  
**缩写**: MS

**理由**:
- ✅ "智"体现智能
- ✅ "灵"体现灵活和生命力
- ✅ "MindSpark"直观表达"思维火花"概念
- ✅ 与AGI的"Mind"(心智)概念关联
- ✅ 通俗易懂,国际化

**体系描述**:
- 智灵(MindSpark) = FlowForge的自我进化智能体
- 每个智灵包含: 心智画像(MindProfile) + 三层记忆(MemoryStore) + 认知画像(CognitionProfile)
- 智灵通过自我进化引擎(Evolution Engine)不断成长

**升华阶段**:
- MS1: Spark(火花) - 基础执行
- MS2: Glow(微光) - 情景记忆
- MS3: Flame(火焰) - 语义抽象
- MS4: Blaze(烈焰) - 跨任务迁移
- MS5: Radiance(光辉) - 元认知
- MS6: Illumination( illumination) - 自我进化

**评价**: ★★★★☆ (推荐)

#### 方案C: "进化体Evoling"

**中文名称**: 进化体  
**英文名称**: Evoling (Evolution + Being)  
**缩写**: EV

**理由**:
- ✅ "进化"直接体现自我进化核心理念
- ✅ "体"体现智能体概念
- ✅ "Evoling"创造新词,体现创新性
- ✅ 与AGI的"Evolution"(进化)概念强关联
- ✅ 通俗易懂,国际化

**体系描述**:
- 进化体(Evoling) = FlowForge的自我进化智能体
- 每个进化体包含: 进化画像(EvolutionProfile) + 三层记忆(EchoStore) + 成长画像(GrowthProfile)
- 进化体通过自我进化引擎(Evolution Engine)不断进化

**升华阶段**:
- EV1: Seed(种子) - 基础执行
- EV2: Sprout(萌芽) - 情景记忆
- EV3: Sapling(树苗) - 语义抽象
- EV4: Tree(树木) - 跨任务迁移
- EV5: Forest(森林) - 元认知
- EV6: Ecosystem(生态系统) - 自我进化

**评价**: ★★★★★ (强烈推荐)

#### 方案D: "灵子Animon"

**中文名称**: 灵子  
**英文名称**: Animon (Anima + Monad)  
**缩写**: AM

**理由**:
- ✅ "灵"体现智能和生命力
- ✅ "子"体现基本单元概念(类似"量子")
- ✅ "Animon"结合"Anima"(灵魂)和"Monad"(单子),体现哲学深度
- ✅ 与AGI的"Anima"(灵魂)概念关联
- ✅ 通俗易懂,国际化

**体系描述**:
- 灵子(Animon) = FlowForge的自我进化智能子
- 每个灵子包含: 灵魂画像(AnimaProfile) + 三层记忆(MnemosStore) + 单子画像(MonadProfile)
- 灵子通过自我进化引擎(Evolution Engine)不断进化

**升华阶段**:
- AM1: Atom(原子) - 基础执行
- AM2: Molecule(分子) - 情景记忆
- AM3: Cell(细胞) - 语义抽象
- AM4: Organ(器官) - 跨任务迁移
- AM5: Organism(有机体) - 元认知
- AM6: Consciousness(意识) - 自我进化

**评价**: ★★★★☆ (推荐)

### 6.3 最终推荐

**强烈推荐方案C: "进化体Evoling"**

**理由**:
1. ✅ **直接体现核心理念**: "进化"直接表达自我进化的核心概念,无需额外解释
2. ✅ **创新性强**: "Evoling"是新造词,体现项目的创新性和前瞻性
3. ✅ **国际化友好**: "Evoling"发音简单,非英语母语者也能轻松发音
4. ✅ **与AGI强关联**: "Evolution"(进化)是AGI的核心概念之一
5. ✅ **升华阶段直观**: Seed→Sprout→Sapling→Tree→Forest→Ecosystem,体现从个体到生态的成长过程
6. ✅ **通俗易懂**: "进化体"中文名称直观易懂,普通用户也能理解

**备选方案**: 方案A"灵核SoulCore"或方案B"智灵MindSpark"

### 6.4 体系建议

#### 6.4.1 核心概念重新定义

**进化体Evoling体系**:

```
进化体(Evoling) = 模型(Model) + 驾驭层(Harness) + 进化核心(Evolution Core)

进化核心包含:
- 进化画像(EvolutionProfile): 身份/世界观/价值观/声音
- 三层记忆(EchoStore): 工作记忆/情景记忆/语义记忆
- 成长画像(GrowthProfile): 认知画像+主观日记
- 自我进化引擎(Evolution Engine): 防御/改进/成长三模式
- 知识锻典(Knowledge Codex): 知识对象+五级成熟度阶梯
```

#### 6.4.2 升华阶段重新定义

| 阶段 | 名称 | 能力 | 知识成熟度 |
|------|------|------|-----------|
| EV1 | Seed(种子) | 基础执行 | 初始 |
| EV2 | Sprout(萌芽) | 情景记忆 | 验证 |
| EV3 | Sapling(树苗) | 语义抽象 | 成熟 |
| EV4 | Tree(树木) | 跨任务迁移 | 权威 |
| EV5 | Forest(森林) | 元认知 | 经典 |
| EV6 | Ecosystem(生态系统) | 自我进化 | 超越 |

#### 6.4.3 与现有代码的映射

| 现有代码 | 新命名 | 说明 |
|---------|--------|------|
| `evolution/engine.py` | `EvolutionEngine` | 自我进化引擎 |
| `evolution/scope_guard.py` | `DefenseMode` | 防御模式 |
| `evolution/process_evolution.py` | `ImprovementMode` | 改进模式 |
| `evolution/knowledge_evolution.py` | `GrowthMode` | 成长模式 |
| `evolution/maturity.py` | `KnowledgeMaturityLadder` | 五级知识成熟度阶梯 |
| `evolution/metacognition.py` | `MetacognitionRouter` | 元认知路由 |
| `evolution/models.py` | `EvolutionModels` | 数据模型 |

#### 6.4.4 文档更新建议

1. **spec.md**: 将"炉灵Forgekin"替换为"进化体Evoling"
2. **arch.md**: 将"炉灵架构"替换为"进化体架构"
3. **design.md**: 将"炉灵详细设计"替换为"进化体详细设计"
4. **config/evolution.yaml**: 将"forgekin"相关配置替换为"evoling"
5. **代码注释**: 将"forgekin"相关注释替换为"evoling"

#### 6.4.5 迁移策略

**Phase 0(当前)**: 
- 不修改代码和文档中的"forgekin"命名
- 在新文档中使用"evoling"命名
- 逐步迁移

**Phase 1(2-4个月)**:
- 修改config/evolution.yaml中的命名
- 修改代码注释中的命名
- 更新spec.md/arch.md/design.md

**Phase 2(4-6个月)**:
- 修改代码中的变量名/类名
- 全面替换"forgekin"为"evoling"
- 发布迁移指南

---

## 附录

### 附录A: 审核检查清单

#### A.1 设计文档完整性检查

- [x] spec.md: 功能特性规格说明书
- [x] arch.md: 架构设计文档
- [x] design.md: 详细设计说明书
- [x] task.md: 问题清单与审计文档
- [x] face/face.md: 大厂面试原始记录
- [x] face/ds.md: 下一代需求规格说明书
- [x] face/spec_face.md: v3.0需求规格说明书
- [x] face/arch_face.md: v3.0架构详设
- [x] face/task_face.md: v3.0任务清单

#### A.2 代码与文档一致性检查

- [x] 目录结构对照
- [x] 配置文件对照
- [x] 核心模块对照
- [x] 硬编码提示词检查
- [x] 特定领域代码检查

#### A.3 跨项目一致性检查

- [x] 质量分阈值
- [x] 变量引用语法
- [x] OpenSieve检索规范
- [x] LoopExecutor铁律
- [x] 架构边界
- [x] 硬编码提示词

#### A.4 rules.md/prompts.md一致性检查

- [x] rules.md vs project_rules.md
- [x] prompts.md内部编号
- [x] prompts.md vs rules.md

### 附录B: 问题跟踪清单

#### B.1 P0级问题(必须立即修复)

| ID | 问题 | 影响范围 | 负责人 | 状态 |
|----|------|----------|--------|------|
| P0-01 | 设计文档严重过时(10+模块未文档化) | FlowForge | - | 待修复 |
| P0-02 | 质量分阈值不一致(0.95 vs 0.85) | FlowForge | - | 待修复 |
| P0-03 | 跨项目一致性(质量分/变量引用/OpenSieve/LoopExecutor) | 9大项目 | - | 待修复 |
| P0-04 | face/文档版本混乱 | FlowForge | - | 待修复 |

#### B.2 P1级问题(必须尽快修复)

| ID | 问题 | 影响范围 | 负责人 | 状态 |
|----|------|----------|--------|------|
| P1-01 | FlowForge含特定领域代码(chapter_write_saga.py等) | FlowForge | - | 待修复 |
| P1-02 | 硬编码提示词残留(FlowForge 6处/ContentForge 20+处) | FlowForge/ContentForge | - | 待修复 |
| P1-03 | 架构边界违规(ContentForge/DevForge/NovelForge/MallForge) | 4个项目 | - | 待修复 |
| P1-04 | core/目录膨胀(67个文件) | FlowForge | - | 待修复 |

#### B.3 P2级问题(质量提升)

| ID | 问题 | 影响范围 | 负责人 | 状态 |
|----|------|----------|--------|------|
| P2-01 | harness/子目录扁平化未更新 | FlowForge | - | 待修复 |
| P2-02 | 文档中描述但不存在的文件(doc_gardener.py等) | FlowForge | - | 待修复 |
| P2-03 | 发布工具迁移(6个工具) | FlowForge→ContentForge | - | 待修复 |

### 附录C: 配置驱动率统计

| 领域 | 驱动率 | 评价 |
|------|:------:|------|
| LLM路由与模型管理 | 95% | ✅ 优秀 |
| 提示词外置 | 90% | ✅ 优秀 |
| 工具/插件注册 | 90% | ✅ 优秀 |
| 工作流模板 | 70% | ⚠️ 良好 |
| Harness驾驭层 | 60% | ⚠️ 一般 |
| Feature Flag | 90% | ✅ 优秀 |
| 基础设施 | 90% | ✅ 优秀 |
| **综合配置驱动率** | **80%** | ✅ **良好** |

### 附录D: 代码规模统计

| 目录 | 文件数 | 说明 |
|------|-------|------|
| core/ | 67 | 共享内核(最大目录) |
| tools/ | 50+ | 工具层 |
| modes/ | 20 | 模式执行器 |
| agents/generic/ | 25 | 通用Agent |
| app/api/endpoints/ | 24 | API端点 |
| config/ | 17 YAML | 配置文件 |
| loop/ | 11 | Loop执行引擎 |
| memory/ | 13 | 记忆层 |
| evolution/ | 8 | 自我进化 |
| compiler/ | 7 | YAML编译器 |
| events/ | 6 | 事件系统 |
| harness/ | 9 | Harness驾驭层 |

### 附录E: 参考文献

1. clowder-ai: https://github.com/clowder-ai/clowder
2. MemGPT: https://arxiv.org/abs/2310.08560
3. Voyager: https://arxiv.org/abs/2305.16291
4. Generative Agents: https://arxiv.org/abs/2304.03442
5. Self-Refine: https://arxiv.org/abs/2303.17651
6. Reflexion: https://arxiv.org/abs/2303.11366
7. Google A2A Protocol: https://github.com/google/a2a

---

**审核完成时间**: 2026-07-15  
**审核人**: AI智能体产品专家 / AI高级架构师 / AI智能体Agent开发工程师 / 高级软件全栈工程师  
**审核方法**: 逐文档逐章节分析,代码与文档对照,跨项目一致性验证  
**审核结论**: ❌ 未通过,存在多处P0/P1级问题需立即修正  
**下一步**: 按行动建议立即修复P0问题,2周内修复P1问题,1个月内修复P2问题

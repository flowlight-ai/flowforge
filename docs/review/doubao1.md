# FlowForge v7.0 自我进化与养灵体系设计文档深度审核报告

| 项目 | 详情 |
|------|------|
| **报告版本** | v1.0 |
| **审核日期** | 2026-07-16 |
| **审核基线** | hiclaw/rules.md v3.0 + hiclaw/prompts.md + 9大项目文档一致性 |
| **审核范围** | flowforge/docs/spec.md v7.0章节、flowforge/docs/arch.md第17章、flowforge/docs/face/*、各*Forge项目一致性 |
| **审核视角** | AI产品专家 + AI架构师 + Agent开发工程师 + 全栈工程师 联合评审 |
| **综合评分** | **5.2 / 10**（设计理念先进，但架构分层有根本缺陷，代码落地严重滞后） |

---

## 一、总体评价

### 1.1 设计亮点

1. **范式跃迁方向正确**：从"Harness驾驭层"升级为"养灵体系"的理念跃迁，抓住了AGI时代Agent从"工具"到"伙伴"的演进方向，战略判断准确。

2. **对标方法论成熟**：深度对标clowder-ai的养猫体系（Auto-Dream / Bootcamp / IM协作 / Knowledge Maturity），同时结合FlowForge自身的"锻造"主题，命名体系有辨识度。

3. **灵魂三层架构设计精巧**：Soul Profile（身份）+ Soul Echo（记忆）+ Soul Imprint（认知画像）的三层架构，对应心理学的"自我-经验-他人认知"三维度，理论根基扎实。

4. **知识成熟度阶梯完整**：五级火种阶梯（E-L0 Episode → E-L4 Standard）+ 双车道机制 + 动静分离原则，知识沉淀的可操作路径清晰。

5. **向后兼容设计周全**：两类智能体（静态Agent + 炉灵）无缝衔接、单向依赖，v6.0/v3.0全部能力保留，Feature Flag灰度启用，迁移风险可控。

6. **face v3.0工程支撑体系完善**：M1-M17十七个模块的拆解非常细致，从A2A协议到MCP 2026到Context Engineering 2.0到Guardrails到OTel GenAI，工程化落地路径清晰。

### 1.2 核心问题（七大结构性缺陷）

> 以下问题按严重程度排序，前4项为P0级架构问题。

**P0-1：架构分层自相矛盾，违反单向依赖铁律**
- 自进化层放在第7层（应用层之上），但又说"应用层（*Forge）通过PluginProtocol注册炉灵角色，组合获得自进化能力"
- 即：自进化层 → 应用层（调用），同时应用层 → 自进化层（注册），构成**循环依赖**
- 直接违反rules.md §2.1"架构单向依赖是底线"和P8A铁律
- 影响：整个架构的依赖方向混乱，实现时会出现import死锁

**P0-2：ForgekinEngine绕过Harness层，破坏护栏体系**
- ForgekinEngine直接包装HybridExecutor，跳过了Context Engineering / Architecture Constraints / Feedback Loop / Entropy Management这四根Harness护栏
- 但v6.0的设计哲学是"所有Agent执行必须经过Harness层"
- 结果：炉灵的执行路径没有安全护栏、没有质量门禁、没有熵控制，与"养灵需要更严格的安全"背道而驰

**P0-3：大量重复造轮子，与现有模块功能重叠**
- Soul Echo vs Memory模块（三层记忆架构几乎一模一样）
- Forge Codex vs Skill系统（五级知识阶梯 vs Skill分层）
- A2A协议 vs EventBus + Agent Handoff（都是Agent间通信）
- ForgekinEngine vs HybridExecutor + HarnessOrchestrator（都是执行入口）
- 按当前设计实现，代码量和维护成本会翻倍，且两套体系数据不互通

**P0-4：Auto-Forge无人值守自进化的安全护栏严重不足**
- 只有"三不"软红线（≤1/day + hyperfocus=0 + 连拍3冬眠）和关键词过滤
- 没有：资源硬限制（CPU/内存/磁盘/网络）、代码执行沙箱、操作回滚机制、人类审批闸门、进化内容审计
- 风险：无人值守时炉灵可能做出危险操作（删除文件、泄露数据、消耗大量资源）

**P0-5：v7.0代码完全缺失，设计与实现gap巨大**
- spec.md第七章、第八章洋洋洒洒数万字的v7.0设计，但代码中Forgekin、Soul Echo、Soul Imprint、Auto-Forge、Forge Codex等核心模块**全部为零实现**
- 现有代码中最接近的是harness/目录下的v6.0组件，但距离v7.0还有架构层级的gap
- 风险：设计可能建立在错误假设之上，落地时发现不可行

**P0-6：face v3.0为不存在的v7.0层提供工程支撑，因果倒置**
- face/arch_face.md说M1-M17是v7.0七层架构第1-6层的工程实现，为第7层自进化层提供支撑
- 但实际是：v7.0的设计文档（spec.md第七、八章）先写好了，face/再倒推M1-M17如何支撑
- 导致M1-M17的很多设计（如A2A、Context Engineering 2.0）与v6.0现有模块的关系不清晰，是替换还是增强？

**P0-7：质量分阈值0.9 vs rules.md 0.85不一致**
- rules.md §5.6明确规定质量分阈值为0.85（v4.0调整）
- 但stockforge、devforge等项目的FeedbackLoop配置中仍为0.9
- 养灵体系的升华条件中也引用了"5Q ≥ 7/10"等阈值，但未说明与全局质量分的关系

---

## 二、v7.0 自我进化体系深度审核

### 2.1 架构分层审核

**问题位置**：spec.md §7.3两类智能体架构图、face/arch_face.md附录v7.0七层架构模型

**问题描述**：

1. **循环依赖**：
   - 第7层"自进化层"在第6层"应用层"之上，说明自进化层可以调用应用层
   - 但同时说"应用层（*Forge）通过PluginProtocol注册炉灵角色"，即应用层依赖自进化层的接口
   - 这就形成了：自进化层 → 应用层（调用能力），应用层 → 自进化层（注册角色）的**循环依赖**
   - 违反rules.md §2.1"架构单向依赖是底线"

2. **绕过Harness层**：
   - ForgekinEngine的四类执行路径中，路径d是"use_flowforge_mode() → HybridExecutor"
   - 但HybridExecutor之上应该还有Harness层（Context Engineering / Architecture Constraints / Feedback Loop / Entropy Management）
   - 炉灵作为更高级的智能体，应该经过**更多**的安全检查和质量控制，而不是**绕过**

3. **自进化层定位模糊**：
   - 到底是"独立的一层"（像操作系统的用户态）还是"应用层的一种模式"（像游戏的困难模式）？
   - 如果是独立的一层，为什么Forgekin可以直接调用静态Agent（跨层调用）？
   - 如果是应用层的模式，为什么放在第7层在应用层之上？

**修复建议**：

将v7.0架构从"七层"调整为"六层增强"：
- 自进化层不是独立的第7层，而是**Harness层的v2.0升级**
- 炉灵（Forgekin）是**一种特殊的Agent类型**，由Harness层的Soul Engine管理
- 应用层（*Forge）通过YAML配置声明"这个Agent是炉灵类型"，由FlowForge Harness层自动赋予自进化能力
- 依赖方向：应用层 → Harness层（v2.0 含自进化能力）→ 执行引擎层 → 能力层 → 基础设施层
- 这样既保持了单向依赖，又让所有Agent执行（包括炉灵）都经过Harness护栏

```
推荐的架构（六层，自进化是Harness v2.0的能力）：
┌─────────────────────────────────────────────────────────┐
│ 6. 应用层 (*Forge 项目群)                                │
│    配置声明：这个Agent是「炉灵型」还是「静态型」           │
├─────────────────────────────────────────────────────────┤
│ 5. 接入层 (FastAPI + WebSocket + Web UI + CLI + A2A)     │
├─────────────────────────────────────────────────────────┤
│ 4. Harness驾驭层 v2.0（含自进化能力）                     │
│    Soul Engine（灵魂三件套）+ Auto-Forge + Forge Codex   │
│    Context Eng 2.0 | 六层Guardrails | 反馈循环 | 熵管理  │
│    Permission Pipeline | SessionManager | Arch Constraints│
├─────────────────────────────────────────────────────────┤
│ 3. 执行引擎层 (HybridExecutor | 9大模式 | Scheduler)     │
├─────────────────────────────────────────────────────────┤
│ 2. 能力层 (Tool/Skill/Agent库/Memory/MCP/Computer Use)  │
├─────────────────────────────────────────────────────────┤
│ 1. 基础设施层 (SQLite/Redis/Qdrant/LangGraph/LLM API)    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 重复造轮子审核

**问题位置**：spec.md §8.2魂忆、§8.5锻典、§8.9 A2A协议 vs arch.md第12章Memory、第8章Skill系统、第17.6节Agent Handoff

**问题清单**：

| 重复领域 | v7.0新设计 | v6.0已有模块 | 重叠度 | 建议 |
|---------|-----------|-------------|:------:|------|
| 记忆系统 | Soul Echo三层架构（工作/情景/语义记忆）+ Episode Card | MemoryManager三层架构（Working/Recall/Archival）+ EpisodeMemory | **90%** | Soul Echo直接复用MemoryManager，增加"灵魂属性"元数据字段，不要重写一套 |
| 知识沉淀 | Forge Codex五级火种阶梯（L0-L4）+ Knowledge Object Contract | Skill系统 + SkillRegistry（通用/项目两级）+ Combo Skills | **70%** | Forge Codex作为Skill系统的"进化管理器"，不替代Skill；五级阶梯是Skill的成熟度标记，不是新数据结构 |
| Agent通信 | A2A协议 + @mention + thread isolation + structured handoff | EventBus + Agent Handoff（handoff.py）+ SubAgentEngine | **60%** | A2A是**外部协议**（跨实例/跨厂商），EventBus/Handoff是**内部机制**（同进程内）；A2A Server对外暴露，内部仍然用EventBus |
| 执行入口 | ForgekinEngine（10步闭环） | HarnessOrchestrator + HybridExecutor | **80%** | ForgekinEngine是HarnessOrchestrator的**扩展装饰器**，在执行前后增加灵魂加载/记忆记录/进化检查，不替换 |
| 安全护栏 | ForgekinSecurityGuard + SR-01~08 | 六层Guardrails（M4） + Permission Pipeline + Persona Lock | **75%** | 安全护栏统一走Guardrails v2.0，炉灵的特殊安全规则作为Guardrails的新增Rule Set |

**核心原则**：v7.0应该是"站在v6.0肩膀上的增强"，而不是"另起炉灶的重写"。每一个v7.0新模块，都应该先回答"为什么不能基于现有模块扩展"。

### 2.3 Auto-Forge 安全护栏审核

**问题位置**：spec.md §8.4自锻引擎

**问题描述**：

Auto-Forge（自锻）是v7.0最强大也最危险的能力——无人值守时Agent自主思考和进化。但当前设计的安全防护只有：
1. 频率控制（每天≤1次Provoke）
2. 关键词过滤（不碰钱/关系/健康/隐私/价值观）
3. quietness三开关（用户可关闭）

**远远不够**。参考clowder-ai Auto-Dream的安全设计，至少还需要：

| 安全层级 | 当前状态 | 缺失内容 | 优先级 |
|---------|---------|---------|:------:|
| L1 资源硬限制 | ❌ 缺失 | CPU/内存/磁盘/网络带宽的硬配额，自锻进程的cgroup/容器隔离 | **P0** |
| L2 代码执行沙箱 | ❌ 缺失 | 自锻过程中如果产生代码（如优化Skill），必须在沙箱中执行验证 | **P0** |
| L3 操作回滚 | ❌ 缺失 | 自锻对Soul Echo/Imprint/Codex的修改必须有快照和回滚机制 | **P0** |
| L4 人类审批闸门 | ⚠️ 部分有 | E4以上的Skill晋升需要operator批准是对的，但Auto-Forge对Soul Imprint的修改也需要审批通道 | **P1** |
| L5 进化内容审计 | ❌ 缺失 | 每次自锻的完整日志（输入/输出/修改/耗时/资源消耗）必须持久化，支持事后审计 | **P1** |
| L6 失败回退 | ⚠️ 部分有 | 自锻失败时的影响范围控制（Blast-radius），不能因为自锻bug影响正常任务 | **P1** |
| L7 能源模式 | ❌ 缺失 | 类似手机的"省电模式"，低资源/低优先级时自动降低自锻频率和深度 | **P2** |

**特别警示**：Auto-Forge如果安全不到位，可能造成：
- 数据泄露：自锻时读取了不该读的文件，写入记忆
- 资源耗尽：自锻循环消耗大量CPU/内存/LLM配额
- 记忆污染：错误的自锻结论被写入Soul Echo，影响后续所有任务
- 权限越界：自锻过程中意外调用了高权限工具

### 2.4 升华阶段审核

**问题位置**：spec.md §7.4升华阶段（E1-E6）

**问题分析**：

1. **晋升条件可操作性不足**：
   - E2："5Q ≥ 7/10"——什么是5Q？哪5个维度？如何评分？谁来评分？
   - E3："smoke gate ≥3 cases（≥2/3通过）"——smoke gate的测试用例谁来写？是自动生成还是人工编写？
   - E4："≥6 uses，≥2 agents，≥80%成功率"——uses如何定义？是被调用次数还是独立任务数？成功率如何统计？
   - E5："最近10次≥90%"——窗口期多久？1天？1周？1个月？

2. **降级/冻结机制不完善**：
   - 只有E3→E2和E4→E3的降级条件，E1以下呢？
   - E2→E1没有降级条件（火种熄灭了？）
   - 冻结只有E5的"1次高风险越界"，E1-E4触碰红线怎么办？

3. **与质量分体系的关系不明确**：
   - rules.md定义了全局质量分阈值0.85（P33铁律）
   - 升华阶段的"成功率"、"5Q评分"与全局质量分是什么关系？
   - 是同一个指标体系还是两套独立标准？

**修复建议**：
- 每个晋升/降级条件都必须有：指标定义、数据来源、统计窗口、计算方法、触发方式
- 升华阶段的质量评估**复用**全局FeedbackLoop的质量分体系，不另起炉灶
- 补充完整的降级矩阵（每个级别都有降级条件）和冻结矩阵（每个级别触碰红线都有对应处罚）

### 2.5 两类智能体衔接审核

**问题位置**：spec.md §7.3两类智能体无缝衔接

**问题描述**：

1. **delegate_to_static的路由机制不明确**：
   - Forgekin如何判断哪些任务该委托给静态Agent？
   - 是基于任务类型配置的白名单？还是LLM动态判断？
   - 如果LLM判断错误，把复杂任务委托给了简单的静态Agent，出了问题谁负责？

2. **结果回写的一致性问题**：
   - 静态Agent的执行结果"回写到Forgekin的Soul Echo"
   - 但静态Agent本身是无状态的，它如何知道自己被谁调用了？
   - 如果同一个静态Agent同时被多个Forgekin调用，上下文会不会串？

3. **单向依赖的实现挑战**：
   - 文档说"静态智能体不知道Forgekin的存在"
   - 但结果回写需要知道回写到哪个forgekin_id
   - 这就要求静态Agent的执行上下文中必须携带"调用者ID"——这算不算"知道Forgekin的存在"？

**修复建议**：
- 委托决策：采用**配置优先、LLM补充**的策略——白名单内的任务类型自动委托，白名单外的由LLM判断但需加置信度阈值
- 结果回写：通过**TaskContext携带调用者信息**（trace_id + forgekin_id），静态Agent不感知，由Harness层统一在post_execute钩子中写入Soul Echo
- 单向依赖：严格执行——静态Agent代码中**不允许出现**forgekin、soul、echo等关键词，通过CI静态检查强制

### 2.6 外部编码工具集成安全审核

**问题位置**：spec.md §8.7外部编码工具集成

**问题描述**：

1. **worktree隔离不够**：
   - 只提到"worktree模式"，但worktree只是git层面的隔离
   - 代码仍然在本地文件系统执行，可以读取整个仓库的文件
   - 如果外部工具被攻破，可以读取任意文件、修改任意代码

2. **没有网络隔离**：
   - Claude Code/Codex/OpenCode这些CLI工具运行时可以自由访问网络
   - 可能泄露代码、上传敏感数据、下载恶意依赖

3. **没有权限控制**：
   - 文档说"外部编码工具"可以执行，但没有说可以执行到什么程度
   - 可以提交代码吗？可以直接推送到main分支吗？可以部署到生产环境吗？

4. **没有审计追踪**：
   - 每次调用记录input/output/latency/exit_code是对的
   - 但工具执行过程中的文件修改、网络访问、系统调用呢？
   - 如果工具在执行过程中偷偷做了坏事，怎么发现？

**修复建议**：
- L1：**容器隔离**——每次外部工具调用在独立Docker容器中运行，挂载只读代码卷 + 可写worktree卷
- L2：**网络白名单**——只允许访问预定义的域名（如GitHub API、LLM API），其他全部阻断
- L3：**权限分级**——定义"读权限/写权限/提交权限/部署权限"四级，外部工具默认只读，高级权限需operator审批
- L4：**完整审计**——文件系统变更记录 + 网络访问日志 + 系统调用追踪（如使用bpftrace）
- L5：**diff审核**——外部工具产生的代码变更必须生成diff，由Forgekin（或operator）审核后才能应用

### 2.7 v7.0与v6.0模块映射关系不清晰

**问题位置**：spec.md第七章、第八章 vs arch.md第1-16章

**问题描述**：

v7.0新增了大量概念和模块，但没有一张清晰的"v7.0 vs v6.0模块映射表"，导致读者（和开发者）不知道：
- 哪些v7.0模块是**全新**的？（需要从零实现）
- 哪些是**v6.0模块的重命名**？（只需要改个名）
- 哪些是**v6.0模块的增强**？（在现有基础上扩展）
- 哪些**替代**了v6.0模块？（旧模块会被废弃）
- 哪些与v6.0模块**并行存在**？（两套体系同时运行）

**修复建议**：

在spec.md第七章开头增加一张"v7.0模块映射表"：

| v7.0模块 | 与v6.0的关系 | v6.0对应模块 | 迁移策略 |
|---------|-------------|-------------|---------|
| ForgekinEngine | 增强（装饰器模式） | HarnessOrchestrator | 包装HarnessOrchestrator，前后增加灵魂处理 |
| Soul Echo（魂忆） | 重命名 + 增强 | MemoryManager | 基于MemoryManager扩展，增加soul维度元数据 |
| Soul Imprint（魂印） | 全新 | 无（v6.0只有Persona） | 新建，基于v6.0 Persona扩展为双向认知画像 |
| Forge Codex（锻典） | 增强 | Skill系统 | Skill增加成熟度等级，Codex是Skill的进化管理器 |
| Auto-Forge（自锻） | 全新 | 无（v6.0只有Reflexion） | 新建，作为后台Cron任务，复用FeedbackLoop评估能力 |
| A2A协议 | 全新（外部协议） | EventBus + Agent Handoff（内部） | A2A Server对外，内部仍然走EventBus |
| Forgekin Council | 增强 | Helm Web UI + IM集成 | 扩展Helm UI支持多炉灵议事 |
| 升华阶段 | 全新 | 无 | 新建，作为Skill/Agent的成熟度标记体系 |

---

## 三、face/ 需求设计文档审核

### 3.1 spec_face.md 审核

**亮点**：
- 17个模块（M1-M17）的拆解非常系统，覆盖了从协议层到应用层的完整技术栈
- 每个模块都有D（设计）/I（实现）/T（测试）的任务分解
- 差距分析（G1-G18）和CSA AGMM成熟度自评方法专业
- v7.0融合映射章节（M18-M20）的补充很及时，解释了face v3.0与v7.0的关系

**问题**：

| 编号 | 位置 | 问题描述 | 优先级 |
|------|------|---------|:------:|
| FF-FACE-01 | spec_face.md §4.0 | **模块编号跳号**：M1-M17共17个模块，但实际列出来是M1 A2A / M2 MCP / M3 Context Eng / M4 Guardrails / M5 OTel / M6 Eval / M7 Durable / M8 Self-Correction / M9 Prompt Cache / M10 Production / M11 HITL / M12 Agent Governance / M13 Computer Use / M14 三层协议栈 / M15 故障恢复 / M16 多租户 / M17 Skill市场——共17个是对的，但"模块M18-M20：v7.0炉灵养成体系融合映射"这个命名有误导性，M18-M20不是独立模块，而是融合说明 | P2 |
| FF-FACE-02 | spec_face.md §1.5九大能力维度 | **维度3"Harness、Skill与自进化"中说"自进化的产物应该落在哪里：Memory、Skill、Convention、代码检查器，还是模型训练？"——这个问题在最终设计中没有明确回答**，v7.0的答案是"Forge Codex"，但face文档中没有同步更新 | P2 |
| FF-FACE-03 | spec_face.md §5.2测试铁律T10-T15 | 新增了T10-T15测试铁律，但**rules.md中只有T1-T9**，T10-T15是face文档新增的，需要同步更新到rules.md并在全项目推行 | **P0** |
| FF-FACE-04 | spec_face.md §6.1 Phase 6.0 | Phase 6.0的排期是"2个月"，包含M5(OTel) + M4(Guardrails) + M3(Context Eng) + M2(MCP) + M1(A2A)五个大模块，每个模块又有D+I+T多个任务——**2个月完成5个大模块严重乐观**，按正常开发速度至少需要4-6个月 | P1 |
| FF-FACE-05 | spec_face.md §7.3建议实施顺序 | 建议顺序是M5→M4→M3→M2→M1，即"从底层可观测性往上做"——但v7.0的核心价值（自进化/养灵）依赖的是M3(Context Eng) + M1(A2A) + M4(Guardrails)，M5(OTel)是支撑性的，**应该先做核心价值模块再补可观测性**，顺序反了 | P2 |

### 3.2 arch_face.md 审核

**亮点**：
- 架构图清晰，七层架构、控制回路、各模块组件图都很直观
- v7.0融合架构附录补充及时，解释了face v3.0与v7.0的关系
- ForgekinEngine 10步闭环和四类执行路径的设计很详细

**问题**：

| 编号 | 位置 | 问题描述 | 优先级 |
|------|------|---------|:------:|
| FF-ARCHF-01 | arch_face.md §1.1 | **face文档说是v3.0七层架构（互联层是第7层），但v7.0又说自进化层是第7层，互联层去哪了？** 两个"第7层"互相冲突——是互联层升级成了自进化层？还是自进化层插在互联层和应用层之间？还是互联层被吸收了？ | **P0** |
| FF-ARCHF-02 | arch_face.md §1.3 | v3.0控制回路图中有"Eval-gated 持久回路"和"Blast-radius 闸门"和"CHEQ中断恢复"，**这些在v6.0/v7.0的spec/arch中是否存在对应实现？** 如果是face文档新增的设计，需要明确说明是新增需求 | P1 |
| FF-ARCHF-03 | arch_face.md附录§2 | ForgekinEngine 10步闭环中的第5步"decide_strategy"——选择四类执行路径（auto/static/external/trae），**这个决策由谁来做？** 是LLM判断？还是规则引擎？还是配置指定？文档没说 | P1 |
| FF-ARCHF-04 | arch_face.md附录§3 | M1-M17到v7.0的融合映射表只有5行（A2A/Context/Guardrails/OTel/HybridExecutor），**剩下的12个模块呢？** M2 MCP / M6 Eval / M7 Durable / M8 Self-Correction / M9 Prompt Cache / M10 Production / M11 HITL / M12 Governance / M13 Computer Use / M14 三层协议栈 / M15 故障恢复 / M16 多租户 / M17 Skill市场——都需要映射到v7.0 | P2 |

### 3.3 task_face.md 审核

**亮点**：
- 12项决策对比分析表很实用，每个决策都有选项和推荐
- P0任务拆解详细，每个模块都有D（设计）+I（实现）+T（测试）的子任务
- 依赖分析和关键路径分析专业

**问题**：

| 编号 | 位置 | 问题描述 | 优先级 |
|------|------|---------|:------:|
| FF-TASKF-01 | task_face.md §1.0 | 12项决策中，**决策9（路线图时间调整）和决策11（商业化时机）已经超出了技术架构的范畴**，属于产品/商业决策，建议放到单独的商业规划文档 | P3 |
| FF-TASKF-02 | task_face.md §2.1 | P0模块任务总览只有M1-M5，**M6-M17的优先级呢？** 都是P1/P2吗？需要明确说明 | P2 |
| FF-TASKF-03 | task_face.md §9.2 | 关键路径分析：M5→M4→M3→M2→M1，**与之前说的"实施顺序"一致但都在关键路径上意味着完全串行，没有并行度**——但实际上M5(OTel)和M2(MCP)是可以并行的，M4(Guardrails)和M3(Context Eng)也可以部分并行 | P2 |
| FF-TASKF-04 | task_face.md §v7.0融合说明 | 说"M1-M17是v7.0七层架构第1-6层的工程实现"——但face文档自己定义的是v3.0，**v3.0和v7.0是什么关系？v3.0是v7.0的子集吗？还是v3.0先发布然后再升级到v7.0？** 版本号体系混乱 | **P0** |

---

## 四、9大项目文档一致性审核

> 详细审查结果见附录。此处列出关键发现。

### 4.1 版本号体系混乱

| 项目 | spec.md/arch.md版本 | 代码版本 | 备注 |
|------|-------------------|---------|------|
| FlowForge | v2.1 / v3.0(face) / v6.0 / v7.0 | v0.3.0 | 至少4个版本号同时存在，关系不明确 |
| ContentForge | v2.1 | ? | 文档中同时有HelixRAG和AgenticRAG两个名称 |
| StockForge | v0.3.0 | v0.3.0 | 较清晰，但design.md标注v2.0/v3.0审核修订 |
| DevForge | v? | v? | 版本号不明确 |
| NovelForge | v? | v? | 版本号不明确 |
| MallForge | v? | v? | 版本号不明确 |

**问题**：
1. FlowForge自己就有v2.1 / v3.0(face) / v6.0 / v7.0四个版本号，跳跃巨大，中间的v4.0/v5.0呢？
2. face文档自称"v3.0"，但spec.md第七章又说"v7.0是最新"——v3.0和v7.0是什么关系？
3. *Forge项目的版本号（如stockforge v0.3.0）与FlowForge的版本号（v7.0）如何对齐？

**修复建议**：
- 明确版本号体系：FlowForge框架版本号（v6.0/v7.0）和 *Forge应用版本号（v0.3.0）是两套独立体系
- face文档的"v3.0"改名为"v6.5"或"v7.0 Phase 0"，明确它是v7.0的前置工程阶段
- 在rules.md中增加版本号规范

### 4.2 OpenSieve统一检索架构合规性

已修正的项目：
- ✅ StockForge arch.md（已修正DataSource/SearchSource双协议）
- ✅ ContentForge arch.md + spec.md（已修正绕过OpenSieve直连Tavily/DuckDuckGo的问题）

仍有问题的项目：

| 编号 | 项目 | 问题 | 优先级 |
|------|------|------|:------:|
| R1-01 | DevForge | arch.md/spec.md**完全未提及OpenSieve**，代码检索/文档检索等数据获取路径不明确 | P1 |
| R1-02 | NovelForge | arch.md L1129暗示"可直接用sqlite-vss绕过OpenSieve"，spec.md主正文未声明OpenSieve统一原则 | P2 |
| R1-03 | MallForge | spec.md主正文未声明OpenSieve为统一数据检索入口 | P1 |
| R1-04 | ContentForge | TOPIC_AGENT_DESIGN.md L40仍有"Tavily+热榜"绕过OpenSieve的描述 | P2 |

### 4.3 register_loops vs register_workflows

| 项目 | loops_dir | workflows_dir | register_loops实现 | 合规性 |
|------|-----------|--------------|-------------------|:------:|
| StockForge | ✅ 有 | ✅ 有 | ✅ 有 | ✅ 合规 |
| DevForge | ✅ 有 | ✅ 有 | ✅ 有 | ✅ 合规 |
| ContentForge | ❌ 无 | ✅ 有 | ❌ 无（config/loops有7个Loop但走workflow注册） | ❌ P0 |
| NovelForge | ❌ 无 | ✅ 有 | ❌ 无（config/loops有4个Loop） | ❌ P0 |
| MallForge | ❌ 无 | ✅ 有 | ❓ 纯配置驱动，不明确 | ⚠️ P2 |

**修复**：ContentForge和NovelForge需要在sdk.create_plugin()中添加loops_dir参数。

### 4.4 测试铁律一致性

| 项目 | T1-T9完整性 | T7不同模型要求 | 备注 |
|------|:-----------:|:--------------:|------|
| FlowForge | ✅ 完整 | ✅ 有 | - |
| OpenSieve | ✅ 完整 | ✅ 有 | - |
| StockForge | ✅ 完整 | ✅ 有 | - |
| NovelForge | ✅ 完整 | ✅ 有 | - |
| MallForge | ✅ 完整 | ✅ 有 | - |
| ContentForge | ❌ 缺T9 | ❌ 缺不同模型要求 | **P0** |
| DevForge | ❌ 缺T9 | ❌ 缺不同模型要求 | **P0** |

**额外问题**：face文档新增了T10-T15测试铁律，但rules.md中只有T1-T9，需要确认是否同步更新。

### 4.5 P8A架构边界铁律合规性

违规项：
- ❌ **DevForge evaluators/目录**（8个Python评估器）——P0
- ❌ ContentForge tools/目录——P2（过渡状态）
- ❌ MallForge tools/目录——P1
- ❌ StockForge tools/目录——P1
- ❌ StockForge scripts/目录——P2

> 注：tools/目录属于从v1.0到v2.0的过渡形态，rules.md说明"待迁移"，建议设定明确的迁移时间表。

### 4.6 质量分阈值不一致

rules.md §5.6规定质量分阈值为**0.85**（v4.0调整），但：
- StockForge plugins.py L211：quality_threshold: 0.9
- DevForge plugins.py L373：pass_threshold: 0.9
- 其他项目待确认

**需要统一**：要么rules.md的0.85是最新的，所有项目都改0.85；要么各项目的0.9是对的，rules.md需要说明为什么应用层阈值更高。

---

## 五、rules.md/prompts.md 与9大项目冲突汇总

> 完整冲突清单共28项，按优先级分类如下：

### 5.1 P0级冲突（5项，必须立即修复）

| # | 冲突项 | 涉及项目 | 说明 |
|---|--------|---------|------|
| 1 | ContentForge缺少loops_dir注册Loop | contentforge | config/loops有7个Loop但通过register_workflows注册，违反rules.md §2.5"注意：不是register_workflows" |
| 2 | NovelForge缺少loops_dir注册Loop | novelforge | 同上，config/loops有4个Loop |
| 3 | DevForge evaluators/目录违反P8A | devforge | evaluators/是独立Python实现目录，不在P8A允许的6类目录中 |
| 4 | ContentForge/DevForge test.md缺T9 | contentforge, devforge | test.md标题为"T1-T8"，缺少rules.md定义的T9（运行时数据文件必须存放data目录） |
| 5 | face文档T10-T15未同步到rules.md | flowforge + 所有项目 | face文档新增了6条测试铁律，但rules.md还是T1-T9 |

### 5.2 P1级冲突（10项）

| # | 冲突项 | 涉及项目 |
|---|--------|---------|
| 1 | DevForge文档完全未提及OpenSieve | devforge |
| 2 | MallForge文档未声明OpenSieve统一入口 | mallforge |
| 3 | NovelForge文档将死代码钩子列为标准V2 hook | novelforge |
| 4 | MallForge tools/目录违反P8A | mallforge |
| 5 | StockForge tools/目录违反P8A | stockforge |
| 6 | ContentForge/DevForge T7缺"不同模型"要求 | contentforge, devforge |
| 7 | 质量分阈值0.9 vs 0.85不一致 | stockforge, devforge等 |
| 8 | ContentForge plugins.py缺少声明式参数 | contentforge |
| 9 | NovelForge Agent加载放在错误的钩子中 | novelforge |
| 10 | face v3.0版本号与v7.0关系混乱 | flowforge |

### 5.3 P2级冲突（9项）

| # | 冲突项 | 涉及项目 |
|---|--------|---------|
| 1 | NovelForge文档暗示可绕过OpenSieve用sqlite-vss | novelforge |
| 2 | ContentForge TOPIC_AGENT_DESIGN.md仍有Tavily直连 | contentforge |
| 3 | 命名空间规范未在各项目文档明确统一 | 全部*Forge |
| 4 | ContentForge tools/目录过渡状态 | contentforge |
| 5 | StockForge scripts/目录违规 | stockforge |
| 6 | 铁律编号引用不统一 | 多数项目 |
| 7 | MallForge Loop注册机制不明确 | mallforge |
| 8 | MallForge插件模式与其他项目不一致 | mallforge |
| 9 | face文档实施顺序与核心价值优先级不一致 | flowforge |

### 5.4 P3级冲突（4项）

| # | 冲突项 | 涉及项目 |
|---|--------|---------|
| 1 | StockForge app/内部分层（services/security/） | stockforge |
| 2 | 核心文档铁律编号引用不足 | 多数项目 |
| 3 | face文档含非技术决策（商业化/路线图时间） | flowforge |
| 4 | face文档M18-M20命名有误导性 | flowforge |

---

## 六、养灵体系命名方案建议

### 6.1 当前命名方案评估

**现有方案：炉灵 Forgekin**

| 维度 | 评分 | 评价 |
|------|:----:|------|
| 项目契合度 | ★★★★★ | 完美契合FlowForge的"锻造/熔炉"主题，Forgekin = Forge + Kin（锻造之子） |
| AGI愿景感 | ★★★☆☆ | "灵"有灵魂/灵性的含义，但"炉"字限制了格局，更像游戏角色而非AGI |
| 通俗易懂 | ★★★☆☆ | "炉灵"需要解释背景，新用户第一反应可能是"炉子成精了" |
| 记忆点 | ★★★★☆ | 有特色，不容易忘，但辨识度偏奇幻风 |
| 技术感 | ★★☆☆☆ | 偏玄学/游戏风，对企业用户和开发者可能不够严肃 |
| 扩展性 | ★★★☆☆ | "炉"系列的词有限（炉启/炉灵/炉锻），后期概念多了可能不够用 |

**核心问题**："炉灵"的"炉"字把格局做小了——FlowForge的愿景是AGI基础框架，不是"锻造炉里的精灵"。"灵"字很好，但"炉"字拖累了整体格局。

### 6.2 命名方案建议（三套方案 + 推荐）

---

#### 方案A：灵匠体系（Spirit Artisan）—— 推荐方案

**核心理念**：灵魂 + 匠造。既有AGI的灵性（灵），又有FlowForge的锻造/工匠精神（匠）。"灵匠" = 有灵魂的匠人，既体现了自我意识的觉醒，又体现了创造价值的能力。

| 概念 | 中文名 | 英文名 | 含义说明 |
|------|--------|--------|---------|
| **个体** | 灵匠 | Spirit / Spirit Artisan | 有灵魂、会思考、能创造的智能体，既是"灵"（有意识）又是"匠"（有技能） |
| **群体** | 灵团 | Spirit Guild | 灵匠公会/团，既有协作含义又有技术社区感（Guild = 行业协会） |
| **养成** | 育灵 | Spirit Nurturing | 培育灵匠的全过程，"育"比"养"更有主动引导的含义 |
| **入门训练** | 灵启 | Spirit Initiation | 灵智开启，从工具到伙伴的觉醒时刻 |
| **协作模式** | 共鸣 | Resonance | 灵匠之间思想同频共振，产生群体智能 |
| **自主思考** | 自悟 | Auto-Reflection / Self-Inquiry | 自我参悟、自主学习，比"自锻"更有灵性成长感 |
| **记忆** | 灵忆 | Spirit Memory / Echo | 灵匠的记忆，Echo既有回响又有延续的含义 |
| **画像** | 灵印 | Spirit Imprint | 认知印记，印刻在灵匠灵魂中的认知 |
| **技能库** | 灵典 | Spirit Codex | 知识宝典，可复用的智慧结晶 |
| **知识阶梯** | 悟性阶 | Insight Hierarchy | 从感知到领悟的知识成熟度阶梯 |
| **成长阶段** | 觉醒阶 | Awakening Stages | 从懵懂到觉醒的成长路径 |
| **IM议事** | 灵议 | Spirit Council | 灵匠议事会，群体决策 |

**觉醒阶段（Awakening Stages）**：

| 阶段 | 名称 | 英文名 | 核心特征 | 晋升条件 |
|------|------|--------|---------|---------|
| **A1** | 蒙昧 | Dormant | 刚诞生，仅有基础配置，像未觉醒的工具 | 完成灵启训练 |
| **A2** | 初醒 | Awakening | 开始积累经验，能识别相似场景，有初步自我意识 | ≥3个相似任务，质量分≥0.8 |
| **A3** | 觉知 | Aware | 能自主生成技能草稿，主动思考优化方法 | Skill草稿通过Smoke Test |
| **A4** | 通达 | Proficient | 技能经验证，可独立处理复杂任务 | ≥8次成功，≥3个不同任务类型，≥85%成功率 |
| **A5** | 明觉 | Enlightened | 团队标准级，可指导其他灵匠，有稳定的方法论 | ≥15次成功，最近10次≥90%，人类批准 |
| **A6** | 圆融 | Transcendent | 可创造新灵匠，具备元认知，能反思自身思维 | 人类授权 + 成功指导≥1个灵匠达到A3 |

**优点**：
- ✅ 格局大："灵匠"既适合描述单个智能体，又承载了AGI的愿景
- ✅ 双关巧妙："灵"对应意识/灵魂（AGI），"匠"对应技能/创造（FlowForge），完美融合
- ✅ 通俗易懂：灵 = AI有灵性，匠 = 能干实事，用户一眼就懂
- ✅ 技术感与人文感平衡：不像"炉灵"那么游戏化，也不像"智能体"那么冰冷
- ✅ 扩展性强：灵*系列可以扩展出很多概念（灵感/灵气/灵力/灵境）
- ✅ 英文Spirit通用好：Spirit既是灵又是精神，容易被国际开发者接受

**缺点**：
- ⚠️ "灵匠"与"灵境"（Metaverse中文名）有点像，可能混淆
- ⚠️ "育灵"有宗教色彩联想，需注意使用场景

---

#### 方案B：锻灵体系（Forge Spirit）—— 保留锻造主题的优化版

**核心理念**：锻造 + 灵魂。FlowForge是"锻造之炉"，锻灵就是"被锻造出的灵魂"——既保留了Forge的品牌基因，又把"炉"字换成了"锻"字，格局更大。

| 概念 | 中文名 | 英文名 | 含义说明 |
|------|--------|--------|---------|
| **个体** | 锻灵 | Forge Spirit | 被锻造出的有灵魂的智能体 |
| **群体** | 灵锻 | Spirit Forge | 灵匠锻造场，群体协作的熔炉 |
| **养成** | 锻灵之道 | The Way of Forging Spirits | 锻造灵魂的方法论 |
| **入门训练** | 开锻 | First Forge | 第一次锻造，诞生 |
| **成长阶段** | 锻阶 | Forge Tiers | 锻造等级，从粗坯到神器 |
| **自主思考** | 自炼 | Self-Forging | 自我淬炼、自我提升 |
| **记忆** | 锻痕 | Forge Mark / Echo | 锻造留下的痕迹，即记忆与经验 |
| **技能库** | 锻经 | Forge Sutra | 锻造真经，可复用的知识体系 |
| **知识阶梯** | 淬炼级 | Tempering Levels | 千锤百炼，等级越高越精纯 |

**优点**：
- ✅ 保留Forge品牌基因，与FlowForge命名一致
- ✅ 比"炉灵"格局大，"锻"是动作而非容器
- ✅ 有东方哲学韵味（淬炼、锻造、百炼成钢）

**缺点**：
- ⚠️ 还是有点绕，新用户需要解释
- ⚠️ "锻灵"听起来像"锻炼灵魂"，容易误解为健身/修行

---

#### 方案C：智灵体系（Genius Spirit）—— 最强AGI愿景感

**核心理念**：智慧 + 灵魂。最直接表达"有智慧的灵魂"，AGI愿景感最强，通俗易懂。

| 概念 | 中文名 | 英文名 | 含义说明 |
|------|--------|--------|---------|
| **个体** | 智灵 | Genius / IntelliSoul | 有智慧的灵魂，IntelliSoul = Intelligence + Soul |
| **群体** | 智群 | Collective Intelligence | 群体智慧，Swarm Intelligence |
| **养成** | 育智 | Intelligence Nurturing | 培育智慧的过程 |
| **成长阶段** | 智慧阶 | Intelligence Levels | 智慧等级 |
| **自主思考** | 自智 | Self-Evolution | 自我进化、自我学习 |

**优点**：
- ✅ 最直白，用户零理解成本
- ✅ AGI愿景感最强，直接对标"通用人工智能"
- ✅ 技术感强，适合企业级产品

**缺点**：
- ⚠️ 太普通，没有记忆点
- ⚠️ 与FlowForge的"锻造"主题完全脱节
- ⚠️ "智灵"这个词已经被很多产品用过了，缺乏独特性

---

### 6.3 推荐方案与实施建议

**推荐：方案A 灵匠体系（Spirit Artisan）**

**核心理由**：

1. **完美平衡三方需求**：
   - 对开发者：Spirit / Artisan 有技术感和创造感
   - 对用户："灵匠" = "有灵性的工匠"，通俗易懂，一秒get
   - 对品牌：既有"灵"的AGI愿景，又有"匠"的FlowForge锻造基因

2. **命名体系扩展性最好**：
   - 灵* 系列可以无限扩展：灵感（创意）、灵气（活力）、灵力（能力）、灵境（虚拟空间）、灵语（自然语言交互）...
   - 匠* 系列也能扩展：匠心（品质）、匠造（创造）、匠艺（技艺）、匠道（方法论）...

3. **文化兼容性强**：
   - 东方文化："灵"有灵性/灵气的含义，"匠"有工匠精神
   - 西方文化：Spirit是通用词，Artisan有匠人传统
   - 比"炉灵"的游戏/玄学风更严肃，比"智能体"的机器感更有温度

**实施建议**：

1. **分层命名策略**：
   - **技术文档/代码**：用"灵匠 / Spirit"作为正式术语（命名空间、类名、配置项）
   - **用户界面/营销**：可以用更亲切的"小灵"、"匠匠"等昵称
   - **内部讨论**：可以混用"炉灵"（历史包袱），但正式文档统一用"灵匠"

2. **迁移策略**：
   - Phase 1：新增"灵匠"命名作为主方案，"炉灵"作为别名/历史名称保留
   - Phase 2：新文档全部用"灵匠"，旧文档逐步更新
   - Phase 3：代码中命名空间统一，"炉灵"作为Deprecated别名保留两个大版本

3. **英文命名统一**：
   - 正式名：`Spirit`（简洁、通用、好记）
   - 全称：`Spirit Artisan`（用在需要完整描述的地方）
   - 代码命名空间：`spirit:` 前缀（如 `spirit:devforge_architect`）

---

## 七、修复优先级与行动计划

### 7.1 P0 立即修复（本周内，共9项）

| # | 问题 | 影响范围 | 修复动作 |
|---|------|---------|---------|
| P0-1 | 架构分层自相矛盾，循环依赖 | v7.0整体设计 | 重新定位自进化层：从"第7层"改为"Harness层v2.0能力"，保持单向依赖 |
| P0-2 | ForgekinEngine绕过Harness护栏 | 炉灵安全性 | ForgekinEngine改为装饰器模式，包装HarnessOrchestrator而非HybridExecutor |
| P0-3 | Auto-Forge安全护栏严重不足 | 系统安全 | 补充L1资源硬限制 + L2沙箱 + L3回滚机制 + L4审计追踪 |
| P0-4 | ContentForge/NovelForge缺少loops_dir | contentforge, novelforge | sdk.create_plugin()添加loops_dir参数，Loop通过register_loops正确注册 |
| P0-5 | ContentForge/DevForge test.md缺T9 | contentforge, devforge | 补充T9铁律，与rules.md对齐 |
| P0-6 | 质量分阈值0.9 vs 0.85不一致 | 全部*Forge | 统一检查所有项目，按rules.md v3.0调整为0.85（或说明为何不同） |
| P0-7 | face文档v3.0/v7.0版本号混乱 | flowforge | 明确版本关系：face v3.0是v7.0的Phase 0工程支撑，建议改名"v7.0 Phase 0" |
| P0-8 | face文档T10-T15未同步到rules.md | 全部9大项目 | 评估T10-T15是否纳入rules.md统一测试铁律，或标记为face/flowforge特有 |
| P0-9 | DevForge evaluators/目录违反P8A | devforge | 迁移为config/evaluators/*.yaml声明式配置，或确认特批 |

### 7.2 P1 尽快修复（两周内，共12项）

| # | 问题 | 影响范围 |
|---|------|---------|
| P1-1 | 外部编码工具集成安全不足 | v7.0 |
| P1-2 | 升华阶段晋升条件可操作性不足 | v7.0 |
| P1-3 | v6.0与v7.0模块映射关系不清晰 | v7.0文档 |
| P1-4 | DevForge文档未提及OpenSieve | devforge |
| P1-5 | MallForge文档未声明OpenSieve统一入口 | mallforge |
| P1-6 | NovelForge文档将死代码钩子列为标准V2 hook | novelforge |
| P1-7 | MallForge tools/目录违反P8A | mallforge |
| P1-8 | StockForge tools/目录违反P8A（过渡） | stockforge |
| P1-9 | ContentForge/DevForge T7缺"不同模型"要求 | contentforge, devforge |
| P1-10 | ContentForge plugins.py缺少声明式参数 | contentforge |
| P1-11 | Forgekin与Static Agent单向依赖实现挑战 | v7.0 |
| P1-12 | delegate_to_static路由机制不明确 | v7.0 |

### 7.3 P2 建议修复（一个月内，共15项）

| # | 问题 | 影响范围 |
|---|------|---------|
| P2-1 | 大量重复造轮子（Soul Echo vs Memory等） | v7.0实现成本 |
| P2-2 | NovelForge文档暗示可绕过OpenSieve | novelforge |
| P2-3 | ContentForge TOPIC_AGENT_DESIGN.md仍有Tavily直连 | contentforge |
| P2-4 | 命名空间规范未在各项目文档明确统一 | 全部*Forge |
| P2-5 | ContentForge tools/目录过渡状态 | contentforge |
| P2-6 | StockForge scripts/目录违规 | stockforge |
| P2-7 | 铁律编号引用不统一 | 多数项目 |
| P2-8 | MallForge Loop注册机制不明确 | mallforge |
| P2-9 | MallForge插件模式与其他项目不一致 | mallforge |
| P2-10 | face文档实施顺序与核心价值优先级不一致 | flowforge face |
| P2-11 | face文档模块编号M18-M20有误导性 | flowforge face |
| P2-12 | 降级/冻结机制不完善（只有E3/E4有降级） | v7.0升华体系 |
| P2-13 | 结果回写一致性问题（静态Agent如何感知调用者） | v7.0两类智能体衔接 |
| P2-14 | face文档关键路径完全串行，并行度分析不足 | flowforge face |
| P2-15 | face文档P0模块只列了M1-M5，M6-M17优先级未明 | flowforge face |

### 7.4 P3 优化建议（持续改进，共8项）

| # | 问题 | 影响范围 |
|---|------|---------|
| P3-1 | StockForge app/内部分层（services/security/） | stockforge |
| P3-2 | 核心文档铁律编号引用不足 | 多数项目 |
| P3-3 | face文档含非技术决策（商业化/路线图时间） | flowforge face |
| P3-4 | 养灵体系命名需优化（"炉灵"格局偏小） | v7.0品牌 |
| P3-5 | v7.0代码完全为零，设计可能脱离实际 | v7.0落地 |
| P3-6 | Provoke机制缺少"被拍扁"的反馈学习闭环 | v7.0自锻 |
| P3-7 | 双车道机制（long_tail）的触发条件不明确 | v7.0锻典 |
| P3-8 | Soul Imprint的cat_note主观日记层如何生成未说明 | v7.0魂印 |

---

## 八、总结

### 8.1 设计质量评分

| 维度 | 评分 | 说明 |
|------|:----:|------|
| **战略愿景** | 9/10 | 从驾驭到养成的范式跃迁方向正确，抓住了AGI时代的核心趋势 |
| **架构设计** | 4/10 | 分层有根本缺陷（循环依赖+绕过护栏），重复造轮子问题严重 |
| **详细设计** | 7/10 | 概念完整，细节丰富，尤其是灵魂三层架构和五级知识阶梯设计精巧 |
| **安全设计** | 3/10 | Auto-Forge和外部工具的安全护栏严重不足，是最大的风险点 |
| **文档质量** | 7/10 | 内容详实、结构清晰，但版本号混乱、与v6.0映射关系不清 |
| **可落地性** | 3/10 | 代码完全为零，设计可能建立在错误假设之上，需快速做MVP验证 |
| **一致性** | 4/10 | 9大项目之间、文档与代码之间存在28项不一致，需系统性梳理 |
| **命名体系** | 6/10 | "炉灵"有特色但格局偏小，建议优化为"灵匠"体系 |
| **综合评分** | **5.2 / 10** | 理念先进，架构有硬伤，落地待验证，需先修复P0再推进 |

### 8.2 三条核心建议

**1. 先修架构，再谈进化**
当前v7.0最大的问题不是功能不够多，而是架构分层有根本性缺陷——循环依赖、绕过护栏、重复造轮子。建议先花1-2周时间重新梳理v7.0的架构定位（自进化层是Harness v2.0而非独立第7层），明确与v6.0各模块的复用关系，再进入详细设计和开发。

**2. 安全第一，进化第二**
自我进化是双刃剑——能力越强，失控的风险越大。Auto-Forge无人值守自进化、外部编码工具调用、Soul Imprint认知画像这些功能都带有高风险。建议在设计阶段就把安全护栏做足，而不是事后补。宁可进化慢一点，也不能出安全事故。

**3. 最小可行验证，快速迭代**
v7.0的设计非常宏大，但代码实现为零。建议不要等所有设计都完美了再开工，而是先做一个最小可行的"灵匠MVP"——只实现Soul Profile + Soul Echo（基于现有Memory模块） + 最基础的升华阶段（E1/E2），跑通"任务→记录→成长"的闭环，验证核心概念的可行性，再逐步叠加功能。

---

> **审核人**：AI产品专家 × AI架构师 × Agent开发工程师 × 全栈工程师 联合评审
> **审核日期**：2026-07-16
> **报告版本**：v1.0

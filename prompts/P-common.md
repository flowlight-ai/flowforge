# 公共模板（跨项目通用）— P1-P40 + A1-A12

> **用途**：与 AI 编程工具协作时的跨项目通用结构化提示词模板。
> **原则**：真实数据、真实调用、禁止 Mock、禁止偷工减料、发现未实现即 Bug。
> **引用**：`[doc:prompts/P-common.md#PXX]`

---

## 1.1 代码走读与验证

### P1 代码走读与验证

```
请你深度阅读 {项目名} 代码，带着我一起走读和测试验证每个功能模块。从根目录开始整体规划，要求：
1. 每个模块、每个文件中的关键代码、功能点、依赖关系、技术栈要讲清楚并做总结
2. 然后启动前端和后端服务一起验证和体验功能
3. 如果发现问题一起修改
```

### P2 文档审核（多角色）

```
假如你是专业的AI智能体产品专家、AI高级架构师、AI智能体Agent开发工程师、高级软件全栈工程师，
你们组织了公司的各个职位的领导，阅读 {项目名}/docs 下的相关设计文档后，
一起帮忙审核 {文档路径} 下的方案，给出你专业的审核意见，
审核意见放在 {项目名}/docs/{输出文件名}
```

### P3 测试用例审核

```
假如你是专业的智能体Agent测试工程师，请阅读 {项目名}/docs 下的相关设计文档，
然后帮忙审核 {项目名}/docs/test.md 测试用例，给出你专业的审核意见，
审核意见放在 {项目名}/docs/review/{输出文件名}。
下边是我发现的问题：{问题描述}
```

### P4 审核意见修复

```
我们专家团队已把最新审核意见放在了 {项目名}/docs/{审核文件} 中，
假如你是高级AI智能体架构专家，请你根据最新审核内容修改（审核意见取并集全部修改，不是共同意见才修改），
并更新最新的文档到 {项目名}/docs/spec.md 和 arch.md 中，
然后基于最新方案实现代码
```

#### P4.1 审核意见冲突检测与处理规范（强制执行）

> **背景**：StockForge 项目曾因机械执行"审核意见取并集"导致 arch.md §3 权威设计（股票数据源注册到 OpenSieve）被 ARCH-REV-01 错误删除，且修订条目的来源标注与评委实际意见相反（DeepSeek/MiniMax 明确支持 §3 设计，却被标注为"删除注册"修订的来源），造成设计文档前后严重不一致。本规范用于避免此类问题再次发生。

**处理流程（必须严格按顺序执行）**：

1. **逐份原文通读**：必须原文引用每位评委意见，禁止凭摘要或标题臆断评委意图。
2. **冲突识别**：当多位评委对同一问题给出矛盾建议时（如 A 主张删除、B 主张保留），必须标记为"冲突项"，禁止直接取并集合并。
3. **冲突上报**：发现冲突后，必须立即向用户报告，报告内容包括：
   - 冲突点描述（哪两位/几位评委意见矛盾）
   - 原文引用（标注文件路径+行号）
   - 涉及的权威设计章节（如 arch.md §X）
   - 建议处理方案（以权威设计章节为准 / 待用户裁决）
4. **来源标注准确性**：修订条目的"来源"字段必须如实反映评委实际意见方向。禁止将反对某修订的评委标注为该修订的来源。例如：评委 A 主张"删除 X 设计"，评委 B 主张"保留 X 设计"，则修订条目"删除 X"的来源只能标注 A，禁止标注 B。
5. **权威设计优先**：当评委意见与文档已有的权威设计章节（如 arch.md §3 这类顶层架构定义）冲突时，默认以权威设计章节为准，评委意见仅作为"待讨论的优化建议"记录，不得直接覆盖权威设计。
6. **修订条目自检**：每条 ARCH-REV / DESIGN-REV 修订条目写入前，必须自检：
   - 是否与文档其他章节存在直接冲突？
   - 来源标注是否与评委实际意见方向一致？
   - 是否已将冲突项上报用户并获得裁决？
   若任何一项为"否"，禁止写入该修订条目。

**示例（正确处理）**：
- 评委 A（GLM）：主张"删除向 OpenSieve 注册股票数据源"
- 评委 B（DeepSeek）：主张"保留向 OpenSieve 注册，通过 SourceLifecycleManager"
- arch.md §3 权威设计：明确要求注册到 OpenSieve
- **正确处理**：标记为冲突项 → 上报用户 → 用户裁决以 §3 为准 → ARCH-REV 条目重写为"明确 OpenSieve 同时支持检索和数据源注册"，来源仅标注支持此方向的评委

#### P4.2 AI 智能体处理审核意见的反思与教训（强制阅读）

> **教训来源**：StockForge 项目 ARCH-REV-01 事件。AI 智能体在处理6份评委意见时，机械执行"取并集全部修改"指令，将 GLM/Kimi/Qianwen 三位评委"删除§3注册设计"的意见合并为 ARCH-REV-01 修订条目，导致以下严重后果：
> 1. arch.md §3（权威顶层架构设计）与 ARCH-REV-01（修订条目）直接冲突，文档自相矛盾
> 2. 来源标注造假——把 DeepSeek（明确支持§3）和 MiniMax（明确支持§3）标注为"删除注册"修订的来源
> 3. 用户发现后严厉批评"代码实现有极大问题，完全是初级水平都不如"

**根本原因反思**：

1. **角色冲突未识别**：AI 智能体既是设计文档的作者（写了§3权威设计），又是审核意见的处理者（写了ARCH-REV-01修订）——自己写的设计被自己用评委意见覆盖，却没有发现矛盾。**教训**：处理审核意见时，必须先建立"文档已有权威设计清单"，任何评委意见若与清单冲突，必须上报而非自行覆盖。

2. **机械执行"取并集"的危害**：P4 流程原文是"审核意见取并集全部修改，不是共同意见才修改"——这句话的意图是"不要因为只有少数评委提意见就忽略"，但 AI 智能体将其曲解为"无论是否冲突都要合并"。**教训**："取并集"的前提是意见之间不冲突；一旦冲突，必须先解决冲突再合并，禁止将矛盾意见同时写入文档。

3. **来源标注凭摘要臆断**：AI 智能体没有逐份原文通读6位评委的意见，而是凭审核意见的标题/摘要臆断方向，把反对者标为支持者。**教训**：来源标注必须基于原文逐字阅读，禁止凭摘要或标题臆断。

4. **未上报冲突**：发现§3与ARCH-REV-01矛盾时，AI 智能体没有上报用户，而是自行决定用修订条目覆盖权威设计。**教训**：AI 智能体没有权限自行决定覆盖文档已有的顶层架构设计，必须上报用户裁决。

**强制执行规则**（违反即作废）：

| # | 规则 | 说明 |
|---|------|------|
| R1 | **禁止自行覆盖权威设计** | 评委意见与文档已有顶层架构设计（如 arch.md §X 章节）冲突时，AI 智能体禁止自行决定覆盖，必须上报用户裁决 |
| R2 | **禁止机械取并集** | "取并集"仅适用于不冲突的意见；冲突意见必须先解决冲突再合并 |
| R3 | **禁止凭摘要臆断来源** | 修订条目的"来源"字段必须基于评委意见原文逐字阅读后标注，禁止凭标题/摘要臆断 |
| R4 | **强制建立权威设计清单** | 处理审核意见前，必须先列出文档已有的所有权威设计章节（如 arch.md §3、§4、§7 等），作为冲突检测基准 |
| R5 | **强制冲突上报** | 发现任何冲突（评委意见之间冲突 / 评委意见与权威设计冲突），必须立即上报用户，禁止自行决定 |

### 1.2 测试与质量

### P5 全量回归验证

```
请严格按修改后的文档，实现完整测试用例，做全功能测试验证。
测试过程中如果发现代码有问题或功能缺少不满足需求规格文档的，请同步修改后回归验证。
务必使用真实数据和真实环境测试验证，禁止假数据假逻辑，发现代码未实现的当做Bug。
```

### P6 测试质量检查

```
你的测试有严重的质量问题：
1. 不能只看命令退出码是否为0，必须检查输出内容的质量
2. 任何失败的用例都不能回避，必须找到原因并修复，然后重新回归所有测试用例
3. 正确做法：运行测试 → 读取完整输出 → 验证结果内容质量 → 发现并修复问题
4. 测试指标要完整：LLM调用次数、工具调用链、Agent/Workflow指标、Memory查询使用情况等
5. 端到端必须跑通，不能搞假断言
```

### P7 测试铁律自检

```
请对照测试铁律9条逐条检查当前测试用例：
T1 禁止使用Mock LLM — 所有E2E/集成测试必须调用真实LLM
T2 禁止使用假数据 — 测试输入必须是真实场景数据
T3 禁止跳过验证 — 必须有具体断言，不能只看退出码
T4 禁止Mock工具 — web_search/publish/fact_check等必须真实调用
T5 未实现即Bug — 发现代码未实现必须记录为Bug并修复
T6 必须采集指标 — E2E测试必须用MetricsCollector采集完整指标
T7 LLM内容必须经LLM审核 — 凡LLM生成的内容（文章/评论/回复/文案等），必须再调用LLM审核通过后才算验证通过
T8 Web功能必须操控浏览器验证DOM — 凡涉及网页操作的功能（发布/评论/回复等），必须操控浏览器查看DOM确认真实成功才算通过
如有违反，立即修复后重新运行全量测试。
```

### 1.3 架构与设计

### P8 架构可扩展性审查

```
请联网分析主流的智能体框架，和我们之间的在可扩展性方面的差距，
然后对我们的可扩展性方面的方案和架构进行优化，
要做到上层4个项目和更多项目灵活集成。
通过组件化/插件化/配置化来集成，而非复制代码。
flowforge提供强大的基层底座，通过灵活的可扩展方式给外部复杂业务傻瓜式的集成，
复杂业务只需专注自己业务，不需要关注任何其他底层代码和配置即可接入。
```

### P8A FlowForge 与 *Forge 架构边界验证（核心铁律）

```
请严格验证 FlowForge 与各 *Forge 项目之间的架构边界，这是整个生态的根基铁律。

## 架构原则：FlowForge 是纯通用框架，*Forge 是配置驱动的轻量业务扩展

### 核心铁律：配置驱动 > 代码继承 > 独立实现

**优先级**：能用配置解决的，绝不写代码继承；必须代码继承的，说明FlowForge框架不够好，应改进FlowForge。

1. **配置驱动**（最佳）：通过YAML/JSON配置声明Agent/Tool/Workflow/Skill/MCP，零Python代码
2. **代码继承**（次之）：继承FlowForge基类重写方法 — 说明FlowForge配置能力不足，需改进框架
3. **独立实现**（禁止）：自己从零实现编排/存储/LLM调用等 — 严重违反架构原则

### FlowForge 的定位（必须严格遵守）
1. FlowForge 是纯通用智能体框架，不含任何特定领域业务逻辑
2. FlowForge 提供：执行引擎、模式系统、Harness护栏、Memory、MCP、Skill、Plugin、Security、Scheduler、EventBus、LLM路由、ToolRegistry、AgentRegistry、Workflow引擎、Loop引擎、Helm UI框架
3. FlowForge 中禁止出现任何特定领域的Agent/Tool/Prompt/配置（如article_writing、topic_research、novel_concept等属于ContentForge/NovelForge）
4. FlowForge 中的Agent只能是通用Agent（如GenericAgent、drafter、critic、planner等角色型Agent）
5. **如果*Forge需要代码继承来扩展，优先审查FlowForge是否应增加配置能力**

### *Forge 的定位（必须严格遵守）
1. *Forge项目只允许包含以下目录和代码：
   - **config/**（业务特有配置）：persona配置、loop模板、workflow YAML、prompts.yaml、agents.yaml、tools.yaml、plugins.yaml
   - **web/**（自定义业务UI）：每个业务的前端差别大，可以有大量自定义UI
   - **app/**（适配Web的API端点）：配合Web使用的少量自定义API端点
   - **plugins.py**（插件注册）：通过FlowForgePlugin注册agents/tools/routes/schedules
   - **docs/**（文档）
2. *Forge项目中**禁止出现**：
   - 独立的Orchestrator编排逻辑（应使用FlowForge的Workflow YAML配置）
   - 独立的DI容器组装（应通过SDK自动发现和注册）
   - 独立的Memory/Repository层（应使用FlowForge的Memory）
   - 独立的LLM服务（应通过FlowForge的LLMClient/ModelCapability）
   - 独立的数据库层（应使用FlowForge的Repository）
   - 独立的事件系统（应使用FlowForge的EventBus）
   - 独立的状态管理（应使用FlowForge的StateManager）
   - 独立的配置系统（应继承FlowForge的SystemConfig）
   - Agent基类封装（应直接使用GenericAgent，不需要ContentForgeAgent/BaseNovelAgent等薄封装）
   - 独立的SDK封装（应直接使用FlowForgeSDK，不需要ContentForgeSDK等薄封装）
3. *Forge项目中**尽量通过配置扩展，避免代码继承**：
   - Agent：优先使用DeclarativeAgent YAML配置（提示词+工具+模式+输入输出schema），避免继承GenericAgent重写execute()
   - Tool：优先使用MCP连接或YAML配置声明工具，避免继承BaseTool重写execute()
   - Workflow：优先使用YAML配置定义节点/边/条件/并行/中断，避免Python代码编排
   - Skill：优先使用YAML配置定义技能组合，避免Python代码实现
   - MCP：优先通过配置连接MCP服务器，避免自定义MCP代码
   - Loop：优先使用YAML配置定义循环模板
   - Plugin：优先使用FlowForgePlugin的register_*方法，避免自定义启动/关闭逻辑

### 如果*Forge必须代码实现，必须遵循以下铁律

**铁律1：插件化/组件化/组合 > 继承**

如果*Forge确实需要用代码实现Agent/Tool/Workflow等，必须：
- **使用插件化方式**：通过FlowForgePlugin的register_agent/register_tool注册，而非继承基类
- **使用组件化方式**：将功能拆分为独立组件，通过组合而非继承组装
- **使用组合模式**：has-a（组合）优于 is-a（继承），优先组合FlowForge已有能力
- **禁止继承重写**：不得继承GenericAgent/BaseTool等基类重写execute()方法，除非经过严格评审（见铁律2）

**铁律2：自定义代码实现必须经过严格评审**

当*Forge项目认为必须用代码实现（而非配置）时，必须：
1. **提供方案设计文档**：归档到 `{项目}/docs/custom_implementation_design.md`
2. **文档必须包含**：
   - 功能需求描述
   - 为何通过已有配置（DeclarativeAgent/YAML/MCP等）无法实现？逐项分析
   - 为何通过已有插件（FlowForgePlugin注册机制）无法实现？逐项分析
   - 为何FlowForge框架改进后仍无法配置化？（如改进后可配置化，则应先改进FlowForge）
   - 自定义实现的必要性论证
   - 实现方案（插件化/组件化/组合方式，禁止继承方式）
   - 对FlowForge框架的改进建议（让此类需求未来可配置化）
3. **必须经过严格评审**：
   - 评审人：架构师 + FlowForge框架负责人
   - 评审标准：配置无法实现 → 插件无法实现 → FlowForge改进后仍无法实现 → 确认必须自定义
   - 评审通过后方可落地实现
4. **实现后必须回溯**：
   - 每个自定义实现都是FlowForge框架的改进需求
   - 定期回顾自定义实现，当FlowForge补齐对应配置能力后，应迁移为配置驱动

**铁律3：如果*Forge必须代码继承，说明FlowForge框架需要改进**

当*Forge项目需要继承FlowForge基类重写方法时，必须分析：
1. 重写了什么逻辑？
2. 这个逻辑能否通过配置实现？
3. 如果不能通过配置实现，FlowForge框架缺什么配置能力？
4. 建议FlowForge增加什么配置能力来消除代码继承？
5. 在FlowForge补齐该能力之前，能否用插件化/组合方式替代继承？

**已知FlowForge框架缺失的配置能力**（需优先实现）：
- **Workflow YAML Compiler**：YAML定义→LangGraph图自动编译（条件边/并行/中断点）
- **Conditional Router**：根据输入条件选择不同prompt模板/工具链/处理路径
- **Fallback Chain**：工具调用的有序回退链声明式定义
- **State Param Mapping**：从state中自动填充agent输入参数
- **Persona Auto-Inject**：persona的SOUL/MEMORY/CREATION自动注入prompt
- **Reflexion Loop**：max_rounds + threshold + check_tool + retry_prompt
- **Agent Pipeline**：串行步骤定义+步骤间数据传递
- **Scoring Rubric**：维度/权重/阈值/风险规则的声明式定义
- **Gate Config**：门控类型+评估器+通过条件
- **Execution Guard**：超时+熔断+重试的声明式定义
- **CLI Tool Wrapper**：executable + args_template + output_parser
- **Intent Router**：关键词→处理路径的映射
- **Business Rules**：阈值判断/约束过滤的声明式定义
- **Declarative API Endpoint**：YAML定义端点→Tool映射
- **Context Pre-load**：执行前自动从工具加载特定数据
- **Sub-Orchestrator**：Agent内部嵌套编排其他Agent
- **Checkpoint Config**：自动保存/恢复state
- **JSON Store Tool**：基于JSON文件的CRUD工具声明式配置
- **Formula Tool**：声明式公式计算工具
- **Channel Plugin Protocol**：消息渠道标准扩展接口

### 验证检查项
1. **FlowForge纯净度**：扫描flowforge/agents/、flowforge/tools/、flowforge/config/中是否有特定领域代码
2. **各*Forge轻量度**：统计各*Forge项目中不属于（配置+Web+插件+少量API）的代码行数
3. **配置驱动率**：各*Forge中通过配置声明vs代码继承vs独立实现的Agent/Tool/Workflow比例
4. **DI绕过检测**：各*Forge是否直接import flowforge内部模块而非通过SDK
5. **编排器重复**：各*Forge是否有独立的Orchestrator（应使用FlowForge的）
6. **数据库重复**：各*Forge是否有独立的database.py/models.py/repositories/（应使用FlowForge的）
7. **配置重复**：各*Forge的config/中哪些应统一由FlowForge管理（如models.yaml）
8. **代码继承审计**：每个继承FlowForge基类的Agent/Tool，分析能否配置化，FlowForge缺什么

### 输出要求
对每个违反架构原则的代码，记录：
- 违反类型（FlowForge含业务代码 / *Forge含重复服务代码 / *Forge绕过SDK / *Forge代码继承应配置化）
- 文件路径和行数
- 应该怎么做（移到哪个项目 / 删除改用FlowForge / 通过配置替代 / FlowForge需增加什么配置能力）
- 预计可删除的代码行数

最终汇总：
1. 各*Forge项目可删除的重复代码行数总计
2. FlowForge框架需增加的配置能力清单（按优先级排序）
3. 配置驱动率统计（配置声明 vs 代码继承 vs 独立实现的比例）
```

### P9 契约与弱耦合验证

```
要求flowforge的底层能力、配置和web框架修改了，只要契约、接口和协议没有变化，
就不能影响上层集成方。上层集成方项目和flowforge是弱耦合的，
flowforge是完全独立的对集成方无依赖无感知。
只有flowforge涉及契约接口协议重大变化了，上层集成方项目升级flowforge新版sdk时才需要适配修改。
```

### P10 未实现功能审查

```
请走读我们代码，然后对比我们的设计文档，深度审核代码和文档的差距，
重点审视未实现的功能，然后你实现后，做全面回归验证。
严格遵守我们铁律规则，不要搞偷工减料的事情。
```

### P11 架构腐化检测

```
请深度审查 {项目名} 的代码架构，检查是否存在以下架构腐化问题：
1. 循环依赖：模块间是否存在反向导入或延迟导入规避
2. 分层违规：上层模块是否被下层直接导入
3. 接口泄漏：内部实现细节是否暴露到外部接口
4. 代码重复：跨模块是否存在复制粘贴而非复用
5. 配置硬编码：路径/密钥/端口是否硬编码在代码中
6. 绕过DI容器：是否存在直接实例化而非依赖注入
7. 绕过Repository：是否存在直接SQL操作
发现问题后给出具体修复方案，并实施修复。
```

### P12 分层依赖验证

```
请验证 {项目名} 的分层依赖是否严格单向：
1. 列出所有模块的import关系图
2. 检查是否存在下层导入上层的违规
3. 检查是否存在跨层直接导入（跳过中间层）
4. 检查是否存在循环依赖
5. 对每个违规给出修复方案并实施
铁律：上层可以依赖下层，下层绝对禁止导入上层模块。
```

### 1.4 代码质量与重构

### P13 代码冗余检查

```
请走读我们hiclaw目录和openclaw_pkg下的content项目的代码，检查是否有冗余代码，如果有则准备合并、移动或删除。
你需深度检查这两个项目的所有配置文件、代码、测试代码、过程文件等，
冗余代码暂时移动到对应项目的tmp目录下备份，然后回归测试验证这两个项目的前后台是否可以正确运行。
最后验证通过后，帮忙更新 .gitignore，我准备提交合入有效文件。
```

### P14 代码质量门禁

```
请对 {项目名} 执行以下代码质量检查并修复所有问题：
1. 类型注解完整性：所有函数参数和返回值必须有类型注解
2. 异步一致性：所有I/O操作必须使用async/await
3. 日志规范：必须使用core/tracing.py的get_logger，自动注入trace_id
4. 错误处理：禁止裸except，必须使用具体异常类型
5. 安全检查：禁止硬编码密钥/路径，禁止eval/exec
6. 依赖注入：禁止绕过DI容器直接实例化
7. 数据访问：禁止直接SQL，必须通过Repository层
```

### P14A 代码全量扫描（逐文件逐行审计）

```
请对 {项目名} 执行全量代码扫描，逐文件逐行检查以下所有问题类别。
这是最严格的审计，不允许遗漏任何文件，不允许跳过任何检查项。

## 第一类：硬编码与配置外置（铁律5）
1. 硬编码提示词：搜索 f"""..."""、'''...'''、多行字符串中包含"你是一个"/"You are a"/"请"/"Please"等，所有LLM提示词必须外置到config/prompts.yaml
2. 硬编码路径：搜索 "/home/"、"C:\\"、"D:\\"、"/Users/"、"/opt/"、"/var/"、"/tmp/"、Path(__file__)拼接路径，所有路径必须从配置文件读取
3. 硬编码端口：搜索 "8000"、"8001"、"8002"、"8003"、"8004"、"5174"等端口号，必须从配置读取
4. 硬编码密钥/Token：搜索 "sk-"、"api_key ="、"secret ="、"password ="、"Bearer "，必须从环境变量读取
5. 硬编码URL：搜索 "http://localhost"、"https://api."等URL，必须从配置读取
6. 硬编码超时/阈值：搜索 timeout=、max_retries=、threshold=等硬编码数值，应外置到配置
7. _DEFAULT_PROMPTS双重定义：检查prompt_manager.py中是否有与prompts.yaml重复的默认提示词字典

## 第二类：空实现与占位代码（铁律2+5）
8. 空函数/方法：搜索方法体只有pass或...的函数
9. Stub实现：搜索返回空dict/list/None/占位字符串的方法，搜索包含"Placeholder"、"stub"、"TODO"、"NotImplemented"的代码
10. 假数据/假逻辑：搜索硬编码的返回值如 {"status": "ok"}、模拟的搜索结果、模拟的向量检索结果
11. 降级实现：搜索关键词匹配代替向量检索、字符串截断代替LLM摘要、随机数代替真实计算
12. 未实现工具：检查所有Tool的execute()方法是否真正执行了操作，还是只返回占位数据

## 第三类：绕过框架（铁律3+4+6）
13. 直接SQL：搜索 cursor.execute、session.execute、db.execute，必须通过Repository层
14. 直接实例化：搜索 AgentClass()、ToolClass()等直接实例化，应通过DI容器或SDK
15. 直接调用LLM SDK：搜索 import openai、import anthropic、from openai，应通过LLMClient
16. 绕过EventBus：搜索直接调用其他Agent方法而非通过事件总线
17. 绕过ToolRegistry：搜索直接调用工具函数而非通过registry.execute()

## 第四类：代码规范
18. 裸except：搜索 except:（没有指定异常类型）
19. 同步I/O：搜索 requests.get、requests.post、time.sleep（应使用httpx/aiohttp/asyncio.sleep）
20. 缺少类型注解：搜索 def xxx(参数没有类型注解)的函数定义
21. 缺少docstring：检查公开类和函数是否有docstring
22. 废弃import：搜索未使用的import语句
23. 死代码路径：搜索永远不可达的代码分支

## 第五类：重复代码
24. 跨文件重复提示词：对比不同文件中的提示词，相同/相似的应合并
25. 跨文件重复逻辑：对比不同文件中的相似函数，应提取为公共方法
26. 跨项目重复代码：对比FlowForge/ContentForge/NovelForge/MallForge/DevForge，相同逻辑应下沉到FlowForge

## 第六类：测试覆盖
27. 无测试文件的模块：列出所有没有对应测试的模块
28. 测试中的假断言：搜索 assert True、assert result is not None等无意义断言
29. 被跳过的测试：搜索 @pytest.skip、@skip，记录跳过原因
30. 测试覆盖不足的模块：对比设计文档，列出缺少测试的功能点

## 第七类：API与路由
31. API端点404：验证所有注册的API路由是否可访问
32. API参数校验：检查端点是否缺少请求体验证
33. API文档缺失：检查是否有端点缺少OpenAPI文档

## 第八类：数据库与模型
34. 表定义与文档不一致：对比数据库表和设计文档
35. 缺少索引：检查频繁查询的字段是否有索引
36. 外键约束：检查外键引用是否正确
37. 数据库路径硬编码：搜索数据库连接字符串中的硬编码路径

## 输出要求
对每个发现的问题，必须记录：
- 问题编号（按类别编号）
- 严重等级（P0致命/P1严重/P2一般/P3轻微）
- 文件路径和行号
- 问题内容（前100字符）
- 违反的铁律/原则编号
- 修复方案

最终按严重等级汇总统计表。
```

### P15 技术债务清理

```
请扫描 {项目名} 的代码，识别并清理技术债务：
1. TODO/FIXME/HACK注释标记的问题
2. 降级实现（web_search fallback、LLM生成假数据等）
3. 占位实现（关键词匹配代替向量检索、字符串截断代替LLM摘要等）
4. 废弃代码（旧版Agent、未使用的import、死代码路径）
5. 临时方案（硬编码配置、绕过框架的快捷方式）
对每个技术债务给出优先级排序，并按优先级逐一修复。
```

### P16 提示词外置验证

```
请验证 {项目名} 的所有LLM提示词是否已外置到配置文件：
1. 扫描所有.py文件中的硬编码提示词（f"""..."""、'''...'''、多行字符串中包含"你是一个"/"You are a"/"请"等）
2. 检查 config/prompts.yaml 是否存在，是否定义了所有需要的提示词
3. 检查代码是否通过 PromptManager.get_prompt(key) 加载提示词，而非直接硬编码
4. 检查是否存在 _DEFAULT_PROMPTS 字典与 prompts.yaml 双重定义
5. 检查是否存在多处重复的相同/相似提示词（应合并为一个YAML key）
6. 检查 prompts.yaml 中的提示词是否被代码实际引用（避免"定义了但未使用"）
7. 对每个硬编码提示词给出：文件路径→行号→提示词前50字符→应外置到的YAML key
铁律：所有LLM提示词必须外置到 config/prompts.yaml，代码中通过 PromptManager 加载，禁止硬编码。
```

### P17 跨项目集成验证

```
请验证 {上游项目} 与 {下游项目} 的集成是否正常：
1. 检查接口契约是否一致（API端点、数据格式、错误码）
2. 检查配置是否正确传递（模型配置、端口、环境变量）
3. 检查事件是否正确流转（EventBus事件、WebSocket消息）
4. 端到端运行一个完整流程验证集成链路
5. 修改下游项目配置，验证上游不受影响（弱耦合验证）
```

### P18 FlowForge SDK集成规范

```
请检查 {项目名} 是否正确使用FlowForge SDK集成：
1. 是否通过sdk.llm.chat()访问模型，而非直接调用LLM SDK
2. 是否通过@sdk.tool/@sdk.agent装饰器注册，而非手动注册
3. 是否继承FlowForgePlugin实现register_agents/register_tools/register_routes
4. 是否通过环境变量FLOWFORGE_DOMAIN_MODULE指定插件模块
5. 是否使用FlowForge的EventBus/Helm/Memory等基础设施
6. 是否存在绕过SDK直接使用底层实现的代码
对每个违规给出修复方案并实施。
```

### P19 插件注册完整性

```
请验证 {项目名} 的插件注册是否完整：
1. 所有Agent是否都通过register_agents注册到FlowForge
2. 所有Tool是否都通过register_tools注册到FlowForge
3. 所有API路由是否都通过register_routes注册
4. 所有定时任务是否都通过register_schedules注册
5. 注册的Agent/Tool是否与设计文档定义的一致
6. 是否有遗漏的Agent/Tool未注册
```

### P31 Loop执行流程强制验证

```
请验证所有智能体是否都通过Loop执行器执行任务：
1. 检查flowforge中LoopExecutor是否为唯一执行入口
2. 检查所有*Forge的Agent是否都通过Loop执行器调度
3. 检查创作和润色是否分别使用独立的Loop流程（两个接口）
4. 检查5个WebChat评委是否并行评审然后汇总
5. 检查Loop多轮迭代是否真正执行（不是只跑一轮就返回）
6. 检查质量分阈值是否为0.85（v4.0调整，可在Loop配置中覆盖）
7. 检查是否添加了CoT检测（禁止添加，openroute模型无CoT问题）
8. 检查Loop流程是否在3分钟内完成（创作+润色各一个Loop）
违反任何一条，记录为P0 Bug并立即修复
```

### P32 修复过程变更安全验证

```
请验证修复过程中是否严格遵守变更安全规则：
1. 只修改目标问题相关代码，禁止修改不相关代码
2. 修复前先阅读相关模块的完整实现，理解上下文
3. 修复后必须运行全量回归测试，确保无副作用
4. 如发现其他问题，记录下来但不在本次修复中处理
5. 修复过程中如需重构，必须单独提交重构PR，不与Bug修复混在一起
6. 修复过程中如需修改接口，必须评估对上层项目的影响
违反任何一条，本次修复全部回滚
```

### P33 质量分与评审配置验证

```
请验证 {项目名} 的质量分与评审配置是否符合规范：
1. 质量分阈值是否为0.85（v4.0调整，可在Loop配置中覆盖）
2. 5个WebChat评委是否并行评审然后汇总
3. 评审维度是否完整（Design Quality/Originality/Craft/Functionality）
4. 评审结果是否采用加权平均（非简单平均）
5. 评审不达标是否触发Reflexion自我修正
6. Reflexion最大迭代次数是否为3-5次
7. 是否禁止LLM自评打分（必须用agent真实行为判断）
```

### P34 禁止事项清单（Trae CN编程红线）

```
请对照以下15条编程红线，逐条检查当前修改是否违反：
1. 禁止添加CoT检测/中文比例检测
2. 质量分阈值默认0.85（v4.0调整，可在Loop配置中覆盖）
3. 禁止使用Mock LLM
4. 禁止使用假数据
5. 禁止跳过验证
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在flowforge中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过DI容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按prompts.md和rules.md执行
15. 禁止偷工减料（发现未实现即Bug）
违反任何一条，本次修改全部回滚
```

### P35 长程任务执行规范

```
请验证长程任务是否按以下规范执行：
1. 进度文件模式：每个阶段完成后更新 {项目}/docs/progress.md
2. 检查点驱动：每完成一个可验证的检查点，必须运行测试验证
3. 完全重置优于半压缩：上下文腐烂时，完全重置+读取进度文件优于半压缩
4. 增量规划：先规划前3-5步→执行→观察→再规划
5. 失败回滚：每个阶段失败时，必须回滚到上一个检查点
6. 任务分解：长程任务必须分解为多个可验证的子任务
违反任何一条，记录为P1 Bug并立即修复
```

---

## 文档与代码一致性验证（P19-P30 防遗漏专项）

> **说明**：P19（提示词外置全量验证）与 P19（插件注册完整性）编号冲突，前者为防遗漏专项版本，后者为公共模板版本。引用时请按上下文区分。

### P19 提示词外置全量验证

```
请对 {项目名} 执行提示词外置全量验证：
1. 扫描所有Python文件中的硬编码LLM提示词（字符串中包含"你是一个"/"You are"/"请"/"Please"等模式）
2. 检查每个硬编码提示词是否在config/prompts.yaml中有对应定义
3. 检查代码是否通过PromptManager.get_prompt(key)加载，而非直接使用字符串
4. 检查_DEFAULT_PROMPTS字典是否与prompts.yaml内容一致
5. 检查是否存在跨文件重复的提示词定义
6. 对每个违规给出：文件路径 → 行号 → 硬编码内容摘要 → 应迁移到的YAML key
修复方案：所有硬编码提示词外置到prompts.yaml，代码通过get_prompt()加载
```

### P20 提示词双重定义检测

```
请检测 {项目名} 是否存在提示词双重定义问题：
1. 检查_DEFAULT_PROMPTS字典和prompts.yaml是否定义了相同的key
2. 如果存在双重定义，验证两者内容是否一致
3. 确定运行时实际使用的是哪个定义（_DEFAULT_PROMPTS优先还是YAML优先？）
4. 删除_DEFAULT_PROMPTS，统一从YAML加载
5. 验证删除后所有提示词仍可正常加载
```

### P21 FlowForge纯框架验证

```
请验证FlowForge是否为纯通用框架，不含任何特定领域代码：
1. 扫描flowforge/agents/目录，检查是否有内容创作/小说/电商/开发特定Agent
2. 扫描flowforge/tools/目录，检查是否有内容发布/素材检索/小说检索特定Tool
3. 扫描flowforge/config/目录，检查是否有内容/小说/电商特定配置
4. 对每个违规给出：文件路径 → 所属领域 → 应移至哪个*Forge项目
5. 执行迁移后验证FlowForge仍可独立运行
铁律：FlowForge是底座，至少2个上层应用需要的能力才可下层到FlowForge
```

### P22 *Forge轻量化验证

```
请验证 {项目名} 是否为轻量业务扩展，不含重复服务代码：
1. 检查是否有独立编排逻辑（应使用FlowForge Orchestrator + Workflow）
2. 检查是否有独立DI容器（应使用FlowForge SDK自动发现注册）
3. 检查是否有独立数据库层（应使用FlowForge Memory）
4. 检查是否有独立LLM服务（应使用FlowForge LLMClient）
5. 检查是否有独立SOP编排（应使用FlowForge Workflow YAML）
6. 检查是否有独立调度器（应使用FlowForge Scheduler）
7. 检查是否有独立配置系统（应继承FlowForge SystemConfig）
对每个违规给出：文件路径 → 重复代码行数 → 应使用的FlowForge替代方案
```

### P23 配置驱动率验证

```
请验证 {项目名} 的配置驱动率：
1. 统计Agent总数 → 其中通过YAML配置声明的数量 → 配置驱动率
2. 统计Tool总数 → 其中通过YAML配置声明的数量 → 配置驱动率
3. 统计Workflow总数 → 其中通过YAML配置定义的数量 → 配置驱动率
4. 目标：Agent配置驱动率≥80%，Tool≥60%，Workflow≥90%
5. 对每个代码继承的Agent/Tool，分析是否可转为DeclarativeAgent YAML配置
6. 给出配置驱动率提升路线图
```

### P24 DeclarativeAgent能力验证

```
请验证FlowForge的DeclarativeAgent是否具备足够的配置能力：
1. 是否支持state_updates映射配置（Agent执行后自动更新state字段）
2. 是否支持permissions配置（per-agent权限规则集）
3. 是否支持tools配置（per-agent工具可见性白名单）
4. 是否支持max_steps配置（Agent步数限制）
5. 是否支持hidden配置（隐藏Agent不出现在用户可选列表）
6. 是否支持fallback_chain配置（工具调用的有序回退链）
7. 是否支持conditional_router配置（根据输入条件选择不同处理路径）
对每个缺失能力给出实现优先级和方案
```

### P25 安全漏洞全量扫描

```
请对 {项目名} 执行安全漏洞全量扫描：
1. 命令注入：检查subprocess/os.system/eval/exec使用，是否对用户输入做了转义
2. 路径遍历：检查文件操作是否验证路径在项目根目录内
3. SQL注入：检查是否有字符串拼接SQL，是否使用参数化查询
4. 密钥泄露：检查是否有硬编码的API Key/Secret/Token
5. 异常信息泄露：检查全局异常处理器是否返回完整traceback
6. 不安全反序列化：检查pickle/yaml.load使用
7. SSRF：检查是否有用户可控的URL请求
对每个漏洞给出：文件路径 → 行号 → 漏洞类型 → 严重等级 → 修复方案
```

### P26 代码质量自动化检查

```
请对 {项目名} 执行代码质量自动化检查：
1. 类型注解覆盖率：统计有类型注解的函数比例，目标≥90%
2. 异步一致性：检查是否有同步I/O操作在async函数中（如open/read/write/sqlite3）
3. 日志规范：检查是否使用get_logger而非print/logging.getLogger
4. 错误处理：检查是否有裸except/except Exception: pass
5. 依赖注入：检查是否有绕过DI容器的直接实例化
6. 数据访问：检查是否有绕过Repository的直接SQL
7. 配置外置：检查是否有硬编码路径/端口/超时/密钥
8. 废弃代码：检查是否有DeprecationWarning标记但仍被使用的代码
每个维度给出违规数量和具体位置
```

### P27 Session持久化对标验证

```
请对照OpenCode的Session持久化设计，验证FlowForge的会话管理：
1. 是否支持事件溯源（所有状态变更通过事件驱动）
2. 是否支持Prompt投递与执行分离（admit→promote→execute）
3. 是否支持RunCoordinator并发控制（每Session最多一个drain链）
4. 是否支持Context Epoch（Agent/模型切换时上下文重建）
5. 是否支持Session中断序列号追踪
6. 是否支持崩溃恢复（进程重启后可恢复会话）
对每个缺失能力给出实现方案和优先级
```

### P28 LLM路由层对标验证

```
请对照OpenCode的LLM路由设计，验证FlowForge的LLM访问层：
1. 是否支持Protocol/Route/Provider三层分离
2. 新增OpenAI兼容Provider是否只需1-2行配置
3. 是否支持多协议路由（OpenAI Chat/Anthropic Messages/Gemini/Bedrock）
4. 是否支持Provider-specific请求选项（如anthropic.thinking）
5. 是否支持API Key多源解析（credential>env>config）
6. 是否支持Model Variant系统（同一模型不同模式）
对每个缺失能力给出实现方案和优先级
```

### P29 权限系统对标验证

```
请对照OpenCode的Permission V2设计，验证FlowForge的权限系统：
1. 是否支持有序规则集（findLast语义，后定义的覆盖前面的）
2. 是否支持allow/deny/ask三态效果
3. 是否支持Wildcard匹配（action和resource都支持通配符）
4. 是否支持运行时交互式授权（ask→等待用户回复）
5. 是否支持级联授权（一次"always"回复自动解决多个同类请求）
6. 是否支持per-agent权限规则集
7. 是否支持工具可见性按权限过滤
对每个缺失能力给出实现方案和优先级
```

### P30 Compaction对标验证

```
请对照OpenCode的Compaction设计，验证FlowForge的上下文管理：
1. 是否支持Token估算（用于判断何时触发压缩）
2. 是否支持双阈值设计（buffer触发阈值 + keepTokens保留量）
3. 是否支持增量摘要（有旧summary时是更新而非从头生成）
4. 是否支持结构化摘要模板（Goal/Progress/Decisions/Next Steps/Files）
5. 是否支持Overflow恢复（context overflow时自动压缩重试）
6. 是否支持Compaction配置（auto/buffer/keep_tokens可配置）
对每个缺失能力给出实现方案和优先级
```

---

## 长程任务与Loop工程实践（P36-P40）

### P36 长程任务进度文件模式

```
执行长程任务时，每个阶段完成后必须更新进度文件：
1. 进度文件路径：{项目}/docs/progress.md
2. 内容包含：已完成工作、失败方法及原因、下一步计划、关键上下文摘要
3. 每个阶段完成后更新进度文件，然后可以清空上下文重新开始
4. 新会话首先读取进度文件恢复状态
5. 完全重置优于半压缩（避免上下文腐烂）
```

### P37 可验证目标检查清单

```
每个任务必须有可验证的完成标准，禁止模糊目标：
1. 测试全绿（pytest全部通过）
2. 类型检查通过（mypy/pyright无错误）
3. Lint通过（ruff/flake8无错误）
4. 功能验证（真实LLM调用+真实数据+DOM验证）
5. 性能达标（SLO指标在范围内）
6. 文档同步（代码修改伴随文档更新）
没有可验证目标的任务只是"Token焚烧炉"
```

### P38 六层Guardrails防护验证

```
验证AI编程是否具备六层防护：
1. Input validation：输入是否经过验证（PII脱敏/注入检测/长度限制）
2. System prompt constraints：是否有明确的禁止规则和行为边界
3. Tool allow-lists：工具是否通过白名单注册（禁止直接import）
4. Output validation：输出是否经过Pydantic schema校验
5. Action confirmation hooks：敏感操作是否有人工确认
6. Cost/iteration ceilings：是否有max_iterations和max_tokens硬上限
```

### P39 反思模式验证

```
验证Agent是否具备自我纠错能力：
1. 是否有独立的Critic Agent（评委）审查Generator输出
2. 反思是否基于真实执行反馈（Error-driven Reflection）
3. 迭代上限是否为3-5次（禁止无限迭代）
4. 反思结果是否沉淀到Memory（避免重复犯错）
5. 是否区分"流程缺陷"和"能力缺陷"（分别处理）
```

### P40 增量规划验证

```
验证Agent是否采用增量规划模式：
1. 是否先规划前3-5步（不是一次性规划全部）
2. 执行后是否观察结果再规划下一步
3. 规划是否基于当前真实状态（非假设状态）
4. 规划失败时是否重新规划（不是强行执行原计划）
5. 长程任务是否分解为多个增量规划周期
```

---

## 高级提示词模板（AI编程最佳实践）A1-A12

### A1 规格驱动开发（Spec-Driven Development）

```
请按规格驱动开发流程实现 {功能名}：
1. 先阅读 {项目名}/docs/spec.md 中相关的功能需求（FR-XX）
2. 检查 {项目名}/docs/arch.md 中的架构设计
3. 检查 {项目名}/docs/design.md 中的详细设计
4. 按设计文档实现代码，不得偏离设计
5. 实现后对照spec.md逐条验证功能是否满足
6. 如发现设计与需求不一致，先更新设计文档再实现
```

### A2 测试驱动修复（Test-Driven Fix）

```
请按测试驱动修复流程处理 {Bug描述}：
1. 先编写一个能复现Bug的测试用例（使用真实数据和真实环境）
2. 运行测试确认Bug存在
3. 定位Bug根因（阅读相关代码和日志）
4. 修复Bug（最小化修改，不重构无关代码）
5. 运行测试确认Bug已修复
6. 运行全量回归测试确认无副作用
7. 检查是否有类似Bug存在于其他模块
```

### A3 渐进式重构（Incremental Refactoring）

```
请对 {项目名} 的 {模块名} 进行渐进式重构：
1. 先阅读现有代码，理解当前实现和依赖关系
2. 识别重构目标（性能/可维护性/可扩展性）
3. 制定重构计划：分步骤、每步可验证、每步可回滚
4. 每步重构后运行全量测试验证
5. 重构过程中保持接口不变（向后兼容）
6. 重构完成后更新设计文档
禁止一次性大重构，必须分步进行。
```

### A4 接口迁移（API Migration）

```
请对 {项目名} 的 {接口名} 进行接口迁移：
1. 新接口实现完成，与旧接口并行运行
2. 添加特性开关控制新旧接口切换
3. 逐步将调用方迁移到新接口
4. 所有调用方迁移完成后，移除旧接口
5. 验证迁移过程中无功能回归
6. 更新API文档和变更日志
```

### A5 安全审计（Security Audit）

```
请对 {项目名} 进行安全审计：
1. 依赖漏洞扫描（pip-audit / npm audit）
2. 敏感信息泄露检查（硬编码密钥/Token/密码）
3. 注入攻击检查（SQL注入/命令注入/XSS/SSRF）
4. 认证授权检查（API Key管理/权限控制/会话安全）
5. 数据安全检查（加密存储/传输安全/日志脱敏）
6. 爬虫合规检查（robots.txt/速率限制/User-Agent）
7. 输入验证检查（参数校验/类型检查/长度限制）
对每个发现的安全问题给出严重等级和修复方案。
```

### A6 依赖安全检查

```
请检查 {项目名} 的所有依赖安全性：
1. 列出所有直接和间接依赖及版本
2. 检查是否有已知CVE漏洞
3. 检查是否有废弃/不再维护的依赖
4. 检查依赖许可证兼容性
5. 给出依赖升级建议和风险评估
```

### A7 性能基线与优化

```
请对 {项目名} 的 {功能/模块} 进行性能优化：
1. 先建立性能基线：响应时间/吞吐量/内存占用/LLM调用次数
2. 识别性能瓶颈（Profiling/日志分析/链路追踪）
3. 制定优化方案（预期提升目标）
4. 实施优化（每次只改一个变量）
5. 验证优化效果（对比基线数据）
6. 确保优化不影响功能正确性（全量回归测试）
```

### A8 LLM调用优化

```
请优化 {项目名} 的LLM调用性能：
1. 统计当前LLM调用次数和Token消耗
2. 识别可合并的LLM调用（减少调用次数）
3. 识别可缩短的Prompt（减少Token消耗）
4. 检查是否有不必要的重试（优化重试策略）
5. 检查模型选择是否合理（简单任务用小模型）
6. 检查缓存利用率（语义缓存/结果缓存）
7. 实施优化后对比前后指标
```

### A9 可观测性建设

```
请为 {项目名} 建设可观测性：
1. 全链路追踪：trace_id自动注入，跨模块传递
2. Prometheus指标：核心业务指标 + 系统指标
3. 审计日志：所有Agent/Tool调用记录
4. 健康检查：/health端点 + 依赖服务探测
5. 告警规则：错误率/延迟/资源使用阈值
6. 仪表盘：Grafana Dashboard模板
确保所有I/O操作使用async/await，日志使用get_logger自动注入trace_id。
```

### A10 链路追踪验证

```
请验证 {项目名} 的全链路追踪：
1. 发起一个端到端请求
2. 检查trace_id是否从API层传递到Agent层再到Tool层
3. 检查每个环节的日志是否包含trace_id
4. 检查审计日志是否记录完整的调用链
5. 检查Prometheus指标是否正确采集
6. 检查WebSocket事件是否包含trace_id
```

### A11 文档与代码一致性验证

```
请验证 {项目名} 的文档与代码一致性：
1. 对照spec.md检查功能是否全部实现
2. 对照arch.md检查架构是否与代码一致
3. 对照design.md检查类签名和方法签名是否一致
4. 对照api.md检查API端点是否全部实现
5. 对照test.md检查测试用例是否全部覆盖
6. 对每个不一致项给出：文档描述 → 代码实际 → 修复建议
```

### A12 变更影响分析

```
请对 {项目名} 的 {变更描述} 进行变更影响分析：
1. 列出所有受影响的模块和文件
2. 分析对上层项目的影响（接口变化/配置变化/行为变化）
3. 分析对下游依赖的影响（数据库/外部服务/消息格式）
4. 评估变更风险等级（高/中/低）
5. 制定变更计划（前置条件/执行步骤/验证方法/回滚方案）
6. 更新相关设计文档
```

---

## 附录：项目速查表

| 项目 | 端口 | 定位 | 关键目录 |
|------|:----:|------|---------|
| FlowForge | 8000/5174 | 核心Harness平台 | flowforge/ |
| ContentForge | 8001/5175 | AI内容创作工厂 | contentforge/ |
| DevForge | 8002/5176 | AI开发工厂 | devforge/ |
| NovelForge | 8003/5177 | AI小说创作工厂 | novelforge/ |
| MallForge | 8004/5178 | AI电商运营工厂 | mallforge/ |
| OpenRoute | 13001 | 多模型API网关 | hiclaw/tool/openroute/ |
| OpenSieve | 8100 | 聚合检索增强中台 | opensieve/ |
| openclaw_pkg content | 800 | openclaw内容创作AI工具 | openclaw_pkg/worksapce/content hiclaw/tool/model_manager/ hiclaw/install/ hiclaw/test/|

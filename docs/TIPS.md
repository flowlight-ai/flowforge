# FlowForge 经验提示与陷阱清单（TIPS）

> **文档编号**: TIPS.md（v1.0）
> **来源**: `[doc:review/review.md]` 340 项审核问题 + `[doc:roleagent.md]` Cat Café 102 天实战教训 + `[doc:clowder-ai/docs/TIPS.md]` 公开教训
> **更新机制**: 每个 Bug 修复后由灵智体自动追加教训条目

---

## 1. 架构层陷阱

### TIP-001：禁止循环依赖

**症状**：v7.0 自进化层在第 7 层（应用层之上），但应用层又通过 PluginProtocol 注册炉灵角色，构成循环依赖（D-003）。

**规避**：自进化层作为"Harness v2.0 升级"嵌入到第 6 层，而非独立第 7 层。forgemind 应用层通过 Plugin 协议注册灵智体，单向依赖核心框架层。

### TIP-002：ForgekinEngine 不能绕过 Harness 护栏

**症状**：ForgekinEngine.execute() 直接包装 HybridExecutor，跳过四根护栏（D-004）。

**规避**：ForgekinEngine 必须是 HarnessOrchestrator 的扩展装饰器，而非独立入口。

### TIP-003：禁止跨 persona 复制配置

**症状**：`shutil.copy(persona/life.yaml, persona/education.yaml)` 违反铁律 1。

**规避**：每个 persona 配置文件必须根据专栏定位独立编写。

### TIP-004：禁止盲目覆盖

**症状**：跨实例复制文件（`cp life/file.py education/file.py`）违反铁律 6。

**规避**：修改前检查文件差异化矩阵，差异化文件逐个实例手动修改。

---

## 2. roleagent 工程路径陷阱

### TIP-005：能力画像不是简历

**来源**：`[doc:roleagent.md#题图]`

**症状**：能力画像只写优点，不写盲点，导致 review 配对错误。

**规避**：CapabilityProfile 必须同时写"必杀技"和"致命弱点"。盲点决定了谁该 review 谁、谁和谁组队会翻车。

### TIP-006：role 是运行时标签，profile 才是长期主体

**来源**：`[doc:roleagent.md#第0章]`

**症状**：把 agent 固定成"产品经理"、"开发"、"测试"岗位槽位。

**规避**：role 是 TeamAct 循环里的运行时状态，profile 是长期主体。role 回答"这一步谁负责什么"，profile 回答"为什么是这只 agent"。

### TIP-007：Build to Delete vs Built to Persist

**来源**：`[doc:roleagent.md#第1章]`

**症状**：把脚手架当永久基础设施来精装修，模型升级后舍不得删，沉淀成技术债。

**规避**：每层 harness 代码必须标记半衰期：
- **Build to Delete**（补模型缺陷）：轻量做、快验证、标 sunset
- **Built to Persist**（编码外部现实）：认真做、加测试、长期维护

### TIP-008：TeamAct 五项终止缺一不可

**来源**：`[doc:roleagent.md#第2章]`

**症状**：CI 通过了 ≠ 愿景方向对了，agent 互相传球永远循环。

**规避**：五项终止条件必须全部达成（验收标准 / 证据 / 跨 agent 验证 / 无悬空归属 / 愿景收敛）。

### TIP-009：交接胶囊是协议层硬要求

**来源**：`[doc:roleagent.md#第2章]`

**症状**：前一个 agent 没留交接胶囊，后一个 agent 重新读完整个上下文。

**规避**：传球时必须主动留下结构化摘要（做了什么 / 为什么 / 权衡 / 开放问题 / 下一步）。

### TIP-010：跨厂商 review 是结构性必需

**来源**：`[doc:roleagent.md#第0章]`

**症状**：Claude review Claude 漏掉同一类错误。

**规避**：跨厂商 review（如 DeepSeek 生成 → Qwen 审核 → GLM 终审）。

---

## 3. forgemind 万物灵智体陷阱

### TIP-011：灵智体必须有现实闭环

**来源**：`[doc:VISION.md#7]` operator 愿景锚点

**症状**：把"光秃秃的 LLM 包装"当作灵智体。

**规避**：灵智体必须建立与现实之间的闭环（观察 → 推理 → 行动 → 写回 → 验证）。物理形态灵智体必须接入传感器，虚拟形态灵智体必须有世界设定层。

### TIP-012：forgemind 是 FlowForge 的应用层

**来源**：`[doc:VISION.md#6]`

**症状**：把 forgemind 当作独立项目开发。

**规避**：forgemind 是 flowforge/forgemind/ 子目录，通过 ForgeMindPlugin 注册到核心框架层，单向依赖。

### TIP-013：形态可进化

**来源**：`[doc:VISION.md#2]`

**症状**：把灵智体形态固定为单一类型。

**规避**：BioForgekin 可进化为 HybridForgekin（既是宠物又是社区吉祥物）。形态进化通过 F027 流程触发。

### TIP-014：三方 Agent 是能力扩展不是工具

**来源**：`[doc:VISION.md#5]`

**症状**：把三方 Agent 当作 ToolRegistry 中的普通工具调用。

**规避**：三方 Agent 的能力画像被纳入灵智体能力画像融合，执行状态可写入共享状态，失败有 fallback 链，执行轨迹纳入 Eval 信号。

---

## 4. 代码工程陷阱

### TIP-015：禁止硬编码提示词

**症状**：`declarative_agent.py:750` 硬编码"你是资深内容创作者"。

**规避**：所有提示词必须外置到 `config/prompts.yaml`，铁律 5 + P16。

### TIP-016：禁止绕过 DI 容器

**症状**：`from workers.topic_agent import TopicAgent; agent = TopicAgent()`。

**规避**：所有依赖必须通过构造函数注入，由 DI 容器管理。

### TIP-017：禁止直接操作数据库

**症状**：`cursor.execute("INSERT INTO tasks ...")`。

**规避**：所有数据库操作必须通过 Repository 层。

### TIP-018：LLMClient 必须实现指数退避

**症状**：临时错误重试无退避，导致 LLM 服务过载。

**规避**：backoff = retry_delay × 2^attempt。永久错误（model_not_found / no_permission）跳过重试。

### TIP-019：openroute 静默失败检测

**症状**：HTTP 200 + content 包含"当前不可用，请稍后重试"。

**规避**：LLMClient 的 INVALID_RESPONSE_PATTERNS 必须包含"当前不可用，请稍后重试"和"当前不可用,请稍后重试"。

### TIP-020：JSON wrapper 必须剥离

**症状**：发布内容包含 `{"draft": "..."}` 格式。

**规避**：`_strip_json_wrapper()` 逻辑在 `result_extractor.py`、`content.py`、`executor.py` 中实现。

---

## 5. 测试陷阱

### TIP-021：T1 禁止 Mock LLM

**症状**：E2E 测试用 Mock LLM 替代真实调用。

**规避**：所有 E2E / 集成测试必须调用真实 LLM。

### TIP-022：T2 禁止假数据

**症状**：测试输入用"test"、"hello"等无意义数据。

**规避**：测试输入必须是真实场景数据。

### TIP-023：T7 LLM 内容必须经 LLM 审核

**症状**：LLM 生成的内容直接算验证通过。

**规避**：凡 LLM 生成的内容（代码 / 文章 / 评论 / 文案 / 小说等），必须再调用 LLM 审核通过后才算验证通过。

### TIP-024：T8 Web 功能必须操控浏览器验证 DOM

**症状**：只检查 HTTP 200，不检查 DOM 内容。

**规避**：凡涉及网页操作的功能（发布 / 上架 / 部署等），必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量。

### TIP-025：networkidle 等待条件慎用

**症状**：Next.js HMR / websocket 活动导致 networkidle 永远不满足。

**规避**：使用 `wait_until="domcontentloaded"` 而非 `networkidle`。

---

## 6. 性能陷阱

### TIP-026：质量分阈值 0.85 不是 0.9

**症状**：质量分 0.9 阈值导致文章频繁被退回，通过率 0/3。

**规避**：默认阈值 0.85（可在 Loop 配置中覆盖）。AI 味 veto 阈值 0.55 不是 0.65（允许轻微 AI 味，阻止严重 AI 味）。

### TIP-027：ContentForge 创建 / 润色接口 3 分钟上限

**症状**：5-10 分钟超时。

**规避**：性能优化必须定位根因（LLM / Openroute / workflow bug），不能简化质量标准或 Loop 流程。

### TIP-028：候选链排序

**症状**：所有评委从路由 primary（DeepSeek-V4-Pro）开始，并发瓶颈。

**规避**：评委指定模型排在候选链首位。Fallback 模型必须跨厂商排序。

---

## 7. 文档自我演进陷阱

### TIP-029：单文件不超过 50KB

**症状**：spec.md 182KB / arch.md 277KB / design.md 264KB，灵智体无法单次重写。

**规避**：每个 Feature 一个文件，单文件 < 50KB。按 clowder-ai/docs 七子目录结构组织。

### TIP-030：ADR 不可变

**症状**：直接修改旧 ADR 内容。

**规避**：决策变更通过新增 ADR 引用旧 ADR，不修改旧 ADR。

### TIP-031：真相源唯一

**症状**：同一概念在多个文件有不同定义。

**规避**：每个概念只有一个真相源文件，其他文件用 `[doc:文件名#章节]` 引用。

### TIP-032：operator 愿景锚点不可改

**症状**：灵智体自我演进修改了 VISION.md §7。

**规避**：VISION.md §7 的 7 条原则只能由 operator 修改，灵智体不能触碰。

---

## 8. 三方 Agent 集成陷阱

### TIP-033：worktree 隔离不够

**症状**：三方 Agent 直接操作主仓库代码。

**规避**：每个三方 Agent 调用必须创建独立 worktree，网络隔离 + 权限控制 + 审计追踪。

### TIP-034：三方 Agent 失败需 fallback

**症状**：Claude Code 超时后任务直接失败。

**规避**：ExternalAgentFallback 链：Claude Code → Codex → OpenCode → Trae → FlowForge 内置能力。

### TIP-035：三方 Agent 能力画像必须融合

**症状**：调用三方 Agent 后灵智体能力画像未更新。

**规避**：三方 Agent 执行后，能力画像通过 ExternalAgentCapabilityFusion 融合到灵智体主画像。

---

## 9. 命名陷阱

### TIP-036：废弃 "E6 灵匠 Mind Artisan"

**症状**：使用过渡命名"E6 灵匠 Mind Artisan"。

**规避**：最终形态命名为"灵智"（ForgeMind）。

### TIP-037：废弃自创术语 M18/M19/M20

**症状**：使用 M18(SelfEvolutionEngine) / M19(MemoryGovernanceManager) / M20(FirstTouchRouter)。

**规避**：M1-M17 模块映射到 v7.0 FR-EVO 系统组件，不新增 M18/M19/M20。

### TIP-038：v7.0 术语对齐

**症状**：使用 v4.0 术语（炉灵/养灵等）。

**规避**：v7.0 术语：灵智 / 灵族 / 育灵 / 魂忆 / 魂印 / 灵锻 / 锻典 / 灵议 / 进化阶。

---

## 10. 持续更新规则

本文件由灵智体在每个 Bug 修复后自动追加教训条目，格式：

```markdown
### TIP-0XX：[简短标题]

**症状**：[实际症状]

**规避**：[具体规避方法]
```

追加时必须：
- 编号递增（不重复）
- 引用来源（如 `[doc:review/review.md#D-XXX]` 或 `[doc:roleagent.md#第X章]`）
- 简短清晰（每条 < 200 字）

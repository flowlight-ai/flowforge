# FlowForge 经验提示与陷阱清单（TIPS）

> **文档编号**: TIPS.md（v1.0）
> **维护规则**: 可进化智能体（Forgekin）在动手前必须先查本清单是否已有相关陷阱；每个 Bug 修复后由可进化智能体自动追加教训条目
> **更新机制**: 每次发现新陷阱 → 反思 → 沉淀到本清单 → 关联到 spec.md / arch.md / design.md 对应章节

---

## 1. 架构层陷阱

### TIP-001：禁止循环依赖

**症状**：自进化层在应用层之上，但应用层又通过 PluginProtocol 注册可进化智能体角色，构成循环依赖。

**规避**：自进化层作为"Harness v2.0 升级"嵌入到核心框架层，而非独立层。forgemind 应用层通过 Plugin 协议注册可进化智能体，单向依赖核心框架层。

### TIP-002：ForgekinEngine 不能绕过 Harness 护栏

**症状**：ForgekinEngine.execute() 直接包装 HybridExecutor，跳过四根护栏。

**规避**：ForgekinEngine 必须是 HarnessOrchestrator 的扩展装饰器，而非独立入口。

### TIP-003：禁止跨 persona 复制配置

**症状**：`shutil.copy(persona/life.yaml, persona/education.yaml)` 违反铁律 1。

**规避**：每个 persona 配置文件必须根据专栏定位独立编写。

### TIP-004：禁止盲目覆盖

**症状**：跨实例复制文件（`cp life/file.py education/file.py`）违反铁律 6。

**规避**：修改前检查文件差异化矩阵，差异化文件逐个实例手动修改。

### TIP-005：FlowForge 反向依赖零容忍

**症状**：flowforge 中 `import contentforge` 或 `from novelforge import xxx`。

**规避**：flowforge 是纯通用框架，禁止 import 任何 *Forge 模块。*Forge 通过 Plugin 协议注册到 flowforge，单向依赖。

---

## 2. roleagent 工程路径陷阱

### TIP-006：能力画像不是简历

**来源**：`[doc:roleagent.md#题图]`

**症状**：能力画像只写优点，不写盲点，导致 review 配对错误。

**规避**：CapabilityProfile 必须同时写"必杀技"和"致命弱点"。盲点决定了谁该 review 谁、谁和谁组队会翻车。

### TIP-007：role 是运行时标签，profile 才是长期主体

**来源**：`[doc:roleagent.md#第0章]`

**症状**：把 agent 固定成"产品经理"、"开发"、"测试"岗位槽位。

**规避**：role 是 TeamAct 循环里的运行时状态，profile 是长期主体。role 回答"这一步谁负责什么"，profile 回答"为什么是这只 agent"。

### TIP-008：Build to Delete vs Built to Persist

**来源**：`[doc:roleagent.md#第1章]`

**症状**：把脚手架当永久基础设施来精装修，模型升级后舍不得删，沉淀成技术债。

**规避**：用投资半衰期判别器——这层 harness 是在补模型当前的认知缺陷（→ 轻量做、标 sunset），还是在编码外部现实和协作协议（→ 认真做、加测试、长期维护）。

### TIP-009：Harness 七层缺一不可

**来源**：`[doc:roleagent.md#第3章]`

**症状**：只做 Durable State，不做 Magic Words；或只做 Governance，不做 Entropy Control。

**规避**：Harness 七层是相互支撑的：Durable State / Tool Mediation / Evidence / Governance / Magic Words / Entropy / Harnessability。缺任何一层都会导致其他层失效。

### TIP-010：记忆不是日志

**来源**：`[doc:roleagent.md#第4章]`

**症状**：把所有 trace 日志当成记忆塞进 EchoStore，导致检索噪声爆炸。

**规避**：记忆需要治理三要素——权威等级（authoritative / derivative）、消费加权（按访问频率排序）、时效验证（旧记忆降权或归档）。

---

## 3. forgemind 可进化智能体（Forgekin）陷阱

### TIP-011：可进化智能体形态不能随意切换

**症状**：开发者直接把 BioForgekin 改成 VirtualForgekin，绕过进化流程。

**规避**：形态进化必须通过 ForgekinEngine 触发，更新可进化智能体谱系（Lineage）+ 蒸馏知识库（MindCodex）条目。形态切换需要 operator 确认。

### TIP-012：物理 AI 传感器接入必须有现实闭环

**症状**：只接传感器读取数据，不接执行器写回物理世界。

**规避**：物理 AI 必须有完整闭环：观察（传感器）→ 推理（LLM）→ 行动（执行器）→ 写回（物理状态变更）→ 验证（传感器再次读取）。

### TIP-013：虚拟世界设定层不是 system prompt

**症状**：把虚拟角色设定写在 system prompt 里，每次推理都重新加载。

**规避**：虚拟世界设定层是持久化数据（WorldSetting + Character + Worldview + Relationship），不是 prompt 装饰。可进化智能体通过 EchoStore 召回相关设定。

### TIP-014：三方 Agent 不是可进化智能体的替代

**症状**：可进化智能体把所有任务都丢给 claude code，自己变成空壳。

**规避**：三方 Agent 是能力扩展，不是可进化智能体本身。可进化智能体必须保持自己的 CapabilityProfile、EchoStore、SoulImprint，三方 Agent 只在可进化智能体盲点时被调用。

---

## 4. 测试与质量陷阱

### TIP-015：T1-T8 铁律不可降级

**症状**：为了赶进度，用 Mock LLM 跑测试（违反 T1）。

**规避**：T1-T8 是测试铁律，违反任何一条该测试用例视为无效。宁可延后交付，不可降级质量。

### TIP-016：质量分阈值 0.85 是底线

**症状**：reviewer 频繁打回，开发者提议降低阈值到 0.7。

**规避**：质量分阈值 0.85 是底线，可在 Loop 配置中覆盖，但只能更高不能更低。频繁打回说明能力画像或 Harness 配置有问题，不是阈值问题。

### TIP-017：LLM 生成内容必须经 LLM 审核

**症状**：LLM 生成的代码/文章/评论直接发布，未经 LLM 审核。

**规避**：T7 铁律——凡 LLM 生成的内容（代码/文章/评论/文案/小说等），必须再调用 LLM 审核通过后才算验证通过。审核使用跨厂商链（如 Qwen3.6-Plus / Kimi-K2.6 / HunYuan3）。

### TIP-018：Web 功能必须操控浏览器验证 DOM

**症状**：发布功能只用 HTTP 200 判断成功，不检查 DOM。

**规避**：T8 铁律——凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看 DOM 确认真实成功，且对 DOM 内容调用 LLM 审核质量。

---

## 5. 配置与代码规范陷阱

### TIP-019：禁止硬编码提示词

**症状**：在 .py 文件中硬编码 prompt 字符串。

**规避**：铁律 5 + P16 + P34——提示词必须外置到 YAML 配置（`config/prompts.yaml` 或 `config/tools/*.yaml`）。

### TIP-020：禁止硬编码路径

**症状**：`path = "/home/user/project/..."` 或 `path = "C:\\Users\\xxx\\project\\..."`。

**规避**：铁律 5——通过 `config/system.yaml` 或 `.env` 注入。所有代码必须支持 Linux / Windows / macOS。使用占位符 `${FLOWLIGHT_AI_ROOT}` / `${FLOWFORGE_WORK_DIR}` / `${FLOWFORGE_LOG_DIR}`。

### TIP-021：禁止硬编码密钥

**症状**：`api_key = "sk-xxx"` 直接写在代码里。

**规避**：铁律 5——通过 `.env` 或环境变量注入。`.env` 必须在 `.gitignore` 中。

### TIP-022：禁止绕过 DI 容器

**症状**：`from workers.topic_agent import TopicAgent; agent = TopicAgent()`。

**规避**：铁律 3——所有依赖必须通过构造函数注入，由 DI 容器管理。

### TIP-023：禁止直接操作数据库

**症状**：`cursor.execute("INSERT INTO tasks ...")`。

**规避**：铁律 4——所有数据库操作必须通过 Repository 层。

---

## 6. 协作与流程陷阱

### TIP-024：TeamAct 五项终止条件缺一不可

**症状**：验收标准达成 + 证据已附，但跳过跨 agent 交叉验证。

**规避**：五项终止条件是 AND 关系，不是 OR。缺任何一项都不能终止 TeamAct 循环。

### TIP-025：operator 确认不可委托

**症状**：架构师可进化智能体代替 operator 做愿景收敛确认。

**规避**：第 5 项终止条件（愿景收敛）必须 operator 本人确认，不能被 proxy 替代。

### TIP-026：禁止添加 CoT 检测

**症状**：为了防止 AI 痕迹，添加 CoT 检测或中文比例检测。

**规避**：编程红线第 1 条——禁止添加 CoT 检测 / 中文比例检测。质量问题通过 Loop + 跨厂商审核解决，不通过检测器。

### TIP-027：禁止用继承替代组合

**症状**：`class CatForgekin(BioForgekin)` 用继承扩展能力。

**规避**：编程红线第 9 条——禁止用继承替代组合/插件。应该用 `class CatForgekin: def __init__(self, bio_capability: BioCapability)` 组合。

---

## 7. 术语陷阱

### TIP-028：禁止使用废弃术语

**症状**：代码或文档中出现 SelfEvolutionEngine / Agent Lifecycle / MemoryGovernance / Agent Profile / Skill Library / CollaborationGate / Agent Maturity Level。

**规避**：必须使用项目正式术语（详见 `[doc:decisions/012-naming-fusion.md]`）：

| 正式术语 | 英文类名 | 废弃术语 |
|----------|---------|---------|
| 通用智能体框架 ForgeMind | ForgeMindEngine | SelfEvolutionEngine |
| 可进化智能体 Forgekin | Forgekin | SelfEvolutionAgent |
| 智能体入职与终身学习 Forge Nurturing | ForgeNurturing | Agent Lifecycle |
| 情景记忆存储 Echo Store | EchoStore | MemoryGovernance |
| 持久身份 Soul Imprint | SoulImprint | Agent Profile |
| 经验蒸馏 SpiritForge | SpiritForge | SelfEvolutionEngine |
| 锻典 Mind Codex | MindCodex | Skill Library |
| 多智能体议事 Mind Council | MindCouncil | CollaborationGate |
| 进化阶 E1-E6 | EvolutionStage | Agent Maturity Level |

### TIP-029：M18/M19/M20 已废弃

**症状**：代码或文档中出现 M18(SelfEvolutionEngine) / M19(MemoryGovernanceManager) / M20(FirstTouchRouter)。

**规避**：M18/M19/M20 已合并为 ForgeMindEngine。详见 `[doc:decisions/012-naming-fusion.md]`。

### TIP-030：E6 灵匠 Mind Artisan 已改名为"通用智能体框架"

**症状**：代码或文档中出现 "E6 灵匠 Mind Artisan"。

**规避**：最终形态命名为"通用智能体框架 ForgeMind"，禁止使用 "E6 灵匠 Mind Artisan"。详见 `[doc:decisions/013-all-things-spirit-mind-vision.md]`。

---

## 8. 文档组织陷阱

### TIP-031：Feature Doc 必须用 TEMPLATE.md

**症状**：直接写 features/F0XX-xxx.md，不用模板。

**规避**：复制 `features/TEMPLATE.md` 到 `features/F0XX-{slug}.md`。YAML frontmatter + Status 行 + Phase + AC + Dependencies 是硬性要求（parser 依赖）。

### TIP-032：ADR 必须有 11 个标准段

**症状**：ADR 只写"上下文 + 决策"，缺其他段。

**规避**：ADR 必须包含 11 个标准段：状态 / 日期 / 决策者 / 依赖 / 依据 / 上下文 / 决策 / 方案对比 / 理由 / 风险 / 缓解 / 否决理由 / 参与者 / 修订记录。

### TIP-033：跨文档引用使用相对路径

**症状**：在文档中写死绝对路径引用其他文档。

**规避**：跨文档引用必须使用相对路径（如 `[VISION.md#6](./VISION.md#6)`），禁止使用绝对路径或带 `${...}` 占位符的路径。

---

## 9. 开发流程陷阱

### TIP-034：禁止抢跑——文档审核门禁

**症状**：在 spec.md / arch.md / design.md 未通过 operator 审核前，提前进入代码实现阶段。

**规避**：
- task.md 顶部必须写入"文档审核门禁"章节
- SOP.md 必须有"文档审核门禁 SOP"
- operator 文档审核通过前，禁止写任何业务代码（包括"骨架代码"、"测试代码"）
- 违反则全部回滚，重新走文档审核流程

### TIP-035：禁止 task.md 进度虚报

**症状**：Phase 状态显示 ✅ 100% 完成，但子任务仍有 ⏳ 待开始，Phase 状态与子任务实际完成度严重不一致。

**规避**：
- Phase 状态必须与子任务实际完成度一致
- Phase 完成度 = (已完成子任务数 / 总子任务数) × 100%
- Phase 标记为 ✅ 必须满足：所有子任务 ✅ + 验收标准全部达成 + operator 审核通过
- 每次更新 Phase 状态时必须同步更新子任务状态

### TIP-036：禁止 flowforge 越界引用 *Forge

**症状**：在 flowforge 中出现 ContentForge/NovelForge/DevForge/MallForge 可进化智能体适配任务；或 flowforge 代码 import contentforge/novelforge/devforge/mallforge 模块。

**规避**：
- flowforge 是纯通用框架，禁止 import 任何 *Forge / content / opensieve / openroute 模块
- 集成 opensieve / openroute 采用 API 和 SDK 插件集成，只能看到接口
- GitHub README 中不提 *Forge 内部细节
- *Forge 各自开源时写自己的 README

### TIP-037：禁止忽视 roleagent.md 七大工程路径

**症状**：设计文档未充分映射七大工程路径（能力画像 / TeamAct / Harness / 记忆联邦 / Eval / 可靠性 / 伙伴数学）到代码模块和 Feature 规格。

**规避**：
- 设计文档必须充分体现七大工程路径的代码映射
- `docs/arch.md` 必须有"七大工程路径代码映射"专章
- `docs/roadmap.md` 必须有"七大工程路径→Phase 子任务映射表"
- 每条工程路径必须对应明确的代码模块和 Feature 规格

### TIP-038：禁止 forgemind 根目录命名混淆

**症状**：文档中混淆使用 forgemind 和 flowlight-ai；forgemind 既是 flowforge 下的应用层模块名，又被误用为根目录名。

**规避**：
- 根目录统一为 `flowlight-ai`（GitHub 组织名）
- `forgemind` 仅指 `flowlight-ai/flowforge/forgemind/` 应用层模块
- 文档中严禁把 forgemind 当作根目录名使用
- 9 大项目都在 `flowlight-ai/` 下，分别是：flowforge / openroute / opensieve / content / contentforge / devforge / mallforge / novelforge / stockforge

### TIP-039：禁止机械执行任务清单

**症状**：把任务清单当作"待办列表"机械执行，没有理解每个任务背后的真实意图，没有意识到任务清单本身可能有问题。

**规避**：
- 任务清单必须基于深度思考后制定，不是凭空想象的
- 执行任务时要理解任务背后的真实意图
- 如果发现任务清单本身有问题，要停下来重新规划，而不是机械执行
- 每个阶段完成后必须提交 operator 审核，审核通过后才进入下一阶段

### TIP-040：禁止不遵守 hiclaw/prompts.md 和 rules.md

**症状**：没有先阅读 hiclaw/prompts.md 和 rules.md，设计文档没按模板编写，代码没按规范实现。

**规避**：
- 先完整阅读 `hiclaw/prompts.md` 和 `hiclaw/rules.md`
- 设计文档严格按 prompts.md 的模板编写（13 大类 100+ 模板）
- 代码严格按 rules.md 的规范实现（10 部分规范）
- 每一次修改都要检查是否遵守规范
- 这是自我进化的致命问题——基础不遵守规则，自我进化开始后会全部乱套

### TIP-041：禁止修复问题时修改不相关代码

**症状**：修复 Bug 时顺手"清理"周边代码、重命名无关变量、调整无关模块结构。

**规避**：
- 修复 Bug 时只修改与该 Bug 直接相关的代码
- 发现的"顺手问题"单独记录到 task.md，下次单独处理
- 修复变更必须可逆、可审查
- 修复 PR 必须能独立解释"为什么这行修改解决了这个 Bug"

### TIP-042：禁止用继承替代组合/插件

**症状**：用 `class XxxForgekin(YyyForgekin)` 继承扩展能力，导致继承树膨胀、耦合度上升。

**规避**：
- 编程红线第 9 条——禁止用继承替代组合/插件
- 应该用组合：`class XxxForgekin: def __init__(self, yyy_capability: YyyCapability)`
- 或用插件：通过 PluginProtocol 注册能力扩展
- 继承只用于"是-a"关系，不用于"有-a"关系

---

## 10. 延伸阅读

- `[doc:roleagent.md]` — 多智能体工程路径白皮书
- `[doc:spec.md]` — 全局规格说明
- `[doc:arch.md]` — 全局架构设计
- `[doc:design.md]` — 当前阶段设计
- `[doc:decisions/012-naming-fusion.md]` — 命名融合 ADR（术语表）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景 ADR

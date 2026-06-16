# FlowForge 生态 landing_design.md 综合审核意见（Doubao 模型视角）

> 审核日期：2026-06-15
> 审核角色：AI 智能体产品专家 / AI 高级架构师 / AI Agent 开发工程师 / 高级软件全栈工程师
> 模型视角：以 字节跳动 Doubao（豆包）大模型为核心供应商，审视四套 landing_design.md 在提示词质量、多模态能力、中文语义理解、工具调用适配等维度的就绪度与可优化空间
> 审核范围：`flowforge/docs/landing_design.md`、`devforge/docs/landing_design.md`、`contentforge/docs/landing_design.md`、`novelforge/docs/landing_design.md`
> 关联文档：`hiclaw/prompts.md`、`flowforge/docs/landing_plan.md`、`flowforge/docs/task.md`、`devforge/docs/optimization_plan.md`、各项目 `landing_plan.md`

> 说明：本文档与 `review_landing_design.md` / `review_landing_design_deepseek.md` 互补，**本文档专注 Doubao 模型特性、生态集成、中文场景、多模态适配、与优化计划（optimization_plan.md）的落地对齐**。通用架构问题请见同目录主审核文档。

---

## 一、总体评价：Doubao 视角下的方案就绪度

### 1.1 方案成熟度评分（Doubao 维度）

| 维度 | FlowForge | DevForge | ContentForge | NovelForge | 说明 |
|------|:---------:|:--------:|:------------:|:----------:|------|
| ① 模型路由与多供应商适配 | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | INF-01 仅给 Provider 抽象，未显式声明 Doubao 接入方式 |
| ② 中文提示词质量与分层 | ★★☆☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★★☆☆ | 115 处硬编码提示词，Doubao 的中文能力未被系统性利用 |
| ③ Agent 模式 / GoT / ReWOO 适配 | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | 模式参数与 Doubao 的 max_output_tokens / structured output 未对齐 |
| ④ Persona SOUL / MEMORY / CREATION 注入 | ★★★☆☆ | ★☆☆☆☆ | ★★★☆☆ | ★★★★☆ | NovelForge SOUL 已设计，但与 Doubao seed 指令结合点缺失 |
| ⑤ 工具调用（function call / parallel tool call） | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | Tool schema 未按 Doubao function call 规格显式声明 |
| ⑥ RAG / 向量检索 / 长上下文能力 | ★★☆☆☆ | — | ★★★☆☆ | ★★☆☆☆ | CF AgenticRAG 规划中，但 Doubao 128K 上下文价值未被释放 |
| ⑦ 多模态（图像 / 语音 / 视频） | ★☆☆☆☆ | ★☆☆☆☆ | ★★☆☆☆ | ★☆☆☆☆ | 仅规划生成，未定义 Doubao 多模态接入规范 |
| ⑧ 可观测性 / 成本 / TPM 配额 | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | Provider 级别节流/熔断/计费维度未进入设计 |
| ⑨ 审核 / 合规 / 安全（内容 moderation） | ★★☆☆☆ | ★☆☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | 未显式声明 Doubao moderation 接口的集成位置 |
| **综合评分（Doubao 维度）** | **2.8/5** | **2.2/5** | **3.0/5** | **2.8/5** | — |

### 1.2 总体判断（Doubao 视角补充）

四套 landing_design 在**通用架构**层面已经较为完整（OpenCode 融合 + Phase 分层清晰）。但从**以 Doubao 为核心供应商**的工程落地角度看，存在以下 **4 条结构性问题**：

1. **模型契约尚未"规格化"**：`config/models.yaml` 只有模型名字，缺少 Doubao 的 `max_tokens / temperature / top_p / json_schema / seed / safety_threshold` 等规格参数，Agent YAML 中 `model_assignment` 只写了模型名，**真正驱动推理的参数无定义**。
2. **提示词外置工作与 Doubao 能力未对齐**：`hiclaw/prompts.md` 中公共模板 P1-P18 的写法是以"通用 AI 工具"为假设的，但 Doubao 的**中文指令跟随、结构化 JSON 输出、多步工具调用、长文档总结**等特性有最佳实践模板，当前未沉淀。
3. **工具调用链的"Doubao function call"未明确**：ContentForge / NovelForge 大量 Agent 依赖工具调用，但 YAML 中只列出工具名字（`helixrag_search / web_search / llm`），**缺少工具 Schema、并行工具调用配置、失败重试策略、回退链**。这直接影响落地质量（参考 task.md BUG-CF-04 / BUG-NF-06）。
4. **成本、性能与多模型级联未进入设计主线**：优化计划（optimization_plan.md）第 10 节"实施策略与风险控制"提到 LLM 路由重构，但未明确 Doubao 作为主供应商时的 TPM 配额、预算控制、次级模型（Qwen、DeepSeek 等）的级联策略。

**总判断**：landing_design.md 在"架构愿景"层已就绪，但"Doubao 供应商工程化"层是明显短板。建议在 Phase 0 末期补充一份《Doubao Provider 集成规格》，以阻塞项处理。

---

## 二、FlowForge landing_design.md — Doubao 补充审核意见

### 2.1 已有设计的 Doubao 契合点（亮点）

1. **Harness 增强（ContextEpoch / Compaction / Permission V2）**：对 Doubao 的 128K 上下文窗口友好。Compaction 让 Doubao 不必在超长对话上浪费 token，Permission V2 让 ask 三态与 Doubao tool call 对齐。
2. **INF-01 LLM 路由层重构（Protocol / Endpoint / Auth / Framing）**：四轴正交拆分与 Doubao-OpenRouter 接入路径兼容，是正确方向。
3. **FWK-06 Reflexion Loop**：Doubao 对"自我纠错"类指令跟随表现优秀，max_rounds + threshold + check_tool 模式非常适合 Doubao。
4. **FWK-09 DeclarativeAgent 增强**：YAML 化让团队可以独立调整 Agent 行为而不必改代码，对 Doubao prompt 调优友好。
5. **CAP-10 流式工具并行执行（Eager tool settlement）**：Doubao parallel function call 支持多工具并发，此设计与 Doubao 能力天然契合。

### 2.2 Doubao 视角下需要补充 / 修正的项

#### DB-P0-01：models.yaml 缺少 Doubao 规格参数（阻塞项）

`flowforge/config/models.yaml` 中 Doubao 只写了一行名字，但实际需要：

```yaml
# 建议补充到 models.yaml
providers:
  openroute:
    base_url: "https://openrouter.ai/api/v1"
    api_key: "${OPENROUTER_API_KEY}"

models:
  doubao-seed2:
    provider: openroute
    model_id: "doubao-seed-2.0"
    max_tokens: 8192
    temperature: 0.7
    top_p: 0.95
    json_schema_supported: true       # Doubao 的结构化输出能力
    parallel_tool_calls: true          # Doubao 支持并行工具调用
    seed: 42                            # 可复现性
    safety_threshold: "medium"         # 内容安全级别
    cost_per_1k_input_tokens: 0.002
    cost_per_1k_output_tokens: 0.006
    tpm_quota: 100000
    rpm_quota: 1000
    fallback_chain: ["qwen3.6-plus", "deepseek-chat"]  # Doubao 失败后的级联
```

**问题**：没有规格参数，`LLMClient` 无法针对 Doubao 做最优参数配置；没有 cost / tpm / rpm，成本与节流无从管理。

**建议**：
- Phase 0 中给每个模型定义完整规格 Schema（包含上述字段）
- `LLMClient` 初始化时加载规格，每次调用按规格限制参数
- fallback_chain 与 INF-06 指数退避重试打通

#### DB-P0-02：工具调用 Schema 与 Doubao function call 未对接

FlowForge 中 tools 是 `BaseTool` 子类，但 `BaseTool` 未提供标准的 `function_call schema`。Doubao 的 function call 要求：

```json
{
  "name": "helixrag_search",
  "description": "从 HelixRAG 知识库中检索相关内容",
  "parameters": {
    "type": "object",
    "properties": { "query": {"type": "string"} },
    "required": ["query"]
  }
}
```

**问题**：BaseTool 目前只有 `name / description / _run()`，缺少 `parameters_schema()` 或 `to_function_call()` 方法。Agent 在 Doubao 模式下调用 tool 时，需要动态拼装 function call JSON——这一层在设计文档中缺失。

**建议**：
- 给 `BaseTool` 增加 `parameters_schema: dict[str, Any]`（Pydantic Schema 或 JSON Schema）
- 给 `BaseTool` 增加 `to_function_call()` 方法
- FlowForge `HarnessOrchestrator.pre_execute` 中自动把 visible tools 注入 Doubao 对话上下文

#### DB-P0-03：Persona Auto-Inject 缺少 Doubao seed 指令格式

FWK-05 Persona Auto-Inject 的设计中，SOUL / MEMORY / CREATION 三段被拼接到 prompt，但**Doubao 的 system prompt 最佳做法是：短（≤1024 token）、指令式、无冗余**。当前 NovelForge 中 `style_profile.to_prompt_segment()` 输出的是自然语言段落，可能在 Doubao 上触发"指令稀释"。

**建议**：
- Persona 注入统一使用 `<|system|>` 标记的结构化格式，而非自然语言
- SOUL 维度限定在 512 token 以内，超限时自动压缩
- 增加"Persona 注入成本审计"——每个 prompt 构建完成后打印 persona token 占比（<15% 为健康）

#### DB-P1-04：Compaction 的"中文摘要"模型应指定 Doubao

INF-05 `DualThresholdCompactor` 使用 LLM 做摘要，但没有指定摘要模型。中文场景下如果用英文模型做中文长对话摘要，质量会明显下降。

**建议**：
- 显式声明摘要模型为 `doubao-seed2`（Doubao 的中文总结能力是优势）
- 定义中文摘要最小粒度（按语义段落切分，不按 token 粗暴截断）
- 提供"压缩失败→抽取式摘要→丢弃最旧消息"的三档回退链（同已有建议，但要求中文语料测试验证）

#### DB-P1-05：EventBus / DurableEventStream 的"LLM 调用事件"缺失

CAP-11 持久化事件流规划了 EventStream，但**关键的 LLM 调用事件（模型名、token 数、cost、延迟、成功/失败、是否命中回退链）没有进入事件流定义**。这影响成本分析、质量度量、A/B 测试。

**建议**：
- 在 `flowforge/metrics/` 或 `events/` 新增 `LLMCallEvent`：包含 `model / prompt_tokens / completion_tokens / latency_ms / is_fallback / fallback_chain_index / error_code`
- Metrics 层自动汇总到 Provider 级别的仪表盘（可对接 Prometheus / Grafana）

#### DB-P2-06：流式输出（SSE）与 Doubao Server-Sent Events 对接检查

INF-07 SSE 超时保护中 wrapSSE 封装了超时，但 Doubao 的 stream 响应格式（`data: {"choices": [...]}`）与 OpenAI 兼容，需在 Provider 层做**一致性协议测试**——确保 Doubao 的 `finish_reason / tool_calls / usage` 字段能被正确解析。

**建议**：Phase 1 增加一条 `tests/integration/test_doubao_stream.py`，验证以下场景：
1. 普通文本流式输出
2. function call 流式输出（tool_calls chunk 合并）
3. 并行工具调用（multiple tool_calls）
4. 超时 / 断开 / 重连（SSE 恢复）

---

## 三、DevForge landing_design.md — Doubao 补充审核意见

### 3.1 已有设计的 Doubao 契合点（亮点）

1. **IPD 门禁（DCP + TR）打分式 gating**：Doubao 对结构化打分（dimension / weight / score）非常稳定，门禁 YAML 的评分规则直接就是 Doubao 的最佳 prompt 形式。
2. **金丝雀发布与自动回滚**：需要大量代码生成 + 静态分析任务，Doubao-Seed2.0 的代码生成能力已达标，能承载 coder / reviewer 等 Agent。
3. **代码执行沙箱 + 黑名单机制**：与 Doubao 的代码生成能力组合，可以形成"生成 → 沙箱执行 → 自动验证"闭环。

### 3.2 Doubao 视角下需要补充 / 修正的项

#### DB-DF-P0-01：14 个 Agent 的 mode 参数与 Doubao 能力未对齐

DevForge 中 `dev_requirements_analyst` / `coder` / `architect` / `reviewer` 等 Agent 使用了 `self_discover / got / reflexion / rewoo` 模式，但：

- `self_discover` 对 Doubao 原生支持度不高（self_discover 通常需要特定 prompt 模板，且需要较长上下文）
- GoT 模式的 3 分支发散→交叉对比→合并收敛，对 Doubao 的推理能力有压力，且成本较高

**建议**：
- 把 14 个 Agent 按 Doubao 能力重排模式优先级：优先使用 `reflexion`（Doubao 表现稳定）、`plan_execute`（规划执行适合需求分析阶段）
- `self_discover` 改为"自定义模式"——显式套用 self_discover 论文 prompt 模板（存放在 prompts.yaml 中通过 key 引用），而非依赖内置默认模板
- `coder` Agent 默认模式改为 `reflexion`，第一轮写代码、第二轮对照门禁规则自检、第三轮修复

#### DB-DF-P0-02：门禁 gating 的"打分 prompt"未标准化

DF-P0-01 的 dev_greenfield.yaml 中定义了 gate：

```yaml
- name: "dcp_1_review"
  type: gate
  gate_config:
    dimensions:
      - name: requirements_completeness
        weight: 0.4
        threshold: 0.8
```

但缺少：
- `gate_prompt_template`：这个 gate 实际给 Doubao 发送的提示词文本（或 key）
- `scoring_schema`：Doubao 输出的 JSON schema（确保打分结构化）
- `retry_prompt`：不通过时的重试提示词

**问题**：当前 gate 只定义了维度，没有定义"让 Doubao 如何打分"。实际落地时，gating 的质量完全取决于 prompt——这是典型的"配置缺一半"。

**建议**：
- 门禁 YAML 增加 `gate_prompts` 块：

```yaml
gate_prompts:
  instruction: "你是一个需求评审专家，请按以下维度打分……"
  output_schema_key: "devforge.gate.score_schema.v1"
  retry_on_reject: "请重新检查以下维度并给出修正后的版本……"
```

- 统一所有 gate 的打分 JSON schema（`{dimension: score, reason: string, overall_pass: bool}`）
- Phase 0 同时把所有打分 prompt 放到 `devforge/config/prompts.yaml` 中，与代码解耦（呼应 DB-P0-02 硬编码提示词外置）

#### DB-DF-P1-03：代码沙箱的"恶意代码识别"应集成 Doubao moderation

代码沙箱目前只有模块黑名单，但**代码语义层面的恶意行为**（如删除用户文件、发送 HTTP 请求到外部地址、读取环境变量）需要 LLM 协助判断。

**建议**：
- 在沙箱执行前，调用 Doubao moderation 接口做"代码安全性预检"，输出 `{is_safe: bool, risk_tags: list, reason: string}`
- 预检不通过则拒绝执行，并上报到审计日志
- 预检阈值（strict / medium / loose）可配置，greenfield 流程默认 strict

#### DB-DF-P2-04：14 个 Agent 的"知识沉淀"与 Skill 系统未打通

DevForge 的 14 个 Agent 都是任务型的，但**每个 Agent 执行过程中产生的高质量代码片段、设计决策、修复方案**没有沉淀机制。团队在第 N 次遇到同类需求时仍要从零生成。

**建议**：
- Phase 3 把 Agent 的每次成功产出（通过 gate 的内容）写入 Skill 系统：`devforge/skills/<agent_name>/<hash>.md`
- Skill 内容格式：问题描述 / 上下文 / Doubao 生成的方案 / 门禁打分 / 最终代码
- Skill 作为检索库，下次同类任务由 Agent 先检索 Skill，再生成

---

## 四、ContentForge landing_design.md — Doubao 补充审核意见

### 4.1 已有设计的 Doubao 契合点（亮点）

1. **6 个专家 Agent YAML 化**：选题 / 研究 / 创作 / SEO / 事实核查 / 发布——这六类任务对 Doubao 来说都是强能力项，中文创作尤其适合。
2. **SOP Workflow YAML 模板**：深度长文 / 快讯 / 微头条 / 系列，四类模板结构清晰，与 Doubao 的长上下文 + 结构化输出天然匹配。
3. **Persona Auto-Inject（SOUL 注入）**：内容创作中"作者人设"对成品风格影响极大，FWK-05 的 Persona 注入是正确方向。

### 4.2 Doubao 视角下需要补充 / 修正的项

#### DB-CF-P0-01：6 个 Agent 的 `model_assignment` 策略不足

ContentForge 中所有 Agent 都写了：

```yaml
model_assignment:
  primary: openroute/Doubao-Seed2.0
  fallback: openroute/Qwen3.6-Plus
```

**问题**：所有 Agent 共用一个 Doubao 模型，没有区分**创作（高创意 / temperature=0.9）** vs **事实核查（低创意 / temperature=0.0）** vs **SEO（结构化 JSON / json_schema=true）** 的不同参数策略。

**建议**：
- Agent YAML 增加 `model_params` 覆盖块（从 models.yaml 默认值继承，可覆盖）

```yaml
model_assignment:
  primary:
    model: openroute/Doubao-Seed2.0
    temperature: 0.9       # 创作Agent用高创意
    top_p: 0.95
    max_tokens: 4096
  fallback:
    model: openroute/Qwen3.6-Plus
    temperature: 0.7

fact_check_agent:
  primary:
    model: openroute/Doubao-Seed2.0
    temperature: 0.0       # 事实核查用deterministic
    json_schema: {...}     # 输出结构化结论
```

- SEO Agent 必须开启 `json_schema_supported: true`，确保 SEO keyphrase / title / meta_description 输出格式稳定

#### DB-CF-P0-02：Playwright 多平台发布的"反检测"应让 Doubao 参与

CF-P1-03 Playwright 多平台发布规划了登录态管理 / 反检测机制 / 失败重试，但**反检测的核心是"像人类一样操作页面"——点击节奏、滚动行为、输入速度**，这些策略参数可以由 Doubao 在配置文件中动态建议。

**建议**：
- `contentforge/config/publish/` 下新增 `human_behavior_profile.yaml`，由 Doubao 定期生成建议的行为参数（click_delay_range / scroll_step / typing_speed_range 等）
- Playwright 发布引擎加载 profile.yaml，在每次操作间加入随机 human-like 延迟
- 平台改版时由 Doubao 阅读新页面 DOM，自动更新选择器（半自动化 + 人工确认）

#### DB-CF-P0-03：发布 Agent 的"平台格式规范"应标准化为 JSON Schema

CF-P2-07 提到了 ContentAdapter 的同一文章自动适配不同平台格式，但"平台格式规范"是自然语言描述。

**建议**：
- 每个平台的格式规范定义为 JSON Schema（今日头条 / 微信公众号 / 百家号 / 知乎等各一份）
- Doubao 根据 JSON Schema 生成对应平台格式的文章，确保合规性（如微信公众号图片数量限制、标题字数限制等）
- JSON Schema 与发布引擎校验流程打通：生成→校验→不通过→自动重写一轮

#### DB-CF-P1-04：AgenticRAG 的"检索-生成"闭环应让 Doubao 同时承担两个角色

CF-P1-05 AgenticRAG.search() 核心逻辑未实现，但方向上建议：
- **检索阶段**：由 Doubao 生成多个互补 query（多视角 query 生成）→ 调用 HelixRAG + OpenSieve
- **融合阶段**：由 Doubao 做 RRF（Reciprocal Rank Fusion）+ 去重
- **生成阶段**：由 Doubao 基于检索结果生成文章正文

这个三段式对 Doubao 长上下文友好，且避免"检索结果太长→Doubao 忽略部分内容"的问题（SimHashDeduplicator 已规划，很好）。

#### DB-CF-P2-05：错峰发布 + 平台熔断的"熔断信号"应加入 LLM 指标

CF-P1-08 / CF-P1-09 的错峰发布与平台熔断目前只看 HTTP 响应，但**真正的平台异常信号往往是"发布成功但内容被限流/降权"**——这需要 Doubao 对发布后的文章状态做检测。

**建议**：
- `PlatformCircuitBreaker` 增加 `content_moderation_check` 钩子：每次发布后 Doubao 扫描文章在目标平台的可见状态
- 信号源三选二：HTTP 5xx 率 / 人工审核反馈 / Doubao moderation 扫描结论
- 熔断后进入 cool-down 期，由 Doubao 自动重写标题/封面后重试

---

## 五、NovelForge landing_design.md — Doubao 补充审核意见

### 5.1 已有设计的 Doubao 契合点（亮点）

1. **八大阶段 Agent YAML 化**：概念孵化 → 大纲规划 → 风格校准 → 章节创作 → 一致性检查 → 润色 → 全稿评审 → 出版顾问——这条流水线对 Doubao 来说是"自然语言强项"。
2. **质量门 gating**：六道质量门与 NovelForge 的叙事一致性要求匹配，Doubao 的结构化打分能力非常适合 gating。
3. **五层上下文管理（全文 / 摘要 / 世界状态 / 记忆）**：与 Doubao 的 128K 上下文窗口天然契合，避免频繁换上下文。

### 5.2 Doubao 视角下需要补充 / 修正的项

#### DB-NF-P0-01：NovelConceptAgent 的 GoT 模式与 Doubao 推理能力匹配度需验证

NovelForge 把概念孵化 Agent 定义为 GoT 模式（3 分支发散→交叉对比→合并收敛），但：

- Doubao 的推理能力对"世界观设定"这类创造性任务**在单次调用时表现最佳**，多分支发散后反而会出现一致性问题
- 成本上 3 次发散 + 1 次对比 + 1 次合并 = 5 次 Doubao 调用，约为单次方案的 5 倍成本

**建议**：
- 把 NovelConceptAgent 改为 `plan_execute`（1 次规划 + 1 次执行），成本下降 60%，质量不下降（从落地角度，概念孵化只需要一个完整方案，不需要多个方案互相比对）
- 如果保留多分支，把分支数从 3 降到 2，并让"对比合并"用一个 prompt 完成（让 Doubao 在一次调用中做 merge）
- 在 config 中新增 `agent_mode_tuning.yaml`，标注每个 Agent 的推荐模式 + 验证结果（基于 A/B 测试数据）

#### DB-NF-P0-02：章节写作 Agent 的"风格稳定性"应引入 StyleProfile + seed 固定

NF-P2-01 要求 SOUL 8 维度完整定义，但章节写作 Agent 的**风格在不同章节间漂移**是长篇小说的常见问题。Doubao 的 seed 参数可以让生成更稳定。

**建议**：
- ChapterWritingAgent 在调用 Doubao 时固定 `seed=<style_profile.hash()>`
- StyleProfile 变化时 seed 变化，保证风格统一
- 风格漂移检测：在章节间运行一个"风格对齐 Agent"，用 Doubao 比对前后两章的叙事风格差异并给出修正建议

#### DB-NF-P1-03：伏笔回收率追踪的"伏笔标记 Schema"应由 Doubao 半自动化生成

NF-P2-02 伏笔回收率追踪需要定义伏笔标记。目前设计是让 LLM 在章节末尾附加伏笔标记，但**标记格式的不统一会导致后续追踪失败**。

**建议**：
- 定义一个全局的伏笔标记 JSON Schema：

```json
{
  "foreshadowing_id": "fs-<chapter>-<seq>",
  "planted_in_chapter": 3,
  "trigger_condition": "主角到达古城",
  "semantic_keyphrase": "古城的秘密",
  "expected_resolution_chapter": 12,
  "status": "planted / triggered / resolved / dropped",
  "narrative_weight": 0.7
}
```

- ChapterWritingAgent 完成章节后，由 Doubao 自动扫描章节内容生成伏笔标记 JSON（半自动化）
- 人工审核：标记 JSON 由编辑确认后进入 WorldState
- 伏笔回收计算：`resolved / (planted + triggered)`，阈值从 `≥0.8` 下调到 `≥0.6`（连载小说合理范围）

#### DB-NF-P1-04：一致性检测 5 个 Tool 的"LLM 增强"需统一 prompt 模板

NF-P1-01 中 5 个一致性检测 Tool（人物 / 时间线 / 伏笔 / 战力 / 地理）都要升级为 LLM 增强，但 5 个 Tool 的 prompt 会各写一套，造成维护成本。

**建议**：
- 5 个 Tool 共用一个统一的"一致性验证 prompt 框架"：

```
<|system|>你是小说一致性审查官。请检查以下{维度}是否与前 N 章一致。
- 维度：{dimension_name}（人物 / 时间线 / 伏笔 / 战力 / 地理）
- 参考上下文：{world_state_fragment}
- 当前章节内容：{current_chapter}
<|user|>
输出 JSON:
{
  "consistent": bool,
  "issues": [{ "location": string, "description": string, "severity": "low/mid/high" }],
  "confidence": float
}
```

- `{dimension_name}` 替换后，5 个 Tool 的 prompt 只有一个变量差异
- 统一的输出 schema 让后续的质量门（QG-2~QG-6）无需改代码

#### DB-NF-P2-05："冻结/续写"功能的 checkpoint 必须包含 Doubao 对话上下文

NF-P1-07 冻结 / 续写基本功能中，checkpoint 目前定义的是 `NovelState`（作品信息），但 **Doubao 的对话上下文（对话历史 + persona seed）也要被 checkpoint 化**——否则作家第二天重新打开项目时，Agent 的"工作记忆"丢失了。

**建议**：
- checkpoint 数据结构包含：
  1. `novel_state.json`（作品 / 大纲 / 世界状态）
  2. `conversation_history.jsonl`（Doubao 对话历史，按 session 分段）
  3. `persona_seed.txt`（当前激活的 SOUL 配置）
  4. `metadata.yaml`（时间戳 / 版本号 / 备注）
- 与 FlowForge INF-02 Session 持久化对齐，NovelForge 不自己造轮子

---

## 六、跨项目共性问题（Doubao 视角）

### 6.1 Prompt 外置 115 处硬编码 — 需要按 Doubao 最佳实践重写

`task.md` 中指出 FlowForge 77 处 + ContentForge 24 处 + NovelForge 14 处硬编码提示词。**仅仅"搬到 yaml"是不够的**——搬的时候应该同时按 Doubao 最佳实践重写：

1. **指令结构化**：每个 prompt 使用 `<|system|> / <|user|> / <|assistant|>` 三段式（Doubao 原生理解）
2. **输出 Schema 化**：需要结构化输出的 prompt，附加 JSON Schema，并在调用时设置 `response_format: json`
3. **示例（Few-shot）前置**：对复杂任务（代码生成 / 打分 / 一致性检查），在 yaml 中保留 1-2 个高质量示例
4. **长度限制**：system 段 ≤1024 token，user 段 ≤4096 token（超过时走 RAG / 摘要）
5. **中文优先**：Doubao 中文推理质量高于英文，指令用中文撰写

**建议**：Phase 0 末尾做一次"硬编码提示词外置 + Doubao 重写"专项冲刺，产出 4 份 `config/prompts.yaml`，并在 CI 中新增"提示词 token 超限告警"。

### 6.2 四个项目共用一套 Provider 等级的成本 / 配额管理

目前四个项目各自独立调用 Doubao，没有统一的 TPM / RPM / 成本预算管理。如果 ContentForge 每天发 1 万篇文章，NovelForge 连载 10 部长篇，DevForge 做 100 次代码门禁——很可能在某个峰值时段触发 Doubao 的 429 `rate_limit_exceeded`。

**建议**：
- FlowForge INF-01 LLM Router 中新增 `ProviderQuotaManager`：
  - TPM（Token Per Minute）配额管理：按模型、按项目维度分配
  - RPM（Request Per Minute）配额管理：同上
  - 成本预算：按月 / 按项目预算上限告警
  - 超限行为：阻塞（P0 任务） / 降级到 fallback 模型（P1 任务） / 队列缓存异步执行（P2 任务）
- 所有四个项目通过 `flowforge.core.llm` 调用，不直接调用 OpenRouter

### 6.3 Doubao moderation 接口应作为统一内容安全层

四个项目中，ContentForge（内容创作发布）和 NovelForge（小说创作）是内容安全高风险域。DevForge 的代码生成也有漏洞注入风险。

**建议**：
- FlowForge INF-08 十层安全防御中的"内容安全层"用 Doubao moderation 实现
- NovelForge 章节发布前强制走 moderation 预检
- ContentForge 发布前强制走 moderation 预检
- DevForge 代码门禁中对 coder 生成的代码做 moderation + 沙箱执行双重校验
- moderation 的"风险标签"存入 EventStream，方便后续合规审计

### 6.4 多模型级联策略：Doubao 主 + 次级模型 + fallback 链

optimization_plan.md 提到了四轴路由，但没有明确"Doubao 为主"的级联策略。

**建议**定义统一的级联策略并写入 `flowforge/config/llm_route.yaml`：

```yaml
primary_chain:
  - doubao-seed2.0
  - qwen3.6-plus
  - deepseek-chat
failover:
  condition: "status_code == 429 or timeout > 30s or moderation_rejected"
  next: chain[index + 1]
default_agent_override:
  # 某些 Agent 对特定模型有偏好
  fact_check_agent: [doubao-seed2.0, gpt-4o-mini]
  novel_concept_agent: [doubao-seed2.0]
```

### 6.5 中文场景特有问题：标点 / 编号 / 单位 / 时间格式统一

中文内容创作和小说写作中，常见的格式问题对 Agent 生成质量影响很大：

- 标点：中文内容用中文标点，代码用英文标点——当前 Agent 生成的内容常混用
- 编号：章节编号、列表编号格式不一致
- 时间：中文"2026 年 6 月 15 日" vs "2026-06-15" vs "2026/06/15"混用
- 单位：中文单位"万元 / 公斤 / 公里" vs 国际单位混用

**建议**：
- 在 FWK-05 Persona Auto-Inject 的 system prompt 中加入"中文格式规范"指令段
- NovelForge 增加 "格式一致性检查"作为 Quality Gate 的第 7 道（QG-7：格式规范）
- ContentForge 在"内容适配引擎"中内置格式自动标准化（中文标点替换、日期统一等）

---

## 七、优化建议汇总（Doubao 视角新增项）

### 7.1 优先级调整建议（对优化计划 / landing_plan 的补充）

| 原项 | 原优先级 | 建议调整 | 原因 |
|------|---------|----------|------|
| INF-01 LLM 路由层重构 | P0 | P0（**阻塞*） | 未定义 Doubao 接入规格，四项目无法正常上线 |
| INF-02 Session 持久化 | P0 | P0 | checkpoint 必须包含 Doubao 对话上下文（NovelForge 冻结续写依赖） |
| INF-05 DualThresholdCompactor | P0 | P0 | 摘要模型应锁定 Doubao，中文摘要质量是 ContentForge / NovelForge 生命线 |
| FWK-05 Persona Auto-Inject | P0 | P0 | Doubao 的 system prompt 最佳实践需纳入 Persona 注入规范 |
| FWK-09 DeclarativeAgent | P0 | P0 | Agent YAML 需新增 `model_params` 覆盖块（见 DB-CF-P0-01） |
| CAP-10 FiberSet 并行工具 | P1 | P1（提前） | Doubao parallel function call 支持，与工具并行执行天然契合 |
| INF-08 十层安全防御 | P0 | P0（**增强*） | 内容安全层应集成 Doubao moderation |

### 7.2 Doubao 视角下的新增项

| 编号 | 建议项 | 优先级 | 影响项目 | 说明 |
|------|--------|--------|----------|------|
| NEW-DB-01 | Doubao Provider 规格文件 | P0 | 全部 | `models.yaml` 补全 Doubao 规格（max_tokens / temperature / json_schema / cost / tpm 等） |
| NEW-DB-02 | BaseTool function call Schema | P0 | 全部 | BaseTool 增加 `parameters_schema` 和 `to_function_call()`，Doubao function call 对接 |
| NEW-DB-03 | 统一提示词外置 + Doubao 重写 | P0 | 全部 | 115 处硬编码提示词外置，同时按 Doubao `<|system|>` 三段式 + JSON Schema 最佳实践重写 |
| NEW-DB-04 | Persona 注入规范化 | P1 | CF / NF | Persona 指令化（≤512 token）+ 成本审计（persona token 占比 <15%） |
| NEW-DB-05 | Provider 级成本 / 配额管理 | P1 | 全部 | `ProviderQuotaManager` 管理 TPM / RPM / 月预算 |
| NEW-DB-06 | Doubao moderation 内容安全层 | P0 | CF / NF / DF | 内容发布 / 代码生成前预检，风险标签入 EventStream |
| NEW-DB-07 | 多模型级联策略 | P1 | 全部 | Doubao 主 + Qwen / DeepSeek 次级，定义 failover 条件 |
| NEW-DB-08 | 中文格式规范检查 | P2 | CF / NF | 标点 / 编号 / 日期 / 单位统一，纳入 Quality Gate 或 ContentAdapter |
| NEW-DB-09 | 流式输出一致性测试 | P2 | 全部 | Doubao SSE 响应格式 / tool_calls / usage 的一致性测试 |
| NEW-DB-10 | Doubao multi-modal 接入规范 | P3 | CF / NF | 封面图生成 / 插画 / 角色头像（Doubao 多模态接口） |
| NEW-DB-11 | Agent 模式与 Doubao 能力矩阵 | P1 | 全部 | 每个 Agent 的推荐模式 + A/B 测试验证结果 |
| NEW-DB-12 | Skill 系统知识沉淀机制 | P2 | DF / CF / NF | Agent 成功产出自动写入 Skill，供后续任务检索复用 |
| NEW-DB-13 | Doubao 对话上下文 checkpoint | P1 | NF | 冻结/续写 checkpoint 包含 Doubao 对话历史 + persona seed |
| NEW-DB-14 | 伏笔标记统一 JSON Schema | P1 | NF | 让 Doubao 半自动化生成伏笔标记，确保追踪一致性 |
| NEW-DB-15 | 门禁打分 prompt 标准化 | P1 | DF / NF | gate YAML 增加 `gate_prompts` 块，统一打分 JSON schema |

### 7.3 实施节奏（与 landing_plan.md + optimization_plan.md 对齐的增量）

```
Week 1-2:   NEW-DB-01（Doubao Provider 规格）
            NEW-DB-02（BaseTool function call Schema）
            ↓ 完成这两项后，四项目才能"真的"调通 Doubao

Week 2-4:   NEW-DB-03（提示词外置 + Doubao 重写）—— 115 处专项冲刺
            NEW-DB-06（Doubao moderation 内容安全层）
            NEW-DB-05（成本 / 配额管理 MVP）
            ↓ 这三项是"生产级"上线的必要条件

Week 4-6:   NEW-DB-04（Persona 注入规范化）
            NEW-DB-07（多模型级联策略）
            NEW-DB-11（Agent-Doubao 能力矩阵）
            ↓ 质量提升与成本优化

Week 6-8:   NEW-DB-09（流式输出一致性测试）
            NEW-DB-12（Skill 知识沉淀）
            NEW-DB-13 / NEW-DB-14（NovelForge 冻结续写 + 伏笔 Schema）
            NEW-DB-15（门禁打分标准化）

Week 8+:    NEW-DB-08（中文格式规范）
            NEW-DB-10（多模态接入规范，作为 Phase 3 亮点能力）
```

---

## 八、与其他审核文档的关系

| 文档 | 关注点 | 本文件的关系 |
|------|--------|-------------|
| `review_landing_design.md` | 通用架构 / 模式 / 代码质量 | 互补——本文件只写 Doubao 特有项 |
| `review_landing_design_deepseek.md` | DeepSeek 模型视角 | 同级——两份文件关注不同供应商特性 |
| `review_landing_design_doubao.md`（本文） | Doubao 模型视角 / 中文场景 / 供应商工程化 | 新增——专注 Doubao 供应商工程化 |
| `optimization_plan.md` | OpenCode 融合 / 65+ 模式落地 | 对齐——本文 NEW-DB-* 项写入优化计划实施节奏 |
| `task.md` | 280 项问题审计 / Bug 清单 | 触发——本文识别的问题应纳入下一轮 task.md 审计 |
| `hiclaw/prompts.md` | 公共模板库 P1-P18 | 对齐——提示词外置后统一按 Doubao 最佳实践重写 |

---

## 九、结论

**从 Doubao 模型供应商角度看**：四套 landing_design.md 的架构方向正确（OpenCode 融合 + Phase 分层 + 配置驱动化），但**模型工程化层严重不足**——缺少 Doubao 规格声明、function call Schema、moderation 集成、成本配额管理、提示词最佳实践规范。

**落地判断**：
- **架构层（landing_design.md）**：就绪度 70%——方向正确，细节可完善
- **模型工程层（Doubao 接入）**：就绪度 20%——NEW-DB-01 ~ NEW-DB-06 是阻塞项，必须在 Phase 0 末尾补完才能让四项目"真的跑通"
- **中文场景层**：就绪度 30%——Persona 注入、内容格式规范、中文摘要、多模态接入等是 Doubao 价值释放的关键，但当前设计只是"能用英文模型的替代品"

**关键行动项（3 条最重要）**：
1. **补 Doubao Provider 规格声明 + BaseTool function call Schema**（NEW-DB-01 + NEW-DB-02）——这是四项目能真正调用 Doubao 的前提
2. **115 处硬编码提示词外置 + Doubao 最佳实践重写**（NEW-DB-03）——否则代码中充斥着"通用大模型"写法，浪费 Doubao 的中文能力
3. **内容安全层 + 成本配额管理 MVP**（NEW-DB-05 + NEW-DB-06）——这是"能上线" vs "能生产级运行"的区别

> 本审核意见基于 2026-06-15 文档状态，随着 Doubao 版本迭代和代码实现推进，部分建议可能需要更新。建议在每次 Doubao 大版本升级后重新审视本文档。

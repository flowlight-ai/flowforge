# governance/skills — 技能内容源（SkillsSource）

B19 技能内容迁入目录。每包一个 `<kebab-case-id>/SKILL.md`，路由元数据集中在 `manifest.yaml`。
框架消费面零改动：`readSkillMeta(<skills>/<name>)` 读 SKILL.md frontmatter；`parseManifestSkillMeta(<skills>)` 读 manifest.yaml `skills:` map。

## 目录约定

- 一包一目录：`<id>/SKILL.md`（正文原样迁入，不做改写——保 frontmatter 与 `readSkillMeta` 解析兼容）。
- 路由单一真源：`manifest.yaml` 的 `skills:` map（category / description / triggers），对齐 `parseManifestSkillMeta` 消费面。
- 分波登记：每波在「批次登记」追加；本目录为 wave 1 起点。

## 命名映射（P0 官方名锚定，对照 naming-contract.md）

| 目录 id | 官方能力概念名 | 中文对照 |
|---|---|---|
| deep-research | Deep Research | 深度调研 |
| expert-panel | Expert Panel | 专家评审团 |
| cross-cat-handoff | Cross-cat Handoff | 跨智能体交接 |
| debugging | Systematic Debugging | 系统化调试 |
| tdd | Test-First Development | 测试驱动开发 |
| writing-plans | Implementation Planning | 实施计划编写 |
| quality-gate | Pre-Delivery Self-Gate | 交付前自检门禁 |
| merge-gate | Merge Governance Gate | 合入治理门禁 |
| fresh-context-review | Fresh-Context Pre-Review | 新语境评审前置扫描 |
| request-review | Review Request Routing | 评审请求路由 |
| receive-review | Review Feedback Processing | 评审反馈处理 |
| receive-handoff-grounding | Handoff Claim Grounding | 交接声明核验 |
| thread-orchestration | Multi-Thread Orchestration | 多线程编排 |
| cross-thread-sync | Cross-Thread Coordination | 跨线程协同 |
| collaborative-thinking | Collaborative Deliberation | 协作思辨收敛 |
| custody-recognition | Custody Acceptance | 接球权识别 |
| feat-lifecycle | Feature Lifecycle Management | 功能生命周期管理 |
| worktree | Isolated Workspace Setup | 隔离工作区搭建 |
| co-creation-docs | Co-Creation Docs Delivery | 共创文档交付 |
| owner-friendly-plugin-development | Hosted Plugin Product Boundary | 宿主插件产品边界 |
| code-as-harness | Harness Self-Repair | 代码即工作台修复 |
| writing-skills | Skill Authoring Meta-Skill | 技能编写元技能 |
| self-evolution | Self-Evolution (Scope Guard + Process/Knowledge Evolution) | 自我进化（范围护栏+流程/知识进化） |
| context-self-management | Context Self-Management | 上下文自管理 |
| knowledge-engineering | AI FDE Knowledge Engineering | 知识工程方法论 |
| anime-forge | Anime Short Production Line | 动画短片生产线 |
| video-forge | Video Production Pipeline | 视频制作全链路 |
| sprite-forge | Character Sprite Production Line | 角色动态素材生产线 |
| ppt-forge | Low-Fidelity MD → AI Image Deck | 演示文稿图像管线 |
| image-generation | AI Image Generation | AI 图片生成 |
| pencil-design | Pencil Design & Code Export | 设计文件与代码导出 |
| ttfund-skills | TTFund Skills Gateway | 天天基金网关数据 |

> 本目录正式内容仅使用官方概念名与中文对照；社交/别名语（如灵智系列别称）不进入本目录正文。

## 批次登记

- **wave 1**（2026-09-11）：`deep-research` / `expert-panel` / `cross-cat-handoff` / `debugging` 四核心包内容迁入（B19 首波）。
- **wave 2**（2026-09-11）：`tdd` / `writing-plans` / `quality-gate` / `merge-gate` 工程流程域四核心包内容迁入（B19 二波）。
- **wave 3**（2026-09-11）：`fresh-context-review` / `request-review` / `receive-review` / `receive-handoff-grounding` 评审与协作域四核心包内容迁入（B19 三波）。
- **wave 4**（2026-09-11）：`thread-orchestration` / `cross-thread-sync` / `collaborative-thinking` / `custody-recognition` 协作与编排域四核心包内容迁入（B19 四波）。
- **wave 5**（2026-09-11）：`feat-lifecycle` / `worktree` / `co-creation-docs` / `owner-friendly-plugin-development` 工程生命周期与工具链开发流程域四核心包内容迁入（B19 五波）。
- **wave 6**（2026-09-13）：`code-as-harness` / `writing-skills` / `self-evolution` / `context-self-management` / `knowledge-engineering` 开发/调试域与能力进化/会话护栏域五核心包内容迁入（B19 六波）。
- **wave 11**（2026-09-13）：`anime-forge` / `video-forge` / `sprite-forge` / `ppt-forge` / `image-generation` / `pencil-design` / `ttfund-skills` 创意与生产工具域七包内容迁入（B19 十一波）。
- 后续 wave：按 B8 技能域分批补齐其余核心包（见 review_code.md §15 Q5）。
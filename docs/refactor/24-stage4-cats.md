# 阶段 4：灵智体系统 cats（对齐 Clowder AI）

> 目标：移植 clowder-ai `domains/cats` 核心，实现灵智体（Forgekin）档案/注册表/调用队列/
> 编排/转录/蒸馏/存储层。品牌命名沿用 Forgekin，内部机制对齐 cats。

## 任务清单

- [ ] T4.1 `packages/shared`：类型/schema（catId/threadId/profile-frontmatter-parser/registry 纯函数）
- [ ] T4.2 `packages/cats/stores`：ports 接口（Thread/Message/Task/Backlog/Memory/SessionChain/
      Draft/DeliveryCursor/ThreadReadState）+ better-sqlite3 实现 + 内存实现（测试用）
- [ ] T4.3 `packages/cats/agents`：AgentRegistry（含能力探测）、provider 适配接口
- [ ] T4.4 `packages/cats/agents/invocation`：InvocationQueue / QueueProcessor / InvocationTracker /
      TaskProgressStore（并发与超时策略）
- [ ] T4.5 `packages/cats/profile`：档案解析/写入/迁移/审批（approveProfileUpdate）
- [ ] T4.6 `packages/cats/orchestration`：任务编排、EventAuditLog、AutoSummarizer、TaskExtractor
- [ ] T4.7 `packages/cats/session`：TranscriptWriter（会话转录）
- [ ] T4.8 `packages/cats/distillation`：Dossier 蒸馏（经验→dossier 草案应用）
- [ ] T4.9 `packages/cats/freshness|duty-briefing|usage-aggregator`：新鲜度治理/值班简报/用量聚合
- [ ] T4.10 `packages/cats/bootcamp`：引导流程（workspace 初始化）
- [ ] T4.11 测试：注册 Forgekin → 发起调用 → 队列处理 → 进度回写（mock provider）；
      档案迁移/审批单测；蒸馏管线单测

## 验收标准

1. 可通过 YAML 档案注册/更新/停用灵智体（Forgekin），迁移与审批流程可用。
2. 调用队列支持并发限制、超时、失败重试、进度事件。
3. 会话转录可持久化（sqlite）并可回放。
4. 蒸馏：任务成功经验 → Dossier → 可应用为档案更新。
5. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(cats): 移植灵智体系统(档案/编排/调用队列/蒸馏) [sherlock]
```

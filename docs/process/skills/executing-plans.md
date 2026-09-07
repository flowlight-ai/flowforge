---
name: executing-plans
description: 在当前会话中执行已写好的实施计划时使用——装载计划、批判性审查、逐任务执行、遇阻即停。
phase: implement
source: superpowers/executing-plans → flowforge 适配（EP0-1 T0.1.7③）
---

# 执行计划（executing-plans）

## 触发时机

- 手头有一份已写好的实施计划（`docs/process/plans/`），需要在当前会话内执行。
- 开始时宣布："正在使用 executing-plans 资产执行本计划。"
- **优先级提示**：若宿主环境支持子代理派发，优先使用 `subagent-driven-development.md`（④）；本资产是无子代理能力时的行内执行路径。

## 流程步骤

### 第一步：装载并批判性审查计划

1. 确认隔离工作区：使用 `using-git-worktrees.md`（⑪）创建或验证（mgr 分支规范允许下）。
2. 通读计划文件。
3. **批判性审查**：列出对计划的疑问与担忧。
4. 有担忧：先向操作者提出，得到解答后再开工。
5. 无担忧：为每个任务建立 todo，开始执行。

### 第二步：逐任务执行

对每个任务：
1. 标记 in_progress。
2. **严格按步骤执行**（计划已切分到 2-5 分钟粒度）。
3. 按计划运行每一条验证命令并确认输出。
4. 标记 completed。

### 第三步：完成开发

全部任务完成且验证通过后：
- 宣布："正在使用 finishing-a-development-branch 资产收尾。"
- 按 `finishing-a-development-branch.md`（⑫）执行：测试全绿 → mgr PR → 清理。

## 门禁

**立即停止执行（STOP）并求助，不要猜**：
- 遇到阻塞（依赖缺失、测试失败、指令看不懂）。
- 计划有无法开工的关键缺口。
- 验证反复失败。

**回到第一步重新审查的时机**：操作者根据你的反馈更新了计划；或根本思路需要推翻。

以下念头均为跳步信号：

| 念头 | 事实 |
|---|---|
| "先跑起来再说，回头补验证" | 跳过验证 = 未验证 |
| "计划这步大概是这个意思" | 看不懂就停，猜错的代价更高 |
| "测试刚才跑过了，这次改动很小不用再跑" | 绿色只证明跑过的那棵树 |

## 与我方规范对接

- **对应状态机**：本资产覆盖 `implement` 阶段；implement → review 无门禁但 review 为强制阶段（不允许从 implement 直跳 verify）。
- **禁止直接在 main/master 实施**：一律在特性分支，经 mgr 提交 PR（`docs/mgr/`）。
- **验证命令**：flowforge 项目使用 `pnpm vitest run <路径>` / `pnpm typecheck`；证据留存遵循 `verification-before-completion.md`（⑩）。
- **测试铁律**：执行中的任何测试环节受 T1-T9 约束（禁 Mock LLM、禁假数据、禁跳过断言）。

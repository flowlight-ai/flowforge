---
name: requesting-code-review
description: 完成任务、实现重大特性、合并之前使用——派发代码审查子代理，给它精确构造的上下文而非你的会话历史。
phase: review
source: superpowers/requesting-code-review → flowforge 适配（EP0-1 T0.1.7⑦）
---

# 发起代码审查（requesting-code-review）

## 触发时机

- **强制**：子代理驱动开发的每个任务之后；重大特性完成后；合并（mgr PR 合入）之前。
- **可选但有价值**：卡住时（换新鲜视角）、重构前（基线检查）、修完复杂 bug 后。

**核心原则**：早审、勤审。

## 流程步骤

1. **取 commit 范围**：
   ```bash
   BASE_SHA=$(git rev-parse <任务开始前的 commit>)   # 派发实现者前记录的 BASE，绝不用 HEAD~1
   HEAD_SHA=$(git rev-parse HEAD)
   ```
   多 commit 任务用 `HEAD~1` 会静默丢掉除最后一个 commit 外的全部内容。

2. **派发审查子代理**：审查者拿到的是**精确构造的上下文**，永远不是你的会话历史：
   - 变更摘要（DESCRIPTION：做了什么）；
   - 依据（PLAN_OR_REQUIREMENTS：对应计划任务/规格条目）；
   - BASE_SHA 与 HEAD_SHA（或落盘的 diff 审查包文件路径：commit 列表 + stat + 全量 diff）；
   - 全局约束原文（计划"全局约束"节的精确值照抄——这是审查者的注意力透镜）。

3. **处置反馈**：
   - Critical → 立即修；
   - Important → 继续前修；
   - Minor → 记录延后；
   - 审查者错了 → 用技术理由反驳（附代码/测试证据）。

## 门禁

- **双裁决缺一不可**：审查结论必须同时含"规格符合性"与"代码质量"两个裁决（见 ④ 任务级审查）。
- **不得预判发现**：派发单里禁止出现"不要标 X""该项至多 Minor""计划选择了"——预先屏蔽发现通常是给自己省审查循环。认为某发现会是误报，让审查者提出来、你在循环里裁决。
- **不得让审查者重跑实现者已跑过的测试**：实现者报告携带测试证据，审查者审 diff 不复跑。
- **审查者的"⚠️ 无法从 diff 验证"条目**：不阻塞审查其余部分，但必须由你亲自解决后才能标记任务完成——你持有审查者缺少的计划与跨任务上下文。

典型自我合理化对照：

| 念头 | 事实 |
|---|---|
| "我自己看下 diff 就行了" | 你是协调者，行内审 diff 烧掉你继续驱动工作所需的上下文；diff 与评估住在子代理的上下文里，只有发现回来 |
| "审查者需要我的完整会话历史才能懂" | 给它精确构造的上下文；让它聚焦工作产物而非你的思路 |

## 与我方规范对接

- **对应状态机**：本资产覆盖 `review` 阶段；implement → review 无门禁（强制连续），review → verify 无门禁——但 finish 前的 verify 门禁要求审查记录在案（`docs/process/reviews/`）。
- **mgr 合并**：审查通过后经 mgr PR 合入（`docs/mgr/`），禁止本地直接 merge 到 main/master。
- **审查等级**：与 clowder 交叉审查协议对齐——Critical/Important/Minor 三级处置 + P1/P2/P3 分级响应（接收侧见 ⑧）。
- **T1-T9 为评分底线**：Mock LLM 的测试、无断言的测试、假数据直接判 Critical/Important。
- **Gitee PR**：PR 评论回复走评论线程（`gh api` 等价操作或 Gitee 界面），不顶层评论。

# 阶段 5：群聊系统 chat（对齐 Clowder AI）

> 目标：移植 clowder-ai 群聊全链路：线程/消息/@mention 路由/会话链/交接/审批/实时投递。

## 任务清单

- [ ] T5.1 `packages/chat/threads`：线程 CRUD/详情/标题/删除/成员 + 线程读取状态
- [ ] T5.2 `packages/chat/messages`：消息发布/编辑/删除/行动（message-action）+ 媒体附件
- [ ] T5.3 `packages/chat/mention`：@mention 路由 + 多 @ 并发编排（callback-multi-mention 语义）
- [ ] T5.4 `packages/chat/session-chain`：会话链管理 + 交接 handoff（session-handoff 语义）
- [ ] T5.5 `packages/chat/thread-branch`：线程分支
- [ ] T5.6 `packages/chat/approval`：审批 Hub / 提案 proposal / 投票 votes / 治理 gate-keeping
- [ ] T5.7 `packages/chat/signals|memory|tasks`：信号、记忆发布、任务/积压（桥接 cats stores）
- [ ] T5.8 `packages/chat/marketplace`：市场/插件/技能包（skill packs）
- [ ] T5.9 ~~world/community/story/排行榜~~ → **stretch**（`10-stage-map.md` §3.4 S3，仅留 ports）
- [ ] T5.10 ~~IM 通道适配~~ → **stretch**（§3.4 S1：WebChat 内置可选，飞书/Telegram/钉钉/企微按凭据启用；
      仅留 ports 接口 + mock）
- [ ] T5.11 socket.io 事件面：消息投递（thread:message）、进度（invocation:progress）、
      信号（signal:new）、审批（approval:update）
- [ ] T5.12 测试：双客户端实时收发；@ 多个灵智体并发响应且线程隔离；交接链正确；
      审批流状态机单测

## 验收标准

1. 线程内多人（含多个灵智体）消息实时收发，@mention 精确路由。
2. 会话交接后上下文连续（新线程可引用旧线程摘要）。
3. 审批/提案/投票状态机正确流转。
4. 路由统一挂 `/api/v2/*`（R18），与 Python 旧版 `/api/v1/*` 物理隔离。
5. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(chat): 群聊系统(线程/@mention/会话链/实时投递) [sherlock]
```

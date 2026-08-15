# 阶段 8：前端融合（合并两前端）

> 目标：Next.js 前端同时保留 flowforge 页面与 clowder-ai 群聊交互，品牌词保留
> Forgekin/灵智，交互对齐 clowder（@mention 菜单、线程分支、终端面板）。

## 任务清单

- [ ] T8.1 `packages/web` 基础：Next.js 14 + Tailwind + Zustand + socket.io-client 工程
- [ ] T8.2 群聊页：Threads 列表/线程详情/@mention 菜单/线程分支（对齐 clowder 交互）
- [ ] T8.3 灵智档案页：Forgekin 列表/详情/档案编辑/审批（clowder cats 档案 UI + Forgekin 品牌）
- [ ] T8.4 终端面板：xterm 组件（对接 limb 输出流）
- [ ] T8.5 管理台：保留 flowforge admin/*（agents/plugins/marketplace/mcp/models/observability/
      permissions/quotas/routing/settings/tools/governance）
- [ ] T8.6 业务页：保留 council（群聊）/mission/memory/review/signals/solo/tasks
- [ ] T8.7 市场页：marketplace / 技能包
- [ ] T8.8 Bootcamp 引导向导（对齐 clowder bootcamp wizard）
- [ ] T8.9 深色主题与品牌（Forgekin 标识、灵智配色）
- [ ] T8.10 Playwright 冒烟：全页面路由可达、群聊收发、终端面板渲染（沿用 _browsertest 思路）

## 验收标准

1. `pnpm dev` 启动后所有页面路由可访问。
2. 群聊页可实时收发消息、@mention 弹出灵智体菜单。
3. 终端面板可显示 mock CLI 输出。
4. 品牌词合规（P1 英文名 + 双标注规则，见 naming-contract）。
5. Python 旧版 `pytest` 回归全绿（旧版 web 不受影响）。

## 提交信息模板

```
feat(web): 前端融合(群聊/灵智档案/管理台) [sherlock]
```

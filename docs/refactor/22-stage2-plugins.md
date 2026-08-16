# 阶段 2：插件体系（对齐 dsh "一切皆插件"）

> 目标：全部框架能力以 cordis 插件包形态提供（可独立加载/卸载），覆盖 dsh 功能矩阵
> D8-D22、D22b、D26 及 D32-D38/D41-D44；应用层插件契约对齐 clowder `@clowder-ai/plugin-contract`（R13）；
> 同时覆盖 clowder C36 与 flowforge F23-F26 的框架侧能力。

## 插件开发契约（本阶段起强制，R13）

每个插件包必须满足：
1. `package.json`：`name: @flowforge/<域>-<名>`，`peerDependencies: { "@flowforge/cordis": ... }`；
2. 导出 `apply(ctx)` 或插件类；
3. `inject` 声明依赖的 `ctx.*` 服务；
4. 可选 `schema`（schemastery）声明配置；
5. 生命周期由 Context 管理，卸载后服务不可用；
6. 独立 vitest 验证加载/卸载/依赖注入。

应用域插件（cats/chat/limb/forgekin）在 1-6 之上额外满足 `@flowforge/plugin-contract`
（T2.15）：应用级生命周期钩子、权限/凭据声明、路由挂载点（`/api/v2/*`，R18）。

## 任务清单

- [ ] T2.1 `packages/plugins/mcp`：MCP 客户端/服务器（stdio+SSE 传输），tool 桥接到 `ctx.tools`
- [ ] T2.2 `packages/plugins/skill`：技能系统（skill / skill-filesystem / skill-badge / tool-skill）
- [ ] T2.3 `packages/plugins/subagent`：子代理编排
- [ ] T2.4 `packages/plugins/sandbox`：沙箱（native landlock-run 编译可选；e2b 可选依赖）
- [ ] T2.5 `packages/plugins/shell|terminal|subprocess`：shell 执行、终端会话、子进程管理
- [ ] T2.6 `packages/plugins/workflow`：工作流执行引擎（dsh workflow，含 YAML 定义加载）
- [ ] T2.7 `packages/plugins/plan|goal|todo`：计划/目标/待办状态机
- [ ] T2.8 `packages/plugins/schedule|jobs`：cron 调度与作业队列
- [ ] T2.9 `packages/plugins/credentials|settings`：密钥存储（better-sqlite3 加密列）与设置 schema
- [ ] T2.10 `packages/plugins/lsp|fs|workspace`：LSP 客户端、文件系统（含写入原子性）、工作区管理
- [ ] T2.11 `packages/plugins/compaction|feedback|guard`：上下文压缩、反馈收集、护栏策略
- [ ] T2.12 `packages/plugins/identity|interaction|approval`：身份、交互层、人工审批
- [ ] T2.13 `packages/extensions/*`：tool-cordis / ui-cordis / cordis-client-runner / cordis-host-runner
      （插件加载/热更新/依赖注入；host-runner 与阶段 0 插件基座衔接，作为生产版装配器）
- [ ] T2.14 集成测试：mcp 连 mock server 完成 tool 调用；skill 从文件系统加载；
      workflow 执行一个 3 节点 DAG；插件卸载后 ctx 服务不可用；
      **全量插件清单经基座装配后一键启动/停止（manifest 冒烟）**
- [ ] T2.15 `packages/plugin-contract`：应用层插件契约（映射 clowder `@clowder-ai/
      plugin-contract` 0.1.0-beta.7）——应用级生命周期/权限钩子类型 + 路由挂载约定，
      契约与内核插件契约同源同构（R13）；cats/chat/limb 各域插件从阶段 4 起实现该契约
- [ ] T2.16 `packages/session-query/*`：会话查询族（session-query/session-query-sqlite/
      session-log-export/tool-session-query，D32；对照 P: `session/` 查询能力）
- [ ] T2.17 `packages/sdk/*`：JSON-RPC SDK（client/protocol/server，D33；python/sdk 桥接基础 S6）
- [ ] T2.18 `packages/acp`：ACP 会话桥（D34；外部 CLI 控制基础）
- [ ] T2.19 `packages/code-runtime/*`：代码运行时（code-runtime + worker-thread，D35；PTC Code Mode 基础）
- [ ] T2.20 `packages/attachment`：附件（D36）
- [ ] T2.21 `packages/plugins/web*`：Web 工具族（web/web-fetch-http/web-search-deepseek|exa|perplexity/tool-web，D37）
- [ ] T2.22 `packages/plugins/goal`：目标族完整化（goal-round-driver/tool-goal/command-goal，D38）
- [ ] T2.23 `packages/preset`：预设（agent-presets/persona，D44；preset 结构对齐 forgekins 档案）
- [ ] T2.24 `packages/plugins/skill-security`：技能安全（C36；vender 自 clowder skill-security）
- [ ] T2.25 `packages/plugins/feature-flags` + `packages/plugins/canary`：特性开关 + 金丝雀
      （F24；对照 P: `core/feature_flags.py` + `core/canary.py`）
- [ ] T2.26 `packages/plugins/modes`：模式执行器（F25；对照 P: `core/base_mode_executor.py` + `modes/`）
- [ ] T2.27 `packages/plugins/guard`：内容审核与护栏扩展（F26；对照 P: `core/{content_moderation,moderation,guardrails}.py` + `core/gate/`）
- [ ] T2.28 `packages/plugins/resilience`：弹性栈（F23；对照 P: `core/{circuit_breaker,fallback_chain,degradation,recovery_tier,restart_recovery,checkpoint_*}.py`）
- [ ] T2.29 集成测试补充：session-query 检索/导出；sdk JSON-RPC 往返；ACP 桥接会话；
      preset 装配 forgekins 档案；skill-security 拒绝越权技能；弹性栈故障注入恢复
- [ ] T2.30 `packages/hooks/*` + `packages/context/*`：事件钩子与上下文辅助域
      （承接阶段 1 T1.9：hook-protocol / hooks-claude-code / hooks-codex /
      agent-instructions / session-reference / time-context / tmux-context，共 7 包；
      依赖 T2.3/T2.5/T2.10/T2.16 的 subagent/shell/fs/session-query，随本阶段一并移植）

## 验收标准

1. 每个插件包可独立 `ctx.plugin(PluginX)` 加载/卸载，生命周期事件（created/ready/dispose）正确。
2. MCP/Skill/Workflow/Schedule 四个代表性插件集成测试通过。
3. `pnpm typecheck` + `pnpm lint` 零错误。
4. Python 旧版 `pytest` 回归全绿。
5. `@flowforge/plugin-contract` 类型发布，示例应用插件按契约实现并通过基座装配。

## 提交信息模板

```
feat(plugins): 移植dsh插件体系(mcp/skill/sandbox/workflow等) [sherlock]
```

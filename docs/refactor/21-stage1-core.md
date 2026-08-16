# 阶段 1：框架内核 core（对齐 DeepSeek Harness，插件化）

> 目标：移植 dsh 产品 API 脊柱（scope/session/system-prompt/tools/agent/agent-loop），
> 建立 `ctx.*` 服务契约，LLM 抽象可用。**每个 core 包均以 cordis 插件形态提供**
> （`apply(ctx)` + `inject` + 可选 `schema`，契约见 `01-stack-decision.md` R13），
> 由阶段 0 的插件基座（`packages/harness/boot`）装配加载。

## 任务清单

- [x] T1.0 确认插件基座可用：`packages/harness/boot` 冒烟测试全绿（阶段 0 验收项）
- [x] T1.1 `packages/core/scope`：scoped-context 注册原语（vendor dsh core/scope，去 dsh brand 逻辑）
- [x] T1.2 `packages/core/session`：event-sourced session 日志 + 内存存储（`ctx.sessions`，插件）
- [x] T1.3 `packages/core/system-prompt`：prompt/tool-schema 组装注册表（`ctx.systemPrompt`，插件）
- [x] T1.4 `packages/core/tools`：scoped tool 注册与执行管线（`ctx.tools`，含执行中间件/事件，插件）
- [x] T1.5 `packages/core/agent`：Agent 接口/注册表/事件词汇（`ctx.agents`，插件）
- [x] T1.6 `packages/core/agent-default-model`：默认模型选择（`ctx.agentDefaultModel`，插件）
- [x] T1.7 `packages/core/agent-loop`：默认 agent 驱动循环（`ctx.agentLoop`，插件）
- [x] T1.8 `packages/harness/util|spill|typert|storage`：基础工具与存储抽象（vendor dsh）
      + `packages/settings`（vendor dsh settings/settings + settings-file，invariant/redact）
      + 连带移植：`attachment`/`code-runtime`/`compaction`/`credentials`(+local)/`identity`/
      `interaction`/`runtime-diagnostics`/`session-persistence` 系列（41 个包，全部改名 `@flowforge/*`）
- [x] T1.9 `packages/harness/hooks|context`：事件钩子与上下文辅助（vendor dsh）
      + 基础设施部分已随 T1.8 移植；dsh 当前结构为顶层 `packages/hooks/*` 与
      `packages/context/*` 共 7 包（hook-protocol/hooks-claude-code/hooks-codex/
      agent-instructions/session-reference/time-context/tmux-context），均依赖阶段 2 的
      shell/fs/subagent/session-query 等插件域包，**随阶段 2 一并移植**（`22-stage2-plugins.md`）
- [x] T1.10 `packages/llm`：provider 接口（anthropic/openai/gemini/openai-compat）+ mock server
      （vendor dsh `packages/llm/*` + `packages/test-support/llm-mock-server`（已确认存在：
      `startMockLlmServer`/`MockLlmBehavior`，阶段 1 测试基线），合并 flowforge
      openroute_adapter 能力为 openroute provider——openroute provider 随阶段 3 api 层落地）
- [x] T1.11 单元测试：session 事件溯源追加/回放；tool 注册/scope 隔离/执行管线；
      agent loop 冒烟（mock LLM 回复 tool_call → 执行 → 收尾）；
      **插件化测试：core 各包可独立加载/卸载，卸载后 `ctx.*` 不可用**
      （2933 测试全绿：141 文件 / 2933 passed / 0 failed；win32 下 6 个 symlink 用例
      `skipIf(platform==='win32')`；2 个超前 spec（gen-tool-catalog/gen-persistence-catalog）
      依赖阶段 2+ 生态，先排除、随阶段 2 恢复）
- [x] T1.12 `packages/core/agent/README.md` 等包 README 补齐（对齐 dsh 文档风格）
      （41 包双语 README 随移植带入；`packages/harness/boot` 补 README.md + README.zh.md）

## 验收标准

1. `ctx.sessions` 可创建会话、追加消息、按事件流回放。
2. `ctx.tools` 支持 scope 内注册/查询/执行，未授权 scope 不可见。
3. `ctx.agentLoop` 用 mock LLM 完成 1 轮 tool_call 循环。
4. **插件化**：core 各包经插件基座装配后可整体 start/stop，卸载后服务不可用。
5. 所有包 `tsc -b` 零错误；vitest 全绿。
6. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(core): 移植dsh core内核(session/tools/agent/loop) [sherlock]
```

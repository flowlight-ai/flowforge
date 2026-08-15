# 阶段 3：API 网关 + Web 服务 + CLI

> 目标：fastify 服务装配层、socket.io 实时通道、`flowforge` CLI 命令、boot/bundle/settings
> 启动链路，`pnpm flowforge web` 可启动。

## 任务清单

- [ ] T3.1 `packages/api`：fastify 装配（cors/cookie/static/multipart/websocket + OpenAPI + OTEL）
- [ ] T3.2 `packages/api`：socket.io 服务（连接鉴权、房间管理，事件面先空转）
- [ ] T3.3 `packages/harness/boot`：插件装配引导（从 config 文件加载插件清单，对齐 dsh boot）
- [ ] T3.4 `packages/harness/settings`：schemastery schema 配置加载（.env + yaml + cli 覆盖）
- [ ] T3.5 `packages/harness/bundle|client|host`：打包/客户端/宿主进程管理
- [ ] T3.6 `apps/cli`：`flowforge` bin（web / headless / jsonrpc 模式，参考 dsh apps/cli）
- [ ] T3.7 健康检查路由 `/api/health` + 系统状态（沿用 flowforge app/api/core/system.py 语义）
- [ ] T3.8 测试：fastify 实例启动 + 路由冒烟；socket.io 连接/断开；CLI `--help`；
      headless 模式跑通一个 agent 会话（mock LLM）
- [ ] T3.9 `apps/cli/README.md` 使用说明

## 验收标准

1. `pnpm flowforge web` 启动后 `http://127.0.0.1:3080`（沿用 dsh 默认端口）返回健康页。
2. `pnpm flowforge headless "你好"`（mock LLM）输出一轮回复。
3. OpenAPI 文档 `/docs` 可访问。
4. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(api): API网关与Web/CLI启动链路 [luban]
```

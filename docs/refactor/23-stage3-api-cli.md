# 阶段 3：API 网关 + Web 服务 + CLI

> 目标：API 网关（apiproxy/webserver）、boot/bundle/settings 启动链路、`flowforge`
> CLI 命令（对齐 dsh profile 体系：base/headless bundle + profile 装配）。

## 任务清单

- [x] T3.1 `packages/api`：api-gateway（typert RPC 网关）+ api-remotes（已按 dsh 架构移植，非 fastify 装配）
- [x] T3.2 `packages/boot`：app-boot（boot/include/patch/profile 装配）+ cmdline（对齐 dsh boot）
- [x] T3.3 `packages/bundle`：base（76 行插件树 patch）+ headless（一次性任务模式）
- [x] T3.4 `packages/host` 9 包：webserver/apiproxy/directory-picker(3)/frontend-static/plugin-inventory
- [x] T3.5 `packages/client/connection`：client 连接层（fetch/SSE、RPC trust fence）
- [x] T3.6 `apps/cli`：`flowforge` bin（profile/plugin/dump-config 模式，对齐 dsh apps/cli）
- [x] T3.7 apiproxy 含健康/会话/导出等 RPC 域（session-export/settings/credentials 全测试覆盖）
- [x] T3.8 测试：vitest 针对性全绿（apps/cli + boot + api + host + client + bundle）；
      CLI `--help` 冒烟通过；headless 端到端冒烟通过（mock LLM 完整一轮回复）
- [x] T3.9 `apps/cli` README（随包移植，README/README.zh.md/README.i18n.yaml）

## 验收标准

1. ~~`pnpm flowforge web` 启动后 `http://127.0.0.1:3080` 返回健康页~~
   → 依赖 `@flowforge/web-app` bundle 与 ~30 个 client-ui 包（阶段 4 范围）；
   阶段 3 已交付 webserver/apiproxy/前端静态服务宿主，web 完整冒烟移入阶段 4 验收。
2. [x] `flowforge --profile headless "..."`（mock LLM）输出一轮回复
   （DEEPSEEK_BASE_URL 指向 llm-mock-server，输出 `mock response recovered`，exit 0）。
3. ~~OpenAPI `/docs`~~ → 本阶段按 dsh 架构为 typert RPC 网关（无 OpenAPI 页）；契约由 typert 生成。
4. [x] Python 旧版回归：阶段 3 未触碰 `app/`（Python），无回归面。

## 冒烟操作记录（2026-08-17）

```sh
# 1) 构建产物（loader 从 profiles/node_modules symlink 解析 lib/index.js）
pnpm run build   # tsc -b tsconfig.host.json && tsdown --env.FF_BUILD_FACE host

# 2) mock LLM server
node --import tsx/esm packages/test-support/llm-mock-server/src/bin.ts \
  --port 18999 --api-key mock-key --sequence success --repeat-last

# 3) headless 端到端
$env:FF_HOME = "$PWD/.tmp-ffhome-smoke"
$env:DEEPSEEK_BASE_URL = "http://127.0.0.1:18999/v1"
$env:DEEPSEEK_API_KEY = "mock-key"
node --import tsx/esm apps/cli/src/bin.ts --profile headless "回复两个字：成功"
# → 输出 mock response recovered，exit 0
```

阶段 3 修复要点：`packages/client/tsdown.client.ts` 的 `clientBundle` 在 Host pass
即为全部消费者构建 Node 半产物（阶段 4 落地 client pass 前的过渡契约），否则
host Loader 无法解析 `lib/index.js`；`apps/cli/package.json` 须全量声明 patch
引用的插件包（76 个），`healProfilesModuleFallback` 才能为 profile 建立解析链接。

## 提交信息模板

```
feat(api): API网关与Web/CLI启动链路 [sherlock]
```

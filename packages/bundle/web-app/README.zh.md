# `@flowforge/web-app`

[English](README.md) | 中文

flowforge 浏览器界面组合包：由 [`cordis.patch.yml`](cordis.patch.yml) 组成的、叠加在 [`@flowforge/base`](../base/README.md) 之上的 web patch 层，外加 `web-app` 运行时胶水插件与 `web-startup` 命令行 provider。它拥有 FlowForge 今天可组合的宿主行——worker-thread 代码执行、会话日志导出与统计、双面目录选择器、插件清单、webserver、浏览器传输的宿主半、前端 dist 服务、web 界面提示词片段、`FF_WEB_URL` bash 变量、URL 行与默认浏览器移交——并把 agent 平面移到 agent preset 之后。

完整的浏览器界面（随发行版提供的 `@flowforge/web-frontend` dist、浏览器 `__FF_BOOT__` 接缝以及 client-capability 清单）随 EP2 客户端能力集成批次落地；在此之前，本组合包只保留它今天能够验证的宿主行组合。

## 使用方式

启动界面并打开浏览器：

```sh
flowforge --profile web
flowforge --profile web --no-open --port 8080
```

启动后会打印出一行 `flowforge web:`，其中给出规范的回环 URL（当服务器绑定所有网络接口时还会附带 LAN URL）。除非 `--no-open` 或 SSH 会话抑制它，默认浏览器会打开该 URL。两个可预期的失败：若 `@flowforge/web-frontend` 缺失，启动会以一条 EP2 提示停止；若浏览器无法打开，会向 stderr 打印一条不带凭据的诊断，同时服务器继续运行——请自行打开打印出的 URL。

### 配置

命令行 flag 依次喂给下面四项设置——`--host`、`--port` 与 `--trusted-host` 来自调用，`--no-open` 为本次调用关闭浏览器移交：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `openBrowser` | `true` | 启动后打开默认浏览器；SSH 启动会抑制它 |
| `printUrl` | `true` | 启动时打印 `flowforge web:` URL 行 |
| `surfaceContext` | `true` | 为 agent 提供 GUI 导向上下文，并把 `FF_WEB_URL` 暴露给其 shell 命令 |
| `trustedHosts` | `[]` | 允许从网络访问本界面的额外主机 |

### LAN 访问与受信主机

默认情况下本界面只接受来自本机的连接。绑定所有网络接口的部署也允许来自 LAN 的浏览器访问，此时打印出的 URL 会附带一个 LAN 地址；两种情况下 `--trusted-host` 都会添加额外主机。LAN 地址在启动时采样一次，之后发生的网络变更不会被重新采样——重启界面以重新公布。

### 通过 SSH 运行

当通过 SSH 启动 `flowforge --profile web` 时，URL 行仍会打印，但不会为你打开浏览器：本地转发地址由 SSH 客户端或编辑器持有。请自行在本机打开转发后的 URL；打印出的 URL 指向远程主机的回环端点。

## 理解实现

该组合包由一份 patch、一个运行时胶水插件与一个命令行 provider 组成。patch 重述 base 有意省略的界面专属值，插入 web 专属宿主行，然后把 agent 平面移到 preset 之后。胶水插件负责 dist 服务、LAN 信任采样、提示词片段、bash 变量与就绪宣告；启动 provider 解析 web flag 家族。

### 就绪

URL 行与浏览器移交是就绪信号，因此它们只会在 Loader 树 settle 之后运行——或在没有 Loader 的手工构建树中立即运行。构造中途被清理的树不宣告任何内容。

### LAN 信任采样

`resolveLanTrust` 在启动时对网络采样一次：回环绑定（`127.0.0.1`）不推导任何 LAN 地址，而绑定所有接口则会加入每个非内部 IPv4 字面量。推导出的字面量加上显式的 `--trusted-host` 权威共同构成 `/api` 浏览器信任围栏，打印出的 LAN URL 始终与该围栏一致。

### 源映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `web-app` 胶水插件：dist 解析、LAN 信任采样、提示词片段、bash 变量、URL 行、浏览器移交 |
| [`src/startup.ts`](src/startup.ts) | `web-startup` provider：`--host`、`--port`、`--trusted-host`、`--no-open`、`--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | web patch：重述的 base 值、web 宿主行、被移到 preset 之后的 agent 平面 |
| — | 不发布运行时不变式 companion；每个贡献（frontend-static 子插件、提示词片段、bash 变量注册）都随 fiber 一起由 registry 清理，且每个所属 registry 的包各自携带该关系的不变式。 |
| [`tests/web-app.spec.ts`](tests/web-app.spec.ts) | dist 解析、fallback 席位、提示词片段、就绪 |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | 命令行解析 |
| [`tests/trusted-hosts.spec.ts`](tests/trusted-hosts.spec.ts) | LAN 信任采样 |
| [`tests/browser-open.spec.ts`](tests/browser-open.spec.ts) | 默认浏览器移交 |

## 深入探索

- [Base 组合包](../base/README.md) —— 本界面运行于其上的共享核心。
- [frontend-static](../../host/frontend-static/README.md) —— 内置前端 dist 的提供方式。

## 模型体验

### Harness 来源与 Web 界面上下文

#### 模型所见

当 `surfaceContext` 为 true 时，`harness:source` 片段标识磁盘上的 FlowForge 实现，但不宣称它就是工作目录；`app:web-surface` 片段把模型导向 GUI：规范的本地 URL、「此页面」指代、更新契约（reload 接收端始终开启；免刷新 reload 还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指示。`FF_WEB_URL` 还会以其描述出现在受管 shell 环境中，按调用从活动服务器解析。当它为 false 时，片段与变量都不注册。

#### KV Cache 影响

提示词片段位于系统提示词头部附近，并在进程生命周期内保持稳定（端口是启动事实），因此不会在跨 turn 时使缓存失效。

## 已知限制与暂缓事项

- **浏览器界面随 EP2 交付** —— `@flowforge/web-frontend` 与 client-capability 清单不在本组合包中；宿主胶水只组合它今天能验证的部分，缺失 dist 的解析会以 EP2 提示大声失败。
- **LAN 地址在启动时采样一次** —— 启动后的接口变更不会被重新采样；打印出的 LAN URL 始终与已采样的内容一致。
- **只可观测移交的开始** —— 界面只报告「已请求打开浏览器」，不报告其确实打开；随后的浏览器退出永远不会被上报，打印出的 URL 是你手动回退的途径。
- **SSH 会话保留 URL 但跳过浏览器移交** —— 打印出的 URL 指向远程主机的回环端点；SSH 客户端或编辑器必须暴露并打开本地转发地址。
- **不支持绑定所有网络接口** —— 出于安全考虑，`--host 0.0.0.0` 在启动时被拒绝；请使用默认回环主机。
- **patch 会替换整行 config** —— profile 覆盖需重述该行保留的每个字段；不存在深度合并层。
# 35. Stretch 批次实施计划（B21 assets / A13 code-runtime-python / S1 IM 真实通道）

> 目标：推进三张「待裁决」stretch 项。本文档是**实施计划**（计划先行，评审批准后再写码）。
> 依据：review_code §13.5 EP4-stretch 排期表 + 阶段 11 日落冻结（Python 运行时仅用于测试、不进入交付面）。
> 红线：无 `@deepseek-ai`/`@cat-cafe` 真依赖（全量移植）；一切皆插件；走 ff_dev 七阶段流程 + ff_doctor L0-L3 校验；mgr 提交 PR 至 gitee。

> **批次进度**：🟩 S-B21 ✓（PR #202） ｜ 🟩 S-S1 ✓（飞书真实 IImChannelAdapter，可独立观测） ｜ 🟩 S-A13 ✓（code-runtime-python 内联移植，fd3/fd4 双管道规避 Windows 死锁）——**三张 stretch 批次全部收口**

## 1. 已确认的源→目标映射（探查结论）

| 项 | 源（clowder / dsh） | 目标（flowforge） | 依赖扫描结论 |
|----|--------------------|-------------------|--------------|
| **B21** `assets/` | clowder `packages/api/src/routes/audio-proxy.ts`（F195 audio-capture 代理，依赖独立 Python audio-service :9881）、`packages/api/src/routes/avatars.ts`（头像上传，multipart + 魔数嗅探）、`packages/web/public/avatars/*.png`（~25 静态头像）、`packages/shared/src/avatar-limits.ts` | flowforge REST 层 `packages/api/rest-controllers`（新增 controller + port），静态头像资产按插件 assets 打包 | clowder 端依赖 `@fastify/multipart`（stream 语义）：flowforge 应绕过 fastify，走自身 HTTP 契约层；`resolveUserId` 对应 flowforge `request-context` port |
| **A13** `code-runtime-python` | dsh `packages/experimental/code-runtime-python`（`src/index.ts` ~140KB、`src/protocol.ts`、`py/bootstrap.py`+`py/protocol.py`、tests×5） | flowforge 新建 `packages/code-runtime/code-runtime-python`（对齐既有 `code-runtime-worker-thread` 蓝本，实现 `CodeRuntime.language='python'/isolation='process'`） | A13 依赖 dsh 共享契约 `@deepseek-ai/dsh-code-runtime` + `dsh-timeout` + `dsh-util-values` + `cordis` + `schemastery`——**全量大**，需先全量移植共享契约（禁依赖）；CPython subprocess 测试需解释器在场 |
| **S1** 真实 IM 通道 | clowder `infrastructure/connectors`（已 C44 移植）框架 + chat-stretch `IImChannelAdapter`（`packages/chat/stretch-ports/src/im-ports.ts`） | 落地真实飞书 adapter：实现 `IImChannelAdapter`（feishu）→ 注册进 connector gateway → 凭据从 `config/im_channels.yaml` + env 接线 | 飞书 callbacks 走既有 connector 入站 router；出站 `send()` 走 gateway adapters；无需新增 http 依赖（走平台 HTTP 层） |

## 2. 阶段切割与依赖关系

- **批次 S-B21（最小、无外部依赖，首位）**：头像静态资产打包 + avatars 上传 route（魔数嗅探 + 体积限制 `AVATAR_RAW_FILE_LIMIT_BYTES`）+ audio-proxy route（默认指向本地 audio-service，缺失时 502，身份走 request-context）。audio-service 本体属 S2 平台路由，不在本批次。
- **批次 S-S1（中量，紧随 B21）**：真实 feishu `IImChannelAdapter` + connector gateway 注册 + 凭据接线（`config/im_channels.yaml` 已有 feishu_group 槽位：app_id_env/app_secret_env/chat_id_env + at-mention + 回调映射）。
- **批次 S-A13（大，CPython 测试费时）**：先全量移植 dsh 共享契约（code-runtime/timeout/util-values + cordis/schemastery 等价物），再移植 Python worker 后端 + py 资产；vitest（mock/真实 temp-dir 分层）+ 包级 tsc + oxlint。

## 3. 门禁与验证（每批次）

1. ff_doctor 计划 → design/plan docs（docs/process）→ gate → advance → evidence → gate verify → advance finish。
2. 包级 vitest exit 0、tsc exit 0、oxlint 0。
3. mgr sync `type(scope): 中文描述 [sherlock]` 提交 PR 至 gitee。
4. 更新 review_code §13.5 / task.md EP4-stretch 行状态。

## 4. 待 operator 确认的决策点

1. **A13 共享契约移植范围**：A13 依赖的 4 个 dsh 包（code-runtime/timeout/util-values + schemastery）是否一次性全量移植为一个 `packages/code-runtime/contracts` 包，还是先内联最小必需子集？→ 建议先内联最小必需（identifier/error/protocol/binding 类型）以满足禁依赖红线，后续再抽公有契约包。
2. **S1 首发通道**：飞书（feishu）作为首个真实通道是否确认？缺真实凭据时，adapter 以「配置探测 → 未配置则回退 mock + 健康检查降级」落地，避免破坏既有 mock 装配。
3. **B21 audio-service 目标地址**：flowforge 无独立 audio-service，`resolveAudioServiceUrl` 默认 `AUDIO_SERVICE_URL ?? http://127.0.0.1:9881` 是否接受（仅在显式配置后才启用，避免误连）？
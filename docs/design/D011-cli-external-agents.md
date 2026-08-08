# 三方编码智能体（CLI）对接与部署文档

> FlowForge 九灵智体如何接入第三方 AI 编码 CLI，以及如何在 Linux/Windows 上一键部署。
> 本文档同时记录了对接过程中遇到并解决的工程问题。

相关脚本：
- `scripts/setup_cli_agents.sh` — 三方 CLI 一键安装/配置/启动/验证
- `scripts/start_proxies.sh` — 启动协议转换代理（gemini/anthropic/responses → OpenRoute）
- `scripts/verify_forgekin.py` — 九灵智体配置 + 一次性（PONG）连通性验证
- `llm/cli_provider.py` — CLI 子进程驱动（`CLIProviderConfig` + `PRESET_CONFIGS`）

---

## 1. 九灵智体 → CLI → 模型 映射

| 灵智体 | 角色 | provider | CLI | 模型 | 传输路径 |
|--------|------|----------|-----|------|----------|
| 文心 (wenxin) | 文档员 | `opencode` | opencode | build（默认） | 直连 |
| 夏洛克 (sherlock) | 开发者 | `codex` | codex | Doubao-Seed2.0 | → responses proxy (8084) → OpenRoute |
| 鲁班 (luban) | 架构师 | `gemini` | gemini | gemini-2.5-flash | → gemini proxy (8082) → OpenRoute |
| 梵高 (vangogh) | 审查员 | `claude_code` | claude | Doubao-Seed2.0 | → claude-code-router (3456) → OpenRoute |
| 达芬奇 (davinci) | 测试员 | `codebuddy` | codebuddy | hy3（预置） | 直连 |
| 鹰·凯恩 (keane) | 产品经理 (F041) | `iflow` | iflow | Doubao-Seed2.0 | OpenAI-Compatible → OpenRoute |
| 蜂鸟·闪电 (humming) | 运维 (F042) | `opencode` | opencode | build（默认） | 直连 |
| 铃鼓 (sqrl) | 开源程序员 | `opencode` | opencode | build（默认） | 直连 |
| 幻蝶 (butterfly) | Trae 桥接 (F045) | `trae` | trae (IDE) | operator 自选 | TraeLLMClient 文件桥接 |

> `qodercli` 已安装但**未绑定任何灵智体**——它需要真实 Qoder 账号登录
> （`qodercli login` 浏览器授权），无法路由到 OpenRouter/OpenRoute。绑定前请先登录。

---

## 2. 部署架构

```
                    ┌─────────────────────────────────────────────┐
                    │  FlowForge (ForgekinBase.chat)              │
                    │   └─ llm/cli_provider.CLILLMProvider        │
                    └──────┬──────────────────────────┬──────────┘
                           │                          │
              ┌────────────┴─────────┐    ┌───────────┴───────────┐
              │ 直连类 (opencode,    │    │ 转发类 (经代理)        │
              │ codebuddy, iflow)    │    │                       │
              └────────────┬─────────┘    └───────────┬───────────┘
                           │                          │
                    ┌──────┴──────┐     ┌─────────────┴──────────────────┐
                    │ OpenRoute 网关 │     │ 本地代理                       │
                    │ :13001        │     │  gemini→OR  (8082)            │
                    │  (openroute)  │     │  anthropic→OR(8083)           │
                    └──────────────┘     │  responses→OR(8084)            │
                                         │  claude-code-router (3456)     │
                                         └────────────────────────────────┘
```

- **直连类**：`opencode`（内置 `build`）、`codebuddy`（预置 `hy3`）、`iflow`（OpenAI-Compatible 指向 13001）。
- **转发类**：`codex`、`gemini`、`claude` 在 Linux 下无法直连官方 API（网络受限），统一经本地
  协议转换代理转发到 OpenRoute 网关（用户选择**本地 OpenRoute 网关**而非 HTTP 代理）。

---

## 3. 一键部署

```bash
# 前置：OpenRoute 网关已在 13001 运行；Node.js >= 18
bash scripts/setup_cli_agents.sh                  # 安装 + 配置 + 启动
bash scripts/setup_cli_agents.sh --only-install   # 仅安装 CLI 包
bash scripts/setup_cli_agents.sh --no-start       # 安装+配置，不启动代理

# 启动 flowforge 前后端
.venv/bin/python scripts/start.py
```

脚本自动完成：
1. `npm install -g` 六种 CLI（claude/codex/opencode/codebuddy/qodercli/iflow）+ `claude-code-router`。
   - gemini-cli **锁定 0.43.0**（v0.44+ 存在 auth+baseURL 回归 bug，`exit 41`）。
2. 从 `config/models.yaml` 自动提取 `openroute.api_key_default`；从 `~/.config/Trae*/` 自动探测 OpenRouter key。
3. 启动 3 个协议代理与 claude-code-router。
4. 写入 `~/.claude/settings.json`、`~/.claude-code-router/config-router.json`、
   `~/.codex/config.toml`、`~/.iflow/settings.json`。
5. 对 claude/codex/opencode 做 PONG 冒烟测试。

---

## 4. 九灵智体验证

```bash
# 配置 + 二进制校验（不调用 LLM）
.venv/bin/python scripts/verify_forgekin.py
# 满校验：对 8 个 CLI 后端各做一次 PONG 调用（trae 跳过）
.venv/bin/python scripts/verify_forgekin.py --live
```

预期结果：
```
  OK : wenxin    opencode     -> 'PONG'
  OK : sherlock  codex        -> 'PONG'
  OK : luban     gemini       -> 'PONG'
  OK : vangogh   claude_code  -> 'PONG'
  OK : davinci   codebuddy    -> 'PONG'
  OK : keane     iflow        -> 'PONG'
  OK : humming   opencode     -> 'PONG'
  OK : sqrl      opencode     -> 'PONG'
  SKIP: butterfly trae        -> IDE 桥接
```

也可经 HTTP API 验证单个灵智体（服务运行中）：
```bash
curl -X POST http://127.0.0.1:8000/api/v1/forgekins/vangogh/chat \
  -H "Content-Type: application/json" -d '{"message":"reply with exactly: PONG"}'
# -> {"content":"PONG","model":"claude_code",...}
```

---

## 5. 对接过程中的问题与解决（Troubleshooting 记录）

### 5.1 gemini-cli：v0.44+ 启动即崩溃（exit 41）
- **现象**：`gemini -p` 报 `exit 41` / auth 初始化失败。
- **根因**：v0.44+ 对 auth + baseURL 处理存在回归。
- **解决**：锁定 `@google/gemini-cli@0.43.0`，配合 `GOOGLE_GEMINI_BASE_URL=127.0.0.1:8082`、
  `GEMINI_API_KEY=<or-...>`、`GEMINI_CLI_TRUST_WORKSPACE=true`。注意 cli_provider 中
  **模型参数必须放在 prompt 之后**（gemini 的 `-p` 会吞掉下一个 `--model`）。

### 5.2 codex 配置合法性
- **现象**：`codex exec` 报 provider name empty / `approval_policy.mode` 非法。
- **根因**：`~/.codex/config.toml` 中 `name` 字段必填；`approval_policy.mode` 只接受
  `untrusted/on-failure/on-request/granular/never`（`auto` 非法）。
- **解决**：配置 `model_providers.openroute_responses`（`wire_api = "responses"`，
  `base_url = 127.0.0.1:8084/v1`，`env_key = CODEX_API_KEY`），`sandbox_mode = "read-only"`。

### 5.3 claude code 需经 claude-code-router 才可用
- **现象**：直连 Anthropic 官方 API 不可达；或转发后返回长篇散文而非所需输出。
- **解决**：安装 `claude-code-router`，配置 `~/.claude-code-router/config-router.json`
  指向 OpenRoute（默认）与 OpenRouter（search），`defaultProvider=openroute`；
  `~/.claude/settings.json` 的 `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`。
- **关键坑**：ccr 的 `loadConfig` 会把**内置 provider**（`codewhisperer-primary`、
  `shuaihong-openai`）合并进配置，且 `categoryMappings` 全为 `true`、优先级更高 → 请求
  总被路由到 codewhisperer 报 401。解法：在配置中显式列出这两个内置 provider 并把
  categoryMappings 全置 `false`，再让 `openroute` 兜底。

### 5.4 iFlow CLI：认证方式已废弃
- **现象**：`iflow` 报 `Auth method has been deprecated. Please reconfigure with OpenAI Compatible API.`
- **根因**：2026-04-16 之后，只有 `openai-compatible`（或 `cloud-shell`）认证合法；
  旧 `selectedAuthType` 值被拒绝。
- **解决**：`~/.iflow/settings.json` 设为
  `selectedAuthType: "openai-compatible"`，配合 `baseUrl`（13001）、`apiKey`、`modelName`。
  若直接用命令行：`iflow -p "<prompt>" --model <model> -y`。

### 5.5 codebuddy：必须显式指定有效模型
- **现象**：`codebuddy -p` 默认请求 `hy3`，若模型未启用报 403 或 `Please use --model`。
- **解决**：本机已切换 codebuddy 预置默认模型为 **hy3**（可用）。所有灵智体绑定前先
  `cd /tmp && codebuddy -p "reply with exactly: PONG"` 确认 `PONG`。

### 5.6 opencode：未知模型 id
- **现象**：`opencode run -m deepseek-v4-flash-free` 报 `UnknownError`。
- **根因**：YAML 中 `model` 名与 opencode 内置模型 id 不一致。
- **解决**：opencode 使用内置 `build` 默认模型 → cli_provider 的 opencode preset
  `model_flag=[]`（不传 `-m`），避免把错误模型名传给 CLI。

### 5.7 qodercli：必须真实账号登录
- **现象**：`qodercli -p` / `--list-models` 报 `Not logged in. Run qodercli login`；无
  干净的 base_url 覆写、无登录免费的默认模型。
- **解决**：需 `qodercli login`（浏览器 OAuth）后才有可用模型；因此**未绑定到任何灵智体**。
  （CLI 是托管云服务，无法路由到 OpenRouter/OpenRoute。）

### 5.8 网络受限：Linux 下无法直连海外 API
- google.com / api.openai.com / generativelanguage.googleapis.com 不可达；openai/tencent
  部分域名不可达；qoder 域名返回 503 → 全部选项收敛为「本地 OpenRoute 网关」转发方案。

---

## 6. 架构接入点（代码位置）

- `flowforge/llm/cli_provider.py`
  - `CLIProviderConfig`：`provider/binary/cli_args/model_flag/model_after_prompt/trailer_args/env`
  - `PRESET_CONFIGS`：7 个 provider 预置（claude_code/codex/gemini/opencode/codebuddy/qodercli/iflow）
  - `CLILLMProvider.chat()`：子进程调用，合并 `os.environ` 与 `config.env`
- `flowforge/forgemind/base.py`：按 `llm.provider` 分发；CLI 路径传 `model=llm_cfg.model`
- `flowforge/forgemind/forgekins/roster.py`：`BUILTIN_FORGEKINS`（9 只）+ `ROSTER_FILES`
- `flowforge/app/api/agents/external_agents.py`：`_EXTERNAL_AGENTS` 连通性列表（8 项 CLI/IDE）
- `flowforge/forgemind/[gemini|anthropic|responses]_to_openroute_proxy.py`：协议转换代理

---

## 7. 常见运维

```bash
bash scripts/start_proxies.sh          # 重启协议代理（幂等）
pgrep -f "ccr start"; tail logs/ccr.log  # claude-code-router 状态/日志
curl -s 127.0.0.1:3456/health          # ccr 健康（degraded 仅因内置 codewhisperer 无关）
curl -s 127.0.0.1:8000/health          # flowforge 后端健康
```
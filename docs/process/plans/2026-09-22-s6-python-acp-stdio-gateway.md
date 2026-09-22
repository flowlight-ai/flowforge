# 2026-09-22 S6 python/sdk Python ACP/stdio 网关

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §3（S6）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 3 项（S6 行）
> 批准计划：`.trae/documents/s6-python-acp-stdio-gateway.md`

## 1. 决策落点

- **S6-0 方向裁决**（operator 指令"推进 S6，搭建 Python ACP/stdio 网关"）：S6 = **Python 客户端库（对 flowforge SDK stdio JSON-RPC 协议）**，非通用 HTTP 网关。映射 B21/A13 之后的对外接入面缺口（旧 `python/legacy/sdk.py` 是对外 SDK，`code-runtime-python` 是内嵌执行，二者方向相反）。
- **协议唯一事实来源** = `@flowforge/sdk-protocol`：spawn runtime 子进程，newline-delimited JSON-RPC 2.0 over stdio（stdout 仅协议帧）。请求 `initialize{cwd,provider,model,maxTokens?}`/`session/prompt{sessionId,contentBlocks}`/`shutdown`；通知 `session.event`/`session.status`/`subagent.started`/`subagent.finished`。
- **参照物** = TS `@flowforge/sdk-client`（docstring 明言 Python 设计孪生 `python/sdk`），Python 实现精确镜像其协议与行为。
- 交付顺序：**先做 sdk-jsonrpc（`--profile sdk`）**；真 ACP 规范（`--profile acp`）列为 S6-2 后续可选项（operator 准入）。

## 2. 交付物（`python/sdk`，纯标准库 + asyncio、零第三方、py≥3.9、各文件 <1000 行）

| 文件 | 行数 | 内容 |
|---|---|---|
| `protocol.py` | 205 | 线契约 dataclass + `flowforge-sdk-runtime` 身份 + 校验 + `isRecord` |
| `errors.py` | 56 | `SdkError`/`TransportClosedError`/`RequestTimeoutError`/`SdkProtocolError`/`JsonRpcResponseError` |
| `transport.py` | 195 | `JsonRpcLineTransport`：asyncio 逐行 JSON-RPC、`id` 关联 Future、超时 abandonment、通知回调 fan-out |
| `dispose.py` | 90 | shutdown→stdin EOF→SIGTERM→SIGKILL 异步阶梯（EOF 6s/term 3s/shutdown 1s） |
| `client.py` | 354 | `HarnessClient`：惰性 spawn `create_subprocess_exec`、initialize/prompt + 线校验、stderr tail 400、subscribe(filter)/subscribe_session_tree（血缘 session_parents + is_descendant_of 闭环防御）、close 幂等 |
| `api.py` | 247 | `FlowForgeHarness` async manager（lazy start 失败 reap+重建）、`HarnessSession.run()` 整轮 idle（prompt→inbox receipt `agent/inbox/spliced`→采集事件→`session.status=='idle'` → `HarnessRunResult{final_response}`）、normalize_input/final_response/validated_session_event |
| `__init__.py` | 42 | 导出 FlowForgeHarness/HarnessClient/HarnessSession + errors |
| `tests/`（fake_runtime 214 + 4 测试文件） | 424 | 可执行 stdio fake runtime；transport/client/api/dispose **28 用例全绿** |

**关键实现取舍**：Spawn 用 `asyncio.create_subprocess_exec`（标准库）；Windows 上不依赖 `connect_read_pipe`（子进程 stdin 不可靠），改用 worker 线程 readline；异常类型/名称与 TS 一一对齐，无功能语义偏离。

## 3. 验证

- `python -m unittest discover -s python/sdk/tests` → **28 tests OK**，退出码 0。
- 所有 import 均为标准库（asyncio/subprocess/json/dataclasses/typing 等），无第三方。
- 端到端真实 `flowforge --profile sdk` 冒烟待 host 接线（宿主批次）。

## 4. 门禁与登记

- 三门禁对齐：Python 侧 28 用例全绿；文档登记 4 处（review_code §13.5 / task.md / 36-stage §3.2+§5+R2 / 本过程记录）。
- PR：随 mgr 提交（累计更新 S6 相关 PR）。
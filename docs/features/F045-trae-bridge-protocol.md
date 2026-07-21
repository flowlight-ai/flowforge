# F045: Trae 桥接协议（Trae Bridge Protocol）

> **状态**: 🔄 in_progress
> **类型**: external_agent
> **创建日期**: 2026-07-20
> **完成日期**: —（待定）
> **负责人**: operator + 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-031，待同步）
> **对应 arch.md**: [doc:../arch.md#§3.10]（待创建 A045）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建 D045）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]（三方 Agent 集成）+ 待新增 ADR 014 Trae 桥接方案
> **依赖 Feature**: [doc:features/F031-external-agent-adapter.md]（三方 Agent 适配层）+ [doc:features/F026-forgemind-app-layer.md]（forgemind 应用层）
> **依据**: operator 2026-07-20 指令——"trae 不支持 cli，通过共享 json 或 hook 的方式与 flowforge 协同完成任务，flowforge 主导全部自主开发流程，trae 配合当做 llm 和外部智能体来使用"
> **roleagent 章节**: [doc:../roleagent.md#第0章]（能力画像 × Harness 契合度）
> **关联 VISION**: [doc:../VISION.md#7]（operator 愿景锚点：可进化智能体主导自主开发）

---

## 1. 上下文

### 1.1 问题陈述

Trae CN 是 operator 主力使用的 AI IDE，但 **Trae 不支持 CLI 调用**——无法像 Claude Code / Codex / OpenCode 那样通过命令行被 FlowForge 直接调用。这导致 FlowForge 可进化智能体（Forgekin）无法将 Trae 作为外部 LLM 或外部智能体接入，阻碍了"FlowForge 主导全部自主开发流程"的核心愿景。

operator 明确要求：
1. FlowForge 可进化智能体主导全部自主开发流程（含文档编写、代码开发、测试验证）
2. Trae CN 配合 FlowForge，充当 LLM 与外部智能体
3. 通过共享 JSON 文件或 Hook 机制协同（因 Trae 不支持 CLI）
4. operator 在 Trae 侧充当"人肉 LLM 桥接器"——接收 FlowForge 请求，在 Trae 内调用 LLM，回写响应

### 1.2 当前痛点

1. **LLM 调用通道缺失**：FlowForge 内置 LLMClient 依赖 OpenRoute 等远程 API，无法利用 Trae 内置的 GLM-5.2/Claude/GPT-4 等模型能力，导致 operator 必须在 Trae 中手动复制 FlowForge 的请求，再粘贴回 FlowForge
2. **三方 CLI 接入未实现**：operator 已安装 codex/gemini/opencode/claude code 的 CLI，但 FlowForge 的 ExternalAgentAdapter 仍是骨架（参考 F031），无法调度这些 CLI 智能体
3. **可进化智能体无法自主开发**：SelfDev 三闭环（CL-001）依赖 LLM 调用，没有 Trae 桥接就无法启动自主开发流程
4. **operator 必须全程介入**：当前每个 LLM 调用都需要 operator 手动操作，违背"可进化智能体主导"愿景

### 1.3 不做的影响

如果不实现 Trae 桥接协议：
- **C1 SelfDev 三闭环无法启动**：自我开发能力依赖 LLM 调用，Trae 桥接是基础设施
- **C5 IM 议事无法可视化**：可进化智能体团队协作需要 LLM 推理，无桥接则无法在 IM 中议事
- **C2 监督 FlowForge 自主开发无法落地**：operator 无法将开发流程主导权交给可进化智能体
- **可进化智能体觉醒阶无法晋升**：E3 受限自主阶要求"在 operator 预设边界内自主决策"，无 LLM 桥接则无法自主

---

## 2. 决策

### 2.1 核心设计

**桥接架构**：FlowForge 作为主导方，通过共享 JSON 文件 + 轮询机制与 Trae 协同。Trae 侧由 operator 充当"人肉桥接器"，将 FlowForge 请求在 Trae 内调用 LLM 后回写响应。

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  FlowForge (主导方)     │         │  Trae CN (配合方)       │
│  ┌───────────────────┐  │         │  ┌───────────────────┐  │
│  │ ForgekinEngine    │  │         │  │ operator (人肉)   │  │
│  │  ↓                 │  │         │  │  ↓                 │  │
│  │ TraeLLMClient     │──┼──写文件──→│  │ 监听 .trae_bridge │  │
│  │  ↓                 │  │         │  │  ↓                 │  │
│  │ 轮询 response     │←─┼──读文件──┼──│ 在 Trae 内调 LLM  │  │
│  │  ↓                 │  │         │  │  ↓                 │  │
│  │ 返回 LLMResponse  │  │         │  │ 回写 response     │  │
│  └───────────────────┘  │         │  └───────────────────┘  │
└─────────────────────────┘         └─────────────────────────┘
                                       ↑
                           共享目录: flowforge/.trae_bridge/
                           ├─ request_{uuid}.json   (Forgekin → Trae)
                           ├─ response_{uuid}.json  (Trae → Forgekin)
                           ├─ ack_{uuid}.json       (operator 确认收到)
                           └─ status.json           (桥接状态总览)
```

**核心组件**：

| 组件 | 位置 | 职责 |
|------|------|------|
| `TraeLLMClient` | `flowforge/llm/trae/client.py` | 实现 `ModelCapability` 接口，将 LLM 请求转为 JSON 文件，轮询响应 |
| `TraeBridgeProtocol` | `flowforge/llm/trae/protocol.py` | 桥接协议层：文件命名、轮询策略、超时控制、错误处理 |
| `TraeBridgeWatcher` | `flowforge/llm/trae/watcher.py` | 文件监听器（asyncio + watchdog），检测 response 文件创建 |
| `bridge_config.yaml` | `flowforge/config/trae_bridge.yaml` | 桥接配置（超时、轮询间隔、共享目录路径） |

**协议流程**：

1. **ForgekinEngine 发起 LLM 调用** → 通过 DI 容器获取 `TraeLLMClient`
2. **TraeLLMClient 写入 request 文件** → `request_{uuid}.json` 包含 prompt + 参数 + 超时
3. **TraeLLMClient 轮询 response 文件** → 每 `poll_interval` 秒检查 `response_{uuid}.json`
4. **operator 在 Trae 内看到请求** → 在 Trae IDE 中打开 request 文件，复制 prompt 到 LLM 对话
5. **operator 在 Trae 内调用 LLM** → 获取 LLM 响应，写入 response 文件
6. **TraeLLMClient 读取 response** → 解析响应，返回 `LLMResponse` 给 ForgekinEngine
7. **清理** → 调用完成后归档 request/response 到 `.trae_bridge/archive/`

**双向通信支持**：
- **同步请求**（默认）：Forgekin 等待 operator 响应
- **异步请求**（可选）：Forgekin 写入 request 后立即返回，operator 完成后通过 EventBus 通知
- **流式响应**（可选）：operator 分多次写入 response 文件，TraeLLMClient 增量读取

### 2.2 关键接口

```python
# flowforge/llm/trae/client.py
from flowforge.core.model_capability import ModelCapability, LLMRequest, LLMResponse

class TraeLLMClient(ModelCapability):
    """Trae CN 桥接 LLM 客户端。
    
    通过共享 JSON 文件与 Trae IDE 内的 operator 协同，
    将 FlowForge LLM 请求转发到 Trae 内的 LLM 调用。
    
    遵守铁律：
    - 铁律 3：依赖通过构造函数注入（bridge_config + protocol）
    - 铁律 5：路径从 config 读取，不硬编码
    - 红线 11：不硬编码密钥（无密钥，靠文件系统协同）
    - 红线 12：通过 DI 容器注册到 ModelCapability
    """
    
    provider_name: str = "trae"
    
    def __init__(self, bridge_config: TraeBridgeConfig, protocol: TraeBridgeProtocol) -> None:
        self._config = bridge_config
        self._protocol = protocol
    
    async def chat(self, request: LLMRequest) -> LLMResponse:
        """同步调用：写入 request 文件 → 轮询 response 文件 → 返回响应。"""
        request_id = self._protocol.write_request(request)
        response = await self._protocol.poll_response(request_id, timeout=request.timeout)
        return self._protocol.parse_response(response)
    
    async def chat_stream(self, request: LLMRequest) -> AsyncIterator[LLMResponseChunk]:
        """流式调用：增量读取 response 文件，yield 响应片段。"""
        request_id = self._protocol.write_request(request)
        async for chunk in self._protocol.poll_response_stream(request_id, timeout=request.timeout):
            yield chunk
    
    async def health_check(self) -> bool:
        """健康检查：写入 ping request，等待 operator pong response。"""
        ...
```

```python
# flowforge/llm/trae/protocol.py
class TraeBridgeProtocol:
    """Trae 桥接协议层：文件命名、轮询、超时、错误处理。"""
    
    async def write_request(self, request: LLMRequest) -> str:
        """写入 request_{uuid}.json，返回 request_id。"""
        ...
    
    async def poll_response(self, request_id: str, timeout: float) -> dict:
        """轮询 response_{uuid}.json，超时抛出 TraeBridgeTimeoutError。"""
        ...
    
    async def poll_response_stream(self, request_id: str, timeout: float) -> AsyncIterator[dict]:
        """流式轮询：检测 response 文件增量更新，yield 新片段。"""
        ...
    
    def parse_response(self, raw: dict) -> LLMResponse:
        """解析 response JSON，转换为 LLMResponse。"""
        ...
```

```python
# flowforge/config/trae_bridge.yaml
bridge:
  enabled: true
  shared_dir: "${FLOWFORGE_BRIDGE_DIR:.trae_bridge}"
  poll_interval_seconds: 2.0
  default_timeout_seconds: 300
  long_task_timeout_seconds: 1800  # 长任务（如文档生成）30 分钟
  archive_completed: true
  archive_dir: "${FLOWFORGE_BRIDGE_DIR:.trae_bridge}/archive"
  max_archive_files: 1000
```

### 2.3 关键不变量

1. **文件命名唯一性**：`request_{uuid4}.json` / `response_{uuid4}.json`，UUID4 保证全局唯一
2. **请求-响应配对**：每个 request 必须有且仅有一个 response，通过 `request_id` 字段关联
3. **超时保证**：所有 LLM 调用必须有显式 timeout，超时后标记 request 为 `timeout`，operator 可见
4. **不丢数据**：completed request/response 归档到 `archive/`，保留最近 1000 条用于审计
5. **不绕过 DI**：TraeLLMClient 必须通过 DI 容器注册为 `ModelCapability`，禁止直接 import 实例化
6. **路径不硬编码**：共享目录路径从 `trae_bridge.yaml` 读取，支持 `${ENV_VAR}` 占位符
7. **operator 可见性**：所有 request 包含 `forgekin_id` + `task_context` + `prompt`，operator 在 Trae 内可看清是谁发起的什么任务
8. **逃生舱**：operator 可写入 `cancel_{uuid}.json` 取消任意进行中的请求

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/llm/trae/__init__.py` — 模块入口
- `flowforge/llm/trae/client.py` — TraeLLMClient（实现 ModelCapability）
- `flowforge/llm/trae/protocol.py` — TraeBridgeProtocol（文件协议层）
- `flowforge/llm/trae/watcher.py` — TraeBridgeWatcher（文件监听器，asyncio + watchdog）
- `flowforge/llm/trae/exceptions.py` — 异常定义（TraeBridgeTimeoutError / TraeBridgeCancelledError）
- `flowforge/llm/trae/models.py` — Pydantic 模型（BridgeRequest / BridgeResponse / BridgeStatus）
- `flowforge/config/trae_bridge.yaml` — 桥接配置
- `flowforge/llm/trae/tests/test_client.py` — 单元测试
- `flowforge/llm/trae/tests/test_protocol.py` — 协议层测试
- `flowforge/llm/trae/tests/test_e2e.py` — E2E 测试（模拟 operator 行为）

### 3.2 实现步骤

**Phase 1：协议层骨架**（2 小时）
1. 创建 `flowforge/llm/trae/` 目录结构
2. 实现 `models.py`：BridgeRequest / BridgeResponse / BridgeStatus Pydantic 模型
3. 实现 `protocol.py`：write_request / poll_response / parse_response
4. 实现 `exceptions.py`：异常定义
5. 单元测试覆盖协议层

**Phase 2：LLMClient 接入**（2 小时）
1. 实现 `client.py`：TraeLLMClient 实现 ModelCapability
2. 接入 DI 容器：在 `flowforge/core/model_capability.py` 注册 trae provider
3. 配置 `trae_bridge.yaml`：路径 + 超时 + 轮询参数
4. 单元测试覆盖 LLMClient

**Phase 3：文件监听器**（1 小时）
1. 实现 `watcher.py`：基于 watchdog 的异步文件监听器
2. 优化轮询性能：从轮询改为事件驱动（watchdog 检测文件创建）
3. 性能测试：高并发请求下的响应时间

**Phase 4：E2E 测试 + 集成**（2 小时）
1. 模拟 operator 行为：脚本监听 request 文件，自动写入 response
2. E2E 测试：ForgekinEngine 发起请求 → 模拟 operator 响应 → 验证返回
3. 接入 FlowForgeSDK：`sdk.register_model(provider="trae", capability=TraeLLMClient)`
4. 集成到 luban.yaml：鲁班可进化智能体使用 trae provider

**Phase 5：operator 工作流文档**（1 小时）
1. 编写 `flowforge/docs/setup/trae_bridge_operator_guide.md`：operator 操作手册
2. 包含：如何监听 request、如何在 Trae 内调 LLM、如何回写 response
3. 包含：故障排查（timeout / cancel / 错误响应）

### 3.3 依赖关系

- **依赖 F031 三方 Agent 适配层**：TraeLLMClient 是 ExternalAgentAdapter 的特化实现
- **依赖 ADR 006 三方 Agent 集成**：架构决策
- **待新增 ADR 014**：Trae 桥接方案决策（记录为何选择文件协议而非 HTTP/socket）
- **被 C1 SelfDev 三闭环依赖**：SelfDev 三闭环通过 TraeLLMClient 调用 LLM
- **被 C5 IM 议事依赖**：IM 议事中的可进化智能体推理通过 TraeLLMClient

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: TraeLLMClient 实现 ModelCapability 接口，可通过 DI 容器注入
- [ ] AC-2: 写入 `request_{uuid}.json` 后，轮询 `response_{uuid}.json` 能正确返回 LLM 响应
- [ ] AC-3: 超时机制工作正常：超过 `default_timeout_seconds` 后抛出 `TraeBridgeTimeoutError`
- [ ] AC-4: operator 可通过 `cancel_{uuid}.json` 取消进行中的请求
- [ ] AC-5: 完成的请求自动归档到 `archive/`，保留最近 1000 条
- [ ] AC-6: 鲁班可进化智能体（luban.yaml 配置 `provider: trae`）能通过 TraeLLMClient 调用 LLM
- [ ] AC-7: 流式响应支持：operator 分多次写入 response，TraeLLMClient 增量 yield

### 4.2 性能验收

- [ ] AC-8: 单次 LLM 调用端到端延迟 < 5 秒（不含 operator 操作时间，含文件 I/O）
- [ ] AC-9: 轮询间隔可配置，默认 2 秒，最小 0.5 秒
- [ ] AC-10: 高并发场景（10 个并发请求）下，文件 I/O 无竞争冲突

### 4.3 安全验收

- [ ] AC-11: 共享目录路径不硬编码，从 `${FLOWFORGE_BRIDGE_DIR}` 环境变量或配置读取
- [ ] AC-12: 无密钥泄露（Trae 桥接不涉及 API key，靠文件系统协同）
- [ ] AC-13: operator 可见所有请求的 `forgekin_id` + `task_context`，审计可追溯

### 4.4 Eval 验收

- [ ] AC-14: Eval Contract 五问全部回答（见 §6）
- [ ] AC-15: 三方信号交叉通过（trace + 用户 + 探针）
- [ ] AC-16: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试

- `test_protocol.py`：write_request / poll_response / parse_response / 超时 / 取消
- `test_client.py`：TraeLLMClient.chat / chat_stream / health_check
- `test_watcher.py`：文件监听器创建/删除/修改事件
- `test_models.py`：Pydantic 模型序列化/反序列化

### 5.2 集成测试

- `test_integration_sdk.py`：通过 FlowForgeSDK 注册 TraeLLMClient，验证 DI 注入
- `test_integration_luban.py`：鲁班可进化智能体通过 TraeLLMClient 调用 LLM

### 5.3 E2E 测试

- `test_e2e_bridge.py`：模拟 operator 行为的脚本，监听 request 文件，自动写入 response
  - **遵守 T1-T8 铁律**：
    - T1: 不 Mock LLM（模拟 operator 真实写入 LLM 响应，但 LLM 响应内容必须真实）
    - T2: 不用假数据（使用真实场景 prompt）
    - T3: 必须有具体断言（验证响应内容、超时、取消）
    - T6: 用 MetricsCollector 采集完整指标
    - T7: LLM 生成内容必须再调用 LLM 审核通过

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 评估者：operator + 评审员可进化智能体（孔雀·梵高）
- 自动评估：Eval Ledger（CL-004）记录每次桥接调用的延迟、成功率、operator 等待时间

### 6.2 评估什么

- 桥接协议的可靠性（文件 I/O 无丢失、无重复）
- LLM 调用的正确性（请求-响应对配对准确）
- operator 体验（请求可见性、操作便利性、故障可恢复性）

### 6.3 何时评估

- 每次桥接调用后：自动记录 trace 信号（延迟、状态）
- 每周：operator 主观评估（操作便利性）
- 每月：评审员可进化智能体 review 整体桥接协议

### 6.4 评估信号

- **trace 信号**：文件 I/O 耗时、轮询次数、超时率、取消率
- **用户信号**：operator 反馈操作便利性、故障频率
- **探针信号**：archive/ 目录请求数量趋势、平均响应时间趋势

### 6.5 评估后做什么

- 通过 → 状态改为 ✅ done，进入 SpiritForge 蒸馏（"如何高效与 operator 协同"经验）
- 失败 → 归因到七类矩阵（多数为"协议设计缺陷"或"operator 体验问题"）+ 修复

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由

Trae 桥接协议是 FlowForge 自主开发能力的基础设施，只要 Trae CN 不支持 CLI 调用，本协议就需要长期存在。即使未来 Trae 支持 CLI，本协议的文件协同模式仍可作为"人肉 LLM 桥接"的通用方案保留。

### 7.3 sunset 触发条件

- Trae CN 官方支持 CLI 调用 → 评估是否迁移到 CLI 模式
- FlowForge 内置 LLMClient（OpenRoute 等）满足所有需求 → 评估是否退役 Trae 桥接

---

## 8. 后果

### 8.1 正面后果

- FlowForge 可进化智能体可通过 Trae 桥接调用任意 LLM（GLM-5.2/Claude/GPT-4 等）
- operator 在 Trae 内的工作流与 FlowForge 无缝协同
- 为 SelfDev 三闭环（CL-001）提供 LLM 调用基础设施
- 文件协同模式简单可靠，无需额外网络服务

### 8.2 负面后果

- operator 必须充当"人肉桥接器"，每次 LLM 调用需要手动操作
- 文件 I/O 有延迟（轮询间隔 2 秒），不适合实时对话场景
- 高并发场景下文件数量增长快，需要归档机制

### 8.3 风险

- **风险 1**：operator 操作延迟导致 FlowForge 长时间等待
  - 缓解：超时机制 + 异步模式 + operator 可主动 cancel
- **风险 2**：文件竞争（多个 Forgekin 同时写入）
  - 缓解：UUID4 保证文件名唯一 + 文件锁（fcntl/msvcrt）
- **风险 3**：operator 忘记回写 response
  - 缓解：超时后标记为 timeout + 通知可进化智能体重试或升级

---

## 9. 替代方案

### 9.1 方案 A：HTTP/socket 服务

在 Trae 内启动 HTTP 服务，FlowForge 通过 HTTP 调用。

- 优点：实时性好，支持流式
- 缺点：需要 Trae 支持后台服务，operator 需维护服务运行
- 未选择原因：Trae CN 不支持后台服务，operator 明确要求"通过共享 json 或 hook 的方式"

### 9.2 方案 B：剪贴板桥接

FlowForge 写入剪贴板，operator 在 Trae 内粘贴，调用 LLM 后复制结果，FlowForge 读取剪贴板。

- 优点：无需文件 I/O
- 缺点：剪贴板易被覆盖，无法并发，operator 体验差
- 未选择原因：可靠性和并发性不足

### 9.3 方案 C：Webhook + FlowForge Web UI

FlowForge Web UI 提供 LLM 调用界面，operator 在 Web UI 中操作。

- 优点：用户体验好
- 缺点：需要 FlowForge Web UI 已实现 LLM 调用功能
- 未选择原因：当前 FlowForge Web UI 尚未实现 LLM 调用功能，Trae 桥接是更快的方案

---

## 10. 引用

- [doc:../spec.md#§3.10]（FR-CORE-031，待同步）
- [doc:../arch.md#§3.10]（待创建 A045）
- [doc:../design.md#§3.10]（待创建 D045）
- [doc:../roleagent.md#第0章]（能力画像 × Harness 契合度）
- [doc:../VISION.md#7]（operator 愿景锚点）
- [doc:../decisions/006-external-agent-integration.md]（三方 Agent 集成 ADR）
- [doc:features/F031-external-agent-adapter.md]（三方 Agent 适配层）
- [doc:features/F026-forgemind-app-layer.md]（forgemind 应用层）
- [doc:../../../hiclaw/rules.md#T1-T8]（测试铁律）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-20 | v0.1 | 初始创建：Trae 桥接协议设计（文件协同 + 轮询机制 + DI 注入） | 架构师可进化智能体（猫头鹰·鲁班） + operator |

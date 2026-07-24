# F047: IM 议事通道（IM Council Channel）

> **状态**: 🔄 in_progress
> **类型**: collaboration
> **创建日期**: 2026-07-21
> **完成日期**: —（待定）
> **负责人**: operator + 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-031，待同步）
> **对应 arch.md**: [doc:../arch.md#§3.10]（待创建 A047）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建 D047）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]（三方 Agent 集成）
> **依赖 Feature**: [doc:features/F045-trae-bridge-protocol.md]（Trae 桥接协议 — 文件协议通道复用）+ [doc:features/F046-selfdev-triple-loop.md]（SelfDev 三闭环 — I8 approval 调用方）
> **依据**: P2-018 Approval Hub（CL-033）已交付 `flowforge/core/approval_hub.py`，本 Feature 为其上层应用；task.md C5 定义为"web 版群 + 三方 CLI 接入"
> **roleagent 章节**: [doc:../roleagent.md#第0章]（能力画像 × Harness 契合度）
> **关联 VISION**: [doc:../VISION.md#7]（可进化智能体主导自主开发 — operator 审批通道）
> **关联 CL**: CL-033（Approval Hub 统一审批中心，P2-018）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 的 ApprovalHub（CL-033，`flowforge/core/approval_hub.py`）已经实现了跨 thread 的统一审批中心骨架——接收请求、operator 一键 approve/reject、超时自动拒绝、统计分布。但 ApprovalHub 仅是**数据模型 + 内存状态机**，没有定义"operator 在哪里、用什么方式收到审批请求、如何回复"——也就是**通道层**尚未实现。

task.md 将 IM 议事通道（C5）定义为"web 版群 + 三方 CLI 接入"，即 operator 必须能在两种以上通道中接收审批请求并作出决策：
- **CLI 终端通道**：operator 在 FlowForge 启动的终端会话中直接输入 `approve` / `reject`（适合本地开发、E2E 测试）
- **Web 版群通道**：operator 通过浏览器访问 FlowForge Web UI，在群聊式界面中查看请求并点击决策按钮（适合远程监督、移动端）
- **Trae IDE 桥接通道**：operator 在 Trae CN IDE 内通过 F045 文件协议接收审批请求并回写决策（适合 operator 主力 IDE 工作流）

进一步，spec.md §2.10 + F046 §10.3 要求 SelfDevFrameworkLoop 的 I8 approval_callback 必须通过 IM 通道推送给 operator 并等待回复——目前没有可用的 IM 通道实现，I8 不变量无法落地。

F047 的目标是补全**通道层**——基于 ApprovalHub 提供 3 个通道适配器 + 1 个统一管理器，让 operator 可以在任一通道接收审批请求、回复决策，并将完整议事流程归档到 MindCodex。

### 1.2 当前痛点

1. **ApprovalHub 无通道层**：`approval_hub.py` 仅提供 `submit / decide / approve / reject` 内存方法，operator 必须主动调用 API 才能决策，无法被动接收推送
2. **I8 approval_callback 无可用实现**：F046 §10.3.2 示例代码引用了 `im_channel.send_and_wait(...)`，但该通道对象不存在，SelfDevFrameworkLoop 无法落地
3. **CLI 通道缺失**：operator 本地开发场景下必须在另一个终端手动 POST `/approval/{id}/decide`，违背"可进化智能体主导"愿景
4. **Web 版群通道缺失**：operator 远程监督场景下无群聊式界面，无法在移动端审批
5. **Trae 桥接通道缺失**：operator 主力 IDE 是 Trae CN，但审批请求无法推送到 Trae，operator 必须切换窗口
6. **议事记录无归档**：当前 ApprovalHub 决策只在内存，无落盘归档，违背"议事不可篡改"治理要求

### 1.3 不做的影响

如果不实现 IM 议事通道：
- **F046 SelfDevFrameworkLoop 无法启动**：I8 approval_callback 缺少通道实现，所有 framework 级 Act 都会被 `ApprovalRequiredError` 阻断
- **operator 必须全程手动 API 调用**：违背"可进化智能体主导自主开发"愿景（VISION §7）
- **远程监督能力缺失**：operator 无法离开终端，移动端/远程办公场景不可用
- **议事记录无法审计**：决策无归档，事故归因（F020）无法回溯审批链路
- **MindCouncil（灵议）议事流程无法落地**：spec.md §2.10 要求的"发起→收集立场→综合→决策→归档"五步流程缺执行层

---

## 2. 决策

### 2.1 核心设计

**分层架构**：基于 ApprovalHub（CL-033，数据模型层）扩展出通道层与管理器层，形成三层结构：

```
┌─────────────────────────────────────────────────────────────────┐
│  调用方（F046 SelfDevFrameworkLoop / 其他灵智体）                │
│     ↓ 调用 IMCouncilManager.request_approval(...)               │
├─────────────────────────────────────────────────────────────────┤
│  管理器层（F047 新增）                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  IMCouncilManager                                       │   │
│  │  - register_channel(name, channel)                      │   │
│  │  - send_to_operator(message, channel_name="auto")       │   │
│  │  - request_approval(request, timeout) → bool            │   │
│  │  - 自动通道选择 / 降级 / 归档                            │   │
│  └────────────────────────┬────────────────────────────────┘   │
├───────────────────────────┼─────────────────────────────────────┤
│  通道层（F047 新增，3 个适配器）                                 │
│                           │                                     │
│  ┌─────────────────┐ ┌────▼──────────────┐ ┌────────────────┐  │
│  │ ConsoleChannel  │ │ WebChatChannel    │ │TraeBridgeChannel│ │
│  │ (CLI 终端)      │ │ (FastAPI WS)      │ │ (F045 文件协议) │  │
│  │                 │ │                   │ │                │  │
│  │ send: print     │ │ send: WS 推送     │ │ send: 写 JSON   │  │
│  │ wait: input()   │ │ wait: WS recv     │ │ wait: 轮询 JSON │  │
│  │ broadcast: n×   │ │ broadcast: 多 WS  │ │ broadcast: n×   │  │
│  └────────┬────────┘ └─────────┬─────────┘ └────────┬───────┘  │
├───────────┼────────────────────┼────────────────────┼──────────┤
│           ▼                    ▼                    ▼          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  数据模型层（已有 — CL-033 approval_hub.py）             │  │
│  │  ApprovalHub / ApprovalRequest / ApprovalDecision        │  │
│  └──────────────────────────────────────────────────────────┘  │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  归档层（F047 新增）                                     │  │
│  │  archive → data/im_council/archive/*.jsonl               │  │
│  │  → MindCodex（F039，Phase 3 集成）                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三通道职责划分

| 通道 | 实现文件 | 传输介质 | 适用场景 | 实现状态 |
|------|---------|---------|---------|:------:|
| **ConsoleChannel** | `im_council.py` | stdin/stdout | 本地开发、E2E 测试、CI | ✅ 完整实现 |
| **WebChatChannel** | `im_council.py` | FastAPI WebSocket | 远程监督、移动端、群聊式 UI | 🔄 骨架（Phase 2） |
| **TraeBridgeChannel** | `im_council.py` | F045 共享 JSON 文件 | operator 主力 IDE 工作流 | 🔄 骨架（Phase 1） |

### 2.3 MindCouncil（灵议）议事流程

每个审批请求触发一次完整的"灵议"五步流程（spec.md §2.10）：

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 发起（Initiate）                                       │
│  灵智体通过 IMCouncilManager.request_approval(...) 提交请求      │
│  → 生成 CouncilMessage(message_type="approval_request")         │
├─────────────────────────────────────────────────────────────────┤
│  Step 2: 收集立场（Collect Stance）                             │
│  Manager 通过选定通道推送 message 给 operator                    │
│  → operator 接收请求并阅读 payload（PR url / config diff）       │
├─────────────────────────────────────────────────────────────────┤
│  Step 3: 综合（Synthesize）                                     │
│  operator 思考并形成决策（approve / reject / defer）             │
│  → 通过同一通道回写 CouncilReply                                 │
├─────────────────────────────────────────────────────────────────┤
│  Step 4: 决策（Decide）                                         │
│  Manager 调用 ApprovalHub.decide(...) 落地决策                   │
│  → 决策写入 ApprovalHub 内存状态机                               │
├─────────────────────────────────────────────────────────────────┤
│  Step 5: 归档（Archive）                                        │
│  Manager 将 message + reply + decision 落盘 JSONL                │
│  → data/im_council/archive/{date}.jsonl                          │
│  → Phase 3 同步到 MindCodex（F039）                              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 关键接口

```python
# flowforge/core/im_council.py

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from flowforge.core.approval_hub import ApprovalHub, ApprovalRequest


class CouncilMessage(BaseModel):
    """议事消息 — Step 1/2 的载荷."""
    message_id: str
    channel: str  # "console" | "webchat" | "trae"
    forgekin_id: str  # 发起灵智体 ID
    content: str  # 消息内容
    message_type: str  # "approval_request" | "info" | "alert" | "council"
    payload: dict = Field(default_factory=dict)  # 附加数据（PR url / config diff）
    created_at: datetime


class CouncilReply(BaseModel):
    """议事回复 — Step 3 的载荷."""
    reply_id: str
    message_id: str  # 对应的 message_id
    replier: str  # "operator" / forgekin_id
    content: str  # "approve" / "reject" / 自然语言回复
    reply_type: str  # "decision" | "comment" | "question"
    decided_at: datetime


class IMCouncilChannel(ABC):
    """IM 议事通道抽象基类 — F047 §2.2."""

    channel_name: str  # 子类必须声明

    @abstractmethod
    async def send(self, message: CouncilMessage) -> str:
        """发送消息到通道，返回 message_id."""

    @abstractmethod
    async def wait_reply(self, message_id: str, timeout: float) -> Optional[CouncilReply]:
        """等待回复，超时返回 None."""

    @abstractmethod
    async def broadcast(self, message: CouncilMessage) -> list[str]:
        """广播给多个接收者，返回 message_id 列表."""


class ConsoleChannel(IMCouncilChannel):
    """CLI 终端通道 — operator 在终端输入 approve/reject."""
    channel_name = "console"


class WebChatChannel(IMCouncilChannel):
    """Web 版群通道 — 通过 FastAPI WebSocket 推送到 Web UI."""
    channel_name = "webchat"


class TraeBridgeChannel(IMCouncilChannel):
    """Trae IDE 桥接通道 — 通过 F045 文件协议推送到 Trae IDE."""
    channel_name = "trae"


class IMCouncilManager:
    """IM 议事管理器 — 统一管理多通道 + 集成 ApprovalHub."""

    def __init__(self, approval_hub: ApprovalHub, config: dict) -> None:
        self._approval_hub = approval_hub
        self._config = config
        self._channels: dict[str, IMCouncilChannel] = {}

    def register_channel(self, name: str, channel: IMCouncilChannel) -> None:
        """注册通道（DI 注入，红线 12）."""

    async def send_to_operator(
        self, message: CouncilMessage, channel_name: str = "auto"
    ) -> str:
        """发送消息给 operator（auto 时按优先级 console > trae > webchat 选择）."""

    async def request_approval(
        self, request: ApprovalRequest, timeout: float = 300
    ) -> bool:
        """发起审批请求 → 推送 → 等待回复 → 调用 ApprovalHub.decide → 归档.

        Returns:
            True = approved, False = rejected / timeout / 通道异常.
        """
```

### 2.5 关键不变量

| # | 不变量 | 说明 | 实现机制 |
|---|--------|------|---------|
| **I1** | 通道故障降级 | 当 `channel_name="auto"` 或指定通道不可用时，自动降级到下一个可用通道（console > trae > webchat），降级链路必须记录到归档日志 | `IMCouncilManager._select_channel` + `try/except` 链式降级 |
| **I2** | 议事不可篡改 | 一旦 CouncilReply 写入归档（JSONL append-only），任何后续修改必须以新行追加（含 `amend_of` 字段），禁止原地修改 | `archive` 函数以 `a` 模式追加写；`ApprovalHub.decide` 已决策的 request 拒绝重写 |
| **I3** | operator 决策必经 | 所有 `request_type in {code_merge, config_change, schedule_change, scope_expansion, external_call}` 的 ApprovalRequest 必须通过 `IMCouncilManager.request_approval` 流程，禁止灵智体直接调用 `ApprovalHub.approve` 自行决策 | `IMCouncilManager.request_approval` 为唯一公开入口；`ApprovalHub.approve/reject` 标记为 `# internal use only` 注释 |
| **I4** | 超时自动拒绝 | `request_approval(request, timeout)` 在 `timeout` 秒内未收到回复时，自动调用 `ApprovalHub.decide(decision="rejected", comments="timeout")` 并归档 | `asyncio.wait_for(channel.wait_reply(...), timeout)` + `TimeoutError` 捕获分支 |
| **I5** | 议事记录归档到 MindCodex | 每次完整议事流程（message + reply + decision）必须落盘到 `data/im_council/archive/{date}.jsonl`；Phase 3 起同步推送到 MindCodex（F039）作为可检索知识 | `_archive_record` 私有方法 + 配置 `archive.enabled` 开关；MindCodex 集成在 Phase 3 实现 |

### 2.6 通道选择算法（I1 降级链路）

```
send_to_operator(message, channel_name="auto")
   │
   ├─ channel_name != "auto" → 直接使用指定通道
   │     ├─ 通道存在且健康 → 使用
   │     └─ 通道不存在/抛异常 → 降级到 auto 流程
   │
   └─ channel_name == "auto" → 按优先级链路尝试
         │
         ▼
         for fallback_name in ["console", "trae", "webchat"]:
             channel = self._channels.get(fallback_name)
             if channel is None: continue
             try:
                 msg_id = await channel.send(message)
                 return msg_id
             except Exception as e:
                 logger.warning(f"channel {fallback_name} failed: {e}")
                 continue
         raise NoAvailableChannelError("所有通道不可用")
```

---

## 3. 实现计划

### 3.1 Phase 划分

#### Phase 1：Console 通道 + Manager 基础（本 Feature 交付）

1. 实现 `CouncilMessage / CouncilReply` Pydantic 模型
2. 实现 `IMCouncilChannel` 抽象基类（3 个抽象方法）
3. 实现 `ConsoleChannel` 完整版（stdin/stdout，可立即使用）
4. 实现 `TraeBridgeChannel` 骨架版（基于 F045 文件协议，TODO 标注完整实现）
5. 实现 `IMCouncilManager`：register_channel / send_to_operator / request_approval / _archive_record
6. 实现 I1-I5 五个不变量
7. 单元测试：test_im_council_console.py

#### Phase 2：WebChat 通道（下一个 Feature）

1. 实现 `WebChatChannel` 完整版：FastAPI WebSocket 推送 + 异步队列接收
2. 在 `flowforge/app/` 注册 `/ws/im` WebSocket 路由
3. Web UI 群聊式界面（参考 F026 forgemind 应用层）
4. 多 operator 同时在线支持（广播路由）
5. 集成测试：test_im_council_webchat.py（真实 WS 连接）

#### Phase 3：MindCodex 归档 + TraeBridge 完整版

1. 实现 `TraeBridgeChannel` 完整版：复用 F045 `TraeBridgeProtocol` 文件命名约定
2. 归档同步到 MindCodex（F039）：每次议事记录作为 `CouncilEpisode` 知识对象
3. MindCouncil 跨通道历史聚合检索（operator 可在任一通道查询历史决策）
4. E2E 测试：test_im_council_e2e.py（真实三通道切换 + 归档检索）

### 3.2 依赖关系

- **依赖 CL-033 ApprovalHub**：`IMCouncilManager` 通过构造函数注入 `ApprovalHub` 实例
- **依赖 F045 Trae 桥接协议**：`TraeBridgeChannel` 复用 `${FLOWFORGE_BRIDGE_DIR}` 配置与文件命名约定
- **被 F046 SelfDevFrameworkLoop 依赖**：I8 `approval_callback` 调用 `IMCouncilManager.request_approval`
- **被 F039 MindCodex 依赖（Phase 3）**：归档记录作为知识对象检索
- **被 F020 七类归因依赖**：审批失败时归因到"approval_missing / approval_timeout / operator_override"等子类

### 3.3 配置外置（铁律 5）

所有路径、超时、通道开关通过 `flowforge/config/im_council.yaml` 注入：

```yaml
im_council:
  enabled: true
  default_channel: "console"
  channels:
    console: { enabled: true, prompt_prefix: "[FlowForge]" }
    webchat: { enabled: false, websocket_url: "ws://localhost:8000/ws/im" }
    trae:    { enabled: true, bridge_dir: "${FLOWFORGE_BRIDGE_DIR}" }
  approval:
    timeout_seconds: 300
    auto_reject_on_timeout: true
  archive:
    enabled: true
    path: "data/im_council/archive"
```

环境变量 `${FLOWFORGE_BRIDGE_DIR}` 由 F045 已定义，本文件复用（红线 11 不硬编码路径）。

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: `ConsoleChannel.send` 能在终端打印审批请求并返回 `message_id`
- [ ] AC-2: `ConsoleChannel.wait_reply` 能阻塞等待 operator 输入 `approve` / `reject`，超时返回 `None`
- [ ] AC-3: `IMCouncilManager.request_approval` 完整执行五步灵议流程（发起→收集→综合→决策→归档）
- [ ] AC-4: I1 降级链路：当 `console` 通道抛异常时自动降级到 `trae`，降级事件记录到日志
- [ ] AC-5: I3 强制：`request_approval` 是审批的唯一公开入口，灵智体无法绕过
- [ ] AC-6: I4 超时自动拒绝：`timeout` 秒未回复时自动 `decide(rejected, "timeout")` 并归档
- [ ] AC-7: I5 归档：每次议事流程产生一行 JSONL，含 message + reply + decision 三段
- [ ] AC-8: `TraeBridgeChannel` / `WebChatChannel` 骨架不抛 `NotImplementedError`，调用时记录 TODO 日志并降级

### 4.2 安全验收

- [ ] AC-9: 所有依赖（ApprovalHub / 通道实例）通过构造函数注入（红线 12）
- [ ] AC-10: 所有路径 / 端口 / 超时通过 YAML 配置注入，禁止硬编码（红线 11）
- [ ] AC-11: 归档 JSONL 以 `a` 模式追加写，禁止覆盖（I2 不变量）

### 4.3 质量验收

- [ ] AC-12: Python 3.11+ 类型注解完整（`from __future__ import annotations` + `dict[str, ...]` 现代语法）
- [ ] AC-13: 所有 I/O 操作 `async/await`（`send / wait_reply / broadcast / request_approval / _archive_record`）
- [ ] AC-14: 中文 docstring 完整（模块 / 类 / 公开方法）
- [ ] AC-15: 代码语法通过 `python -c "import ast; ast.parse(open(...).read())"` 验证

### 4.4 Eval 验收

- [ ] AC-16: Eval Contract 五问全部回答（§6）
- [ ] AC-17: 三方信号交叉通过（trace + 用户 + 探针）
- [ ] AC-18: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试

- `test_im_council_models.py`：`CouncilMessage` / `CouncilReply` Pydantic 校验
- `test_im_council_console.py`：`ConsoleChannel` send / wait_reply / broadcast
- `test_im_council_manager.py`：`IMCouncilManager` register / send_to_operator / request_approval / 降级链路 / 归档
- `test_im_council_invariants.py`：I1-I5 不变量独立测试

### 5.2 集成测试

- `test_integration_approval_hub.py`：`IMCouncilManager` + `ApprovalHub` 端到端
- `test_integration_trae_bridge.py`：`TraeBridgeChannel` 复用 F045 文件协议（Phase 3）

### 5.3 E2E 测试

- `test_e2e_console_approval.py`：真实 operator 在终端输入 approve，验证 ApprovalHub 状态变更 + 归档 JSONL
- `test_e2e_webchat_approval.py`（Phase 2）：真实浏览器 WS 连接 + DOM 验证（T8 铁律）
- `test_e2e_trae_bridge_approval.py`（Phase 3）：真实 F045 文件协议 + operator 在 Trae 内回写

E2E 测试遵守 T1-T8 铁律：
- T1: 不 Mock LLM（本 Feature 不直接调用 LLM，但归档检索可调用 LLM 审核）
- T2: 真实场景数据（真实 ApprovalRequest payload）
- T3: 具体断言（验证 `ApprovalHub.list_all("approved")` 长度 + 归档文件行数）
- T6: MetricsCollector 采集指标（端到端延迟 / 通道降级次数 / 超时次数）
- T7: LLM 生成内容经 LLM 审核（本 Feature 不涉及，归档检索场景在 Phase 3 适用）
- T8: WebChat 通道 E2E 必须操控浏览器验证 DOM（Phase 2）

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- **评估者**：operator（主评估者，审批体验第一手）+ 评审员可进化智能体（梵高·vangogh，审查归档记录完整性）+ Eval Ledger 自动评估（延迟 / 超时率 / 降级率）
- **自动评估**：每次 `request_approval` 完成后自动记录 trace 信号到 Eval Ledger（F040）

### 6.2 评估什么

- 三通道的可用性（Console 完整 / TraeBridge 骨架 / WebChat 骨架）
- 五步灵议流程的完整性（发起→收集→综合→决策→归档，无断链）
- I1-I5 不变量的有效性（降级链路 / 不可篡改 / 强制入口 / 超时拒绝 / 归档完整）
- operator 体验（响应延迟、决策便利性、归档检索效率）

### 6.3 何时评估

- **每次 `request_approval` 完成后**：自动记录 trace 信号（延迟 / 通道 / 决策结果）
- **每周**：operator 主观评估（哪些通道最常用、哪些降级最频繁）
- **每月**：梵高 review 归档 JSONL 完整性 + MindCodex 检索复用度（Phase 3）

### 6.4 评估信号

- **trace 信号**：`request_approval` 延迟、通道选择分布、降级次数、超时次数、归档行数
- **用户信号**：operator 反馈通道易用性、决策便利性、归档检索需求
- **探针信号**：归档 JSONL 行数增长率、MindCodex 检索命中率（Phase 3）

### 6.5 评估后做什么

- 通过 → 状态改为 ✅ done，进入 KnowledgeEvolution 蒸馏为 `CouncilEpisodeCard`
- 失败 → 归因到七类矩阵：
  - `approval_missing`（I3 违反，灵智体绕过通道）
  - `approval_timeout`（I4 触发，operator 未及时响应）
  - `channel_degradation`（I1 触发，主通道故障）
  - `archive_corruption`（I2 违反，归档被篡改）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由

IM 议事通道是 FlowForge 治理体系的**永久基础设施**——只要 FlowForge 存在多灵智体协同 + operator 审批需求，就需要 IM 通道。即使未来 LLM 能力升级到完全自主，operator 仍需对 framework 级变更保留最终决策权（I8 不变量，F046 §10.3）。

具体而言：
- `IMCouncilChannel` 抽象基类 + 5 个不变量属于 Build to Persist（治理契约）
- `ConsoleChannel` 属于 Build to Persist（CLI 是最稳定的开发者工具）
- `WebChatChannel` 属于 Build to Persist（Web UI 是远程监督的标准形态）
- `TraeBridgeChannel` 属于混合：F045 文件协议本身是 Build to Persist，但具体 Trae IDE 集成方式可能随 Trae 升级而调整

### 7.3 sunset 触发条件

- FlowForge 退役 → 整体迁移到新框架
- LLM 能力达到完全自主（operator 无需审批）→ 评估是否简化为纯日志归档
- Trae CN 提供 CLI 调用能力 → `TraeBridgeChannel` 可简化为直接 SDK 调用

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-21 | 初版：基于 CL-033 ApprovalHub + F045 Trae 桥接协议已完成的设计，规划三通道 IM 议事 + 五步灵议流程 + I1-I5 不变量；Phase 1 交付 ConsoleChannel 完整版 + TraeBridgeChannel/WebChatChannel 骨架 |

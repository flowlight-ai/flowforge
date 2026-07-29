---
feature_ids: [F009]
related_features: [F002, F008, F010, F011, F012, F013]
topics: [harness, tool-mediation, allowlist, tool-registry, authorization]
doc_kind: spec
created: 2026-07-21
---

# F009: 工具中介（Tool Mediation）

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/007-harness-engineering.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 3 章 Harness 七层（Layer 2）
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第3章]` 指出：能力半径变大后，边界必须显式化。模型一旦能调用工具（写文件、发请求、调外部 API），就必须有结构性机制约束"谁可以调什么"——只靠在 prompt 里写"请不要调用某工具"是不可靠的，因为 prompt 会被压缩、被忽略、被 prompt injection 绕过。

FlowForge 需要一个**工具中介层**：所有工具调用必须经过 `ToolMediator.invoke()`，调用前先校验 `caller in allowlist`，未授权调用同步抛 `ToolAllowlistViolation`。这是项目规则"工具调用必须通过 `ToolRegistry.execute()`"的结构性 enforcement。

### 1.2 当前痛点

- *Forge 项目中 Agent 直接 `import` 工具函数，绕过 ToolRegistry（违反铁律"工具调用必须通过 ToolRegistry.execute()"）
- 工具权限靠 prompt 约束，被压缩后失效
- 工具 handler 抛异常时，调用方不知道是权限拒绝还是 handler 执行失败
- sync/async handler 混用，调用方需手动判断 `iscoroutine`

### 1.3 不做的影响

- Forgekin可调用任意工具（包括越权），不可逆操作无外部边界
- prompt injection 可诱导Forgekin调用危险工具
- 工具调用审计缺失，事故无法追查
- operator 原则第 6 条（支持自己开发自己）无法达成——Forgekin开发Forgekin需要工具边界

## 2. 决策

### 2.1 核心设计

- `ToolResult`：调用结果数据类，含 `success` / `output` / `error` / `duration_ms`
- `ToolMediator.register_tool(name, handler, allowlist)`：注册工具时绑定允许调用者名单（`list[str]`）
- `ToolMediator.invoke(tool_name, args, caller)`：异步入口，调用前先校验 `caller in allowlist`，否则抛 `ToolAllowlistViolation`
- **未授权调用同步抛异常**（`ToolAllowlistViolation`，在 handler 运行前）；**handler 失败被捕获为 `ToolResult(success=False)`**，让上层决策
- 自动检测 sync/async handler（`inspect.iscoroutinefunction`），统一 `await` 协议
- 与项目规则"工具调用必须通过 `ToolRegistry.execute()`"对齐：ToolMediator 是 ToolRegistry 的 harness 层 enforcement 实现

### 2.2 关键接口

```python
"""Tool Mediation — allowlist-enforced tool dispatch (roleagent.md Ch.7).

Layer 2 of the Harness seven-layer guardrail. Every tool invocation must
pass through ToolMediator so callers can be authorized against per-tool
allowlists. This is the structural enforcement of "tool calls must go
through ToolRegistry.execute()" (project rules).
"""

import inspect
import time
from dataclasses import dataclass
from typing import Any, Callable

from flowforge.core.errors import HarnessError, ToolAllowlistViolation

ToolHandler = Callable[..., Any]


@dataclass
class ToolResult:
    """Outcome of a mediated tool invocation."""

    success: bool
    output: Any
    error: str | None
    duration_ms: float


class ToolMediator:
    """Allowlist-enforced tool dispatcher.

    Handlers may be sync or async — ``invoke`` detects coroutine functions
    and awaits them. Allowlist violations raise ``ToolAllowlistViolation``
    synchronously (before the handler runs); handler failures are captured
    as ``ToolResult(success=False, ...)`` rather than raised, so the caller
    can decide how to react.
    """

    def __init__(self) -> None:
        self._tools: dict[str, tuple[ToolHandler, list[str]]] = {}

    def register_tool(
        self,
        name: str,
        handler: ToolHandler,
        allowlist: list[str],
    ) -> None:
        if not name:
            raise HarnessError("tool name must be non-empty")
        if name in self._tools:
            raise HarnessError(f"tool {name!r} already registered")
        self._tools[name] = (handler, list(allowlist))

    async def invoke(
        self,
        tool_name: str,
        args: dict[str, Any],
        caller: str,
    ) -> ToolResult:
        if tool_name not in self._tools:
            raise HarnessError(f"tool {tool_name!r} not registered")
        handler, allowlist = self._tools[tool_name]
        if caller not in allowlist:
            raise ToolAllowlistViolation(
                f"caller {caller!r} not in allowlist for tool {tool_name!r}"
            )
        start = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(handler):
                output = await handler(**args)
            else:
                output = handler(**args)
            duration_ms = (time.perf_counter() - start) * 1000.0
            return ToolResult(
                success=True,
                output=output,
                error=None,
                duration_ms=duration_ms,
            )
        except Exception as exc:  # noqa: BLE001
            duration_ms = (time.perf_counter() - start) * 1000.0
            return ToolResult(
                success=False,
                output=None,
                error=str(exc),
                duration_ms=duration_ms,
            )
```

## 3. 验收标准

### Phase A（中介原语 + allowlist 强制）

- [ ] AC-A1: `ToolResult` 数据类含 4 字段（`success` / `output` / `error` / `duration_ms`）
- [ ] AC-A2: `register_tool(name, handler, allowlist)` 注册工具，`name` 重复抛 `HarnessError`
- [ ] AC-A3: `invoke(tool_name, args, caller)` 异步入口，未注册工具抛 `HarnessError`
- [ ] AC-A4: `caller not in allowlist` 同步抛 `ToolAllowlistViolation`（在 handler 运行前）
- [ ] AC-A5: handler 失败被捕获为 `ToolResult(success=False, error=str(exc))`，不抛出
- [ ] AC-A6: 自动检测 sync/async handler（`inspect.iscoroutinefunction`），async handler 被 `await`
- [ ] AC-A7: `duration_ms` 用 `time.perf_counter()` 测量，单位毫秒

### Phase B（配置驱动 + E2E）

- [ ] AC-B1: allowlist 配置驱动（YAML），与项目规则"工具调用必须通过 ToolRegistry.execute()"对齐
- [ ] AC-B2: 调用日志含 `tool` / `caller` / `ok` / `duration_ms`，可用于审计
- [ ] AC-B3: invoke 延迟（不含 handler 执行）< 1ms
- [ ] AC-B4: E2E 测试 — Forgekin A 调用工具 X（在 allowlist）成功，Forgekin B 调用工具 X（不在 allowlist）抛 `ToolAllowlistViolation`
- [ ] AC-B5: E2E 测试 — handler 抛异常时返回 `ToolResult(success=False)`，上层Forgekin可决策重试或降级
- [ ] AC-B6: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F008（Durable State Surface，工具调用日志可持久化）
- **Related**: F002（TeamAct Action 步骤的工具调用经 ToolMediator）、F010（证据传感器，工具调用结果作为证据）、F011（治理边界，工具调用前 check_violation）、F012（魔法词，工具调用过程中检测逃生舱）、F013（熵控 + 可驾驭性评分，`tool_allowlist_strictness` 维度）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| allowlist 维护成本随工具数量上升 | 配置驱动注册（YAML），与 ToolRegistry 对齐 |
| handler 异常被吞（`success=False`），调用方可能误判 | `error` 字段保留 `str(exc)`，日志 WARNING 级别 |
| sync handler 阻塞事件循环 | P2 阶段引入 `run_in_executor` 包装 sync handler |
| allowlist 用 `list[str]` 线性查找 | Forgekin数量 < 100 时无性能问题；P2 可换 `set` |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | allowlist 是否支持通配符（如 `*` 表示所有Forgekin）？ | ⬜ 未定 |
| OQ-2 | 工具调用是否需要支持超时（`timeout` 参数）？ | ⬜ 未定 |
| OQ-3 | `ToolResult` 是否需要附带 `trace_id` 用于跨层追踪？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 未授权调用同步抛 `ToolAllowlistViolation` | 在 handler 运行前拦截，避免副作用 | 2026-07-21 |
| KD-2 | handler 失败被捕获为 `ToolResult(success=False)` | 让上层决策（重试/降级/升级），不强行中断 | 2026-07-21 |
| KD-3 | 自动检测 sync/async handler | 统一 `await` 协议，调用方无需关心 handler 类型 | 2026-07-21 |
| KD-4 | `duration_ms` 用 `time.perf_counter()` | 高精度计时，可用于性能审计 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Tool Mediation Feature 规格，对齐 ADR-007 Layer 2 与 `flowforge/core/harness/tool_mediation.py` P1 实现 |

## 9. Review Gate

- Phase A: 单元测试通过，allowlist 强制与 sync/async 检测由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，越权调用拦截率 100%

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/007-harness-engineering.md` | Harness 工程路径决策（七层） |
| **roleagent** | `docs/roleagent.md#第3章` | Harness 七层白皮书（Layer 2：改变现实） |
| **代码** | `flowforge/core/harness/tool_mediation.py` | ToolMediator P1 实现 |
| **代码** | `flowforge/core/errors.py` | `ToolAllowlistViolation` 异常定义 |
| **Feature** | `docs/features/F008-durable-state-surface.md` | Durable State Surface（调用日志持久化） |
| **规则** | `docs/project_rules.md#铁律` | 工具调用必须通过 ToolRegistry.execute() |

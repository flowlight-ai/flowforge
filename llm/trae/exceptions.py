"""Trae 桥接异常定义 — F045 §3.1 协议层骨架.

定义 Trae 桥接协议所有异常类型，独立模块便于复用与测试。
对应 F045 §2.3 不变量 3（超时保证）+ 不变量 8（逃生舱）。

异常层次：
    TraeBridgeError（基类）
    ├── TraeBridgeTimeoutError      — 超时（不变量 3）
    ├── TraeBridgeCancelledError    — operator 取消（不变量 8）
    ├── TraeBridgeProtocolError     — 协议层错误（文件格式/解析）
    ├── TraeBridgeIOError           — 文件 I/O 错误
    └── TraeBridgeConfigError       — 配置错误

向后兼容：保留旧异常别名（TraeLLMError / TraeLLMTimeoutError 等），
         现有代码无需改动。
"""

from __future__ import annotations

from typing import Optional


class TraeBridgeError(Exception):
    """Trae 桥接协议基础异常.

    所有 Trae 桥接相关异常的基类。
    保留 mode/task_id 字段向后兼容旧 TraeLLMError API。

    Attributes:
        request_id: 关联的请求 ID（UUID4），可用于排查归档文件
        mode: 桥接模式（bridge/cli/api），向后兼容
        task_id: 任务 ID，向后兼容（等于 request_id）
    """

    def __init__(
        self,
        message: str,
        *,
        request_id: str = "",
        mode: str = "",
        task_id: str = "",
    ) -> None:
        self.request_id = request_id or task_id
        self.mode = mode
        self.task_id = request_id or task_id
        super().__init__(message)


class TraeBridgeTimeoutError(TraeBridgeError):
    """桥接超时 — F045 §2.3 不变量 3.

    当 operator 在 timeout 秒内未回写 response 时抛出。
    超时后 request 文件标记为 timeout，operator 可见。
    """


class TraeBridgeCancelledError(TraeBridgeError):
    """operator 主动取消 — F045 §2.3 不变量 8（逃生舱）.

    当 operator 写入 cancel_{uuid}.json 时抛出。
    Forgekin 接收到此异常后应停止等待，可选重试或升级。
    """


class TraeBridgeProtocolError(TraeBridgeError):
    """协议层错误 — 文件格式/字段缺失/状态非法.

    例如 response 文件缺少 request_id 字段、status 值不在枚举内等。
    """


class TraeBridgeIOError(TraeBridgeError):
    """文件 I/O 错误 — 目录创建/读写失败.

    例如共享目录不可写、磁盘满、权限不足等。
    """


class TraeBridgeConfigError(TraeBridgeError):
    """配置错误 — 路径/参数非法.

    例如 bridge_dir 为空、poll_interval 为负数等。
    """


# ── 向后兼容别名（旧 TraeLLMError API）─────────────────────────────
# 现有代码 `from flowforge.llm.trae.client import TraeLLMError` 仍可工作
TraeLLMError = TraeBridgeError
TraeLLMTimeoutError = TraeBridgeTimeoutError
TraeLLMCliError = TraeBridgeError  # CLI 模式未实现，归一到基类
TraeLLMApiError = TraeBridgeError  # API 模式未实现，归一到基类


__all__ = [
    "TraeBridgeError",
    "TraeBridgeTimeoutError",
    "TraeBridgeCancelledError",
    "TraeBridgeProtocolError",
    "TraeBridgeIOError",
    "TraeBridgeConfigError",
    # 向后兼容别名
    "TraeLLMError",
    "TraeLLMTimeoutError",
    "TraeLLMCliError",
    "TraeLLMApiError",
]

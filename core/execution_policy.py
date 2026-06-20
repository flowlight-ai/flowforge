"""统一执行策略配置 — 跨项目规范。

将4个项目的执行策略统一为标准格式：

    execution_policy:
      timeout: 300
      retry: 2
      on_error: "fallback"    # fallback | retry | skip | abort
      on_anomaly: "reflect"   # reflect | retry | abort | escalate

与 workflow_compiler.OnErrorStrategy 对齐，并扩展 anomaly 处理策略。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator

from flowforge.core.tracing import get_logger

logger = get_logger("execution_policy")


class OnErrorStrategy(str, Enum):
    """错误处理策略 — 与 workflow_compiler.OnErrorStrategy 对齐并扩展。"""

    ABORT = "abort"
    SKIP = "skip"
    RETRY = "retry"
    FALLBACK = "fallback"
    REFLEXION_RETRY = "reflexion_retry"


class OnAnomalyStrategy(str, Enum):
    """异常（非错误但结果异常）处理策略。"""

    REFLECT = "reflect"
    RETRY = "retry"
    ABORT = "abort"
    ESCALATE = "escalate"


class ExecutionPolicy(BaseModel):
    """统一执行策略配置模型。

    Attributes:
        timeout: 单步超时时间（秒），0 表示不限制。
        retry: 最大重试次数。
        retry_delay: 重试间隔（秒）。
        backoff_strategy: 退避策略: fixed | exponential。
        backoff_base: 指数退避基数。
        on_error: 错误处理策略。
        on_anomaly: 异常结果处理策略。
        fallback_agent: on_error=fallback 时使用的备选 Agent 名称。
        fallback_tool: on_error=fallback 时使用的备选 Tool 名称。
    """

    timeout: int = Field(default=300, ge=0, description="单步超时时间（秒）")
    retry: int = Field(default=2, ge=0, description="最大重试次数")
    retry_delay: float = Field(default=2.0, ge=0, description="重试间隔（秒）")
    backoff_strategy: str = Field(
        default="exponential",
        description="退避策略: fixed | exponential",
    )
    backoff_base: int = Field(default=2, ge=1, description="指数退避基数")
    on_error: OnErrorStrategy = Field(
        default=OnErrorStrategy.FALLBACK,
        description="错误处理策略",
    )
    on_anomaly: OnAnomalyStrategy = Field(
        default=OnAnomalyStrategy.REFLECT,
        description="异常结果处理策略",
    )
    fallback_agent: Optional[str] = Field(
        default=None,
        description="fallback 策略使用的备选 Agent",
    )
    fallback_tool: Optional[str] = Field(
        default=None,
        description="fallback 策略使用的备选 Tool",
    )

    model_config = {"extra": "allow"}

    @field_validator("backoff_strategy")
    @classmethod
    def _validate_backoff(cls, v: str) -> str:
        if v not in ("fixed", "exponential"):
            raise ValueError(f"backoff_strategy must be 'fixed' or 'exponential', got '{v}'")
        return v

    def compute_delay(self, attempt: int) -> float:
        """计算第 attempt 次重试的等待时间。

        Args:
            attempt: 重试次数（从1开始）。

        Returns:
            等待秒数。
        """
        if self.backoff_strategy == "exponential":
            return self.retry_delay * (self.backoff_base ** (attempt - 1))
        return self.retry_delay

    def to_workflow_node_config(self) -> Dict[str, Any]:
        """转换为 WorkflowNodeConfig 兼容的配置字典。

        用于 WorkflowCompiler 编译时合并策略。
        """
        config: Dict[str, Any] = {
            "timeout": self.timeout,
            "retry_count": self.retry,
            "retry_delay": self.retry_delay,
            "on_error": self.on_error.value,
        }
        if self.fallback_agent:
            config["fallback_chain"] = [{"agent": self.fallback_agent}]
        elif self.fallback_tool:
            config["fallback_chain"] = [{"tool": self.fallback_tool}]
        return config


# ── 预定义策略模板 ────────────────────────────────────────────

POLICY_TEMPLATES: Dict[str, ExecutionPolicy] = {
    "default": ExecutionPolicy(),
    "strict": ExecutionPolicy(
        timeout=600,
        retry=0,
        on_error=OnErrorStrategy.ABORT,
        on_anomaly=OnAnomalyStrategy.ABORT,
    ),
    "resilient": ExecutionPolicy(
        timeout=300,
        retry=5,
        backoff_strategy="exponential",
        on_error=OnErrorStrategy.RETRY,
        on_anomaly=OnAnomalyStrategy.RETRY,
    ),
    "content_creation": ExecutionPolicy(
        timeout=600,
        retry=3,
        on_error=OnErrorStrategy.FALLBACK,
        on_anomaly=OnAnomalyStrategy.REFLECT,
    ),
    "novel_writing": ExecutionPolicy(
        timeout=900,
        retry=3,
        backoff_strategy="exponential",
        on_error=OnErrorStrategy.REFLEXION_RETRY,
        on_anomaly=OnAnomalyStrategy.REFLECT,
    ),
    "code_review": ExecutionPolicy(
        timeout=300,
        retry=2,
        on_error=OnErrorStrategy.FALLBACK,
        on_anomaly=OnAnomalyStrategy.ESCALATE,
    ),
}


def get_policy(name: str = "default") -> ExecutionPolicy:
    """获取预定义策略模板。

    Args:
        name: 策略名称: default | strict | resilient | content_creation | novel_writing | code_review

    Returns:
        对应的 ExecutionPolicy 实例。未知名称返回 default。
    """
    policy = POLICY_TEMPLATES.get(name)
    if policy is None:
        logger.warning(f"Unknown policy template '{name}', using 'default'")
        return ExecutionPolicy()
    return policy.model_copy()


def policy_from_config(config: Dict[str, Any]) -> ExecutionPolicy:
    """从配置字典创建 ExecutionPolicy。

    支持 template 字段指定预定义模板，再用配置字段覆盖。

    Args:
        config: 配置字典，如:
            {"template": "resilient", "timeout": 600}

    Returns:
        配置好的 ExecutionPolicy 实例。
    """
    template_name = config.pop("template", "default") if isinstance(config, dict) else "default"
    base = get_policy(template_name)
    # 用配置字段覆盖模板
    override = {k: v for k, v in config.items() if v is not None}
    if not override:
        return base
    return base.model_copy(update=override)

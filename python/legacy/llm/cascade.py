"""多模型级联执行器。

实现 primary → fallback_1 → fallback_2 的级联调用策略。
从 DevForge 迁移至 FlowForge 通用框架。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.tracing import get_logger

logger = get_logger("llm.cascade")


class AllModelsExhaustedError(Exception):
    """所有模型都已尝试但仍然失败。"""
    pass


@dataclass
class CascadeStep:
    """级联步骤记录。"""
    model: str
    provider: str
    role: str
    success: bool
    latency_ms: float
    error: str | None = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class CascadeResult:
    """级联执行结果。"""
    output: Any
    steps: list[CascadeStep] = field(default_factory=list)
    used_model: str = ""
    used_provider: str = ""
    total_latency_ms: float = 0.0
    cascaded: bool = False


class LLMCascadeExecutor:
    """多模型级联执行器。

    按配置的级联链依次尝试调用LLM，直到成功或全部失败。
    """

    def __init__(self, cascade_config_path: str | Path | None = None):
        self._config = self._load_config(cascade_config_path)
        self._cascade_history: list[CascadeResult] = []

    def _load_config(self, path: str | Path | None) -> dict:
        """加载级联配置。"""
        if path is None:
            default_path = Path(__file__).parent.parent / "config" / "cascade.yaml"
            if default_path.exists():
                with open(default_path, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f) or {}
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def get_chain(self, mode: str | None = None, task_type: str | None = None) -> list[dict]:
        """获取级联链，优先使用任务类型覆盖，其次模式覆盖，最后默认链。"""
        if task_type and task_type in self._config.get("task_overrides", {}):
            return self._config["task_overrides"][task_type]
        if mode and mode in self._config.get("mode_overrides", {}):
            return self._config["mode_overrides"][mode]
        return self._config.get("default_chain", [])

    async def execute(self, llm_call_fn, prompt: str, *,
                      mode: str | None = None, task_type: str | None = None,
                      **kwargs) -> CascadeResult:
        """执行级联调用。

        Args:
            llm_call_fn: 异步LLM调用函数，签名为 async (model, provider, prompt, **kwargs) -> Any
            prompt: 提示词
            mode: Agent模式（用于选择级联链）
            task_type: 任务类型（用于选择级联链）
            **kwargs: 传递给LLM调用函数的额外参数

        Returns:
            CascadeResult 包含最终输出和级联过程记录

        Raises:
            AllModelsExhaustedError: 所有模型都失败时抛出
        """
        chain = self.get_chain(mode, task_type)
        if not chain:
            # 无级联配置，直接调用
            result = await llm_call_fn(prompt=prompt, **kwargs)
            return CascadeResult(output=result, used_model="default", used_provider="default")

        failover_config = self._config.get("failover_conditions", {})
        retry_before_cascade = failover_config.get("retry_before_cascade", 1)
        error_types = failover_config.get("error_types", ["RateLimitError", "ModelError", "TimeoutError"])

        start_time = time.time()
        steps: list[CascadeStep] = []
        last_error: str | None = None

        for chain_item in chain:
            model = chain_item["model"]
            provider = chain_item["provider"]
            role = chain_item["role"]

            for attempt in range(retry_before_cascade + 1):
                step_start = time.time()
                try:
                    output = await llm_call_fn(
                        model=model, provider=provider,
                        prompt=prompt, **kwargs,
                    )
                    step_latency = (time.time() - step_start) * 1000
                    steps.append(CascadeStep(
                        model=model, provider=provider, role=role,
                        success=True, latency_ms=step_latency,
                    ))
                    total_latency = (time.time() - start_time) * 1000
                    result = CascadeResult(
                        output=output, steps=steps,
                        used_model=model, used_provider=provider,
                        total_latency_ms=total_latency,
                        cascaded=role != "primary",
                    )
                    self._cascade_history.append(result)
                    if result.cascaded:
                        logger.warning(
                            f"LLM级联: primary失败，回退到 {provider}/{model}，"
                            f"总延迟 {total_latency:.0f}ms"
                        )
                    return result

                except Exception as e:
                    step_latency = (time.time() - step_start) * 1000
                    error_name = type(e).__name__
                    steps.append(CascadeStep(
                        model=model, provider=provider, role=role,
                        success=False, latency_ms=step_latency,
                        error=str(e),
                    ))
                    last_error = str(e)

                    if error_name not in error_types and attempt == 0:
                        # 非可级联错误，直接抛出
                        break
                    logger.warning(
                        f"LLM级联: {provider}/{model} 失败 ({error_name}): {e}"
                    )

        total_latency = (time.time() - start_time) * 1000
        raise AllModelsExhaustedError(
            f"所有模型都已尝试但仍然失败。最后错误: {last_error}。"
            f"总延迟: {total_latency:.0f}ms，尝试步骤: {len(steps)}"
        )

    @property
    def cascade_history(self) -> list[CascadeResult]:
        """获取级联历史记录。"""
        return self._cascade_history

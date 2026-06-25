"""FWK-03: Fallback Chain — 声明式回退链，按序尝试多个工具/Agent，直到成功。

当前4个Agent各自硬编码回退逻辑，本模块将其统一为声明式配置驱动。
典型场景：helixrag → web_search → llm_generate

Usage:
    from flowforge.core.fallback_chain import FallbackChain

    # 方法1: 代码构建
    chain = FallbackChain(chain=[
        FallbackStep(name="helixrag_search", type="tool", tool="helixrag_search",
                     input={"query": "{{input.query}}", "top_k": 10}, timeout=15),
        FallbackStep(name="web_search", type="tool", tool="web_search",
                     input={"query": "{{input.query}}", "max_results": 5}, timeout=20),
        FallbackStep(name="llm_generate", type="llm",
                     prompt="请基于你的知识，回答以下问题：{{input.query}}", timeout=30),
    ])
    result = await chain.execute({"query": "AI发展趋势"}, tool_registry=registry)

    # 方法2: YAML文件
    chain = FallbackChain.from_yaml("config/fallbacks/search_fallback.yaml")
    result = await chain.execute({"query": "AI发展趋势"}, tool_registry=registry)

    # 方法3: 预定义工厂
    chain = FallbackChain.search_chain()
    result = await chain.execute({"query": "AI发展趋势"}, tool_registry=registry)
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from typing import Any, Callable

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("fallback_chain")

# ---------------------------------------------------------------------------
# 模板变量解析
# ---------------------------------------------------------------------------

_TEMPLATE_PATTERN = re.compile(r"\{\{(\w+(?:\.\w+)*)\}\}")


def _resolve_template(value: Any, context: dict) -> Any:
    """递归解析模板变量，将 `{{input.query}}` 替换为 context 中对应值。"""
    if isinstance(value, str):
        def _replacer(match: re.Match) -> str:
            key_path = match.group(1)
            parts = key_path.split(".")
            current: Any = context
            for part in parts:
                if isinstance(current, dict):
                    current = current.get(part, match.group(0))
                else:
                    return match.group(0)
            return str(current) if current is not None else match.group(0)
        return _TEMPLATE_PATTERN.sub(_replacer, value)
    if isinstance(value, dict):
        return {k: _resolve_template(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_template(item, context) for item in value]
    return value


# ---------------------------------------------------------------------------
# 条件表达式求值
# ---------------------------------------------------------------------------

def _evaluate_condition(condition: str, context: dict) -> bool:
    """简单条件表达式求值，支持比较和逻辑运算。

    支持的语法示例:
        - "input.priority == 'high'"
        - "input.retry_count > 0"
        - "input.mode != 'skip'"
    不满足条件或表达式无效时返回 False。
    """
    if not condition:
        return True
    try:
        # 安全求值：仅允许比较运算符
        allowed_names: dict[str, Any] = {}
        parts = condition.split()
        if len(parts) == 3 and parts[1] in ("==", "!=", ">", "<", ">=", "<="):
            left_expr, op, right_expr = parts
            left_val = _resolve_value_expr(left_expr, context)
            right_val = _resolve_value_expr(right_expr, context)
            if op == "==":
                return left_val == right_val
            if op == "!=":
                return left_val != right_val
            if op == ">":
                return left_val > right_val
            if op == "<":
                return left_val < right_val
            if op == ">=":
                return left_val >= right_val
            if op == "<=":
                return left_val <= right_val
        # 无法解析的条件默认通过
        logger.warning(f"Unsupported condition expression: {condition}")
        return True
    except Exception as e:
        logger.warning(f"Condition evaluation failed for '{condition}': {e}")
        return True


def _resolve_value_expr(expr: str, context: dict) -> Any:
    """解析条件表达式中的值，支持 context 路径和字面量。"""
    # 去除引号 → 字面量字符串
    if (expr.startswith("'") and expr.endswith("'")) or \
       (expr.startswith('"') and expr.endswith('"')):
        return expr[1:-1]
    # 数字字面量
    try:
        if "." in expr:
            return float(expr)
        return int(expr)
    except ValueError:
        pass
    # 布尔字面量
    if expr == "true" or expr == "True":
        return True
    if expr == "false" or expr == "False":
        return False
    # context 路径
    parts = expr.split(".")
    current: Any = context
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


# ---------------------------------------------------------------------------
# 错误类型分类
# ---------------------------------------------------------------------------

_AUTH_ERROR_PATTERNS = ("auth", "authentication", "unauthorized", "401", "403")
_PERMISSION_ERROR_PATTERNS = ("permission", "forbidden", "access_denied")


def _classify_error(error_msg: str) -> str:
    """根据错误消息分类错误类型。"""
    lower = error_msg.lower()
    for pattern in _AUTH_ERROR_PATTERNS:
        if pattern in lower:
            return "auth_error"
    for pattern in _PERMISSION_ERROR_PATTERNS:
        if pattern in lower:
            return "permission_denied"
    if "timeout" in lower or "timed out" in lower:
        return "timeout_error"
    if "not found" in lower:
        return "not_found_error"
    return "execution_error"


# ---------------------------------------------------------------------------
# Pydantic 模型
# ---------------------------------------------------------------------------

class FallbackStep(BaseModel):
    """回退链中的单个步骤。"""

    name: str = Field(description="步骤名称")
    type: str = Field(description="步骤类型: tool | agent | llm | function")
    tool: str | None = Field(default=None, description="type=tool 时的工具名")
    agent: str | None = Field(default=None, description="type=agent 时的 Agent 名")
    prompt: str | None = Field(default=None, description="type=llm 时的提示词模板")
    function: str | None = Field(default=None, description="type=function 时的函数路径")
    input: dict[str, Any] = Field(default_factory=dict, description="输入参数映射")
    timeout: float = Field(default=30.0, description="单步超时（秒）")
    retry: int = Field(default=0, description="单步重试次数")
    condition: str | None = Field(default=None, description="执行条件表达式")
    description: str = Field(default="", description="步骤描述")


class AttemptRecord(BaseModel):
    """单次尝试记录。"""

    step_name: str = Field(description="步骤名称")
    success: bool = Field(description="是否成功")
    error: str | None = Field(default=None, description="错误信息")
    error_type: str | None = Field(default=None, description="错误类型分类")
    duration: float = Field(default=0.0, description="耗时（秒）")
    result: Any = Field(default=None, description="执行结果")


class FallbackResult(BaseModel):
    """回退链执行结果。"""

    success: bool = Field(description="是否成功")
    result: Any = Field(default=None, description="成功步骤的结果")
    successful_step: str | None = Field(default=None, description="成功的步骤名")
    attempts: list[AttemptRecord] = Field(default_factory=list, description="所有尝试记录")
    total_time: float = Field(default=0.0, description="总耗时（秒）")


# ---------------------------------------------------------------------------
# FallbackChain 核心
# ---------------------------------------------------------------------------

class FallbackChain:
    """声明式回退链 — 按序尝试多个工具/Agent，直到成功。

    按优先级从 chain[0] 开始执行，成功则返回，失败则尝试下一个。
    遇到 stop_on 中定义的错误类型时停止回退。
    """

    def __init__(
        self,
        chain: list[FallbackStep],
        stop_on: list[str] | None = None,
        name: str = "",
        description: str = "",
    ) -> None:
        self.chain = chain
        self.stop_on = stop_on or []
        self.name = name
        self.description = description

    async def execute(
        self,
        context: dict,
        tool_registry: Any = None,
        agent_registry: Any = None,
    ) -> FallbackResult:
        """按序执行回退链，直到成功或全部失败。

        Args:
            context: 执行上下文，模板变量从中解析（如 {{input.query}}）。
            tool_registry: 工具注册表，用于查找和调用工具。
            agent_registry: Agent 注册表，用于查找和调用 Agent。

        Returns:
            FallbackResult 包含执行结果和所有尝试记录。
        """
        start_time = time.monotonic()
        attempts: list[AttemptRecord] = []

        for step in self.chain:
            # 条件检查
            if step.condition and not _evaluate_condition(step.condition, context):
                logger.debug(f"Step '{step.name}' skipped: condition not met ({step.condition})")
                attempts.append(AttemptRecord(
                    step_name=step.name,
                    success=False,
                    error="Condition not met",
                    error_type="condition_skipped",
                ))
                continue

            # 解析模板变量
            resolved_input = _resolve_template(step.input, context)
            resolved_prompt = _resolve_template(step.prompt, context) if step.prompt else None

            # 带重试的执行
            attempt = await self._execute_step_with_retry(
                step, resolved_input, resolved_prompt,
                tool_registry, agent_registry,
            )
            attempts.append(attempt)

            if attempt.success:
                total_time = time.monotonic() - start_time
                logger.info(
                    f"Fallback chain succeeded at step '{step.name}' "
                    f"after {len(attempts)} attempt(s) in {total_time:.3f}s"
                )
                return FallbackResult(
                    success=True,
                    result=attempt.result,
                    successful_step=step.name,
                    attempts=attempts,
                    total_time=total_time,
                )

            # 检查 stop_on
            if attempt.error_type and attempt.error_type in self.stop_on:
                total_time = time.monotonic() - start_time
                logger.warning(
                    f"Fallback chain stopped at step '{step.name}' "
                    f"due to stop_on error type: {attempt.error_type}"
                )
                return FallbackResult(
                    success=False,
                    result=None,
                    successful_step=None,
                    attempts=attempts,
                    total_time=total_time,
                )

            logger.debug(
                f"Step '{step.name}' failed: {attempt.error}, "
                f"trying next fallback..."
            )

        total_time = time.monotonic() - start_time
        logger.warning(
            f"Fallback chain exhausted all {len(self.chain)} steps in {total_time:.3f}s"
        )
        return FallbackResult(
            success=False,
            result=None,
            successful_step=None,
            attempts=attempts,
            total_time=total_time,
        )

    async def _execute_step_with_retry(
        self,
        step: FallbackStep,
        resolved_input: dict,
        resolved_prompt: str | None,
        tool_registry: Any,
        agent_registry: Any,
    ) -> AttemptRecord:
        """执行单个步骤，支持重试。"""
        last_error: str | None = None
        last_error_type: str | None = None
        last_result: Any = None

        max_attempts = 1 + step.retry
        for attempt_idx in range(max_attempts):
            step_start = time.monotonic()
            try:
                result = await asyncio.wait_for(
                    self._invoke_step(step, resolved_input, resolved_prompt,
                                      tool_registry, agent_registry),
                    timeout=step.timeout,
                )
                duration = time.monotonic() - step_start
                logger.debug(
                    f"Step '{step.name}' succeeded on attempt {attempt_idx + 1}/{max_attempts} "
                    f"in {duration:.3f}s"
                )
                return AttemptRecord(
                    step_name=step.name,
                    success=True,
                    error=None,
                    error_type=None,
                    duration=duration,
                    result=result,
                )
            except asyncio.TimeoutError:
                duration = time.monotonic() - step_start
                last_error = f"Timeout after {step.timeout}s"
                last_error_type = "timeout_error"
                logger.debug(
                    f"Step '{step.name}' timed out on attempt {attempt_idx + 1}/{max_attempts}"
                )
            except Exception as e:
                duration = time.monotonic() - step_start
                last_error = str(e)
                last_error_type = _classify_error(last_error)
                logger.debug(
                    f"Step '{step.name}' failed on attempt {attempt_idx + 1}/{max_attempts}: {e}"
                )

        return AttemptRecord(
            step_name=step.name,
            success=False,
            error=last_error,
            error_type=last_error_type,
            duration=0.0,
            result=last_result,
        )

    async def _invoke_step(
        self,
        step: FallbackStep,
        resolved_input: dict,
        resolved_prompt: str | None,
        tool_registry: Any,
        agent_registry: Any,
    ) -> Any:
        """根据步骤类型调用对应的执行器。"""
        if step.type == "tool":
            return await self._invoke_tool(step, resolved_input, tool_registry)
        if step.type == "agent":
            return await self._invoke_agent(step, resolved_input, agent_registry)
        if step.type == "llm":
            return await self._invoke_llm(step, resolved_prompt, tool_registry)
        if step.type == "function":
            return await self._invoke_function(step, resolved_input)
        raise ValueError(f"Unknown step type: {step.type}")

    async def _invoke_tool(
        self, step: FallbackStep, resolved_input: dict, tool_registry: Any,
    ) -> Any:
        """通过 ToolRegistry 调用工具。"""
        if tool_registry is None:
            raise RuntimeError(f"tool_registry is required for tool step '{step.name}'")
        if step.tool is None:
            raise ValueError(f"Step '{step.name}' of type 'tool' must specify 'tool' field")

        from flowforge.core.base_tool import ToolInput
        tool_input = ToolInput(params=resolved_input)
        tool_output = await tool_registry.execute(step.tool, tool_input)
        if tool_output.error:
            raise RuntimeError(tool_output.error)
        return tool_output.result

    async def _invoke_agent(
        self, step: FallbackStep, resolved_input: dict, agent_registry: Any,
    ) -> Any:
        """通过 AgentRegistry 调用 Agent。"""
        if agent_registry is None:
            raise RuntimeError(f"agent_registry is required for agent step '{step.name}'")
        if step.agent is None:
            raise ValueError(f"Step '{step.name}' of type 'agent' must specify 'agent' field")

        agent = agent_registry.get(step.agent)
        if agent is None:
            raise RuntimeError(f"Agent '{step.agent}' not found in registry")

        from flowforge.core.base_agent import AgentInput
        agent_input = AgentInput(task=str(resolved_input), params=resolved_input)
        agent_output = await agent.execute(agent_input)
        return agent_output.result

    async def _invoke_llm(
        self, step: FallbackStep, resolved_prompt: str | None, tool_registry: Any,
    ) -> Any:
        """通过 ToolRegistry 中的 llm 工具调用 LLM。"""
        if resolved_prompt is None:
            raise ValueError(f"Step '{step.name}' of type 'llm' must specify 'prompt' field")

        if tool_registry is not None:
            try:
                from flowforge.core.base_tool import ToolInput
                llm_input = ToolInput(params={
                    "messages": [{"role": "user", "content": resolved_prompt}],
                    "stream": False,
                })
                llm_output = await tool_registry.execute("llm", llm_input)
                if llm_output.error:
                    raise RuntimeError(llm_output.error)
                return llm_output.result
            except Exception:
                # llm 工具不可用，尝试直接构造返回
                logger.warning(f"LLM tool not available for step '{step.name}'")

        raise RuntimeError(
            f"Cannot execute LLM step '{step.name}': "
            "no tool_registry or 'llm' tool not registered"
        )

    async def _invoke_function(
        self, step: FallbackStep, resolved_input: dict,
    ) -> Any:
        """动态导入并调用函数。"""
        if step.function is None:
            raise ValueError(f"Step '{step.name}' of type 'function' must specify 'function' field")

        # 格式: "module.path:function_name"
        if ":" in step.function:
            module_path, func_name = step.function.rsplit(":", 1)
        else:
            module_path, func_name = step.function.rsplit(".", 1)

        import importlib
        module = importlib.import_module(module_path)
        func = getattr(module, func_name)
        if not callable(func):
            raise RuntimeError(f"'{step.function}' is not callable")

        result = func(**resolved_input)
        if asyncio.iscoroutine(result):
            result = await result
        return result

    # -----------------------------------------------------------------------
    # 工厂方法
    # -----------------------------------------------------------------------

    @classmethod
    def from_yaml(cls, yaml_path: str) -> FallbackChain:
        """从 YAML 文件加载回退链配置。

        Args:
            yaml_path: YAML 配置文件路径。

        Returns:
            FallbackChain 实例。
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Fallback chain config not found: {yaml_path}")

        with open(path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        return cls.from_config(config)

    @classmethod
    def from_config(cls, config: list[dict] | dict) -> FallbackChain:
        """从配置字典创建 FallbackChain。

        支持两种格式:
        1. 列表格式: [{"name": ..., "type": ..., ...}, ...]
        2. 完整格式: {"name": ..., "chain": [...], "stop_on": [...]}

        Args:
            config: 配置字典或列表。

        Returns:
            FallbackChain 实例。
        """
        if isinstance(config, list):
            steps = [FallbackStep(**step_cfg) for step_cfg in config]
            return cls(chain=steps)

        chain_cfg = config.get("chain", [])
        steps = [FallbackStep(**step_cfg) for step_cfg in chain_cfg]
        return cls(
            chain=steps,
            stop_on=config.get("stop_on", []),
            name=config.get("name", ""),
            description=config.get("description", ""),
        )

    @classmethod
    def search_chain(cls) -> FallbackChain:
        """搜索回退链: helixrag → web_search → llm_generate。"""
        return cls(
            name="search_fallback",
            description="搜索回退链：helixrag → web_search → llm_generate",
            stop_on=["auth_error", "permission_denied"],
            chain=[
                FallbackStep(
                    name="helixrag_search",
                    type="tool",
                    tool="helixrag_search",
                    input={"query": "{{input.query}}", "top_k": 10},
                    timeout=15.0,
                    description="优先使用HelixRAG向量检索",
                ),
                FallbackStep(
                    name="web_search",
                    type="tool",
                    tool="web_search",
                    input={"query": "{{input.query}}", "max_results": 5},
                    timeout=20.0,
                    description="回退到Web搜索",
                ),
                FallbackStep(
                    name="llm_generate",
                    type="llm",
                    prompt="请基于你的知识，回答以下问题：{{input.query}}",
                    timeout=30.0,
                    description="最后回退到LLM生成",
                ),
            ],
        )

    @classmethod
    def publish_chain(cls) -> FallbackChain:
        """发布回退链: wechat → toutiao → draft_save。

        .. deprecated::
            此方法硬编码了内容发布领域的回退链，属于 contentforge 领域逻辑，
            不应存在于 flowforge 底座中。请在 contentforge 项目中定义自己的
            发布回退链。此方法将在未来版本中移除。
        """
        import warnings
        warnings.warn(
            "FallbackChain.publish_chain() is deprecated: "
            "publish fallback chain is domain-specific to contentforge and should be "
            "defined in the contentforge project. This method will be removed in a future version.",
            DeprecationWarning,
            stacklevel=2,
        )
        return cls(
            name="publish_fallback",
            description="发布回退链：wechat → toutiao → draft_save",
            stop_on=["auth_error", "permission_denied"],
            chain=[
                FallbackStep(
                    name="wechat_publish",
                    type="tool",
                    tool="wechat_publish",
                    input={"content": "{{input.content}}", "title": "{{input.title}}"},
                    timeout=30.0,
                    description="优先发布到微信公众号",
                ),
                FallbackStep(
                    name="toutiao_publish",
                    type="tool",
                    tool="toutiao_publish",
                    input={"content": "{{input.content}}", "title": "{{input.title}}"},
                    timeout=30.0,
                    description="回退到今日头条发布",
                ),
                FallbackStep(
                    name="draft_save",
                    type="tool",
                    tool="draft_save",
                    input={"content": "{{input.content}}", "title": "{{input.title}}"},
                    timeout=10.0,
                    description="最终保存为草稿",
                ),
            ],
        )

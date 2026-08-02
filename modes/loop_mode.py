"""Loop mode executor — Loop 的便捷适配器，而非独立模式。

Loop 不是第10种模式，而是模式的"上层管理者"（设计文档 loop.md §5.3）。
LoopModeExecutor 保留为向后兼容的便捷入口：当用户通过 mode_hint="loop"
请求 Loop 时，自动转换为"使用 LoopExecutor 包装 HybridExecutor 执行"。

本类不再注册到 ModeRegistry，而是由 HybridExecutor 在检测到 loop_config
时直接调用 LoopExecutor.run()。LoopModeExecutor 仅在 HybridExecutor
未配置 LoopExecutor 时作为降级适配器使用。
"""

from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("modes.loop_mode")

DEFAULT_LOOP_CONFIG = {
    "name": "default_loop",
    "max_retries": 3,
    "worker": {"mode": "workflow"},
}


class LoopModeExecutor(BaseModeExecutor):
    """Loop 便捷适配器 — 向后兼容 mode_hint="loop" 的入口。

    Loop 不是新模式，而是模式的"上层管理者"。它决定"当前这个步骤应该
    用什么模式"，并根据校验结果动态切换（设计文档 loop.md §5.3）。

    本类保留为向后兼容入口，当 HybridExecutor 检测到 mode_hint="loop"
    但未配置 LoopExecutor 时，通过 ModeRegistry 查找本类执行降级逻辑。

    推荐方式：通过 TaskContext.metadata["loop_config"] 配置触发 Loop，
    由 HybridExecutor 直接委托给 LoopExecutor（不经过本类）。

    Capabilities:
        iterative: 迭代执行能力
        verify: 校验能力
        reflect: 复盘能力
        retry: 重试能力
    """

    mode_name = "loop"
    capabilities = ["iterative", "verify", "reflect", "retry"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        """执行 Loop 便捷入口。

        优先从 ctx.metadata 获取 loop_executor（由 HybridExecutor 注入），
        若无则尝试从 ctx.executor（HybridExecutor）获取 loop_executor，
        最后降级为直接委托给 HybridExecutor（由其内部 Loop 编排层处理）。

        Args:
            ctx: 任务上下文，可能包含 "loop_executor" 或 "loop_config"。

        Returns:
            包含执行结果的字典。

        Raises:
            RuntimeError: 如果无法获取 LoopExecutor 且 HybridExecutor 未配置。
        """
        loop_config = ctx.metadata.get("loop_config", DEFAULT_LOOP_CONFIG.copy())

        # 确保默认配置中有 name 字段
        if "name" not in loop_config:
            loop_config = {**DEFAULT_LOOP_CONFIG, **loop_config}

        # 优先级1：从 ctx.metadata 获取 loop_executor（HybridExecutor 注入）
        loop_executor = ctx.metadata.get("loop_executor")

        # 优先级2：从 ctx.executor（HybridExecutor）获取 loop_executor
        if loop_executor is None and hasattr(ctx, "executor") and ctx.executor is not None:
            loop_executor = getattr(ctx.executor, "loop_executor", None)
            if loop_executor is not None:
                logger.info(
                    f"LoopModeExecutor: obtained LoopExecutor from HybridExecutor, "
                    f"task_id={ctx.task_id}"
                )

        if loop_executor is None:
            raise RuntimeError(
                "LoopModeExecutor requires a LoopExecutor. "
                "Ensure HybridExecutor has a loop_executor configured, "
                "or provide 'loop_executor' in ctx.metadata."
            )

        logger.info(
            f"Loop mode executing (convenience adapter): "
            f"loop_name={loop_config.get('name')}, "
            f"max_retries={loop_config.get('max_retries', 3)}, "
            f"task_id={ctx.task_id}"
        )

        loop_result = await loop_executor.run(ctx, loop_config)

        # 将 LoopResult 转换为 dict
        result = {
            "success": loop_result.success,
            "total_attempts": loop_result.total_attempts,
        }
        if loop_result.output is not None:
            result["output"] = loop_result.output
            # 向后兼容：将 output 中的关键字段提升到顶层
            if isinstance(loop_result.output, dict):
                for key in ("response", "final_answer", "content"):
                    if key in loop_result.output and key not in result:
                        result[key] = loop_result.output[key]
        if loop_result.error is not None:
            result["error"] = loop_result.error
        if loop_result.state is not None:
            result["loop_state"] = loop_result.state.model_dump()

        logger.info(
            f"Loop mode completed (convenience adapter): success={loop_result.success}, "
            f"attempts={loop_result.total_attempts}, task_id={ctx.task_id}"
        )

        return result

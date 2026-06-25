"""FlowForge Loop 编排器 — 通用的 Loop 执行 + 结果提取 + 降级策略。

重构后 contentforge/brain/orchestrator.py 会被删除，
其中的编排逻辑迁移到此模块，作为 flowforge 的通用能力。

使用方式:
    from flowforge.loop.orchestrator import LoopOrchestrator

    orchestrator = LoopOrchestrator(sdk)
    result = await orchestrator.run(task_id, input_data, template_name, persona)
"""
import uuid
import logging
from typing import Any, Optional

from flowforge.loop.result_extractor import extract_result_summary
from flowforge.core.tracing import get_logger

logger = get_logger("loop.orchestrator")


class LoopOrchestrator:
    """通用 Loop 编排器 — 通过 LoopExecutor 执行任务，提取结果，支持降级。"""

    def __init__(self, sdk=None):
        self._sdk = sdk

    async def run(
        self,
        task_id: str,
        input_data: dict,
        template_name: str = "deep-article-loop",
        persona: str = "default",
        sop_name: str = "create",
        fallback_agent_name: str | None = None,
    ) -> dict:
        """执行任务 — 通过 LoopExecutor（含多评委评审+反思迭代）。

        Args:
            task_id: 任务ID
            input_data: 输入数据（topic_list, research_materials等）
            template_name: Loop模板名
            persona: 人设
            sop_name: SOP名称
            fallback_agent_name: 降级时直接调用的Agent名

        Returns:
            dict: 包含 content, title, word_count, quality_score, iterations, loop_success
        """
        # 1. 尝试通过 LoopExecutor 执行
        result = await self._run_via_loop(task_id, input_data, template_name, persona, sop_name)

        if result is not None:
            return result

        # 2. 降级：直接调用 Agent
        if fallback_agent_name:
            result = await self._run_via_agent(task_id, input_data, fallback_agent_name, persona)
            if result is not None:
                return result

        # 3. 全部失败
        return {
            "content": "",
            "title": "",
            "word_count": 0,
            "quality_score": 0.0,
            "iterations": 0,
            "loop_success": False,
        }

    async def _run_via_loop(
        self, task_id: str, input_data: dict, template_name: str, persona: str, sop_name: str
    ) -> Optional[dict]:
        """通过 LoopExecutor 执行。"""
        if self._sdk is None:
            return None

        loop_executor = getattr(self._sdk, 'loop_executor', None)
        if loop_executor is None:
            logger.info("[LoopOrchestrator] LoopExecutor 不可用")
            return None

        # 获取 Loop 模板配置
        from flowforge.loop.registry import LoopRegistry
        import os
        config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "loops")
        # 也检查项目级配置
        project_config_dir = os.path.join(os.getcwd(), "config", "loops")
        if os.path.isdir(project_config_dir):
            config_dir = project_config_dir

        loop_registry = LoopRegistry(config_dir=config_dir)
        template = loop_registry.get(template_name)
        if template is None:
            logger.warning(f"[LoopOrchestrator] Loop模板 '{template_name}' 未找到")
            return None

        loop_config = template.model_dump()

        # 构造 TaskContext
        from flowforge.core.task_context import TaskContext

        task_context = TaskContext(
            task_id=task_id,
            input_data=input_data,
            metadata={"persona": persona, "sop_name": sop_name},
            tools=getattr(self._sdk, 'tools', None),
            agents=getattr(self._sdk, 'agents', None),
            persona=persona,
        )

        logger.info(f"[LoopOrchestrator] 通过LoopExecutor执行: template={template_name}, task_id={task_id}")

        try:
            result = await loop_executor.run(task_context, loop_config)
            logger.info(f"[LoopOrchestrator] LoopExecutor完成: task_id={task_id}, "
                        f"success={result.success}, attempts={result.total_attempts}")

            # 使用 result_extractor 提取结果
            summary = extract_result_summary(result, task_context)
            logger.info(f"[LoopOrchestrator] 结果: content_len={summary['word_count']}, "
                        f"quality={summary['quality_score']:.2f}, iterations={summary['iterations']}")
            return summary

        except Exception as e:
            logger.error(f"[LoopOrchestrator] LoopExecutor异常: {e}", exc_info=True)
            return None

    async def _run_via_agent(
        self, task_id: str, input_data: dict, agent_name: str, persona: str
    ) -> Optional[dict]:
        """降级：直接调用 Agent 执行。"""
        if self._sdk is None:
            return None

        agents = getattr(self._sdk, 'agents', None)
        if agents is None:
            return None

        # 支持namespace查找
        agent = agents.get(agent_name)
        if agent is None and ':' not in agent_name:
            for ns in ('contentforge:', 'flowforge:'):
                agent = agents.get(f'{ns}{agent_name}')
                if agent:
                    break

        if agent is None:
            logger.warning(f"[LoopOrchestrator] Agent '{agent_name}' 未找到")
            return None

        from flowforge.core.base_agent import AgentInput

        agent_input = AgentInput(
            params=input_data,
            state={"persona": persona, "task_id": task_id},
        )

        logger.info(f"[LoopOrchestrator] 直接Agent执行: agent={agent_name}")
        try:
            output = await agent.execute(agent_input)
            draft = output.result.get("draft", output.result.get("edited_draft", "")) if isinstance(output.result, dict) else str(output.result)

            return {
                "content": draft,
                "title": draft.split("\n")[0].replace("# ", "").strip()[:60] if draft else "",
                "word_count": len(draft) if draft else 0,
                "quality_score": 0.0,
                "iterations": 0,
                "loop_success": False,
            }
        except Exception as e:
            logger.error(f"[LoopOrchestrator] Agent执行失败: {e}", exc_info=True)
            return None

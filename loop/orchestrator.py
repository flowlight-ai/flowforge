"""FlowForge Loop 编排器 — 通用的 Loop 执行 + 结果提取 + 降级策略。

重构后 contentforge/brain/orchestrator.py 会被删除，
其中的编排逻辑迁移到此模块，作为 flowforge 的通用能力。

使用方式:
    from flowforge.loop.orchestrator import LoopOrchestrator

    orchestrator = LoopOrchestrator(sdk)
    result = await orchestrator.run(task_id, input_data, template_name, persona)
"""

from flowforge.core.tracing import get_logger
from flowforge.loop.result_extractor import extract_result_summary

logger = get_logger("loop.orchestrator")


class LoopOrchestrator:
    """通用 Loop 编排器 — 通过 LoopExecutor 执行任务，提取结果，支持降级。"""

    # 平台默认命名空间（始终最后一个尝试）
    PLATFORM_NAMESPACE = "flowforge:"

    def __init__(self, sdk=None):
        self._sdk = sdk

    def _discover_agent_namespaces(self) -> list[str]:
        """动态发现已注册的 Agent 命名空间列表。

        优先使用 flowforge.core.namespace 注册表（各 *Forge 通过
        register_namespace 注册自己的命名空间）。
        平台命名空间 'flowforge:' 始终最后尝试。

        Returns:
            list[str]: 命名空间前缀列表（含冒号），如 ['contentforge:', 'flowforge:']
        """
        namespaces: list[str] = []
        try:
            from flowforge.core.namespace import get_all_namespaces
            for project in get_all_namespaces():
                namespaces.append(f"{project}:")
        except Exception as e:
            logger.debug(f"[LoopOrchestrator] namespace registry lookup failed: {e}")

        # 平台命名空间始终在列（最后尝试）
        if self.PLATFORM_NAMESPACE not in namespaces:
            namespaces.append(self.PLATFORM_NAMESPACE)
        return namespaces

    async def run(
        self,
        task_id: str,
        input_data: dict,
        template_name: str = "",
        persona: str = "default",
        sop_name: str = "",
        fallback_agent_name: str | None = None,
    ) -> dict:
        """执行任务 — 通过 LoopExecutor（含多评委评审+反思迭代）。

        Args:
            task_id: 任务ID
            input_data: 输入数据（topic_list, research_materials等）
            template_name: Loop模板名（空串表示使用注册表中第一个可用模板）
            persona: 人设
            sop_name: SOP名称（空串表示不指定SOP）
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
    ) -> dict | None:
        """通过 LoopExecutor 执行。"""
        if self._sdk is None:
            return None

        loop_executor = getattr(self._sdk, 'loop_executor', None)
        if loop_executor is None:
            logger.info("[LoopOrchestrator] LoopExecutor 不可用")
            return None

        # 获取 Loop 模板配置
        import os

        from flowforge.loop.registry import LoopRegistry
        config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "loops")
        # 也检查项目级配置
        project_config_dir = os.path.join(os.getcwd(), "config", "loops")
        if os.path.isdir(project_config_dir):
            config_dir = project_config_dir

        loop_registry = LoopRegistry(config_dir=config_dir)

        # 空模板名：尝试使用注册表中第一个可用模板（业务无关降级）
        if not template_name:
            try:
                available = loop_registry.list_names() if hasattr(loop_registry, 'list_names') else []
                if available:
                    template_name = available[0]
                    logger.info(f"[LoopOrchestrator] template_name 为空，使用首个可用模板: '{template_name}'")
                else:
                    logger.warning("[LoopOrchestrator] template_name 为空且注册表无可用模板")
                    return None
            except Exception as e:
                logger.warning(f"[LoopOrchestrator] 枚举可用模板失败: {e}")
                return None

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
    ) -> dict | None:
        """降级：直接调用 Agent 执行。"""
        if self._sdk is None:
            return None

        agents = getattr(self._sdk, 'agents', None)
        if agents is None:
            return None

        # 支持namespace查找
        agent = agents.get(agent_name)
        if agent is None and ':' not in agent_name:
            # 动态发现已注册的命名空间（消除硬编码 'contentforge:' 业务耦合）
            # 各 *Forge 通过 flowforge.core.namespace.register_namespace 注册
            namespaces = self._discover_agent_namespaces()
            for ns in namespaces:
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

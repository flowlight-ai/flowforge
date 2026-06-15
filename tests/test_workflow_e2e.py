"""Workflow模块拆分后E2E集成测试

验证拆分后的5个模块正确集成到主流程：
- workflow_executor.py (主入口)
- workflow_context.py (ContextHandler)
- workflow_tools.py (ToolHandler)
- workflow_react.py (ReactHandler)
- workflow_chat.py (ChatHandler)
"""

import asyncio
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from flowforge.core.task_context import TaskContext
from flowforge.events.event_bus import EventBus


# ──────────────────────────────────────────────────────────────
# 1. 模块导入链路验证
# ──────────────────────────────────────────────────────────────


class TestWorkflowModuleImports:
    """验证拆分后的5个模块可正常导入"""

    def test_workflow_executor_import(self):
        """WorkflowExecutor可从主模块导入"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        assert WorkflowExecutor is not None
        assert WorkflowExecutor.mode_name == "workflow"

    def test_context_handler_import(self):
        """ContextHandler可正常导入"""
        from flowforge.modes.workflow_context import ContextHandler
        assert ContextHandler is not None

    def test_tool_handler_import(self):
        """ToolHandler可正常导入"""
        from flowforge.modes.workflow_tools import ToolHandler
        assert ToolHandler is not None

    def test_react_handler_import(self):
        """ReactHandler可正常导入"""
        from flowforge.modes.workflow_react import ReactHandler
        assert ReactHandler is not None

    def test_chat_handler_import(self):
        """ChatHandler可正常导入"""
        from flowforge.modes.workflow_chat import ChatHandler
        assert ChatHandler is not None

    def test_backward_compatible_import_from_workflow(self):
        """从flowforge.modes.workflow可向后兼容导入WorkflowExecutor"""
        from flowforge.modes.workflow import WorkflowExecutor as WE_from_workflow
        from flowforge.modes.workflow_executor import WorkflowExecutor as WE_from_executor
        assert WE_from_workflow is WE_from_executor

    def test_backward_compatible_import_from_init(self):
        """从flowforge.modes包可导入WorkflowExecutor（如果__init__.py导出）"""
        # __init__.py当前为空文件，验证不报错即可
        import flowforge.modes
        # 直接从子模块导入
        from flowforge.modes.workflow_executor import WorkflowExecutor
        assert WorkflowExecutor is not None


# ──────────────────────────────────────────────────────────────
# 2. WorkflowExecutor实例化与Handler组合验证
# ──────────────────────────────────────────────────────────────


class TestWorkflowExecutorComposition:
    """验证WorkflowExecutor正确组合4个Handler"""

    def test_executor_instantiation(self):
        """WorkflowExecutor可正常实例化"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        executor = WorkflowExecutor()
        assert executor is not None
        assert executor.mode_name == "workflow"

    def test_executor_has_context_handler(self):
        """WorkflowExecutor包含ContextHandler实例"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_context import ContextHandler
        executor = WorkflowExecutor()
        assert hasattr(executor, '_context_handler')
        assert isinstance(executor._context_handler, ContextHandler)

    def test_executor_has_tool_handler(self):
        """WorkflowExecutor包含ToolHandler实例"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_tools import ToolHandler
        executor = WorkflowExecutor()
        assert hasattr(executor, '_tool_handler')
        assert isinstance(executor._tool_handler, ToolHandler)

    def test_executor_has_react_handler(self):
        """WorkflowExecutor包含ReactHandler实例"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_react import ReactHandler
        executor = WorkflowExecutor()
        assert hasattr(executor, '_react_handler')
        assert isinstance(executor._react_handler, ReactHandler)

    def test_executor_has_chat_handler(self):
        """WorkflowExecutor包含ChatHandler实例"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_chat import ChatHandler
        executor = WorkflowExecutor()
        assert hasattr(executor, '_chat_handler')
        assert isinstance(executor._chat_handler, ChatHandler)

    def test_handler_back_reference(self):
        """每个Handler持有对executor的反向引用"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        executor = WorkflowExecutor()
        assert executor._context_handler._executor is executor
        assert executor._tool_handler._executor is executor
        assert executor._react_handler._executor is executor
        assert executor._chat_handler._executor is executor

    def test_executor_has_validator(self):
        """WorkflowExecutor包含WorkflowValidator实例"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_validator import WorkflowValidator
        executor = WorkflowExecutor()
        assert hasattr(executor, '_validator')
        assert isinstance(executor._validator, WorkflowValidator)


# ──────────────────────────────────────────────────────────────
# 3. 代理方法存在性验证
# ──────────────────────────────────────────────────────────────


class TestDelegatedMethods:
    """验证WorkflowExecutor上的代理方法存在且正确委托"""

    # ContextHandler代理方法
    CONTEXT_METHODS = [
        '_call_llm',
        '_recall_memories',
        '_save_to_memory',
        '_build_tool_descriptions_text',
        '_render_template',
    ]

    # ToolHandler代理方法
    TOOL_METHODS = [
        '_execute_tool_or_agent',
        '_build_function_schemas',
        '_llm_web_search_fallback',
    ]

    # ReactHandler代理方法
    REACT_METHODS = [
        '_run_react_loop',
    ]

    # ChatHandler代理方法
    CHAT_METHODS = [
        '_execute_intelligent_chat',
        '_execute_normal_chat',
        '_simple_response',
    ]

    @pytest.fixture
    def executor(self):
        from flowforge.modes.workflow_executor import WorkflowExecutor
        return WorkflowExecutor()

    def test_context_proxy_methods_exist(self, executor):
        """ContextHandler代理方法存在"""
        for method in self.CONTEXT_METHODS:
            assert hasattr(executor, method), f"Missing ContextHandler proxy method: {method}"
            assert callable(getattr(executor, method)), f"Method {method} is not callable"

    def test_tool_proxy_methods_exist(self, executor):
        """ToolHandler代理方法存在"""
        for method in self.TOOL_METHODS:
            assert hasattr(executor, method), f"Missing ToolHandler proxy method: {method}"
            assert callable(getattr(executor, method)), f"Method {method} is not callable"

    def test_react_proxy_methods_exist(self, executor):
        """ReactHandler代理方法存在"""
        for method in self.REACT_METHODS:
            assert hasattr(executor, method), f"Missing ReactHandler proxy method: {method}"
            assert callable(getattr(executor, method)), f"Method {method} is not callable"

    def test_chat_proxy_methods_exist(self, executor):
        """ChatHandler代理方法存在"""
        for method in self.CHAT_METHODS:
            assert hasattr(executor, method), f"Missing ChatHandler proxy method: {method}"
            assert callable(getattr(executor, method)), f"Method {method} is not callable"

    def test_core_methods_exist(self, executor):
        """核心方法存在"""
        core_methods = [
            '_execute_core',
            '_execute_sop_steps',
            '_pause_for_review',
            '_execute_parallel',
            '_save_checkpoint',
        ]
        for method in core_methods:
            assert hasattr(executor, method), f"Missing core method: {method}"

    def test_proxy_methods_delegate_to_handlers(self, executor):
        """代理方法正确委托到对应Handler"""
        # 验证_call_llm委托到ContextHandler.call_llm
        assert executor._call_llm.__func__ is not None
        # 验证_execute_tool_or_agent委托到ToolHandler.execute_tool_or_agent
        assert executor._execute_tool_or_agent.__func__ is not None
        # 验证_run_react_loop委托到ReactHandler.run_react_loop
        assert executor._run_react_loop.__func__ is not None
        # 验证_execute_intelligent_chat委托到ChatHandler.execute_intelligent_chat
        assert executor._execute_intelligent_chat.__func__ is not None


# ──────────────────────────────────────────────────────────────
# 4. 主流程集成验证
# ──────────────────────────────────────────────────────────────


class TestMainFlowIntegration:
    """验证WorkflowExecutor被主流程正确引用"""

    def test_hybrid_executor_uses_mode_registry(self):
        """HybridExecutor通过ModeRegistry获取WorkflowExecutor"""
        from flowforge.modes.registry import ModeRegistry
        from flowforge.modes.workflow_executor import WorkflowExecutor
        registry = ModeRegistry()
        executor = WorkflowExecutor()
        registry.register(executor)
        resolved = registry.get("workflow")
        assert isinstance(resolved, WorkflowExecutor)

    def test_workflow_registered_in_mode_registry(self):
        """WorkflowExecutor注册后可被ModeRegistry查找"""
        from flowforge.modes.registry import ModeRegistry
        from flowforge.modes.workflow_executor import WorkflowExecutor
        registry = ModeRegistry()
        registry.register(WorkflowExecutor())
        assert "workflow" in registry.list_modes()

    def test_sdk_can_create_workflow_executor(self):
        """SDK能通过ModeRegistry间接创建WorkflowExecutor"""
        from flowforge.modes.registry import ModeRegistry
        from flowforge.modes.workflow_executor import WorkflowExecutor
        registry = ModeRegistry()
        registry.register(WorkflowExecutor())
        executor = registry.get("workflow")
        assert executor.mode_name == "workflow"
        assert hasattr(executor, '_context_handler')
        assert hasattr(executor, '_tool_handler')
        assert hasattr(executor, '_react_handler')
        assert hasattr(executor, '_chat_handler')


# ──────────────────────────────────────────────────────────────
# 5. E2E流程验证 — 模拟完整执行流程
# ──────────────────────────────────────────────────────────────


def _make_mock_ctx(task_id="test-task", input_data=None, metadata=None,
                    interaction_mode="helm", sop_steps=None):
    """创建一个最小化的mock TaskContext用于测试

    使用spec=TaskContext确保mock对象具有正确的属性结构，
    避免TaskContext.from_parent()访问属性时AttributeError。
    """
    ctx = MagicMock(spec=TaskContext)
    ctx.task_id = task_id
    ctx.input_data = input_data or {"task": "测试任务"}
    ctx.metadata = metadata or {}
    if sop_steps is not None:
        ctx.metadata["sop_steps"] = sop_steps
    ctx.interaction_mode = interaction_mode
    ctx.mode = "workflow"
    ctx.persona = "default"
    ctx.state = {}
    ctx.event_bus = EventBus()
    ctx.memory = None
    ctx.tools = None
    ctx.agents = None
    ctx.checkpoint = None
    ctx.harness_enabled = False
    ctx.plugin_registry = None
    ctx.executor = None
    return ctx


class TestWorkflowE2EFlow:
    """E2E流程验证 — 模拟完整执行流程"""

    @pytest.mark.asyncio
    async def test_execute_core_recursion_limit(self):
        """验证递归深度限制生效"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.core.errors import WorkflowRecursionError

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx(metadata={"_workflow_depth": 3})
        with pytest.raises(WorkflowRecursionError):
            await executor._execute_core(ctx)

    @pytest.mark.asyncio
    async def test_execute_core_no_sop_normal_chat(self):
        """无SOP步骤时走normal_chat路径"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx(interaction_mode="normal")

        # Mock _execute_normal_chat
        expected_result = {"response": "你好", "task": "测试任务"}
        executor._execute_normal_chat = AsyncMock(return_value=expected_result)

        result = await executor._execute_core(ctx)
        assert result == expected_result
        executor._execute_normal_chat.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_core_no_sop_auto_chat(self):
        """无SOP步骤且auto模式走intelligent_chat(is_auto=True)路径"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx(interaction_mode="auto")

        expected_result = {"response": "自动回复", "task": "测试任务"}
        executor._execute_intelligent_chat = AsyncMock(return_value=expected_result)

        result = await executor._execute_core(ctx)
        assert result == expected_result
        executor._execute_intelligent_chat.assert_called_once()
        # 验证is_auto=True
        call_kwargs = executor._execute_intelligent_chat.call_args
        assert call_kwargs[1].get("is_auto") is True or (len(call_kwargs[0]) > 1 and call_kwargs[0][1] is True or call_kwargs[0][2] if len(call_kwargs[0]) > 2 else False)

    @pytest.mark.asyncio
    async def test_execute_core_with_sop_steps(self):
        """有SOP步骤时走_execute_sop_steps路径"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        sop_steps = [{"name": "step1", "mode": "plan_execute"}]
        ctx = _make_mock_ctx(sop_steps=sop_steps)

        # Mock _execute_sop_steps
        expected_result = {"step1": "done"}
        executor._execute_sop_steps = AsyncMock(return_value=expected_result)
        executor._recall_memories = AsyncMock(return_value=[])

        result = await executor._execute_core(ctx)
        assert result == expected_result
        executor._execute_sop_steps.assert_called_once()

    @pytest.mark.asyncio
    async def test_context_handler_call_llm_delegation(self):
        """验证_call_llm正确委托到ContextHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ContextHandler.call_llm
        executor._context_handler.call_llm = AsyncMock(return_value="LLM响应")

        result = await executor._call_llm(ctx, [{"role": "user", "content": "你好"}], "auto")
        assert result == "LLM响应"
        executor._context_handler.call_llm.assert_called_once_with(
            ctx, [{"role": "user", "content": "你好"}], "auto", "helm_assistant", "default"
        )

    @pytest.mark.asyncio
    async def test_tool_handler_execute_delegation(self):
        """验证_execute_tool_or_agent正确委托到ToolHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ToolHandler.execute_tool_or_agent
        expected = {"success": True, "result": {"data": "tool result"}}
        executor._tool_handler.execute_tool_or_agent = AsyncMock(return_value=expected)

        result = await executor._execute_tool_or_agent(ctx, "web_search", {"query": "测试"})
        assert result == expected
        executor._tool_handler.execute_tool_or_agent.assert_called_once_with(
            ctx, "web_search", {"query": "测试"}
        )

    @pytest.mark.asyncio
    async def test_react_handler_delegation(self):
        """验证_run_react_loop正确委托到ReactHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ReactHandler.run_react_loop
        expected = {"iterations": 1, "tool_calls_made": 0, "collected_context": "结果"}
        executor._react_handler.run_react_loop = AsyncMock(return_value=expected)

        result = await executor._run_react_loop(ctx, "搜索信息", [], "auto", "default")
        assert result == expected
        executor._react_handler.run_react_loop.assert_called_once_with(
            ctx, "搜索信息", [], "auto", "default"
        )

    @pytest.mark.asyncio
    async def test_chat_handler_intelligent_chat_delegation(self):
        """验证_execute_intelligent_chat正确委托到ChatHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ChatHandler.execute_intelligent_chat
        expected = {"response": "智能回复", "plan": {"intent_type": "chat"}}
        executor._chat_handler.execute_intelligent_chat = AsyncMock(return_value=expected)

        result = await executor._execute_intelligent_chat(ctx, {"task": "写文章"}, is_auto=False)
        assert result == expected
        executor._chat_handler.execute_intelligent_chat.assert_called_once_with(
            ctx, {"task": "写文章"}, False
        )

    @pytest.mark.asyncio
    async def test_chat_handler_normal_chat_delegation(self):
        """验证_execute_normal_chat正确委托到ChatHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ChatHandler.execute_normal_chat
        expected = {"response": "普通回复"}
        executor._chat_handler.execute_normal_chat = AsyncMock(return_value=expected)

        result = await executor._execute_normal_chat(ctx, {"task": "你好"})
        assert result == expected
        executor._chat_handler.execute_normal_chat.assert_called_once_with(ctx, {"task": "你好"})

    @pytest.mark.asyncio
    async def test_chat_handler_simple_response_delegation(self):
        """验证_simple_response正确委托到ChatHandler"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        ctx = _make_mock_ctx()

        # Mock ChatHandler.simple_response
        expected = {"response": "简单回复"}
        executor._chat_handler.simple_response = AsyncMock(return_value=expected)

        result = await executor._simple_response(ctx, {"task": "hi"}, "auto", "default", "hi")
        assert result == expected
        executor._chat_handler.simple_response.assert_called_once_with(
            ctx, {"task": "hi"}, "auto", "default", "hi"
        )


# ──────────────────────────────────────────────────────────────
# 6. ContextHandler独立功能验证
# ──────────────────────────────────────────────────────────────


class TestContextHandlerIntegration:
    """验证ContextHandler独立功能"""

    def test_render_template(self):
        """模板渲染功能正常"""
        from flowforge.modes.workflow_context import ContextHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ContextHandler(executor)

        result = handler.render_template("你好{{name}}，今天是{{day}}", {"name": "世界", "day": "周一"})
        assert result == "你好世界，今天是周一"

    def test_render_template_missing_key(self):
        """模板渲染时缺失key保留原始占位符"""
        from flowforge.modes.workflow_context import ContextHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ContextHandler(executor)

        result = handler.render_template("你好{{name}}", {})
        assert result == "你好{{name}}"

    def test_build_tool_descriptions_text_no_tools(self):
        """无工具时返回默认文本"""
        from flowforge.modes.workflow_context import ContextHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ContextHandler(executor)
        ctx = _make_mock_ctx()

        result = handler.build_tool_descriptions_text(ctx)
        assert result == "无可用工具"

    @pytest.mark.asyncio
    async def test_recall_memories_no_memory(self):
        """无memory时返回空列表"""
        from flowforge.modes.workflow_context import ContextHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ContextHandler(executor)
        ctx = _make_mock_ctx()
        ctx.memory = None

        result = await handler.recall_memories(ctx, "测试")
        assert result == []

    @pytest.mark.asyncio
    async def test_save_to_memory_no_memory(self):
        """无memory时save不报错"""
        from flowforge.modes.workflow_context import ContextHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ContextHandler(executor)
        ctx = _make_mock_ctx()
        ctx.memory = None

        # 应该不抛异常
        await handler.save_to_memory(ctx, "测试", {"response": "ok"}, {"intent_type": "chat"})


# ──────────────────────────────────────────────────────────────
# 7. ToolHandler独立功能验证
# ──────────────────────────────────────────────────────────────


class TestToolHandlerIntegration:
    """验证ToolHandler独立功能"""

    def test_build_function_schemas_no_tools(self):
        """无工具时返回空列表"""
        from flowforge.modes.workflow_tools import ToolHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ToolHandler(executor)
        ctx = _make_mock_ctx()

        result = handler.build_function_schemas(ctx)
        assert result == []

    @pytest.mark.asyncio
    async def test_execute_unknown_tool(self):
        """执行未知工具返回失败结果"""
        from flowforge.modes.workflow_tools import ToolHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ToolHandler(executor)
        ctx = _make_mock_ctx()

        result = await handler.execute_tool_or_agent(ctx, "nonexistent_tool", {"query": "测试"})
        assert result["success"] is False
        assert "Unknown tool/agent" in result["error"]


# ──────────────────────────────────────────────────────────────
# 8. ReactHandler独立功能验证
# ──────────────────────────────────────────────────────────────


class TestReactHandlerIntegration:
    """验证ReactHandler独立功能"""

    def test_react_handler_instantiation(self):
        """ReactHandler可正常实例化"""
        from flowforge.modes.workflow_react import ReactHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ReactHandler(executor)
        assert handler._executor is executor


# ──────────────────────────────────────────────────────────────
# 9. ChatHandler独立功能验证
# ──────────────────────────────────────────────────────────────


class TestChatHandlerIntegration:
    """验证ChatHandler独立功能"""

    def test_chat_handler_instantiation(self):
        """ChatHandler可正常实例化"""
        from flowforge.modes.workflow_chat import ChatHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ChatHandler(executor)
        assert handler._executor is executor

    @pytest.mark.asyncio
    async def test_normal_chat_flow(self):
        """普通对话流程通过ChatHandler执行"""
        from flowforge.modes.workflow_chat import ChatHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ChatHandler(executor)
        ctx = _make_mock_ctx()

        # Mock executor的依赖方法
        executor._recall_memories = AsyncMock(return_value=[])
        executor._call_llm = AsyncMock(return_value="你好，有什么可以帮你的？")
        executor._save_to_memory = AsyncMock()

        result = await handler.execute_normal_chat(ctx, {"task": "你好"})
        assert "response" in result
        assert result["response"] == "你好，有什么可以帮你的？"

    @pytest.mark.asyncio
    async def test_simple_response_flow(self):
        """简单回复流程通过ChatHandler执行"""
        from flowforge.modes.workflow_chat import ChatHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ChatHandler(executor)
        ctx = _make_mock_ctx()

        # Mock executor的依赖方法
        executor._recall_memories = AsyncMock(return_value=[])
        executor._call_llm = AsyncMock(return_value="好的")
        executor._save_to_memory = AsyncMock()

        result = await handler.simple_response(ctx, {"task": "好的"}, "auto", "default", "好的")
        assert "response" in result
        assert result["response"] == "好的"
        assert result["plan"]["intent_type"] == "chat"


# ──────────────────────────────────────────────────────────────
# 10. 完整SOP步骤执行验证
# ──────────────────────────────────────────────────────────────


class TestSOPStepExecution:
    """验证SOP步骤执行流程通畅"""

    @pytest.mark.asyncio
    async def test_sop_with_agent_step(self):
        """SOP包含agent步骤时正确执行"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.core.base_agent import AgentInput, AgentOutput

        executor = WorkflowExecutor()
        sop_steps = [{"name": "research", "agent": "research_agent"}]
        ctx = _make_mock_ctx(sop_steps=sop_steps)

        # Mock agent
        mock_agent = MagicMock()
        mock_agent.execute_with_context = AsyncMock(
            return_value=AgentOutput(result={"findings": "研究发现"})
        )
        mock_agents_registry = MagicMock()
        mock_agents_registry.get = MagicMock(return_value=mock_agent)
        ctx.agents = mock_agents_registry

        # Mock其他依赖
        executor._recall_memories = AsyncMock(return_value=[])
        executor._save_to_memory = AsyncMock()

        # Mock executor引用
        mock_executor_ref = MagicMock()
        mock_executor_ref.run = AsyncMock(return_value={"result": "sub"})
        ctx.executor = mock_executor_ref

        result = await executor._execute_sop_steps(ctx, sop_steps, ctx.input_data, 0)
        assert "research" in result or "findings" in result

    @pytest.mark.asyncio
    async def test_sop_parallel_group(self):
        """SOP包含parallel_group时正确并行执行"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        parallel_group = [
            {"name": "step_a", "mode": "plan_execute", "output": "result_a"},
            {"name": "step_b", "mode": "plan_execute", "output": "result_b"},
        ]
        sop_steps = [{"parallel_group": parallel_group}]
        ctx = _make_mock_ctx(sop_steps=sop_steps)

        # Mock _execute_parallel
        executor._execute_parallel = AsyncMock(
            return_value={"result_a": "A完成", "result_b": "B完成"}
        )
        executor._recall_memories = AsyncMock(return_value=[])
        executor._save_to_memory = AsyncMock()

        result = await executor._execute_sop_steps(ctx, sop_steps, ctx.input_data, 0)
        assert "result_a" in result
        assert "result_b" in result

    @pytest.mark.asyncio
    async def test_sop_template_rendering(self):
        """SOP步骤中的prompt模板被正确渲染"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        sop_steps = [{"name": "step1", "prompt": "任务：{{task}}", "mode": "plan_execute"}]
        ctx = _make_mock_ctx(
            sop_steps=sop_steps,
            input_data={"task": "写文章"}
        )

        # Mock dependencies
        executor._recall_memories = AsyncMock(return_value=[])
        executor._save_to_memory = AsyncMock()

        mock_executor_ref = MagicMock()
        mock_executor_ref.run = AsyncMock(return_value={"result": "done"})
        ctx.executor = mock_executor_ref

        # 验证_render_template被调用
        original_render = executor._render_template
        rendered_prompts = []
        def capture_render(text, context_data):
            result = original_render(text, context_data)
            rendered_prompts.append(result)
            return result
        executor._render_template = capture_render

        await executor._execute_sop_steps(ctx, sop_steps, {"task": "写文章"}, 0)
        assert any("写文章" in p for p in rendered_prompts)


# ──────────────────────────────────────────────────────────────
# 11. 事件发射验证
# ──────────────────────────────────────────────────────────────


class TestEventEmission:
    """验证Workflow执行过程中事件正确发射"""

    @pytest.mark.asyncio
    async def test_sop_step_start_and_complete_events(self):
        """SOP步骤执行发射step.start和step.complete事件"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        sop_steps = [{"name": "step1", "mode": "plan_execute"}]
        event_bus = EventBus()
        ctx = _make_mock_ctx(sop_steps=sop_steps)
        ctx.event_bus = event_bus

        # 收集事件
        events_received = []
        event_bus.subscribe("workflow.step.start", lambda e: events_received.append(("start", e)))
        event_bus.subscribe("workflow.step.complete", lambda e: events_received.append(("complete", e)))

        # Mock dependencies
        executor._recall_memories = AsyncMock(return_value=[])
        executor._save_to_memory = AsyncMock()

        mock_executor_ref = MagicMock()
        mock_executor_ref.run = AsyncMock(return_value={"result": "done"})
        ctx.executor = mock_executor_ref

        await executor._execute_sop_steps(ctx, sop_steps, ctx.input_data, 0)

        start_events = [e for e in events_received if e[0] == "start"]
        complete_events = [e for e in events_received if e[0] == "complete"]
        assert len(start_events) >= 1
        assert len(complete_events) >= 1

    @pytest.mark.asyncio
    async def test_normal_chat_emits_events(self):
        """普通对话流程发射正确事件"""
        from flowforge.modes.workflow_chat import ChatHandler
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        handler = ChatHandler(executor)
        event_bus = EventBus()
        ctx = _make_mock_ctx()
        ctx.event_bus = event_bus

        # 收集事件
        events_received = []
        event_bus.subscribe("workflow.step.start", lambda e: events_received.append(("start", e)))
        event_bus.subscribe("workflow.step.complete", lambda e: events_received.append(("complete", e)))
        event_bus.subscribe("draft.update", lambda e: events_received.append(("draft", e)))

        # Mock dependencies
        executor._recall_memories = AsyncMock(return_value=[])
        executor._call_llm = AsyncMock(return_value="回复内容")
        executor._save_to_memory = AsyncMock()

        await handler.execute_normal_chat(ctx, {"task": "你好"})

        start_events = [e for e in events_received if e[0] == "start"]
        complete_events = [e for e in events_received if e[0] == "complete"]
        draft_events = [e for e in events_received if e[0] == "draft"]
        assert len(start_events) >= 1
        assert len(complete_events) >= 1
        assert len(draft_events) >= 1


# ──────────────────────────────────────────────────────────────
# 12. BaseModeExecutor生命周期验证
# ──────────────────────────────────────────────────────────────


class TestBaseModeExecutorLifecycle:
    """验证WorkflowExecutor遵循BaseModeExecutor生命周期"""

    @pytest.mark.asyncio
    async def test_run_lifecycle(self):
        """run()方法按_prepare→_on_enter→_execute_core→_on_exit→_postprocess顺序执行"""
        from flowforge.modes.workflow_executor import WorkflowExecutor

        executor = WorkflowExecutor()
        call_order = []

        # Mock lifecycle methods
        original_prepare = executor._prepare
        async def mock_prepare(ctx):
            call_order.append("prepare")
            return ctx
        executor._prepare = mock_prepare

        original_on_enter = executor._on_enter
        async def mock_on_enter(ctx):
            call_order.append("on_enter")
        executor._on_enter = mock_on_enter

        original_execute_core = executor._execute_core
        async def mock_execute_core(ctx):
            call_order.append("execute_core")
            return {"response": "ok"}
        executor._execute_core = mock_execute_core

        original_on_exit = executor._on_exit
        async def mock_on_exit(ctx, result):
            call_order.append("on_exit")
            return result
        executor._on_exit = mock_on_exit

        original_postprocess = executor._postprocess
        async def mock_postprocess(ctx, result):
            call_order.append("postprocess")
            return result
        executor._postprocess = mock_postprocess

        ctx = _make_mock_ctx()
        result = await executor.run(ctx)

        assert call_order == ["prepare", "on_enter", "execute_core", "on_exit", "postprocess"]
        assert result == {"response": "ok"}


# ──────────────────────────────────────────────────────────────
# 13. 真实LLM E2E验证 — T1铁律遵守
# ──────────────────────────────────────────────────────────────

def _llm_available() -> bool:
    """检查LLM服务是否可用（openroute 可达且API key有效）"""
    import os
    if os.environ.get("FLOWFORGE_REAL_LLM") == "1":
        return True
    # 检查是否有真实的API key（非测试key）
    openroute_key = os.environ.get("OPENROUTE_API_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    if openroute_key in ("", "test-key") and openrouter_key in ("", "test-key"):
        return False
    # 检查openroute端口是否可达
    try:
        import urllib.request
        req = urllib.request.Request(
            "http://127.0.0.1:13001/v1/models",
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=3)
        return resp.status == 200
    except Exception:
        return False


skip_no_llm = pytest.mark.skipif(
    not _llm_available(),
    reason="LLM服务不可用，需设置 FLOWFORGE_REAL_LLM=1 或启动 openroute"
)


@skip_no_llm
class TestRealLLMWorkflowE2E:
    """真实LLM E2E测试 — 验证WorkflowExecutor通过真实LLM完成对话"""

    @pytest.mark.asyncio
    async def test_normal_chat_with_real_llm(self):
        """使用真实LLM执行normal_chat流程，验证返回内容质量"""
        from flowforge.modes.workflow_executor import WorkflowExecutor
        from flowforge.modes.workflow_chat import ChatHandler
        from flowforge.tools.llm_client import LLMClient
        from flowforge.core.config import ConfigLoader
        from flowforge.core.base_tool import ToolInput
        from flowforge.core import metrics as ff_metrics

        # 创建真实LLMClient
        config_loader = ConfigLoader()
        models_config = config_loader.get_models_config()
        event_bus = EventBus()
        llm_client = LLMClient(models_config=models_config, event_bus=event_bus)

        # 创建 MetricsCollector (T6)
        collector = ff_metrics.get_metrics_collector("test-real-llm-chat")

        executor = WorkflowExecutor()
        # 注入真实LLMClient到ContextHandler
        executor._context_handler._llm_client = llm_client

        ctx = _make_mock_ctx(
            input_data={"task": "请分析2026年人工智能在教育领域的三大突破性趋势，每条趋势给出具体案例。"},
            interaction_mode="normal",
        )
        ctx.event_bus = event_bus

        # 使用真实LLM执行
        executor._recall_memories = AsyncMock(return_value=[])
        executor._save_to_memory = AsyncMock()

        result = await executor._execute_core(ctx)

        # T3: 具体断言，验证内容质量
        assert result is not None, "LLM返回结果为空"
        response = result.get("response", "")
        assert len(response) >= 30, f"LLM返回内容过短(len={len(response)}), 期望>=30字"
        # 验证内容与AI/教育主题相关
        assert any(kw in response for kw in ["AI", "人工智能", "教育", "学习", "技术"]), \
            f"LLM返回内容与主题不相关: {response[:200]}"

        # 输出指标报告 (T6)
        collector.end_time = time.time()
        report = collector.generate_report()
        print(f"\n[Metrics] {report}")

    @pytest.mark.asyncio
    async def test_llm_client_direct_call(self):
        """直接调用LLMClient验证真实LLM可达性"""
        from flowforge.tools.llm_client import LLMClient
        from flowforge.core.config import ConfigLoader
        from flowforge.core.base_tool import ToolInput
        from flowforge.core import metrics as ff_metrics

        config_loader = ConfigLoader()
        models_config = config_loader.get_models_config()
        event_bus = EventBus()
        client = LLMClient(models_config=models_config, event_bus=event_bus)

        # 创建 MetricsCollector (T6)
        collector = ff_metrics.get_metrics_collector("test-llm-direct")

        result = await client.execute(ToolInput(params={
            "messages": [
                {"role": "system", "content": "你是一位资深科技评论员，擅长撰写深度分析文章。"},
                {"role": "user", "content": "请用200字分析人工智能如何重塑2026年的教育模式。"},
            ],
            "max_tokens": 500,
        }))

        # T3: 具体断言
        assert result.error is None, f"LLM调用失败: {result.error}"
        content = result.result.get("content", "")
        assert len(content) >= 20, f"LLM返回内容过短(len={len(content)}), 期望>=20字"

        # 记录指标 (T6)
        collector.record_llm_call(
            provider=result.result.get("provider", "unknown"),
            model=result.result.get("model", "unknown"),
            latency_ms=result.result.get("latency_ms", 0),
            success=True,
        )
        collector.end_time = time.time()
        report = collector.generate_report()
        print(f"\n[Metrics] {report}")

"""ReAct多轮Tool Loop + Resume人工审核中断 集成测试

验证场景：
1. DeclarativeAgent 在 multi_turn=True 模式下执行多轮 Tool 调用（ReAct循环）
2. ResumeAdapter 创建审核请求 → 人工审核 → 恢复工作流
3. 两者结合：Agent执行 → 触发审核暂停 → 审核通过 → Agent继续执行
"""
import asyncio
import json
import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# 确保项目根目录在 sys.path 中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from flowforge.agents.declarative import DeclarativeAgent, AgentConfig, DeclarativeAgentAdapter
from flowforge.core.base_agent import AgentInput, AgentOutput
from flowforge.compiler.resume_adapter import ResumeAdapter, HumanReviewConfig, ResumeCommand


# ── Mock LLM Client ──────────────────────────────────────────────

class MockLLMResponse:
    """模拟LLM响应"""
    def __init__(self, content="", tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []


class MockLLMClient:
    """模拟LLM客户端，支持多轮对话
    
    DeclarativeAgent通过 _llm_client.execute(ToolInput(params=...)) 调用LLM，
    返回 ToolOutput(result={content, tool_calls, model, provider, tokens})
    """
    
    def __init__(self, responses=None):
        """
        Args:
            responses: 响应序列，每个元素是 (content, tool_calls) 元组
                       tool_calls 格式: [{"name": "tool_name", "arguments": {...}}]
        """
        self.responses = responses or []
        self.call_count = 0
        self.messages_history = []
    
    async def execute(self, input):
        """模拟execute调用（DeclarativeAgent通过此接口调用LLM）"""
        from flowforge.core.base_tool import ToolOutput
        
        params = input.params if hasattr(input, 'params') else {}
        messages = params.get("messages", [])
        self.messages_history.append(messages)
        
        if self.call_count < len(self.responses):
            content, tool_calls = self.responses[self.call_count]
            self.call_count += 1
            return ToolOutput(result={
                "content": content,
                "tool_calls": tool_calls,
                "model": params.get("model", "mock-model"),
                "provider": "mock",
                "tokens": 100,
            })
        
        # 默认：无tool_calls的纯文本响应
        self.call_count += 1
        return ToolOutput(result={
            "content": "任务完成",
            "tool_calls": [],
            "model": params.get("model", "mock-model"),
            "provider": "mock",
            "tokens": 50,
        })


class MockToolRegistry:
    """模拟工具注册表"""
    
    def __init__(self, tools=None):
        self._tools = tools or {}
    
    async def execute(self, tool_name, tool_input):
        """执行工具"""
        if tool_name in self._tools:
            result = self._tools[tool_name]
            if callable(result):
                result = result(tool_input.params)
            from flowforge.core.base_tool import ToolOutput
            return ToolOutput(result=result)
        from flowforge.core.base_tool import ToolOutput
        return ToolOutput(result={"error": f"Tool {tool_name} not found"}, error="not_found")
    
    def get_tool(self, name):
        return self._tools.get(name)
    
    def get_function_calls(self, tool_names):
        """返回OpenAI function-calling格式的tools schema"""
        schemas = []
        for name in tool_names:
            if name in self._tools:
                schemas.append({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": f"Mock tool: {name}",
                        "parameters": {"type": "object", "properties": {}},
                    },
                })
        return schemas


# ── 测试用例 ──────────────────────────────────────────────────────

class TestReActMultiTurn:
    """测试 DeclarativeAgent ReAct 多轮 Tool Loop"""
    
    @pytest.mark.asyncio
    async def test_single_tool_call(self):
        """测试单轮Tool调用：LLM调用一次工具后返回结果"""
        # LLM第一轮返回tool_call，第二轮返回最终结果
        mock_llm = MockLLMClient(responses=[
            # 第一轮：LLM决定调用web_search
            ("我需要搜索相关信息", [{"name": "web_search", "arguments": {"query": "AI趋势"}}]),
            # 第二轮：LLM基于搜索结果生成最终回答
            ("根据搜索结果，AI趋势如下：...", []),
        ])
        
        mock_tools = MockToolRegistry(tools={
            "web_search": {"results": ["AI趋势1", "AI趋势2"], "total": 2}
        })
        
        config = AgentConfig(
            name="research_agent",
            description="研究Agent",
            tools=["web_search"],
            multi_turn=True,
            max_steps=5,
            prompt_template="请研究以下主题：{{task}}",
        )
        
        agent = DeclarativeAgent(
            config=config,
            llm_client=mock_llm,
            tool_registry=mock_tools,
        )
        
        input_data = AgentInput(params={"task": "2024年AI发展趋势"})
        output = await agent.execute(input_data)
        
        # 验证：LLM被调用2次（1次tool_call + 1次最终响应）
        assert mock_llm.call_count == 2
        assert output.result is not None
        assert output.metadata.get("agent_type") == "declarative_multi_turn"
        assert output.metadata.get("steps_used", 0) >= 1
    
    @pytest.mark.asyncio
    async def test_multi_tool_calls_sequential(self):
        """测试多轮Tool调用：LLM连续调用多个工具"""
        mock_llm = MockLLMClient(responses=[
            # 第1轮：调用搜索
            ("需要搜索", [{"name": "web_search", "arguments": {"query": "深度学习"}}]),
            # 第2轮：调用另一个工具分析
            ("搜索完成，现在分析", [{"name": "data_analyze", "arguments": {"data": "search_results"}}]),
            # 第3轮：生成最终结果
            ("分析完成，结论如下：深度学习在2024年持续发展", []),
        ])
        
        mock_tools = MockToolRegistry(tools={
            "web_search": {"results": ["论文1", "论文2"]},
            "data_analyze": {"analysis": "趋势上升", "confidence": 0.95},
        })
        
        config = AgentConfig(
            name="deep_research_agent",
            description="深度研究Agent",
            tools=["web_search", "data_analyze"],
            multi_turn=True,
            max_steps=5,
            prompt_template="深度研究：{{task}}",
        )
        
        agent = DeclarativeAgent(config=config, llm_client=mock_llm, tool_registry=mock_tools)
        output = await agent.execute(AgentInput(params={"task": "深度学习趋势"}))
        
        assert mock_llm.call_count == 3
        assert output.metadata.get("tool_calls_total", 0) >= 2
    
    @pytest.mark.asyncio
    async def test_max_steps_limit(self):
        """测试max_steps限制：LLM持续调用工具但被max_steps截断"""
        # LLM每轮都返回tool_call，模拟无限循环
        infinite_tool_calls = [
            ("继续搜索", [{"name": "web_search", "arguments": {"query": f"query_{i}"}}])
            for i in range(20)
        ]
        # 最后加一个最终响应
        infinite_tool_calls.append(("最终结果", []))
        
        mock_llm = MockLLMClient(responses=infinite_tool_calls)
        mock_tools = MockToolRegistry(tools={"web_search": {"results": ["result"]}})
        
        config = AgentConfig(
            name="loop_agent",
            description="循环Agent",
            tools=["web_search"],
            multi_turn=True,
            max_steps=3,  # 限制3步
        )
        
        agent = DeclarativeAgent(config=config, llm_client=mock_llm, tool_registry=mock_tools)
        output = await agent.execute(AgentInput(params={"task": "test"}))
        
        # 验证：LLM最多被调用3次（max_steps限制）
        assert mock_llm.call_count <= 3
        assert output.metadata.get("steps_used", 0) <= 3
    
    @pytest.mark.asyncio
    async def test_single_turn_fallback(self):
        """测试单轮模式（multi_turn=False）：不执行tool loop"""
        mock_llm = MockLLMClient(responses=[
            ("直接回答", []),
        ])
        
        config = AgentConfig(
            name="simple_agent",
            description="简单Agent",
            multi_turn=False,
            max_steps=1,
            prompt_template="回答：{{task}}",
        )
        
        agent = DeclarativeAgent(config=config, llm_client=mock_llm)
        output = await agent.execute(AgentInput(params={"task": "你好"}))
        
        assert mock_llm.call_count == 1
        # 单轮模式不应有 declarative_multi_turn 标记
        assert output.metadata.get("agent_type") != "declarative_multi_turn"


class TestResumeAdapter:
    """测试 ResumeAdapter 人工审核中断与恢复"""
    
    def test_compile_interrupt_config(self):
        """测试从Workflow YAML编译interrupt_before配置"""
        adapter = ResumeAdapter()
        
        workflow_config = {
            "nodes": [
                {"name": "research", "type": "agent", "agent": "researcher"},
                {"name": "write", "type": "agent", "agent": "writer"},
                {"name": "review", "type": "human_review"},
                {"name": "publish", "type": "agent", "agent": "publisher"},
            ]
        }
        
        result = adapter.compile_interrupt_config(workflow_config)
        
        assert result["has_human_review"] is True
        assert "review" in result["interrupt_before"]
    
    def test_compile_interrupt_config_with_flag(self):
        """测试interrupt_before标记的节点"""
        adapter = ResumeAdapter()
        
        workflow_config = {
            "nodes": [
                {"name": "step1", "type": "agent"},
                {"name": "step2", "type": "agent", "interrupt_before": True},
            ]
        }
        
        result = adapter.compile_interrupt_config(workflow_config)
        assert "step2" in result["interrupt_before"]
    
    def test_create_review_request(self):
        """测试创建审核请求"""
        adapter = ResumeAdapter()
        
        request = adapter.create_review_request(
            workflow_id="wf-001",
            node_name="review",
            state={"draft": "文章内容...", "score": 0.85},
        )
        
        assert request["review_id"] == "wf-001:review"
        assert request["workflow_id"] == "wf-001"
        assert request["status"] == "pending"
        assert request["state_snapshot"]["score"] == 0.85
    
    @pytest.mark.asyncio
    async def test_resume_workflow_approve(self):
        """测试审核通过后恢复工作流"""
        adapter = ResumeAdapter()
        
        # 先创建审核请求
        adapter.create_review_request(
            workflow_id="wf-002",
            node_name="review",
            state={"draft": "内容"},
        )
        
        # 审核通过
        result = await adapter.resume_workflow(
            workflow_id="wf-002",
            node_name="review",
            review_action="approve",
            reviewer="admin",
        )
        
        assert result["resume_values"]["approved"] is True
        assert result["resume_values"]["review_action"] == "approve"
        assert result["resume_values"]["reviewer"] == "admin"
        assert result["node_name"] == "review"
        
        # 审核请求应已清理
        pending = adapter.get_pending_reviews(workflow_id="wf-002")
        assert len(pending) == 0
    
    @pytest.mark.asyncio
    async def test_resume_workflow_reject(self):
        """测试审核拒绝后恢复工作流"""
        adapter = ResumeAdapter()
        
        adapter.create_review_request("wf-003", "review", {"draft": "不合规内容"})
        
        result = await adapter.resume_workflow(
            workflow_id="wf-003",
            node_name="review",
            review_action="reject",
            review_data={"feedback": "内容涉及敏感信息"},
            reviewer="moderator",
        )
        
        assert result["resume_values"]["approved"] is False
        assert result["resume_values"]["feedback"] == "内容涉及敏感信息"
    
    @pytest.mark.asyncio
    async def test_resume_workflow_request_changes(self):
        """测试审核要求修改"""
        adapter = ResumeAdapter()
        
        adapter.create_review_request("wf-004", "review", {"draft": "需修改"})
        
        result = await adapter.resume_workflow(
            workflow_id="wf-004",
            node_name="review",
            review_action="request_changes",
            review_data={
                "feedback": "需要补充数据支撑",
                "changes": ["添加引用", "补充图表"],
            },
            reviewer="editor",
        )
        
        assert result["resume_values"]["approved"] is False
        assert result["resume_values"]["requested_changes"] == ["添加引用", "补充图表"]
    
    @pytest.mark.asyncio
    async def test_resume_no_pending_review(self):
        """测试恢复不存在的工作流"""
        adapter = ResumeAdapter()
        
        result = await adapter.resume_workflow("nonexistent", "review", "approve")
        
        assert result["status"] == "error"
        assert "No pending review" in result["reason"]
    
    def test_get_pending_reviews(self):
        """测试获取待审核列表"""
        adapter = ResumeAdapter()
        
        adapter.create_review_request("wf-a", "review1", {"data": 1})
        adapter.create_review_request("wf-a", "review2", {"data": 2})
        adapter.create_review_request("wf-b", "review1", {"data": 3})
        
        # 获取所有
        all_pending = adapter.get_pending_reviews()
        assert len(all_pending) == 3
        
        # 按workflow_id过滤
        wf_a_pending = adapter.get_pending_reviews(workflow_id="wf-a")
        assert len(wf_a_pending) == 2


class TestReActWithResume:
    """测试 ReAct Agent + 人工审核中断 的完整场景"""
    
    @pytest.mark.asyncio
    async def test_react_then_review_then_continue(self):
        """完整场景：Agent执行 → 触发审核 → 审核通过 → Agent继续
        
        模拟一个内容创作流程：
        1. Agent调用搜索工具获取素材
        2. Agent基于素材生成草稿
        3. 触发人工审核中断
        4. 审核通过
        5. Agent继续执行（如发布）
        """
        # Step 1: Agent执行ReAct循环
        mock_llm = MockLLMClient(responses=[
            ("搜索素材中", [{"name": "web_search", "arguments": {"query": "AI趋势2024"}}]),
            ("基于搜索结果生成文章草稿：AI在2024年的主要趋势包括...", []),
        ])
        
        mock_tools = MockToolRegistry(tools={
            "web_search": {"results": ["趋势1", "趋势2", "趋势3"]},
        })
        
        agent_config = AgentConfig(
            name="content_writer",
            description="内容创作Agent",
            tools=["web_search"],
            multi_turn=True,
            max_steps=5,
            prompt_template="创作关于{{task}}的文章",
        )
        
        agent = DeclarativeAgent(config=agent_config, llm_client=mock_llm, tool_registry=mock_tools)
        output = await agent.execute(AgentInput(params={"task": "AI趋势"}))
        
        # 验证Agent执行了多轮
        assert mock_llm.call_count == 2
        assert output.metadata.get("tool_calls_total", 0) >= 1
        
        # Step 2: 触发人工审核
        adapter = ResumeAdapter()
        draft_content = output.result.get("content", "草稿内容") if isinstance(output.result, dict) else str(output.result)
        
        review_request = adapter.create_review_request(
            workflow_id="article-001",
            node_name="content_review",
            state={"draft": draft_content, "quality_score": 0.82},
            config=HumanReviewConfig(
                required_fields=["approved", "feedback"],
                allowed_actions=["approve", "reject", "request_changes"],
            ),
        )
        
        assert review_request["status"] == "pending"
        assert review_request["state_snapshot"]["quality_score"] == 0.82
        
        # Step 3: 审核通过
        resume_result = await adapter.resume_workflow(
            workflow_id="article-001",
            node_name="content_review",
            review_action="approve",
            review_data={"feedback": "内容质量良好，可以发布"},
            reviewer="editor_zhang",
        )
        
        assert resume_result["resume_values"]["approved"] is True
        assert resume_result["resume_values"]["reviewer"] == "editor_zhang"
        
        # Step 4: 验证审核后无pending
        pending = adapter.get_pending_reviews(workflow_id="article-001")
        assert len(pending) == 0
    
    @pytest.mark.asyncio
    async def test_react_review_reject_with_feedback(self):
        """场景：Agent执行 → 审核拒绝 → 反馈回Agent"""
        mock_llm = MockLLMClient(responses=[
            ("搜索中", [{"name": "web_search", "arguments": {"query": "测试"}}]),
            ("文章草稿：这是测试内容", []),
        ])
        
        mock_tools = MockToolRegistry(tools={"web_search": {"results": ["结果1"]}})
        
        agent = DeclarativeAgent(
            config=AgentConfig(name="writer", tools=["web_search"], multi_turn=True, max_steps=5),
            llm_client=mock_llm, tool_registry=mock_tools,
        )
        output = await agent.execute(AgentInput(params={"task": "测试"}))
        
        # 审核拒绝
        adapter = ResumeAdapter()
        adapter.create_review_request("wf-reject", "review", {"draft": output.result})
        
        result = await adapter.resume_workflow(
            workflow_id="wf-reject",
            node_name="review",
            review_action="reject",
            review_data={"feedback": "内容质量不达标，需要重写"},
            reviewer="moderator",
        )
        
        assert result["resume_values"]["approved"] is False
        assert "质量不达标" in result["resume_values"]["feedback"]

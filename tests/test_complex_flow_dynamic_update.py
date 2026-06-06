"""Multi-step complex flow tests for FlowForge Solo mode dynamic update logic.

Tests simulate realistic SOP workflows across different "Forge" projects
(ContentForge, DevForge, NovelForge, MallForge) and verify that the
EventBus → EventBusSoloAdapter → SoloManager pipeline correctly handles
multi-step sequences, retry loops, parallel tasks, and state transitions.

This is a unit/integration test suite — mock LLM is acceptable per project rules.
"""

import asyncio
from unittest.mock import patch

import pytest

from flowforge.events.event_bus import EventBus
from flowforge.events.solo_adapter import EventBusSoloAdapter, _event_to_message
from flowforge.core.workspace import WorkspaceManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MockSoloManager:
    """Records all emit_event calls for assertion."""

    def __init__(self):
        self.events: list[tuple[str, str, dict]] = []

    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        self.events.append((task_id, event_type, payload))


class FakeWorkspaceManager:
    """In-memory workspace manager that avoids filesystem I/O."""

    def __init__(self):
        self._messages: dict[str, list[dict]] = {}
        self._task_status: dict[str, str] = {}

    def save_message(self, task_id: str, message: dict):
        self._messages.setdefault(task_id, []).append(message)

    def load_messages(self, task_id: str) -> list[dict]:
        return self._messages.get(task_id, [])

    def update_task_status(self, task_id: str, status: str, **kwargs):
        self._task_status[task_id] = status


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def event_bus():
    return EventBus()


@pytest.fixture
def mock_solo_manager():
    return MockSoloManager()


@pytest.fixture
def fake_workspace():
    return FakeWorkspaceManager()


@pytest.fixture
def adapter(event_bus, mock_solo_manager):
    return EventBusSoloAdapter(event_bus, mock_solo_manager)


@pytest.fixture
def bridged_adapter(adapter):
    adapter.bridge()
    return adapter


# ===========================================================================
# 1. TestContentForgeDeepArticleFlow
# ===========================================================================

class TestContentForgeDeepArticleFlow:
    """Simulate ContentForge deep_article SOP:
    topic → research → writer → audit → review → publish
    """

    @pytest.mark.asyncio
    async def test_deep_article_full_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Full deep_article SOP: topic → research → writer → audit → review → publish.

        Verify every stage transition produces the correct Solo event sequence
        and that workspace messages are persisted in the right order.
        """
        task_id = "cf-deep-article-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Topic selection
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "topic", "label": "选题策划", "order": 1, "total": 6,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "web_search"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "web_search", "result": {"count": 8}})
            event_bus.emit(task_id, "draft.update", {
                "content": "AI教育公平性：技术如何弥合城乡差距",
                "is_partial": False,
                "agent_name": "TopicAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "topic", "label": "选题策划",
            })

            # Stage 2: Research
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "research", "label": "深度调研", "order": 2, "total": 6,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "helixrag_search"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "helixrag_search"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "research", "label": "深度调研",
            })

            # Stage 3: Writer
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "writer", "label": "文章创作", "order": 3, "total": 6,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "AI正在重塑教育资源配置方式...",
                "is_partial": True,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "AI正在重塑教育资源配置方式。在偏远山区，智能教学系统让每个孩子都能接触到优质课程...",
                "is_partial": False,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "writer", "label": "文章创作",
            })

            # Stage 4: Audit
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "audit", "label": "合规审核", "order": 4, "total": 6,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "fact_check"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "fact_check"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "audit", "label": "合规审核",
            })

            # Stage 5: Review
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "review", "label": "人工审核", "order": 5, "total": 6,
            })
            event_bus.emit(task_id, "review.ready", {
                "draft_summary": "文章《AI教育公平性》已通过合规审核，请人工确认发布",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "review", "label": "人工审核",
            })

            # Stage 6: Publish
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "publish", "label": "多平台发布", "order": 6, "total": 6,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "wechat_publish"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "wechat_publish"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "publish", "label": "多平台发布",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "文章已发布至微信公众号",
                "published_urls": ["https://mp.weixin.qq.com/s/ai-education-fairness"],
            })

            await asyncio.sleep(0.3)

        # ---- Assertions ----

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify stage enter/exit pairs for all 6 stages
        stage_enters = [p for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.stage.enter"]
        stage_exits = [p for tid, et, p in solo_mgr.events
                       if tid == task_id and et == "solo.stage.exit"]
        assert len(stage_enters) == 6, f"Expected 6 stage enters, got {len(stage_enters)}"
        assert len(stage_exits) == 6, f"Expected 6 stage exits, got {len(stage_exits)}"

        # 2) Verify stage labels appear in order
        enter_labels = [p.get("label") or p.get("stage") for p in stage_enters]
        assert enter_labels == [
            "选题策划", "深度调研", "文章创作", "合规审核", "人工审核", "多平台发布",
        ]

        # 3) Verify tool events
        tool_starts = [p for tid, et, p in solo_mgr.events
                       if tid == task_id and et == "solo.tool.start"]
        tool_names = [p.get("tool_name") for p in tool_starts]
        assert "web_search" in tool_names
        assert "helixrag_search" in tool_names
        assert "fact_check" in tool_names
        assert "wechat_publish" in tool_names

        # 4) Verify draft.update events (partial + final)
        draft_events = [p for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.draft.update"]
        assert len(draft_events) >= 2

        # 5) Verify review.ready
        review_events = [p for tid, et, p in solo_mgr.events
                         if tid == task_id and et == "solo.review.ready"]
        assert len(review_events) == 1
        assert "AI教育公平性" in review_events[0].get("draft_summary", "")

        # 6) Verify task completed
        completed_events = [p for tid, et, p in solo_mgr.events
                            if tid == task_id and et == "solo.task.completed"]
        assert len(completed_events) == 1
        assert completed_events[0]["result"] == "文章已发布至微信公众号"

        # 7) Verify workspace messages persisted
        msgs = fake_workspace.load_messages(task_id)
        assert len(msgs) > 0

        # 8) Verify task status
        assert fake_workspace._task_status.get(task_id) == "completed"

        # 9) Verify _event_to_message produces correct roles for key events
        stage_msg = _event_to_message("solo.stage.enter", {"stage": "topic", "label": "选题策划"})
        assert stage_msg is not None
        assert stage_msg["role"] == "stage"
        assert stage_msg["content"] == "选题策划"

        draft_final_msg = _event_to_message("solo.draft.update", {
            "content": "AI正在重塑教育资源配置方式。在偏远山区...",
            "is_partial": False,
            "agent_name": "WriterAgent",
        })
        assert draft_final_msg is not None
        assert draft_final_msg["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_deep_article_audit_retry(self, bridged_adapter, event_bus, fake_workspace):
        """Audit fails → retry writer → audit passes.

        Verify retry_count increments and the retry loop produces the
        correct event sequence.
        """
        task_id = "cf-deep-article-retry-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Topic
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "topic", "label": "选题策划", "order": 1, "total": 4,
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "topic", "label": "选题策划",
            })

            # Stage 2: Research
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "research", "label": "深度调研", "order": 2, "total": 4,
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "research", "label": "深度调研",
            })

            # Stage 3: Writer (first attempt)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "writer", "label": "文章创作", "order": 3, "total": 4,
                "retry_count": 0,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "初稿内容，存在事实性错误",
                "is_partial": False,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "writer", "label": "文章创作",
            })

            # Stage 4: Audit (fails)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "audit", "label": "合规审核", "order": 4, "total": 4,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "fact_check"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "fact_check", "result": {"passed": False}})
            event_bus.emit(task_id, "step.intermediate", {
                "step_name": "审核未通过：发现事实性错误，需重写",
                "retry_count": 1,
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "audit", "label": "合规审核",
            })

            # Stage 3 again: Writer (retry, retry_count=1)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "writer", "label": "文章创作(重试1)", "order": 3, "total": 4,
                "retry_count": 1,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "修正后稿件：经核实的数据与引用",
                "is_partial": False,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "writer", "label": "文章创作(重试1)",
            })

            # Stage 4 again: Audit (passes)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "audit", "label": "合规审核(重试1)", "order": 4, "total": 4,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "fact_check"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "fact_check", "result": {"passed": True}})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "audit", "label": "合规审核(重试1)",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "文章经重写后通过审核并发布",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify writer stage was entered twice (original + retry)
        writer_enters = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
            and (p.get("stage") == "writer" or "文章创作" in (p.get("label") or ""))
        ]
        assert len(writer_enters) == 2, f"Expected 2 writer enters, got {len(writer_enters)}"

        # 2) Verify retry_count in the second writer enter
        retry_enter = writer_enters[1]
        assert retry_enter.get("retry_count") == 1, \
            f"Expected retry_count=1 in second writer enter, got {retry_enter.get('retry_count')}"

        # 3) Verify audit stage was entered twice
        audit_enters = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
            and (p.get("stage") == "audit" or "合规审核" in (p.get("label") or ""))
        ]
        assert len(audit_enters) == 2

        # 4) Verify step.intermediate was emitted for the audit failure
        intermediate_events = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.step.intermediate"
        ]
        assert len(intermediate_events) >= 1
        assert intermediate_events[0].get("retry_count") == 1

        # 5) Verify task completed successfully (not error)
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "重写后通过审核" in completed[0].get("result", "")

        # 6) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"


# ===========================================================================
# 2. TestDevForgeCodeReviewFlow
# ===========================================================================

class TestDevForgeCodeReviewFlow:
    """Simulate DevForge code review SOP:
    code_writer → code_reviewer → test_generator → bug_analyzer
    """

    @pytest.mark.asyncio
    async def test_code_review_full_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Full code review flow: code_writer → code_reviewer → test_generator → bug_analyzer.

        Verify each agent stage emits correct events and the final task
        completes with the expected result.
        """
        task_id = "df-code-review-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Code Writer
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "code_writer", "label": "代码编写", "order": 1, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "CodeWriterAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "code_editor"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "code_editor"})
            event_bus.emit(task_id, "draft.update", {
                "content": "def calculate_fibonacci(n):\n    if n <= 1:\n        return n\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)",
                "is_partial": False,
                "agent_name": "CodeWriterAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "CodeWriterAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "code_writer", "label": "代码编写",
            })

            # Stage 2: Code Reviewer
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "code_reviewer", "label": "代码审查", "order": 2, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "CodeReviewerAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "static_analysis"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "static_analysis"})
            event_bus.emit(task_id, "draft.update", {
                "content": "审查意见：递归实现存在性能问题，建议使用动态规划优化",
                "is_partial": False,
                "agent_name": "CodeReviewerAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "CodeReviewerAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "code_reviewer", "label": "代码审查",
            })

            # Stage 3: Test Generator
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "test_generator", "label": "测试生成", "order": 3, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "TestGeneratorAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "test_runner"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "test_runner", "result": {"passed": 5, "failed": 0}})
            event_bus.emit(task_id, "agent.end", {"agent_name": "TestGeneratorAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "test_generator", "label": "测试生成",
            })

            # Stage 4: Bug Analyzer
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "bug_analyzer", "label": "缺陷分析", "order": 4, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "BugAnalyzerAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "未发现安全漏洞，性能问题已标记为低优先级",
                "is_partial": False,
                "agent_name": "BugAnalyzerAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "BugAnalyzerAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "bug_analyzer", "label": "缺陷分析",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "代码审查完成：5项测试通过，0项缺陷",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify 4 stage enter/exit pairs
        stage_enters = [et for tid, et, _ in solo_mgr.events
                        if tid == task_id and et == "solo.stage.enter"]
        stage_exits = [et for tid, et, _ in solo_mgr.events
                       if tid == task_id and et == "solo.stage.exit"]
        assert len(stage_enters) == 4
        assert len(stage_exits) == 4

        # 2) Verify agent events
        agent_starts = [p for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.agent.start"]
        agent_names = [p.get("agent_name") for p in agent_starts]
        assert "CodeWriterAgent" in agent_names
        assert "CodeReviewerAgent" in agent_names
        assert "TestGeneratorAgent" in agent_names
        assert "BugAnalyzerAgent" in agent_names

        # 3) Verify tool events
        tool_starts = [p.get("tool_name") for tid, et, p in solo_mgr.events
                       if tid == task_id and et == "solo.tool.start"]
        assert "code_editor" in tool_starts
        assert "static_analysis" in tool_starts
        assert "test_runner" in tool_starts

        # 4) Verify draft updates from different agents
        draft_updates = [p for tid, et, p in solo_mgr.events
                         if tid == task_id and et == "solo.draft.update"]
        assert len(draft_updates) >= 3  # writer, reviewer, analyzer

        # 5) Verify task completed
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "5项测试通过" in completed[0].get("result", "")

        # 6) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"

    @pytest.mark.asyncio
    async def test_code_review_reflexion_loop(self, bridged_adapter, event_bus, fake_workspace):
        """Reflexion loop: code_writer writes → code_reviewer rejects →
        code_writer rewrites → code_reviewer approves.

        Verify the loop produces correct event sequences and the retry
        is properly tracked.
        """
        task_id = "df-reflexion-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Iteration 1: Code Writer writes
            event_bus.emit(task_id, "react.iteration", {"iteration": 1})
            event_bus.emit(task_id, "react.thought", {
                "agent_name": "CodeWriterAgent",
                "delta_text": "分析需求，编写初始代码实现",
            })
            event_bus.emit(task_id, "react.action", {"tool_name": "code_editor"})
            event_bus.emit(task_id, "react.observation", {
                "tool_name": "code_editor",
                "result": {"files_changed": 1},
            })

            # Code Reviewer rejects
            event_bus.emit(task_id, "react.thought", {
                "agent_name": "CodeReviewerAgent",
                "delta_text": "代码存在潜在空指针异常，需要修复",
            })
            event_bus.emit(task_id, "react.action", {"tool_name": "static_analysis"})
            event_bus.emit(task_id, "react.observation", {
                "tool_name": "static_analysis",
                "result": {"issues": 1, "severity": "high"},
            })

            # Iteration 2: Code Writer rewrites
            event_bus.emit(task_id, "react.iteration", {"iteration": 2})
            event_bus.emit(task_id, "react.thought", {
                "agent_name": "CodeWriterAgent",
                "delta_text": "根据审查意见修复空指针问题",
            })
            event_bus.emit(task_id, "react.action", {"tool_name": "code_editor"})
            event_bus.emit(task_id, "react.observation", {
                "tool_name": "code_editor",
                "result": {"files_changed": 1},
            })

            # Code Reviewer approves
            event_bus.emit(task_id, "react.thought", {
                "agent_name": "CodeReviewerAgent",
                "delta_text": "修复后代码通过审查，无遗留问题",
            })
            event_bus.emit(task_id, "react.action", {"tool_name": "static_analysis"})
            event_bus.emit(task_id, "react.observation", {
                "tool_name": "static_analysis",
                "result": {"issues": 0, "severity": "none"},
            })

            # Final output
            event_bus.emit(task_id, "react.final", {
                "output": "代码经Reflexion循环优化后通过审查",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "代码审查通过，Reflexion循环2次迭代",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify two ReAct iterations → two solo.stage.enter
        react_enters = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
        ]
        assert len(react_enters) == 2, f"Expected 2 ReAct iteration enters, got {len(react_enters)}"

        # 2) Verify reasoning events from both agents
        reasoning_events = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.llm.reasoning"
        ]
        reasoning_agents = [p.get("agent_name") for p in reasoning_events]
        assert "CodeWriterAgent" in reasoning_agents
        assert "CodeReviewerAgent" in reasoning_agents

        # 3) Verify tool events (code_editor + static_analysis × 2 iterations)
        tool_starts = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.tool.start"
        ]
        tool_names = [p.get("tool_name") for p in tool_starts]
        assert tool_names.count("code_editor") == 2
        assert tool_names.count("static_analysis") == 2

        # 4) Verify react.final → solo.stage.exit
        stage_exits = [
            et for tid, et, _ in solo_mgr.events
            if tid == task_id and et == "solo.stage.exit"
        ]
        assert len(stage_exits) >= 1

        # 5) Verify task completed
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "Reflexion" in completed[0].get("result", "")

        # 6) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"


# ===========================================================================
# 3. TestNovelForgeChapterFlow
# ===========================================================================

class TestNovelForgeChapterFlow:
    """Simulate NovelForge chapter writing SOP:
    outline → character_design → chapter_writing → chapter_review
    """

    @pytest.mark.asyncio
    async def test_chapter_writing_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Full chapter writing flow:
        outline → character_design → chapter_writing → chapter_review.

        Verify each creative stage emits correct events and draft content
        is properly persisted.
        """
        task_id = "nf-chapter-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Outline
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "outline", "label": "章节大纲", "order": 1, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "OutlineAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "第三章：暗流涌动——主角发现隐藏的地下组织",
                "is_partial": False,
                "agent_name": "OutlineAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "OutlineAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "outline", "label": "章节大纲",
            })

            # Stage 2: Character Design
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "character_design", "label": "角色设计", "order": 2, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "CharacterDesignAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "新角色：沈墨——地下组织联络人，表面身份是古籍修复师",
                "is_partial": False,
                "agent_name": "CharacterDesignAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "CharacterDesignAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "character_design", "label": "角色设计",
            })

            # Stage 3: Chapter Writing
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "chapter_writing", "label": "章节创作", "order": 3, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ChapterWriterAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "夜色笼罩着老城区的街巷，沈墨推开那扇斑驳的木门...",
                "is_partial": True,
                "agent_name": "ChapterWriterAgent",
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "夜色笼罩着老城区的街巷，沈墨推开那扇斑驳的木门，空气中弥漫着陈年纸张的气息。书架深处，一盏孤灯映照着他凝重的面容。",
                "is_partial": False,
                "agent_name": "ChapterWriterAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ChapterWriterAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "chapter_writing", "label": "章节创作",
            })

            # Stage 4: Chapter Review
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "chapter_review", "label": "章节审校", "order": 4, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ChapterReviewAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "审校意见：氛围营造出色，建议加强沈墨的内心独白以深化角色",
                "is_partial": False,
                "agent_name": "ChapterReviewAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ChapterReviewAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "chapter_review", "label": "章节审校",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "第三章《暗流涌动》创作完成",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify 4 stage enter/exit pairs
        stage_enters = [et for tid, et, _ in solo_mgr.events
                        if tid == task_id and et == "solo.stage.enter"]
        assert len(stage_enters) == 4

        # 2) Verify stage labels
        enter_labels = [
            p.get("label") or p.get("stage")
            for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
        ]
        assert enter_labels == ["章节大纲", "角色设计", "章节创作", "章节审校"]

        # 3) Verify agent events for all 4 agents
        agent_starts = [p.get("agent_name") for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.agent.start"]
        assert "OutlineAgent" in agent_starts
        assert "CharacterDesignAgent" in agent_starts
        assert "ChapterWriterAgent" in agent_starts
        assert "ChapterReviewAgent" in agent_starts

        # 4) Verify draft updates: partial + final from writer, final from others
        draft_updates = [p for tid, et, p in solo_mgr.events
                         if tid == task_id and et == "solo.draft.update"]
        # Outline(1) + CharacterDesign(1) + ChapterWriting(2: partial+final) + Review(1) = 5
        assert len(draft_updates) >= 5

        # 5) Verify workspace persisted the final chapter draft
        msgs = fake_workspace.load_messages(task_id)
        assistant_msgs = [m for m in msgs if m.get("role") == "assistant"]
        # At least outline + character + chapter final + review should be saved
        assert len(assistant_msgs) >= 4

        # 6) Verify task completed
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "暗流涌动" in completed[0].get("result", "")

        # 7) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"

    @pytest.mark.asyncio
    async def test_chapter_review_with_arbitration(self, bridged_adapter, event_bus, fake_workspace):
        """Three-way blind review: emotion_reviewer + prose_reviewer +
        structure_reviewer → arbitrator.

        Verify all reviewers emit events and the arbitrator produces the
        final consolidated opinion.
        """
        task_id = "nf-arbitration-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Outline (brief)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "outline", "label": "章节大纲", "order": 1, "total": 3,
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "outline", "label": "章节大纲",
            })

            # Stage 2: Chapter Writing (brief)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "chapter_writing", "label": "章节创作", "order": 2, "total": 3,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "月光穿过窗棂，落在那卷泛黄的族谱上...",
                "is_partial": False,
                "agent_name": "ChapterWriterAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "chapter_writing", "label": "章节创作",
            })

            # Stage 3: Three-way blind review (parallel reviewers)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "chapter_review", "label": "三方盲评", "order": 3, "total": 3,
            })

            # Reviewer 1: Emotion
            event_bus.emit(task_id, "agent.start", {"agent_name": "EmotionReviewer"})
            event_bus.emit(task_id, "draft.update", {
                "content": "情感维度评分：8.5/10——月光意象营造了恰当的怀旧氛围，建议增加角色间的情感张力",
                "is_partial": False,
                "agent_name": "EmotionReviewer",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "EmotionReviewer"})

            # Reviewer 2: Prose
            event_bus.emit(task_id, "agent.start", {"agent_name": "ProseReviewer"})
            event_bus.emit(task_id, "draft.update", {
                "content": "文笔维度评分：7.0/10——意象选择精准，但长句节奏略显拖沓，建议拆分复合句",
                "is_partial": False,
                "agent_name": "ProseReviewer",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ProseReviewer"})

            # Reviewer 3: Structure
            event_bus.emit(task_id, "agent.start", {"agent_name": "StructureReviewer"})
            event_bus.emit(task_id, "draft.update", {
                "content": "结构维度评分：9.0/10——开篇悬念设置合理，伏笔埋设自然，叙事节奏把控出色",
                "is_partial": False,
                "agent_name": "StructureReviewer",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "StructureReviewer"})

            # Arbitrator consolidates
            event_bus.emit(task_id, "agent.start", {"agent_name": "Arbitrator"})
            event_bus.emit(task_id, "draft.update", {
                "content": "综合裁定：8.2/10——三方均认可开篇氛围，主要改进方向为句式节奏优化。建议通过，附修改建议。",
                "is_partial": False,
                "agent_name": "Arbitrator",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "Arbitrator"})

            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "chapter_review", "label": "三方盲评",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "章节经三方盲评后通过，综合评分8.2",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify all 4 agents started
        agent_starts = [p.get("agent_name") for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.agent.start"]
        assert "EmotionReviewer" in agent_starts
        assert "ProseReviewer" in agent_starts
        assert "StructureReviewer" in agent_starts
        assert "Arbitrator" in agent_starts

        # 2) Verify all 4 agents ended
        agent_ends = [p.get("agent_name") for tid, et, p in solo_mgr.events
                      if tid == task_id and et == "solo.agent.end"]
        assert "EmotionReviewer" in agent_ends
        assert "ProseReviewer" in agent_ends
        assert "StructureReviewer" in agent_ends
        assert "Arbitrator" in agent_ends

        # 3) Verify 4 draft updates (3 reviewers + 1 arbitrator)
        draft_updates = [p for tid, et, p in solo_mgr.events
                         if tid == task_id and et == "solo.draft.update"]
        draft_agents = [p.get("agent_name") for p in draft_updates]
        assert draft_agents.count("EmotionReviewer") >= 1
        assert draft_agents.count("ProseReviewer") >= 1
        assert draft_agents.count("StructureReviewer") >= 1
        assert draft_agents.count("Arbitrator") >= 1

        # 4) Verify the arbitrator's consolidated score appears in workspace
        msgs = fake_workspace.load_messages(task_id)
        arbitrator_msgs = [
            m for m in msgs
            if m.get("role") == "assistant"
            and m.get("data", {}).get("_agent_name") == "Arbitrator"
        ]
        assert len(arbitrator_msgs) >= 1
        assert "8.2" in arbitrator_msgs[0].get("content", "")

        # 5) Verify task completed
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "8.2" in completed[0].get("result", "")

        # 6) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"


# ===========================================================================
# 4. TestMallForgeProductIncubationFlow
# ===========================================================================

class TestMallForgeProductIncubationFlow:
    """Simulate MallForge product incubation SOP:
    product_scout → profit_calculator → listing_generator → ad_optimizer
    """

    @pytest.mark.asyncio
    async def test_product_incubation_flow(self, bridged_adapter, event_bus, fake_workspace):
        """Full product incubation flow:
        product_scout → profit_calculator → listing_generator → ad_optimizer.

        Verify each business stage emits correct events and the product
        listing is generated with ad optimization.
        """
        task_id = "mf-incubation-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Product Scout
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "product_scout", "label": "选品发现", "order": 1, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ProductScoutAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "market_trend_search"})
            event_bus.emit(task_id, "tool.end", {
                "tool_name": "market_trend_search",
                "result": {"trending_categories": ["智能家居", "户外运动"]},
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "推荐选品：便携式智能空气净化器——搜索量月增230%，竞争度中等",
                "is_partial": False,
                "agent_name": "ProductScoutAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ProductScoutAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "product_scout", "label": "选品发现",
            })

            # Stage 2: Profit Calculator
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "profit_calculator", "label": "利润测算", "order": 2, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ProfitCalculatorAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "cost_analyzer"})
            event_bus.emit(task_id, "tool.end", {
                "tool_name": "cost_analyzer",
                "result": {"cost": 45, "suggested_price": 199, "margin": 0.77},
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "利润测算：成本45元，建议售价199元，毛利率77%，预计月销量800台",
                "is_partial": False,
                "agent_name": "ProfitCalculatorAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ProfitCalculatorAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "profit_calculator", "label": "利润测算",
            })

            # Stage 3: Listing Generator
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "listing_generator", "label": "详情页生成", "order": 3, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ListingGeneratorAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "商品标题：便携智能空气净化器 | 车载家用两用 | HEPA滤芯 | 静音设计",
                "is_partial": True,
                "agent_name": "ListingGeneratorAgent",
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "商品标题：便携智能空气净化器 | 车载家用两用 | HEPA滤芯 | 静音设计\n\n核心卖点：三重过滤系统、APP智能控制、续航8小时",
                "is_partial": False,
                "agent_name": "ListingGeneratorAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ListingGeneratorAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "listing_generator", "label": "详情页生成",
            })

            # Stage 4: Ad Optimizer
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "ad_optimizer", "label": "广告优化", "order": 4, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "AdOptimizerAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "keyword_planner"})
            event_bus.emit(task_id, "tool.end", {
                "tool_name": "keyword_planner",
                "result": {"top_keywords": ["空气净化器", "车载净化器", "便携净化"]},
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "广告策略：主投'车载净化器'长尾词，CPC预估1.2元，ROI目标3.5",
                "is_partial": False,
                "agent_name": "AdOptimizerAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "AdOptimizerAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "ad_optimizer", "label": "广告优化",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "新品孵化完成：便携智能空气净化器已上架，广告计划已部署",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify 4 stage enter/exit pairs
        stage_enters = [et for tid, et, _ in solo_mgr.events
                        if tid == task_id and et == "solo.stage.enter"]
        assert len(stage_enters) == 4

        # 2) Verify stage labels
        enter_labels = [
            p.get("label") or p.get("stage")
            for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
        ]
        assert enter_labels == ["选品发现", "利润测算", "详情页生成", "广告优化"]

        # 3) Verify all 4 agents
        agent_starts = [p.get("agent_name") for tid, et, p in solo_mgr.events
                        if tid == task_id and et == "solo.agent.start"]
        assert "ProductScoutAgent" in agent_starts
        assert "ProfitCalculatorAgent" in agent_starts
        assert "ListingGeneratorAgent" in agent_starts
        assert "AdOptimizerAgent" in agent_starts

        # 4) Verify tool events
        tool_starts = [p.get("tool_name") for tid, et, p in solo_mgr.events
                       if tid == task_id and et == "solo.tool.start"]
        assert "market_trend_search" in tool_starts
        assert "cost_analyzer" in tool_starts
        assert "keyword_planner" in tool_starts

        # 5) Verify draft updates from listing generator (partial + final)
        listing_drafts = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.draft.update"
            and p.get("agent_name") == "ListingGeneratorAgent"
        ]
        assert len(listing_drafts) >= 2

        # 6) Verify task completed
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "便携智能空气净化器" in completed[0].get("result", "")

        # 7) Verify workspace status
        assert fake_workspace._task_status.get(task_id) == "completed"

    @pytest.mark.asyncio
    async def test_product_incubation_with_rejection(self, bridged_adapter, event_bus, fake_workspace):
        """Profit calculation shows insufficient margin → product filtered out.

        Verify the flow correctly terminates with an error/rejection when
        profit criteria are not met.
        """
        task_id = "mf-rejection-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Product Scout
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "product_scout", "label": "选品发现", "order": 1, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ProductScoutAgent"})
            event_bus.emit(task_id, "draft.update", {
                "content": "推荐选品：手工编织草帽——搜索量月增15%，竞争度极高",
                "is_partial": False,
                "agent_name": "ProductScoutAgent",
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ProductScoutAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "product_scout", "label": "选品发现",
            })

            # Stage 2: Profit Calculator (fails margin check)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "profit_calculator", "label": "利润测算", "order": 2, "total": 4,
            })
            event_bus.emit(task_id, "agent.start", {"agent_name": "ProfitCalculatorAgent"})
            event_bus.emit(task_id, "tool.start", {"tool_name": "cost_analyzer"})
            event_bus.emit(task_id, "tool.end", {
                "tool_name": "cost_analyzer",
                "result": {"cost": 85, "suggested_price": 99, "margin": 0.14},
            })
            event_bus.emit(task_id, "step.intermediate", {
                "step_name": "利润率14%低于阈值30%，选品不通过",
                "margin": 0.14,
                "threshold": 0.30,
            })
            event_bus.emit(task_id, "agent.end", {"agent_name": "ProfitCalculatorAgent"})
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "profit_calculator", "label": "利润测算",
            })

            # Task error — product rejected
            event_bus.emit(task_id, "task.error", {
                "error_message": "选品被过滤：手工编织草帽利润率14%低于最低阈值30%",
                "step_name": "profit_calculator",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify only 2 stages were entered (scout + calculator)
        stage_enters = [et for tid, et, _ in solo_mgr.events
                        if tid == task_id and et == "solo.stage.enter"]
        assert len(stage_enters) == 2

        # 2) Verify listing_generator and ad_optimizer were NOT entered
        enter_stages = [
            p.get("stage")
            for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
        ]
        assert "listing_generator" not in enter_stages
        assert "ad_optimizer" not in enter_stages

        # 3) Verify step.intermediate was emitted with margin info
        intermediate_events = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.step.intermediate"
        ]
        assert len(intermediate_events) >= 1
        assert intermediate_events[0].get("margin") == 0.14
        assert intermediate_events[0].get("threshold") == 0.30

        # 4) Verify task error was emitted
        error_events = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.task.error"
        ]
        assert len(error_events) == 1
        assert "利润率14%" in error_events[0].get("error_message", "")

        # 5) Verify workspace status is error
        assert fake_workspace._task_status.get(task_id) == "error"

        # 6) Verify error message persisted to workspace
        msgs = fake_workspace.load_messages(task_id)
        error_msgs = [
            m for m in msgs
            if m.get("role") == "system" and "利润率" in m.get("content", "")
        ]
        assert len(error_msgs) >= 1


# ===========================================================================
# 5. TestCrossProjectDynamicUpdate
# ===========================================================================

class TestCrossProjectDynamicUpdate:
    """Test concurrent tasks from different projects and pause/resume
    state transitions to verify dynamic update correctness."""

    @pytest.mark.asyncio
    async def test_concurrent_tasks_different_projects(self, bridged_adapter, event_bus, fake_workspace):
        """Launch 2 tasks from different projects concurrently.

        Verify events are isolated per task_id — no cross-contamination.
        """
        task_cf = "cf-concurrent-001"  # ContentForge task
        task_df = "df-concurrent-001"  # DevForge task

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # ContentForge task: deep article flow
            event_bus.emit(task_cf, "workflow.step.start", {
                "stage": "topic", "label": "选题策划", "order": 1, "total": 3,
            })
            event_bus.emit(task_cf, "tool.start", {"tool_name": "web_search"})
            event_bus.emit(task_cf, "tool.end", {"tool_name": "web_search"})
            event_bus.emit(task_cf, "workflow.step.complete", {
                "stage": "topic", "label": "选题策划",
            })

            # DevForge task: code review flow (interleaved)
            event_bus.emit(task_df, "workflow.step.start", {
                "stage": "code_writer", "label": "代码编写", "order": 1, "total": 2,
            })
            event_bus.emit(task_df, "agent.start", {"agent_name": "CodeWriterAgent"})
            event_bus.emit(task_df, "draft.update", {
                "content": "def process_data(items):\n    return [x.strip() for x in items if x]",
                "is_partial": False,
                "agent_name": "CodeWriterAgent",
            })
            event_bus.emit(task_df, "agent.end", {"agent_name": "CodeWriterAgent"})
            event_bus.emit(task_df, "workflow.step.complete", {
                "stage": "code_writer", "label": "代码编写",
            })

            # ContentForge continues
            event_bus.emit(task_cf, "workflow.step.start", {
                "stage": "writer", "label": "文章创作", "order": 2, "total": 3,
            })
            event_bus.emit(task_cf, "draft.update", {
                "content": "量子计算正在从实验室走向产业化应用...",
                "is_partial": False,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_cf, "workflow.step.complete", {
                "stage": "writer", "label": "文章创作",
            })

            # DevForge continues
            event_bus.emit(task_df, "workflow.step.start", {
                "stage": "code_reviewer", "label": "代码审查", "order": 2, "total": 2,
            })
            event_bus.emit(task_df, "agent.start", {"agent_name": "CodeReviewerAgent"})
            event_bus.emit(task_df, "draft.update", {
                "content": "代码简洁，建议增加类型注解和边界处理",
                "is_partial": False,
                "agent_name": "CodeReviewerAgent",
            })
            event_bus.emit(task_df, "agent.end", {"agent_name": "CodeReviewerAgent"})
            event_bus.emit(task_df, "workflow.step.complete", {
                "stage": "code_reviewer", "label": "代码审查",
            })

            # ContentForge completes
            event_bus.emit(task_cf, "workflow.step.start", {
                "stage": "publish", "label": "发布", "order": 3, "total": 3,
            })
            event_bus.emit(task_cf, "workflow.step.complete", {
                "stage": "publish", "label": "发布",
            })
            event_bus.emit(task_cf, "task.completed", {
                "result": "量子计算文章已发布",
            })

            # DevForge completes
            event_bus.emit(task_df, "task.completed", {
                "result": "代码审查完成，建议已记录",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Separate events by task_id
        cf_events = [(et, p) for tid, et, p in solo_mgr.events if tid == task_cf]
        df_events = [(et, p) for tid, et, p in solo_mgr.events if tid == task_df]

        # 2) ContentForge should have topic + writer + publish stages
        cf_stages = [
            p.get("label") or p.get("stage")
            for et, p in cf_events if et == "solo.stage.enter"
        ]
        assert "选题策划" in cf_stages
        assert "文章创作" in cf_stages
        assert "发布" in cf_stages

        # 3) DevForge should have code_writer + code_reviewer stages
        df_stages = [
            p.get("label") or p.get("stage")
            for et, p in df_events if et == "solo.stage.enter"
        ]
        assert "代码编写" in df_stages
        assert "代码审查" in df_stages

        # 4) No cross-contamination: CF events should not contain DevForge agents
        cf_agents = [
            p.get("agent_name") for et, p in cf_events
            if et == "solo.agent.start"
        ]
        assert "CodeWriterAgent" not in cf_agents
        assert "CodeReviewerAgent" not in cf_agents

        # 5) No cross-contamination: DF events should not contain CF tools
        df_tools = [
            p.get("tool_name") for et, p in df_events
            if et == "solo.tool.start"
        ]
        assert "web_search" not in df_tools

        # 6) Both tasks completed
        cf_completed = [p for et, p in cf_events if et == "solo.task.completed"]
        df_completed = [p for et, p in df_events if et == "solo.task.completed"]
        assert len(cf_completed) == 1
        assert len(df_completed) == 1

        # 7) Workspace messages are isolated per task
        cf_msgs = fake_workspace.load_messages(task_cf)
        df_msgs = fake_workspace.load_messages(task_df)

        # CF messages should not contain DevForge content
        cf_contents = " ".join(m.get("content", "") for m in cf_msgs)
        assert "CodeWriterAgent" not in cf_contents
        assert "process_data" not in cf_contents

        # DF messages should not contain CF content
        df_contents = " ".join(m.get("content", "") for m in df_msgs)
        assert "量子计算" not in df_contents
        assert "web_search" not in df_contents

        # 8) Both workspace statuses are completed
        assert fake_workspace._task_status.get(task_cf) == "completed"
        assert fake_workspace._task_status.get(task_df) == "completed"

    @pytest.mark.asyncio
    async def test_task_pause_resume(self, bridged_adapter, event_bus, fake_workspace):
        """Simulate task pause and resume.

        Verify that:
        - task.paused → solo.task.paused is emitted
        - task.resumed → solo.task.resumed is emitted
        - After resume, the task continues and completes normally
        - Workspace messages from before pause are preserved
        """
        task_id = "cf-pause-resume-001"

        with patch("flowforge.events.solo_adapter.get_workspace_manager", return_value=fake_workspace):
            # Stage 1: Topic (before pause)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "topic", "label": "选题策划", "order": 1, "total": 3,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "深度报道：新能源汽车出海战略分析",
                "is_partial": False,
                "agent_name": "TopicAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "topic", "label": "选题策划",
            })

            # Stage 2: Research (before pause)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "research", "label": "深度调研", "order": 2, "total": 3,
            })
            event_bus.emit(task_id, "tool.start", {"tool_name": "helixrag_search"})
            event_bus.emit(task_id, "tool.end", {"tool_name": "helixrag_search"})

            # Pause
            event_bus.emit(task_id, "task.paused", {
                "reason": "等待补充行业数据",
                "paused_at_stage": "research",
            })

            await asyncio.sleep(0.1)

            # Record messages before resume
            msgs_before_resume = len(fake_workspace.load_messages(task_id))

            # Resume
            event_bus.emit(task_id, "task.resumed", {
                "reason": "行业数据已补充",
                "resumed_at_stage": "research",
            })

            # Continue research
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "research", "label": "深度调研",
            })

            # Stage 3: Writer (after resume)
            event_bus.emit(task_id, "workflow.step.start", {
                "stage": "writer", "label": "文章创作", "order": 3, "total": 3,
            })
            event_bus.emit(task_id, "draft.update", {
                "content": "中国新能源汽车出口量在2024年突破200万辆，标志着从产品出海到品牌出海的战略转型...",
                "is_partial": False,
                "agent_name": "WriterAgent",
            })
            event_bus.emit(task_id, "workflow.step.complete", {
                "stage": "writer", "label": "文章创作",
            })

            # Task completed
            event_bus.emit(task_id, "task.completed", {
                "result": "新能源汽车出海报道已完成",
            })

            await asyncio.sleep(0.3)

        solo_mgr = bridged_adapter.solo_manager

        # 1) Verify pause event was emitted
        paused_events = [
            (tid, et, p) for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.task.paused"
        ]
        assert len(paused_events) == 1
        assert paused_events[0][2].get("reason") == "等待补充行业数据"
        assert paused_events[0][2].get("paused_at_stage") == "research"

        # 2) Verify resume event was emitted
        resumed_events = [
            (tid, et, p) for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.task.resumed"
        ]
        assert len(resumed_events) == 1
        assert resumed_events[0][2].get("reason") == "行业数据已补充"
        assert resumed_events[0][2].get("resumed_at_stage") == "research"

        # 3) Verify events after resume are still for the same task
        post_resume_stages = [
            p for tid, et, p in solo_mgr.events
            if tid == task_id and et == "solo.stage.enter"
            and p.get("stage") in ("writer",)
        ]
        assert len(post_resume_stages) >= 1

        # 4) Verify task completed after resume
        completed = [p for tid, et, p in solo_mgr.events
                     if tid == task_id and et == "solo.task.completed"]
        assert len(completed) == 1
        assert "新能源汽车" in completed[0].get("result", "")

        # 5) Verify workspace messages from before pause are preserved
        msgs = fake_workspace.load_messages(task_id)
        assert len(msgs) >= msgs_before_resume

        # Pre-pause content should still be in messages
        all_contents = " ".join(m.get("content", "") for m in msgs)
        assert "新能源汽车出海战略分析" in all_contents

        # 6) Verify workspace status is completed (not paused)
        assert fake_workspace._task_status.get(task_id) == "completed"

        # 7) Verify the event ordering: pause comes before resume
        all_event_types = [et for tid, et, _ in solo_mgr.events if tid == task_id]
        pause_idx = all_event_types.index("solo.task.paused")
        resume_idx = all_event_types.index("solo.task.resumed")
        assert pause_idx < resume_idx, "Pause event must come before resume event"

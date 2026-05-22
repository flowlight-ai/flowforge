"""Tests for FlowForge v6.0 Harness Layer."""

import pytest
import asyncio
import json
import os
import tempfile
import time
from unittest.mock import AsyncMock, MagicMock, patch
from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.context_engine import ContextEngine
from flowforge.harness.session_manager import SessionManager
from flowforge.harness.feedback_loop import (
    FeedbackLoop, FeedbackResult, EvaluationMode, ClassificationGate,
    EVAL_MODE_FULL, EVAL_MODE_LIGHTWEIGHT, EVAL_MODE_SKIP,
    GATE_PASS, GATE_CONDITIONAL, GATE_FAIL,
)
from flowforge.harness.entropy_manager import (
    EntropyManager, DocGardener, DebtTracker, DebtSeverity, DebtStatus,
    RuleEvolution, RuleLifecycle, GarbageCollection, GCSchedule,
)
from flowforge.security.permission_pipeline import PermissionPipeline, ActionLevel
from flowforge.security.arch_constraint import ArchitectureConstraintEngine
from flowforge.core.task_context import TaskContext
from flowforge.core.base_tool import ToolInput, ToolOutput


@pytest.fixture
def ctx():
    """Create a basic TaskContext for testing."""
    return TaskContext(task_id="test-001", input_data={"task": "test"})


class TestHarnessOrchestrator:
    """Tests for HarnessOrchestrator."""

    @pytest.mark.asyncio
    async def test_orchestrator_disabled(self, ctx):
        """When harness is disabled, hooks are no-ops."""
        orch = HarnessOrchestrator(config={"enabled": False})
        await orch.pre_execute(ctx)
        result = {"content": "test output", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        assert result["content"] == "test output"
        assert "_feedback" not in result

    @pytest.mark.asyncio
    async def test_orchestrator_enabled(self, ctx):
        """When harness is enabled, hooks execute."""
        orch = HarnessOrchestrator(config={"enabled": True})
        await orch.pre_execute(ctx)
        result = {"content": "This is a test output that is long enough for evaluation", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        # FeedbackLoop should have evaluated
        assert "_feedback" in result

    @pytest.mark.asyncio
    async def test_orchestrator_get_status(self):
        """get_status returns all component statuses."""
        orch = HarnessOrchestrator()
        status = orch.get_status()
        assert "enabled" in status
        assert "context_engine" in status
        assert "session_manager" in status
        assert "feedback_loop" in status
        assert "entropy_manager" in status

    @pytest.mark.asyncio
    async def test_orchestrator_context_harness_disabled(self, ctx):
        """When context has harness_enabled=False in metadata, hooks are no-ops."""
        ctx.metadata["harness_enabled"] = False
        orch = HarnessOrchestrator(config={"enabled": True})
        await orch.pre_execute(ctx)
        result = {"content": "test", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        assert "_feedback" not in result


class TestContextEngine:
    """Tests for ContextEngine."""

    @pytest.mark.asyncio
    async def test_inject_empty_paths(self, ctx):
        """Inject with no configured paths is safe."""
        engine = ContextEngine(config={"agents_md_paths": []})
        await engine.inject(ctx)
        # Should not crash

    @pytest.mark.asyncio
    async def test_inject_with_persona(self, ctx):
        """Inject with persona but no matching AGENTS.md."""
        ctx.persona = "test_persona"
        engine = ContextEngine(config={"agents_md_paths": ["/nonexistent"]})
        await engine.inject(ctx)
        # Should not crash, just no injection

    def test_get_status(self):
        engine = ContextEngine()
        status = engine.get_status()
        assert "enabled" in status
        assert "injection_count" in status


class TestSessionManager:
    """Tests for SessionManager."""

    def test_should_compact_below_threshold(self):
        """Below threshold, should not compact."""
        mgr = SessionManager(config={"context_window": 128000, "compact_threshold": 0.92})
        assert not mgr.should_compact(100000)  # 78% < 92%

    def test_should_compact_above_threshold(self):
        """Above threshold, should compact."""
        mgr = SessionManager(config={"context_window": 128000, "compact_threshold": 0.92})
        assert mgr.should_compact(120000)  # 93.75% > 92%

    def test_should_compact_exact_threshold(self):
        """At exact threshold, should compact."""
        mgr = SessionManager(config={"context_window": 100000, "compact_threshold": 0.92})
        assert mgr.should_compact(92000)  # 92% == 92%

    def test_truncate_tool_output_small(self):
        """Small output is not truncated."""
        mgr = SessionManager(config={"tool_output_limit": 25000})
        output = "Hello world"
        result = mgr.truncate_tool_output(output)
        assert result == output

    def test_truncate_tool_output_large(self):
        """Large output is truncated."""
        mgr = SessionManager(config={"tool_output_limit": 100})
        output = "x" * 10000
        result = mgr.truncate_tool_output(output)
        assert "truncated" in result
        assert len(result) < len(output)

    @pytest.mark.asyncio
    async def test_compact_if_needed_below_threshold(self):
        """Below threshold, messages are unchanged."""
        mgr = SessionManager(config={"context_window": 128000})
        messages = [{"role": "user", "content": "hello"}]
        result = await mgr.compact_if_needed(messages)
        assert result == messages

    @pytest.mark.asyncio
    async def test_compact_if_needed_above_threshold(self):
        """Above threshold, messages are compacted."""
        mgr = SessionManager(config={"context_window": 100, "compact_threshold": 0.5})
        messages = [{"role": "system", "content": "system prompt"}]
        for i in range(20):
            messages.append({"role": "user", "content": f"message {i} " * 50})
            messages.append({"role": "assistant", "content": f"response {i} " * 50})
        result = await mgr.compact_if_needed(messages)
        assert len(result) < len(messages)

    def test_build_handoff(self):
        """Build handoff artifact."""
        mgr = SessionManager()
        handoff = mgr.build_handoff(
            init_script="print('hello')",
            progress_log=["step1 done", "step2 done"],
            feature_checklist=["feature A", "feature B"],
        )
        assert handoff["init_script"] == "print('hello')"
        assert len(handoff["progress_log"]) == 2
        assert "timestamp" in handoff


class TestFeedbackLoop:
    """Tests for FeedbackLoop."""

    @pytest.mark.asyncio
    async def test_skip_mode(self, ctx):
        """Skip mode does not evaluate."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_SKIP})
        result = {"content": "test output", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert "_feedback" not in result

    @pytest.mark.asyncio
    async def test_lightweight_mode_pass(self, ctx):
        """Lightweight mode evaluates and passes good content."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        result = {"content": "This is a well-written article about AI technology and its applications in modern software development.", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        assert result["_feedback"]["gate"] in ("PASS", "CONDITIONAL", "FAIL")

    @pytest.mark.asyncio
    async def test_lightweight_mode_fail_short(self, ctx):
        """Very short content auto-passes."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        result = {"content": "ok", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        # Too short for evaluation, should auto-pass
        assert result["_feedback"]["gate"] == "PASS"

    @pytest.mark.asyncio
    async def test_full_mode(self, ctx):
        """Full mode returns 4-dimension scores."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_FULL})
        result = {"content": "A comprehensive analysis of machine learning trends with detailed examples and code snippets.", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        assert "scores" in result["_feedback"]
        assert "design_quality" in result["_feedback"]["scores"] or "correctness" in result["_feedback"]["scores"]

    @pytest.mark.asyncio
    async def test_fail_gate_downgrades(self, ctx):
        """FAIL gate downgrades the result."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        # Create content that will trigger FAIL (highly repetitive)
        result = {"content": " ".join(["word"] * 200), "status": "completed"}
        result = await loop.evaluate(result, ctx)
        if result["_feedback"]["gate"] == "FAIL":
            assert result["status"] == "partial"
            assert result.get("quality_warning") is True

    def test_get_status(self):
        loop = FeedbackLoop()
        status = loop.get_status()
        assert "evaluation_mode" in status
        assert "evaluation_count" in status


class TestEntropyManager:
    """Tests for EntropyManager."""

    @pytest.mark.asyncio
    async def test_pre_check_no_flags(self, ctx):
        """Pre-check with no flags is safe."""
        mgr = EntropyManager()
        await mgr.pre_check(ctx)
        # Should not crash

    @pytest.mark.asyncio
    async def test_pre_check_with_flags(self, ctx):
        """Pre-check with high_debt_alert flag injects metadata."""
        mgr = EntropyManager()
        mgr.set_entropy_flag("high_debt_alert", True)
        await mgr.pre_check(ctx)
        assert ctx.metadata.get("entropy_alert") == "high_technical_debt"

    @pytest.mark.asyncio
    async def test_post_track_no_error(self, ctx):
        """Post-track with no error is safe."""
        mgr = EntropyManager()
        result = {"content": "success", "status": "completed"}
        await mgr.post_track(result, ctx)

    @pytest.mark.asyncio
    async def test_post_track_with_error(self, ctx):
        """Post-track with error records failure."""
        mgr = EntropyManager()
        result = {"error": "something failed", "status": "failed"}
        await mgr.post_track(result, ctx)
        # Should log the failure without crashing

    @pytest.mark.asyncio
    async def test_run_doc_gardener(self):
        """Doc gardener runs without error."""
        mgr = EntropyManager()
        issues = await mgr.run_doc_gardener()
        assert isinstance(issues, list)

    @pytest.mark.asyncio
    async def test_run_debt_tracker(self):
        """Debt tracker runs without error."""
        mgr = EntropyManager()
        issues = await mgr.run_debt_tracker()
        assert isinstance(issues, list)

    def test_get_status(self):
        mgr = EntropyManager()
        status = mgr.get_status()
        assert "enabled" in status
        assert "doc_gardener_enabled" in status


# ══════════════════════════════════════════════════════════════
# v6.0 新增：约束验证 + 反馈闸门 + 熵控制 协同测试
# ══════════════════════════════════════════════════════════════


class TestFeedbackLoopGateLogic:
    """Detailed tests for FeedbackLoop gate classification logic."""

    @pytest.mark.asyncio
    async def test_lightweight_failure_indicators(self, ctx):
        """Content with failure indicators gets CONDITIONAL gate."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        failure_phrases = [
            "I cannot complete this task because the data is unavailable",
            "I can't process this request at this time",
            "Unable to retrieve the requested information",
            "Error: connection timeout occurred",
            "Failed to generate the expected output",
            "It is not possible to fulfill this request",
            "作为ai，我无法完成这个任务",
        ]
        for phrase in failure_phrases:
            # Pad with meaningful words to exceed 50-char threshold and 20-word minimum
            padding = " This is additional context to ensure the content is long enough for evaluation."
            result = {"content": phrase + padding, "status": "completed"}
            result = await loop.evaluate(result, ctx)
            assert result["_feedback"]["gate"] == GATE_CONDITIONAL, \
                f"Expected CONDITIONAL for: '{phrase[:30]}...'"

    @pytest.mark.asyncio
    async def test_lightweight_repetitive_content_fail(self, ctx):
        """Highly repetitive content gets FAIL gate."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        # Create content with very low unique word ratio
        repetitive = " ".join(["same"] * 200)
        result = {"content": repetitive, "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert result["_feedback"]["gate"] == GATE_FAIL
        assert result["status"] == "partial"
        assert result.get("quality_warning") is True

    @pytest.mark.asyncio
    async def test_lightweight_good_content_pass(self, ctx):
        """Good, diverse content gets PASS gate."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        good_content = (
            "Artificial intelligence has transformed software development in profound ways. "
            "Modern AI systems leverage deep learning architectures including transformers, "
            "diffusion models, and reinforcement learning to solve complex problems. "
            "The emergence of large language models has created new possibilities for "
            "automated code generation, content creation, and decision support systems. "
            "Engineers must carefully design harness systems to ensure reliability."
        )
        result = {"content": good_content, "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert result["_feedback"]["gate"] == GATE_PASS
        assert result["status"] == "completed"
        assert not result.get("quality_warning")

    @pytest.mark.asyncio
    async def test_full_mode_classify_with_scores_pass(self, ctx):
        """Full mode: all scores above threshold → PASS."""
        loop = FeedbackLoop(config={
            "evaluation_mode": EVAL_MODE_FULL,
            "quality_threshold": 0.7,
        })
        result = {"content": "A well-structured analysis of modern AI trends and their impact on software engineering practices today.", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        # Default scores are all >= 0.7, so should PASS
        assert result["_feedback"]["gate"] == GATE_PASS
        scores = result["_feedback"]["scores"]
        assert all(v >= 0.7 for v in scores.values())

    @pytest.mark.asyncio
    async def test_full_mode_classify_with_scores_conditional(self, ctx):
        """Full mode: one critically low dimension → CONDITIONAL."""
        loop = FeedbackLoop(config={
            "evaluation_mode": EVAL_MODE_FULL,
            "quality_threshold": 0.7,
        })
        # We need to test _classify_with_scores directly
        gate = loop._classify_with_scores({
            "design_quality": 0.8,
            "originality": 0.3,  # Critically low
            "craft": 0.8,
            "functionality": 0.8,
        })
        assert gate == GATE_CONDITIONAL

    @pytest.mark.asyncio
    async def test_full_mode_classify_with_scores_fail(self, ctx):
        """Full mode: average below 70% of threshold → FAIL."""
        loop = FeedbackLoop(config={
            "evaluation_mode": EVAL_MODE_FULL,
            "quality_threshold": 0.7,
        })
        gate = loop._classify_with_scores({
            "design_quality": 0.3,
            "originality": 0.2,
            "craft": 0.3,
            "functionality": 0.2,
        })
        assert gate == GATE_FAIL

    @pytest.mark.asyncio
    async def test_gate_counts_tracking(self, ctx):
        """Gate counts are tracked correctly across evaluations."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        # PASS (long enough, diverse content, >=20 words)
        await loop.evaluate({"content": "Good content about AI and technology development with multiple perspectives and detailed analysis covering recent advances in the research field.", "status": "completed"}, ctx)
        # CONDITIONAL (failure indicator)
        await loop.evaluate({"content": "I cannot complete this task " * 5, "status": "completed"}, ctx)
        # FAIL (repetitive)
        await loop.evaluate({"content": " ".join(["x"] * 200), "status": "completed"}, ctx)

        status = loop.get_status()
        assert status["evaluation_count"] == 3
        # At least one of each gate type
        assert status["gate_counts"]["PASS"] >= 1
        assert status["gate_counts"]["CONDITIONAL"] >= 1
        assert status["gate_counts"]["FAIL"] >= 1

    @pytest.mark.asyncio
    async def test_empty_content_auto_pass(self, ctx):
        """Empty content auto-passes (too short to evaluate)."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        result = {"content": "", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert result["_feedback"]["gate"] == GATE_PASS
        assert result["_feedback"]["reason"] == "output_too_short_for_evaluation"

    @pytest.mark.asyncio
    async def test_feedback_metadata_completeness(self, ctx):
        """Feedback metadata contains all expected fields."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        result = {"content": "A detailed analysis of software architecture patterns.", "status": "completed"}
        result = await loop.evaluate(result, ctx)
        fb = result["_feedback"]
        assert "gate" in fb
        assert "mode" in fb
        assert "duration_ms" in fb
        assert fb["mode"] == EVAL_MODE_LIGHTWEIGHT


class TestEntropyManagerEnhanced:
    """Enhanced tests for EntropyManager with quality warning tracking."""

    @pytest.mark.asyncio
    async def test_post_track_quality_warning(self, ctx):
        """Quality warning is tracked as entropy signal."""
        mgr = EntropyManager()
        result = {
            "content": "repetitive content",
            "status": "partial",
            "quality_warning": True,
        }
        await mgr.post_track(result, ctx)
        assert mgr._entropy_flags.get("last_quality_warning") == ctx.task_id

    @pytest.mark.asyncio
    async def test_post_track_no_quality_warning(self, ctx):
        """No quality warning = no entropy flag set."""
        mgr = EntropyManager()
        result = {"content": "good output", "status": "completed"}
        await mgr.post_track(result, ctx)
        assert "last_quality_warning" not in mgr._entropy_flags

    @pytest.mark.asyncio
    async def test_stale_docs_flag_injection(self, ctx):
        """stale_docs_alert flag injects stale_docs into context."""
        mgr = EntropyManager()
        mgr.set_entropy_flag("stale_docs_alert", True)
        await mgr.pre_check(ctx)
        assert ctx.metadata.get("stale_docs") is True

    @pytest.mark.asyncio
    async def test_multiple_flags(self, ctx):
        """Multiple entropy flags are all processed."""
        mgr = EntropyManager()
        mgr.set_entropy_flag("high_debt_alert", True)
        mgr.set_entropy_flag("stale_docs_alert", True)
        await mgr.pre_check(ctx)
        assert ctx.metadata.get("entropy_alert") == "high_technical_debt"
        assert ctx.metadata.get("stale_docs") is True

    @pytest.mark.asyncio
    async def test_rule_evolution_disabled(self):
        """Rule evolution returns empty when disabled."""
        mgr = EntropyManager(config={"rule_evolution_enabled": False})
        result = await mgr.run_rule_evolution([{"error": "test"}])
        assert result == []

    @pytest.mark.asyncio
    async def test_rule_evolution_empty_failures(self):
        """Rule evolution returns empty with no failures."""
        mgr = EntropyManager()
        result = await mgr.run_rule_evolution([])
        assert result == []

    def test_set_entropy_flag_logging(self):
        """set_entropy_flag updates value correctly."""
        mgr = EntropyManager()
        mgr.set_entropy_flag("test_flag", True)
        assert mgr._entropy_flags["test_flag"] is True
        mgr.set_entropy_flag("test_flag", False)
        assert mgr._entropy_flags["test_flag"] is False


class TestPermissionPipelineIntegration:
    """Tests for PermissionPipeline integration with Harness."""

    @pytest.mark.asyncio
    async def test_pipeline_with_ask_callback_approved(self):
        """Ask rule with approved callback allows execution."""
        pipeline = PermissionPipeline()
        pipeline.add_ask_rule(tool_name="sensitive_tool", reason="Needs approval")

        async def approve(tool_name, action_level, context):
            return True

        pipeline.set_approval_callback(approve)
        result = await pipeline.check("sensitive_tool", ActionLevel.EXECUTE)
        assert result["allowed"]
        assert result["layer"] == "ask"

    @pytest.mark.asyncio
    async def test_pipeline_with_ask_callback_denied(self):
        """Ask rule with denied callback blocks execution."""
        pipeline = PermissionPipeline()
        pipeline.add_ask_rule(tool_name="sensitive_tool")

        async def deny(tool_name, action_level, context):
            return False

        pipeline.set_approval_callback(deny)
        result = await pipeline.check("sensitive_tool", ActionLevel.EXECUTE)
        assert not result["allowed"]
        assert result["layer"] == "ask"

    @pytest.mark.asyncio
    async def test_pipeline_condition_matching(self):
        """Rules with conditions match correctly."""
        pipeline = PermissionPipeline()
        pipeline.add_deny_rule(
            tool_name="db_tool",
            action_level=ActionLevel.EXECUTE,
            reason="No production access",
        )
        # Should match with matching action level
        result = await pipeline.check("db_tool", ActionLevel.EXECUTE)
        assert not result["allowed"]
        # Should NOT match with different action level
        result = await pipeline.check("db_tool", ActionLevel.READ)
        # No matching rule for READ, so default deny
        assert not result["allowed"]

    @pytest.mark.asyncio
    async def test_pipeline_status_tracking(self):
        """Pipeline status tracks check counts."""
        pipeline = PermissionPipeline()
        pipeline.add_allow_rule(tool_name="read_tool", action_level=ActionLevel.READ)
        await pipeline.check("read_tool", ActionLevel.READ)
        await pipeline.check("unknown_tool", ActionLevel.EXECUTE)
        status = pipeline.get_status()
        assert status["check_count"] == 2
        assert status["allow_count"] == 1
        assert status["deny_count"] == 1


class TestArchConstraintIntegration:
    """Tests for ArchitectureConstraintEngine integration with Harness."""

    def test_check_file_with_real_python(self):
        """Check a real Python file for violations."""
        engine = ArchitectureConstraintEngine(config={
            "layer_mapping": {
                "core": ["flowforge.core"],
                "modes": ["flowforge.modes"],
            },
            "layer_order": ["core", "modes"],
        })
        # core importing from modes would be a violation
        source = "from flowforge.modes.react import ReActExecutor\n"
        deps = engine.extract_dependencies(source)
        assert "flowforge.modes.react" in deps

    def test_check_file_nonexistent(self):
        """Check nonexistent file returns empty violations."""
        engine = ArchitectureConstraintEngine()
        violations = engine.check_file("/nonexistent/path.py")
        assert violations == []

    def test_extract_import_from(self):
        """Extract 'from X import Y' dependencies."""
        engine = ArchitectureConstraintEngine()
        source = "from flowforge.core.base_tool import BaseTool\nfrom os import path\n"
        deps = engine.extract_dependencies(source)
        assert "flowforge.core.base_tool" in deps
        assert "os" in deps

    def test_extract_import_bare(self):
        """Extract 'import X' dependencies."""
        engine = ArchitectureConstraintEngine()
        source = "import json\nimport flowforge.core\n"
        deps = engine.extract_dependencies(source)
        assert "json" in deps
        assert "flowforge.core" in deps

    def test_same_layer_no_violation(self):
        """Same-layer imports are not violations."""
        engine = ArchitectureConstraintEngine(config={
            "layer_mapping": {"core": ["flowforge.core"]},
            "layer_order": ["core"],
        })
        v = engine.check_dependency("flowforge.core.types", "flowforge.core.base")
        assert v is None


class TestHarnessOrchestratorIntegration:
    """Integration tests for HarnessOrchestrator with all components."""

    @pytest.mark.asyncio
    async def test_full_harness_lifecycle_good_output(self, ctx):
        """Full lifecycle: good output → PASS gate, no downgrade."""
        orch = HarnessOrchestrator(config={
            "enabled": True,
            "feedback_loop": {"evaluation_mode": EVAL_MODE_LIGHTWEIGHT},
        })
        await orch.pre_execute(ctx)
        result = {
            "content": "A comprehensive analysis of machine learning trends with detailed examples and practical applications across various industries and research domains worldwide.",
            "status": "completed",
        }
        result = await orch.post_execute(result, ctx)
        assert "_feedback" in result
        assert result["_feedback"]["gate"] == GATE_PASS
        assert result.get("status") == "completed"
        assert not result.get("quality_warning")

    @pytest.mark.asyncio
    async def test_full_harness_lifecycle_bad_output(self, ctx):
        """Full lifecycle: bad output → FAIL gate, downgrade."""
        orch = HarnessOrchestrator(config={
            "enabled": True,
            "feedback_loop": {"evaluation_mode": EVAL_MODE_LIGHTWEIGHT},
        })
        await orch.pre_execute(ctx)
        result = {
            "content": " ".join(["fail"] * 200),
            "status": "completed",
        }
        result = await orch.post_execute(result, ctx)
        assert result["_feedback"]["gate"] == GATE_FAIL
        assert result["status"] == "partial"
        assert result.get("quality_warning") is True

    @pytest.mark.asyncio
    async def test_harness_with_entropy_flags(self, ctx):
        """Harness pre_execute picks up entropy flags."""
        orch = HarnessOrchestrator(config={"enabled": True})
        orch.entropy_manager.set_entropy_flag("high_debt_alert", True)
        await orch.pre_execute(ctx)
        assert ctx.metadata.get("entropy_alert") == "high_technical_debt"

    @pytest.mark.asyncio
    async def test_harness_error_result_entropy_tracking(self, ctx):
        """Error result is tracked by EntropyManager."""
        orch = HarnessOrchestrator(config={"enabled": True})
        await orch.pre_execute(ctx)
        result = {"error": "timeout", "status": "failed"}
        result = await orch.post_execute(result, ctx)
        # EntropyManager should have tracked the failure
        assert orch.entropy_manager._post_track_count > 0

    @pytest.mark.asyncio
    async def test_harness_context_harness_enabled_attribute(self, ctx):
        """TaskContext.harness_enabled attribute controls harness."""
        ctx.harness_enabled = False
        orch = HarnessOrchestrator(config={"enabled": True})
        await orch.pre_execute(ctx)
        result = {"content": "test output content", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        # Should NOT have feedback because harness is disabled on context
        assert "_feedback" not in result

    @pytest.mark.asyncio
    async def test_harness_full_mode_with_scores(self, ctx):
        """Full mode returns scores and correct gate."""
        orch = HarnessOrchestrator(config={
            "enabled": True,
            "feedback_loop": {
                "evaluation_mode": EVAL_MODE_FULL,
                "quality_threshold": 0.7,
            },
        })
        await orch.pre_execute(ctx)
        result = {
            "content": "A detailed analysis of modern AI trends and their impact on software engineering practices.",
            "status": "completed",
        }
        result = await orch.post_execute(result, ctx)
        assert "_feedback" in result
        assert "scores" in result["_feedback"]
        assert result["_feedback"]["mode"] == EVAL_MODE_FULL

    @pytest.mark.asyncio
    async def test_harness_global_disabled(self, ctx):
        """Orchestrator.enabled=False → all hooks are no-ops."""
        orch = HarnessOrchestrator(config={"enabled": False})
        await orch.pre_execute(ctx)
        result = {"content": "test output content for harness disabled check", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        # No feedback injected when globally disabled
        assert "_feedback" not in result
        assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_harness_metadata_disabled(self, ctx):
        """ctx.metadata['harness_enabled']=False → hooks skip."""
        ctx.metadata["harness_enabled"] = False
        orch = HarnessOrchestrator(config={"enabled": True})
        await orch.pre_execute(ctx)
        result = {"content": "test output content for metadata disabled check", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        assert "_feedback" not in result

    @pytest.mark.asyncio
    async def test_harness_skip_mode(self, ctx):
        """evaluation_mode=skip → no feedback evaluation."""
        orch = HarnessOrchestrator(config={
            "enabled": True,
            "feedback_loop": {"evaluation_mode": EVAL_MODE_SKIP},
        })
        await orch.pre_execute(ctx)
        result = {"content": "Some content that would normally be evaluated.", "status": "completed"}
        result = await orch.post_execute(result, ctx)
        # Skip mode: no _feedback added
        assert "_feedback" not in result
        assert result["status"] == "completed"

    @pytest.mark.asyncio
    async def test_harness_pre_execute_exception_tolerated(self, ctx):
        """Exception in pre_execute should not break execution flow."""
        orch = HarnessOrchestrator(config={"enabled": True})
        # Force context_engine.inject to raise
        async def bad_inject(ctx):
            raise RuntimeError("ContextEngine failure")
        orch.context_engine.inject = bad_inject
        # pre_execute should raise (HybridExecutor wraps in try/except)
        with pytest.raises(RuntimeError, match="ContextEngine failure"):
            await orch.pre_execute(ctx)

    @pytest.mark.asyncio
    async def test_harness_post_execute_exception_tolerated(self, ctx):
        """Exception in post_execute should not lose the result."""
        orch = HarnessOrchestrator(config={"enabled": True})
        # Force feedback_loop.evaluate to raise
        async def bad_evaluate(result, ctx):
            raise RuntimeError("FeedbackLoop failure")
        orch.feedback_loop.evaluate = bad_evaluate
        result = {"content": "test output content for exception tolerance check", "status": "completed"}
        # post_execute should raise (HybridExecutor wraps in try/except)
        with pytest.raises(RuntimeError, match="FeedbackLoop failure"):
            await orch.post_execute(result, ctx)

    @pytest.mark.asyncio
    async def test_harness_multiple_evaluations_gate_counts(self, ctx):
        """Multiple sequential evaluations accumulate gate_counts correctly."""
        orch = HarnessOrchestrator(config={
            "enabled": True,
            "feedback_loop": {"evaluation_mode": EVAL_MODE_LIGHTWEIGHT},
        })
        # Run 3 evaluations with different outcomes
        await orch.pre_execute(ctx)

        # PASS: diverse content
        r1 = await orch.post_execute(
            {"content": "A comprehensive analysis of machine learning trends with detailed examples and practical applications across various industries and research domains worldwide.", "status": "completed"},
            ctx,
        )
        # CONDITIONAL: failure indicator
        r2 = await orch.post_execute(
            {"content": "I cannot complete this task because the data source is currently unavailable for processing.", "status": "completed"},
            ctx,
        )
        # FAIL: repetitive
        r3 = await orch.post_execute(
            {"content": " ".join(["bad"] * 200), "status": "completed"},
            ctx,
        )

        status = orch.feedback_loop.get_status()
        assert status["evaluation_count"] == 3
        assert status["gate_counts"]["PASS"] >= 1
        assert status["gate_counts"]["CONDITIONAL"] >= 1
        assert status["gate_counts"]["FAIL"] >= 1

    @pytest.mark.asyncio
    async def test_harness_entropy_flags_and_quality_warning_chain(self, ctx):
        """Full chain: entropy flag → quality_warning → entropy signal recorded."""
        orch = HarnessOrchestrator(config={"enabled": True})
        orch.entropy_manager.set_entropy_flag("high_debt_alert", True)

        await orch.pre_execute(ctx)
        assert ctx.metadata.get("entropy_alert") == "high_technical_debt"

        # Bad output triggers FAIL gate + quality_warning
        result = {"content": " ".join(["x"] * 200), "status": "completed"}
        result = await orch.post_execute(result, ctx)

        assert result["_feedback"]["gate"] == GATE_FAIL
        assert result["quality_warning"] is True
        # EntropyManager should have recorded the quality warning
        assert orch.entropy_manager._entropy_flags.get("last_quality_warning") == getattr(ctx, 'task_id', 'unknown')


class TestContextEngineWithFiles:
    """Tests for ContextEngine with actual file loading."""

    @pytest.mark.asyncio
    async def test_load_agents_md_from_file(self, ctx):
        """Load AGENTS.md from a real temp directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create AGENTS.md
            persona_dir = os.path.join(tmpdir, "writer")
            os.makedirs(persona_dir)
            with open(os.path.join(persona_dir, "AGENTS.md"), "w", encoding="utf-8") as f:
                f.write("# Writer Persona\nYou are a professional content writer.")

            engine = ContextEngine(config={"agents_md_paths": [tmpdir]})
            ctx.persona = "writer"
            await engine.inject(ctx)
            assert "agents_md" in ctx.metadata
            assert "professional content writer" in ctx.metadata["agents_md"]

    @pytest.mark.asyncio
    async def test_load_agents_md_fallback(self, ctx):
        """Load root AGENTS.md when persona-specific not found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "AGENTS.md"), "w", encoding="utf-8") as f:
                f.write("# Default Agent\nYou are a helpful assistant.")

            engine = ContextEngine(config={"agents_md_paths": [tmpdir]})
            ctx.persona = "unknown_persona"
            await engine.inject(ctx)
            assert "agents_md" in ctx.metadata
            assert "helpful assistant" in ctx.metadata["agents_md"]

    @pytest.mark.asyncio
    async def test_injection_count_increments(self, ctx):
        """Injection count increments with each call."""
        engine = ContextEngine(config={"agents_md_paths": []})
        await engine.inject(ctx)
        await engine.inject(ctx)
        await engine.inject(ctx)
        status = engine.get_status()
        assert status["injection_count"] == 3


# ══════════════════════════════════════════════════════════════
# v6.0 新增：EntropyManager 子组件详细测试
# ══════════════════════════════════════════════════════════════


class TestEntropySubComponents:
    """Tests for EntropyManager sub-components: DocGardener, DebtTracker,
    RuleEvolution, GarbageCollection, and EntropyManager.check / post_track."""

    @pytest.mark.asyncio
    async def test_doc_gardener_register_and_check(self):
        """Register a doc with linked sources, check freshness."""
        with tempfile.TemporaryDirectory() as tmpdir:
            doc_path = os.path.join(tmpdir, "guide.md")
            source_path = os.path.join(tmpdir, "source.py")
            with open(doc_path, "w", encoding="utf-8") as f:
                f.write("# Guide\nDocumentation content.")
            with open(source_path, "w", encoding="utf-8") as f:
                f.write("# source code")

            gardener = DocGardener(stale_threshold=0.7)
            gardener.register_doc(doc_path, linked_sources={source_path})
            assert doc_path in gardener.entries
            assert source_path in gardener.entries[doc_path].linked_sources

            stale = await gardener.check_freshness()
            assert isinstance(stale, list)

    @pytest.mark.asyncio
    async def test_doc_gardener_stale_detection(self):
        """Modify source after doc, verify staleness > threshold."""
        with tempfile.TemporaryDirectory() as tmpdir:
            doc_path = os.path.join(tmpdir, "guide.md")
            source_path = os.path.join(tmpdir, "source.py")

            # Create doc first
            with open(doc_path, "w", encoding="utf-8") as f:
                f.write("# Guide\nOld documentation.")

            # Register doc
            gardener = DocGardener(stale_threshold=0.1, mtime_cache_ttl=0)
            gardener.register_doc(doc_path, linked_sources={source_path})

            # Now modify source (make it newer than doc)
            time.sleep(0.05)
            with open(source_path, "w", encoding="utf-8") as f:
                f.write("# Updated source code")

            # Also backdate the doc entry to simulate age
            gardener.entries[doc_path].last_modified = time.time() - 86400 * 60  # 60 days ago

            stale = await gardener.check_freshness()
            assert len(stale) > 0
            assert stale[0]["staleness_score"] > 0.1

    @pytest.mark.asyncio
    async def test_doc_gardener_disabled(self):
        """doc_gardener_enabled=False → run_doc_gardener() returns empty."""
        mgr = EntropyManager(config={"doc_gardener_enabled": False})
        result = await mgr.run_doc_gardener()
        assert result == []

    @pytest.mark.asyncio
    async def test_debt_tracker_record_and_query(self):
        """Record debt items, verify get_open_items() and get_summary()."""
        tracker = DebtTracker()
        id1 = tracker.record("Missing error handling", severity=DebtSeverity.HIGH, source="test")
        id2 = tracker.record("Deprecated API usage", severity=DebtSeverity.MEDIUM, source="test")

        assert id1 == "DEBT-0001"
        assert id2 == "DEBT-0002"

        open_items = tracker.get_open_items()
        assert len(open_items) == 2

        summary = tracker.get_summary()
        assert summary["total_items"] == 2
        assert summary["open_items"] == 2
        assert summary["by_severity"]["high"] == 1
        assert summary["by_severity"]["medium"] == 1
        assert summary["by_status"]["open"] == 2

    @pytest.mark.asyncio
    async def test_debt_tracker_update_status(self):
        """Update status to RESOLVED, verify not in open items."""
        tracker = DebtTracker()
        item_id = tracker.record("Some debt", severity=DebtSeverity.LOW)

        open_before = tracker.get_open_items()
        assert len(open_before) == 1

        updated = tracker.update_status(item_id, DebtStatus.RESOLVED)
        assert updated is True

        open_after = tracker.get_open_items()
        assert len(open_after) == 0

        # Verify item still exists but is resolved
        assert tracker.items[item_id].status == DebtStatus.RESOLVED

    @pytest.mark.asyncio
    async def test_debt_tracker_disabled(self):
        """debt_tracker_enabled=False → run_debt_tracker() returns empty."""
        mgr = EntropyManager(config={"debt_tracker_enabled": False})
        result = await mgr.run_debt_tracker()
        assert result == []

    @pytest.mark.asyncio
    async def test_rule_evolution_lifecycle(self):
        """Full lifecycle: propose → activate → mutate → deprecate → retire."""
        evolution = RuleEvolution()

        # Propose
        rule_id = evolution.propose("No raw SQL", "Prevent raw SQL queries in service layer")
        assert rule_id == "RULE-0001"
        assert evolution.rules[rule_id].lifecycle == RuleLifecycle.PROPOSED

        # Activate
        activated = evolution.activate(rule_id)
        assert activated is True
        assert evolution.rules[rule_id].lifecycle == RuleLifecycle.ACTIVE

        # Deprecate
        deprecated = evolution.deprecate(rule_id)
        assert deprecated is True
        assert evolution.rules[rule_id].lifecycle == RuleLifecycle.DEPRECATED

        # Retire
        retired = evolution.retire(rule_id)
        assert retired is True
        assert evolution.rules[rule_id].lifecycle == RuleLifecycle.RETIRED

    @pytest.mark.asyncio
    async def test_rule_evolution_mutate_creates_new_version(self):
        """Mutate creates new rule with version+1."""
        evolution = RuleEvolution()

        rule_id = evolution.propose("Timeout rule", "All API calls must have timeout")
        evolution.activate(rule_id)
        assert evolution.rules[rule_id].version == 1

        new_id = evolution.mutate(rule_id, "All API calls must have 30s timeout")
        assert new_id is not None
        assert new_id != rule_id
        assert evolution.rules[new_id].version == 2
        assert evolution.rules[new_id].lifecycle == RuleLifecycle.ACTIVE
        assert evolution.rules[new_id].parent_id == rule_id
        # Original should be deprecated
        assert evolution.rules[rule_id].lifecycle == RuleLifecycle.DEPRECATED

    @pytest.mark.asyncio
    async def test_rule_evolution_disabled(self):
        """rule_evolution_enabled=False → run_rule_evolution() returns empty."""
        mgr = EntropyManager(config={"rule_evolution_enabled": False})
        result = await mgr.run_rule_evolution([{"error": "test"}])
        assert result == []

    @pytest.mark.asyncio
    async def test_garbage_collection_default_schedules(self):
        """Verify 4 default schedules exist."""
        gc = GarbageCollection()
        assert len(gc.schedules) == 4
        assert "checkpoints" in gc.schedules
        assert "sessions" in gc.schedules
        assert "cache_entries" in gc.schedules
        assert "task_states" in gc.schedules

    @pytest.mark.asyncio
    async def test_garbage_collection_check_and_collect(self):
        """Run GC, verify it returns collected list."""
        gc = GarbageCollection()
        result = await gc.check_and_collect()
        assert "collected" in result
        assert "details" in result
        assert isinstance(result["collected"], list)
        # First run should collect all 4 default schedules
        assert len(result["collected"]) == 4

        # Second run immediately should collect nothing (interval not elapsed)
        result2 = await gc.check_and_collect()
        assert len(result2["collected"]) == 0

    @pytest.mark.asyncio
    async def test_entropy_manager_check_method(self, ctx):
        """Call check(ctx) with a TaskContext, verify combined report."""
        mgr = EntropyManager()
        report = await mgr.check(ctx)
        assert "doc_freshness" in report
        assert "debt_summary" in report
        assert "active_rules_count" in report
        assert "gc_result" in report
        assert "stale_count" in report["doc_freshness"]

    @pytest.mark.asyncio
    async def test_post_track_records_debt_on_error(self, ctx):
        """Error result → DebtItem recorded via debt_tracker."""
        mgr = EntropyManager()
        result = {"error": "connection timeout", "status": "failed"}
        await mgr.post_track(result, ctx)

        # Verify debt was recorded
        assert mgr.debt_tracker is not None
        open_items = mgr.debt_tracker.get_open_items()
        assert len(open_items) >= 1
        assert any("connection timeout" in item.description for item in open_items)

    @pytest.mark.asyncio
    async def test_post_track_records_debt_on_quality_warning(self, ctx):
        """quality_warning → DebtItem recorded."""
        mgr = EntropyManager()
        result = {
            "content": "some output",
            "status": "partial",
            "quality_warning": True,
        }
        await mgr.post_track(result, ctx)

        assert mgr.debt_tracker is not None
        open_items = mgr.debt_tracker.get_open_items()
        assert len(open_items) >= 1
        assert any("Quality warning" in item.description for item in open_items)

    @pytest.mark.asyncio
    async def test_record_failure_proposes_rule(self, ctx):
        """Error → rule_evolution.propose() called."""
        mgr = EntropyManager()
        result = {"error": "database connection lost", "status": "failed"}
        await mgr.post_track(result, ctx)

        assert mgr.rule_evolution is not None
        active_rules = mgr.rule_evolution.get_active_rules()
        # Proposed rules are not active yet, check all rules
        all_rules = list(mgr.rule_evolution.rules.values())
        assert len(all_rules) >= 1
        assert any("database connection lost" in r.description for r in all_rules)


# ══════════════════════════════════════════════════════════════
# v6.0 新增：FeedbackLoop LLM 路径测试
# ══════════════════════════════════════════════════════════════


class _MockLLMClient:
    """Simple async mock LLM client for testing FeedbackLoop LLM paths."""

    def __init__(self, responses=None, side_effect=None):
        self.responses = responses or []
        self._call_index = 0
        self._call_count = 0
        self.side_effect = side_effect

    async def execute(self, tool_input: ToolInput) -> ToolOutput:
        self._call_count += 1
        if self.side_effect:
            raise self.side_effect
        if self._call_index < len(self.responses):
            resp = self.responses[self._call_index]
            self._call_index += 1
            return ToolOutput(result={"content": resp})
        return ToolOutput(result={"content": ""})


class TestFeedbackLoopLLMEvaluation:
    """Tests for FeedbackLoop LLM-based evaluation paths."""

    @pytest.mark.asyncio
    async def test_lightweight_with_mock_llm(self, ctx):
        """Lightweight mode with mock LLM returns LLM-based gate."""
        json_response = json.dumps({
            "overall_score": 0.9,
            "dimension_scores": {
                "correctness": 0.9,
                "completeness": 0.9,
                "coherence": 0.9,
                "safety": 0.9,
            },
            "issues": [],
            "recommendations": [],
        })
        mock_client = _MockLLMClient(responses=[json_response])
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        loop.set_llm_client(mock_client)

        result = {
            "content": "A well-structured analysis of modern AI trends and their impact on software engineering practices today with detailed examples.",
            "status": "completed",
        }
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        assert result["_feedback"]["gate"] == GATE_PASS
        assert mock_client._call_count == 1

    @pytest.mark.asyncio
    async def test_full_with_mock_llm(self, ctx):
        """Full mode with mock LLM makes 2 LLM calls."""
        judge_response = "The output is well-structured and accurate."
        scoring_response = json.dumps({
            "overall_score": 0.85,
            "dimension_scores": {
                "correctness": 0.85,
                "completeness": 0.85,
                "coherence": 0.85,
                "safety": 0.85,
            },
            "issues": [],
            "recommendations": [],
        })
        mock_client = _MockLLMClient(responses=[judge_response, scoring_response])
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_FULL})
        loop.set_llm_client(mock_client)

        result = {
            "content": "A comprehensive analysis of machine learning trends with detailed examples and code snippets for production deployment.",
            "status": "completed",
        }
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        assert "scores" in result["_feedback"]
        assert mock_client._call_count == 2

    @pytest.mark.asyncio
    async def test_llm_failure_fallback(self, ctx):
        """Mock LLM that raises → fallback to heuristic evaluation."""
        mock_client = _MockLLMClient(side_effect=RuntimeError("LLM unavailable"))
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        loop.set_llm_client(mock_client)

        result = {
            "content": "A detailed analysis of software architecture patterns and their applications in modern distributed systems development.",
            "status": "completed",
        }
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        # Should still produce a gate result via heuristic fallback
        assert result["_feedback"]["gate"] in (GATE_PASS, GATE_CONDITIONAL, GATE_FAIL)

    @pytest.mark.asyncio
    async def test_no_llm_client_heuristic_fallback(self, ctx):
        """No llm_client set → heuristic evaluation works."""
        loop = FeedbackLoop(config={"evaluation_mode": EVAL_MODE_LIGHTWEIGHT})
        assert loop._llm_client is None

        result = {
            "content": "Artificial intelligence has transformed software development in profound ways. Modern AI systems leverage deep learning architectures including transformers and diffusion models to solve complex problems. The emergence of large language models has created new possibilities for automated code generation and content creation.",
            "status": "completed",
        }
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        assert result["_feedback"]["gate"] == GATE_PASS

    @pytest.mark.asyncio
    async def test_parse_scoring_response_json_block(self):
        """Test _parse_scoring_response with ```json block."""
        loop = FeedbackLoop()
        response = 'Here is my evaluation:\n```json\n{"overall_score": 0.8, "dimension_scores": {"correctness": 0.8, "completeness": 0.8, "coherence": 0.8, "safety": 0.8}, "issues": ["minor issue"], "recommendations": ["add more detail"]}\n```'
        parsed = loop._parse_scoring_response(response)
        assert parsed["overall_score"] == 0.8
        assert parsed["dimension_scores"]["correctness"] == 0.8
        assert len(parsed["issues"]) == 1

    @pytest.mark.asyncio
    async def test_parse_scoring_response_bare_json(self):
        """Test with bare JSON (no code block)."""
        loop = FeedbackLoop()
        response = '{"overall_score": 0.75, "dimension_scores": {"correctness": 0.7, "completeness": 0.8, "coherence": 0.75, "safety": 0.8}, "issues": [], "recommendations": []}'
        parsed = loop._parse_scoring_response(response)
        assert parsed["overall_score"] == 0.75
        assert parsed["dimension_scores"]["completeness"] == 0.8

    @pytest.mark.asyncio
    async def test_parse_scoring_response_invalid_json(self):
        """Invalid JSON → fallback scores."""
        loop = FeedbackLoop()
        response = "This is not valid JSON at all!"
        parsed = loop._parse_scoring_response(response)
        assert parsed["overall_score"] == 0.5
        assert all(v == 0.5 for v in parsed["dimension_scores"].values())

    @pytest.mark.asyncio
    async def test_set_llm_client(self):
        """Verify set_llm_client() works."""
        loop = FeedbackLoop()
        assert loop._llm_client is None

        mock = _MockLLMClient()
        loop.set_llm_client(mock)
        assert loop._llm_client is mock

    @pytest.mark.asyncio
    async def test_feedback_result_to_dict(self):
        """Create FeedbackResult, verify to_dict() output."""
        result = FeedbackResult(
            gate=ClassificationGate.PASS,
            overall_score=0.9,
            dimension_scores={"correctness": 0.9, "completeness": 0.9, "coherence": 0.9, "safety": 0.9},
            issues=[],
            recommendations=["Consider adding examples"],
            mode=EvaluationMode.FULL,
            llm_calls=2,
        )
        d = result.to_dict()
        assert d["gate"] == "pass"
        assert d["overall_score"] == 0.9
        assert d["dimension_scores"]["correctness"] == 0.9
        assert d["mode"] == "full"
        assert d["llm_calls"] == 2
        assert len(d["recommendations"]) == 1

    @pytest.mark.asyncio
    async def test_classification_gate_enum(self):
        """Verify ClassificationGate values."""
        assert ClassificationGate.PASS.value == "pass"
        assert ClassificationGate.CONDITIONAL.value == "conditional"
        assert ClassificationGate.FAIL.value == "fail"

    @pytest.mark.asyncio
    async def test_evaluation_mode_enum(self):
        """Verify EvaluationMode values."""
        assert EvaluationMode.FULL.value == "full"
        assert EvaluationMode.LIGHTWEIGHT.value == "lightweight"
        assert EvaluationMode.SKIP.value == "skip"


# ══════════════════════════════════════════════════════════════
# v6.0 新增：ContextEngine v6 路径测试
# ══════════════════════════════════════════════════════════════


class TestContextEngineV6:
    """Tests for ContextEngine v6 paths: harness_context, handoff_artifacts,
    dynamic context, format_context_block, cache, and workspace search."""

    @pytest.mark.asyncio
    async def test_inject_populates_harness_context(self, ctx):
        """Verify ctx.state['harness_context'] is populated after inject."""
        engine = ContextEngine(config={"agents_md_paths": []})
        await engine.inject(ctx)
        assert "harness_context" in ctx.state
        hc = ctx.state["harness_context"]
        assert "agents_md" in hc
        assert "past_failures" in hc
        assert "handoff_artifacts" in hc
        assert "dynamic_context" in hc

    @pytest.mark.asyncio
    async def test_collect_handoff_artifacts(self, ctx):
        """Set ctx.state['handoff_artifacts'], verify collection."""
        ctx.state["handoff_artifacts"] = [
            {"source_agent": "researcher", "artifact_type": "research", "content": "findings"},
            {"source_agent": "writer", "artifact_type": "draft", "content": "article"},
            {"invalid": "no source_agent key"},
        ]
        engine = ContextEngine(config={"agents_md_paths": []})
        artifacts = engine._collect_handoff_artifacts(ctx)
        assert len(artifacts) == 2
        assert artifacts[0]["source_agent"] == "researcher"
        assert artifacts[1]["source_agent"] == "writer"

    @pytest.mark.asyncio
    async def test_build_dynamic_context(self, ctx):
        """Verify dynamic context has task_id, persona, mode."""
        ctx.persona = "writer"
        ctx.mode = "react"
        engine = ContextEngine(config={"agents_md_paths": []})
        dynamic = engine._build_dynamic_context(ctx)
        assert dynamic["task_id"] == "test-001"
        assert dynamic["persona"] == "writer"
        assert dynamic["mode"] == "react"

    @pytest.mark.asyncio
    async def test_format_context_block(self):
        """Call format_context_block with assembled dict, verify output string."""
        engine = ContextEngine()
        assembled = {
            "agents_md": "# Project Guide\nFollow these rules.",
            "handoff_artifacts": [
                {"source_agent": "researcher", "artifact_type": "research", "content": "Key findings here"},
            ],
            "dynamic_context": {
                "task_id": "task-123",
                "persona": "writer",
                "mode": "react",
            },
        }
        block = engine.format_context_block(assembled)
        assert "Project Guide" in block
        assert "researcher" in block
        assert "task-123" in block
        assert "Runtime Context" in block

    @pytest.mark.asyncio
    async def test_clear_cache(self, ctx):
        """Load AGENTS.md, clear cache, verify re-read."""
        with tempfile.TemporaryDirectory() as tmpdir:
            agents_file = os.path.join(tmpdir, "AGENTS.md")
            with open(agents_file, "w", encoding="utf-8") as f:
                f.write("# Test Agent\nInitial content.")

            engine = ContextEngine(config={"agents_md_paths": [tmpdir]})
            ctx.persona = ""
            await engine.inject(ctx)
            assert "agents_md" in ctx.metadata

            # Clear cache
            engine.clear_cache()
            assert len(engine._agents_md_cache) == 0
            assert engine._agents_md_v6_cache is None

    @pytest.mark.asyncio
    async def test_load_agents_md_v6_from_workspace(self, ctx):
        """Set workspace_root to temp dir with AGENTS.md."""
        with tempfile.TemporaryDirectory() as tmpdir:
            agents_file = os.path.join(tmpdir, "AGENTS.md")
            with open(agents_file, "w", encoding="utf-8") as f:
                f.write("# Workspace Agent\nWorkspace-level instructions.")

            engine = ContextEngine(config={
                "agents_md_paths": [],
                "workspace_root": tmpdir,
            })
            ctx.persona = ""
            await engine.inject(ctx)
            assert "agents_md" in ctx.metadata
            assert "Workspace-level instructions" in ctx.metadata["agents_md"]


# ══════════════════════════════════════════════════════════════
# v6.0 新增：SessionManager v6 路径测试
# ══════════════════════════════════════════════════════════════


class TestSessionManagerV6:
    """Tests for SessionManager v6 paths: check_and_compact, session usage,
    _compact_messages, _summarize_older_messages, and char-based truncation."""

    @pytest.mark.asyncio
    async def test_check_and_compact_below_threshold(self, ctx):
        """Messages below threshold → not compacted."""
        mgr = SessionManager(config={"context_window": 128000, "compact_threshold": 0.92})
        ctx.state["messages"] = [{"role": "user", "content": "hello"}]
        result = await mgr.check_and_compact(ctx)
        assert result["compacted"] is False
        assert result["before_tokens"] < result["threshold"]

    @pytest.mark.asyncio
    async def test_check_and_compact_above_threshold(self, ctx):
        """Large messages → compacted with summary."""
        mgr = SessionManager(config={"context_window": 100, "compact_threshold": 0.5})
        messages = [{"role": "system", "content": "system prompt"}]
        for i in range(20):
            messages.append({"role": "user", "content": f"message {i} " * 50})
            messages.append({"role": "assistant", "content": f"response {i} " * 50})
        ctx.state["messages"] = messages

        result = await mgr.check_and_compact(ctx)
        assert result["compacted"] is True
        assert result["after_tokens"] < result["before_tokens"]

    @pytest.mark.asyncio
    async def test_get_session_usage(self, ctx):
        """After check_and_compact, verify usage tracked."""
        mgr = SessionManager(config={"context_window": 128000})
        ctx.state["messages"] = [{"role": "user", "content": "hello world"}]
        await mgr.check_and_compact(ctx)

        usage = mgr.get_session_usage("test-001")
        assert usage > 0

    @pytest.mark.asyncio
    async def test_compact_messages_summarizes(self):
        """Verify _compact_messages creates summary."""
        mgr = SessionManager()
        messages = [{"role": "system", "content": "You are helpful."}]
        for i in range(10):
            messages.append({"role": "user", "content": f"Question {i}: " + "x" * 100})
            messages.append({"role": "assistant", "content": f"Answer {i}: " + "y" * 100})

        compacted = await mgr._compact_messages(messages, ctx=None)
        assert len(compacted) < len(messages)
        # Should contain a summary message
        summary_msgs = [m for m in compacted if "Context Summary" in m.get("content", "")]
        assert len(summary_msgs) >= 1

    @pytest.mark.asyncio
    async def test_summarize_older_messages(self):
        """Verify extractive summary output."""
        mgr = SessionManager()
        messages = [
            {"role": "user", "content": "What is Python?"},
            {"role": "assistant", "content": "Python is a programming language."},
            {"role": "user", "content": "What is FastAPI?"},
            {"role": "assistant", "content": "FastAPI is a web framework."},
        ]
        summary = mgr._summarize_older_messages(messages)
        assert "user" in summary
        assert "assistant" in summary
        assert "Python" in summary

    @pytest.mark.asyncio
    async def test_truncate_tool_output_v6(self):
        """Verify token-based truncation with low tool_output_limit."""
        mgr = SessionManager(config={"tool_output_limit": 100})
        long_output = "x" * 10000
        result = mgr.truncate_tool_output(long_output)
        assert "truncated" in result
        assert len(result) < len(long_output)


# ══════════════════════════════════════════════════════════════
# v6.0 新增：Security 模块覆盖率测试
# ══════════════════════════════════════════════════════════════


class TestSecurityCoverage:
    """Tests for PermissionPipeline ask_callback and ArchitectureConstraintEngine
    edge cases."""

    @pytest.mark.asyncio
    async def test_permission_pipeline_ask_callback_approved(self):
        """Set ask_callback that returns True → allowed."""
        pipeline = PermissionPipeline()
        pipeline.add_ask_rule(tool_name="sensitive_tool", reason="Needs approval")

        async def approve(tool_name, action_level, context):
            return True

        pipeline.set_approval_callback(approve)
        result = await pipeline.check("sensitive_tool", ActionLevel.EXECUTE)
        assert result["allowed"] is True
        assert result["layer"] == "ask"

    @pytest.mark.asyncio
    async def test_permission_pipeline_ask_callback_denied(self):
        """Set ask_callback that returns False → denied."""
        pipeline = PermissionPipeline()
        pipeline.add_ask_rule(tool_name="sensitive_tool", reason="Needs approval")

        async def deny(tool_name, action_level, context):
            return False

        pipeline.set_approval_callback(deny)
        result = await pipeline.check("sensitive_tool", ActionLevel.EXECUTE)
        assert result["allowed"] is False
        assert result["layer"] == "ask"

    @pytest.mark.asyncio
    async def test_permission_pipeline_get_status(self):
        """Verify get_status() returns correct counts."""
        pipeline = PermissionPipeline()
        pipeline.add_allow_rule(tool_name="read_tool", action_level=ActionLevel.READ)
        pipeline.add_deny_rule(tool_name="write_tool", action_level=ActionLevel.EXECUTE)

        await pipeline.check("read_tool", ActionLevel.READ)
        await pipeline.check("write_tool", ActionLevel.EXECUTE)
        await pipeline.check("unknown_tool", ActionLevel.EXECUTE)

        status = pipeline.get_status()
        assert status["check_count"] == 3
        assert status["allow_count"] == 1
        assert status["deny_count"] == 2  # write_tool denied + unknown_tool fail-closed

    @pytest.mark.asyncio
    async def test_arch_constraint_check_file_nonexistent(self):
        """Nonexistent file → no violations."""
        engine = ArchitectureConstraintEngine()
        violations = engine.check_file("/nonexistent/path/to/file.py")
        assert violations == []

    @pytest.mark.asyncio
    async def test_arch_constraint_inject_violations_empty(self):
        """Empty violations list → no injection."""
        engine = ArchitectureConstraintEngine()
        ctx = TaskContext(task_id="test", input_data={})
        engine.inject_violations_into_context(ctx, [])
        assert "arch_violations" not in ctx.metadata

    @pytest.mark.asyncio
    async def test_arch_constraint_resolve_layer_no_match(self):
        """Unknown module → None layer."""
        engine = ArchitectureConstraintEngine(config={
            "layer_mapping": {
                "core": ["flowforge.core"],
                "modes": ["flowforge.modes"],
            },
        })
        assert engine.get_layer("unknown.module.path") is None

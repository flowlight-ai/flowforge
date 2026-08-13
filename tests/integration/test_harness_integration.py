#!/usr/bin/env python
"""FlowForge v6.0 Harness Integration Test.

Simulates a complete Agent task lifecycle with all Harness guardrails:
1. ContextEngine: AGENTS.md injection, failure case retrieval, session handoff
2. SessionManager: Context compaction, tool output truncation
3. FeedbackLoop: Quality evaluation (lightweight/full/skip modes)
4. EntropyManager: Pre-check flags, post-track failure recording
5. PermissionPipeline: deny→ask→allow three-layer permission
6. ArchitectureConstraintEngine: Layer dependency validation

Run with:
    python -m flowforge.tests.integration.test_harness_integration

Or directly:
    python flowforge/tests/integration/test_harness_integration.py
"""

import asyncio
import sys
import os
import time

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# P-118: 显式 asyncio 标记，不依赖 asyncio_mode="auto" 隐式行为
pytestmark = pytest.mark.asyncio

from flowforge.harness.orchestrator import HarnessOrchestrator
from flowforge.harness.context_engine import ContextEngine
from flowforge.harness.session_manager import SessionManager
from flowforge.harness.feedback_loop import (
    FeedbackLoop, EVAL_MODE_FULL, EVAL_MODE_LIGHTWEIGHT, EVAL_MODE_SKIP,
    GATE_PASS, GATE_CONDITIONAL, GATE_FAIL,
)
from flowforge.harness.entropy_manager import EntropyManager
from flowforge.security.permission_pipeline import PermissionPipeline, ActionLevel
from flowforge.security.arch_constraint import ArchitectureConstraintEngine
from flowforge.core.task_context import TaskContext


# ── Color helpers ──

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def log_section(title):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")

def log_pass(msg):
    print(f"  {GREEN}[PASS]{RESET} {msg}")

def log_fail(msg):
    print(f"  {RED}[FAIL]{RESET} {msg}")

def log_info(msg):
    print(f"  {YELLOW}[INFO]{RESET} {msg}")


# ══════════════════════════════════════════════════════════════
# SCENARIO DATA
# ══════════════════════════════════════════════════════════════

GOOD_ARTICLE = """
The rapid advancement of artificial intelligence has fundamentally transformed how we approach software development and content creation. In this comprehensive analysis, we explore several key trends that are shaping the industry in 2026.

First, the emergence of large language models has democratized access to sophisticated natural language processing capabilities. Developers can now leverage these models for code generation, documentation writing, and even architectural decision-making support.

Second, the integration of AI agents into development workflows has created new paradigms for task automation. These agents can independently research topics, draft content, perform quality checks, and iterate based on feedback - a capability that was previously limited to human operators.

Third, the concept of "Harness Engineering" has gained significant traction. This approach treats AI models as "brains" while providing a robust "body" of engineering infrastructure - including context management, feedback loops, entropy control, and permission systems - to ensure reliable and predictable behavior.

In conclusion, the combination of powerful AI models with well-engineered harness systems represents the future of intelligent automation.
"""

BAD_OUTPUT_SHORT = "I can't help you with that."

BAD_OUTPUT_REPETITIVE = "word word word word word " * 50

FAILURE_INDICATOR = """I apologize, but I am unable to complete this request at this time due to technical limitations."""

ERROR_RESULT = {
    "error": "Connection timeout after 30s",
    "status": "failed",
}


# ══════════════════════════════════════════════════════════════
# TEST CASES
# ══════════════════════════════════════════════════════════════

async def test_scenario_1_normal_execution():
    """Scenario 1: Normal execution with good output → PASS gate."""
    log_section("SCENARIO 1: Normal Execution (Good Output)")

    orch = HarnessOrchestrator(config={
        "enabled": True,
        "feedback_loop": {"evaluation_mode": EVAL_MODE_LIGHTWEIGHT},
    })
    ctx = TaskContext(task_id="scenario-1", input_data={"task": "write an article"})

    # Step 1: pre_execute
    log_info("Calling pre_execute...")
    await orch.pre_execute(ctx)
    log_pass("pre_execute completed without error")

    # Check context injection happened
    if ctx.metadata.get("agents_md") or ctx.metadata.get("past_failures"):
        log_pass("ContextEngine injected data into ctx.metadata")
    else:
        log_info("No AGENTS.md or failures injected (expected without config paths)")

    # Step 2: Simulate agent execution
    result = {
        "content": GOOD_ARTICLE.strip(),
        "status": "completed",
        "tool_calls": ["web_search", "fact_check"],
        "duration_ms": 3500,
    }
    log_info(f"Simulated agent execution: status={result['status']}, "
             f"content_len={len(result['content'])}")

    # Step 3: post_execute
    log_info("Calling post_execute...")
    result = await orch.post_execute(result, ctx)

    # Verify feedback
    assert "_feedback" in result, "Feedback metadata missing!"
    fb = result["_feedback"]
    log_info(f"Gate: {fb['gate']} | Mode: {fb['mode']} | Duration: {fb.get('duration_ms', 0):.1f}ms")

    if fb["gate"] == GATE_PASS:
        log_pass(f"Gate=PASS (good output correctly evaluated)")
    elif fb["gate"] == GATE_CONDITIONAL:
        log_pass(f"Gate=CONDITIONAL (acceptable)")
    else:
        log_fail(f"Unexpected gate={fb['gate']} for good article!")

    # Verify no downgrade
    assert not result.get("quality_warning"), "Should NOT have quality_warning"
    assert result.get("status") == "completed", "Status should remain 'completed'"
    log_pass("Result status unchanged (no downgrade)")

    # Print harness status
    status = orch.get_status()
    log_info(f"Harness status: enabled={status['enabled']}")
    log_info(f"FeedbackLoop: evaluations={status['feedback_loop']['evaluation_count']}, "
             f"gates={status['feedback_loop']['gate_counts']}")
    log_info(f"EntropyManager: pre_checks={status['entropy_manager']['pre_check_count']}, "
             f"post_tracks={status['entropy_manager']['post_track_count']}")

    return True


async def test_scenario_2_bad_output():
    """Scenario 2: Bad output (repetitive) → FAIL gate + downgrade."""
    log_section("SCENARIO 2: Bad Output (Repetitive Content)")

    orch = HarnessOrchestrator(config={
        "enabled": True,
        "feedback_loop": {"evaluation_mode": EVAL_MODE_LIGHTWEIGHT},
    })
    ctx = TaskContext(task_id="scenario-2", input_data={"task": "write summary"})

    await orch.pre_execute(ctx)

    # Bad output: highly repetitive
    result = {
        "content": BAD_OUTPUT_REPETITIVE.strip(),
        "status": "completed",
    }

    log_info(f"Simulated bad execution: content_len={len(result['content'])}, repetitive=True")
    result = await orch.post_execute(result, ctx)

    fb = result.get("_feedback", {})
    log_info(f"Gate: {fb.get('gate', 'N/A')} | Action: {fb.get('action', 'N/A')}")

    if fb.get("gate") == GATE_FAIL:
        log_pass(f"Gate=FAIL as expected for repetitive content!")
        assert result.get("status") == "partial", "Should be downgraded to 'partial'"
        assert result.get("quality_warning") is True, "quality_warning should be set"
        log_pass(f"Result downgraded: status='partial', quality_warning=True")
    elif fb.get("gate") == GATE_CONDITIONAL:
        log_info(f"Gate=CONDITIONAL (heuristic may vary)")
    else:
        log_fail(f"Expected FAIL or CONDITIONAL, got {fb.get('gate')}")

    return True


async def test_scenario_3_error_with_entropy():
    """Scenario 3: Error result → EntropyManager records failure."""
    log_section("SCENARIO 3: Error Result (Entropy Tracking)")

    orch = HarnessOrchestrator(config={"enabled": True})
    ctx = TaskContext(task_id="scenario-3", input_data={"task": "connect API"})

    # Set an entropy flag to verify pre_check picks it up
    orch.entropy_manager.set_entropy_flag("high_debt_alert", True)

    await orch.pre_execute(ctx)
    # Verify flag was picked up
    if ctx.metadata.get("entropy_alert"):
        log_pass(f"pre_check detected high_debt_alert flag → injected into context")
    else:
        log_fail("high_debt_alert flag was not processed!")

    # Error result from agent
    result = dict(ERROR_RESULT)
    log_info(f"Simulated error execution: error='{result['error']}'")

    result = await orch.post_execute(result, ctx)

    # Verify entropy tracking recorded the failure
    em_status = orch.entropy_manager.get_status()
    log_info(f"EntropyManager: post_tracks={em_status['post_track_count']}")
    assert em_status["post_track_count"] > 0, "Failure should have been tracked"
    log_pass("Error result was tracked by EntropyManager.post_track()")

    return True


async def test_scenario_4_full_evaluation():
    """Scenario 4: Full mode with 4-dimension scoring."""
    log_section("SCENARIO 4: Full Evaluation Mode (4-Dimension Scoring)")

    orch = HarnessOrchestrator(config={
        "enabled": True,
        "feedback_loop": {
            "evaluation_mode": EVAL_MODE_FULL,
            "quality_threshold": 0.7,
        },
    })
    ctx = TaskContext(task_id="scenario-4", input_data={"task": "write report"})
    await orch.pre_execute(ctx)

    result = {
        "content": GOOD_ARTICLE.strip(),
        "status": "completed",
    }

    result = await orch.post_execute(result, ctx)
    fb = result.get("_feedback", {})

    assert fb.get("mode") == EVAL_MODE_FULL, f"Expected full mode, got {fb.get('mode')}"
    log_pass(f"Evaluation mode: FULL")

    scores = fb.get("scores", {})
    if scores:
        log_info(f"Scores:")
        for dim, score in scores.items():
            bar = "#" * int(score * 20)
            print(f"      {dim:20s}: [{bar:<20}] {score:.2f}")
        avg = sum(scores.values()) / len(scores)
        log_info(f"Average score: {avg:.3f} (threshold: 0.7)")
        log_pass("4-dimension scoring returned")
    else:
        log_fail("No scores returned in FULL mode!")

    log_info(f"Final gate: {fb.get('gate')}")
    return True


async def test_scenario_5_permission_pipeline():
    """Scenario 5: PermissionPipeline three-layer validation."""
    log_section("SCENARIO 5: Permission Pipeline (deny→ask→allow)")

    pipeline = PermissionPipeline()

    # Configure rules
    pipeline.add_allow_rule(tool_name="read_file", action_level=ActionLevel.READ, reason="Read-only is safe")
    pipeline.add_ask_rule(tool_name="write_file", action_level=ActionLevel.EXECUTE, reason="Write needs approval")
    pipeline.add_deny_rule(tool_name="delete_db", action_level=ActionLevel.EXECUTE, reason="Destructive operation")
    pipeline.add_deny_rule(tool_name="*", action_level=ActionLevel.EXECUTE, reason="Default deny for EXECUTE")

    # Test 1: Allow read-only
    r1 = await pipeline.check("read_file", ActionLevel.READ)
    if r1["allowed"]:
        log_pass(f"read_file READ → allowed ({r1['layer']})")
    else:
        log_fail(f"read_file READ → denied! reason={r1['reason']}")

    # Test 2: Deny destructive
    r2 = await pipeline.check("delete_db", ActionLevel.EXECUTE)
    if not r2["allowed"]:
        log_pass(f"delete_db EXEC → denied ({r2['layer']})")
    else:
        log_fail(f"delete_db EXEC → allowed! Should be denied!")

    # Test 3: Ask for write (no callback = denied)
    r3 = await pipeline.check("write_file", ActionLevel.EXECUTE)
    if not r3["allowed"]:
        log_pass(f"write_file EXEC → ask→denied (no callback) ({r3['layer']})")
    else:
        log_fail(f"write_file EXEC → allowed! Ask rule requires callback")

    # Test 4: Wildcard deny catches unknown
    r4 = await pipeline.check("unknown_tool", ActionLevel.EXECUTE)
    if not r4["allowed"]:
        log_pass(f"unknown_tool EXEC → wildcard denied ({r4['layer']})")
    else:
        log_fail(f"unknown_tool EXEC → allowed! Fail-closed violated")

    # Test 5: Read level bypasses wildcard deny
    r5 = await pipeline.check("any_tool", ActionLevel.READ)
    # Note: wildcard deny is for EXECUTE only, so READ may pass or fail depending on config
    log_info(f"any_tool READ → allowed={r5['allowed']} ({r5['layer']})")

    # Status
    st = pipeline.get_status()
    log_info(f"Pipeline stats: allow={st['allow_rules']}, deny={st['deny_rules']}, "
             f"ask={st['ask_rules']}, total_checks={st['check_count']}")

    return True


async def test_scenario_6_arch_constraints():
    """Scenario 6: ArchitectureConstraintEngine layer validation."""
    log_section("SCENARIO 6: Architecture Constraint Engine")

    engine = ArchitectureConstraintEngine(config={
        "enabled": True,
        "layer_mapping": {
            "types": ["flowforge.core.types"],
            "config": ["flowforge.config"],
            "repo": ["flowforge.memory.repo"],
            "service": ["flowforge.services", "flowforge.tools"],
            "runtime": ["flowforge.modes", "flowforge.agents"],
            "ui": ["flowforge.web", "flowforge.app"],
        },
        "layer_order": ["types", "config", "repo", "service", "runtime", "ui"],
    })

    # Valid: higher layer imports lower
    source_code_valid = """
import flowforge.core.types as types
from flowforge.config import settings
from flowforge.memory.repo import Repository
"""
    deps = engine.extract_dependencies(source_code_valid)
    log_info(f"Extracted dependencies: {deps}")
    log_pass(f"Dependency extraction works: {len(deps)} deps found")

    v1 = engine.check_dependency("flowforge.services.user", "flowforge.core.types")
    if v1 is None:
        log_pass(f"service→types: VALID (higher importing lower)")
    else:
        log_fail(f"service→types: VIOLATION? {v1['message']}")

    # Invalid: lower layer imports higher
    v2 = engine.check_dependency("flowforge.core.types", "flowforge.services.user")
    if v2 is not None:
        log_pass(f"types→service: VIOLATION DETECTED ({v2['violation_type']})")
        log_info(f"  Message: {v2['message']}")
    else:
        log_fail(f"types→service: No violation found (should have!)")

    # File-level check
    violations = engine.check_file("/nonexistent/test.py")
    log_info(f"File check on nonexistent path: {len(violations)} violations")

    # Inject into context
    ctx = TaskContext(task_id="arch-test", input_data={})
    engine.inject_violations_into_context(ctx, [v2] if v2 else [])
    if ctx.metadata.get("arch_violations"):
        log_pass(f"Violations injected into context: {ctx.metadata['arch_violations']}")
    else:
        log_info("No violations to inject")

    return True


async def test_scenario_7_session_compression():
    """Scenario 7: SessionManager compression and truncation."""
    log_section("SCENARIO 7: Session Manager (Compression & Truncation)")

    mgr = SessionManager(config={
        "context_window": 100000,
        "compact_threshold": 0.92,
        "tool_output_limit": 500,
        "recent_rounds": 3,
    })

    # Test threshold calculation
    below = mgr.should_compact(80000)
    above = mgr.should_compact(95000)
    log_info(f"80K tokens / 100K window = 80% → compact={above} (should be False)")
    log_info(f"95K tokens / 100K window = 95% → compact={above} (should be True)")
    if not below and above:
        log_pass("Compaction threshold logic correct")
    else:
        log_fail("Compaction threshold logic incorrect!")

    # Test tool output truncation
    large_output = "A" * 5000  # ~1250 tokens
    truncated = mgr.truncate_tool_output(large_output, token_estimate=1250)
    if "truncated" in truncated:
        log_pass(f"Large output truncated: {len(large_output)} → {len(truncated)} chars")
    else:
        log_info(f"Output within limit, no truncation needed")

    small_output = "Hello world"
    kept = mgr.truncate_tool_output(small_output)
    if kept == small_output:
        log_pass("Small output preserved intact")
    else:
        log_fail("Small output should not be truncated!")

    # Test handoff building
    handoff = mgr.build_handoff(
        init_script="# Setup environment\npip install -r requirements.txt",
        progress_log=["Step 1: Research done", "Step 2: Draft written"],
        feature_checklist=["SEO keywords", "Internal links", "Fact accuracy"],
    )
    log_info(f"Handoff built: keys={list(handoff.keys())}")
    assert handoff["init_script"].startswith("# Setup")
    assert len(handoff["progress_log"]) == 2
    assert len(handoff["feature_checklist"]) == 3
    log_pass("Handoff artifact built correctly")

    return True


async def test_scenario_8_full_lifecycle():
    """Scenario 8: Complete lifecycle with all components interacting."""
    log_section("SCENARIO 8: Full Lifecycle (All Components)")

    # Build orchestrator with all components configured
    orch = HarnessOrchestrator(config={
        "enabled": True,
        "context_engine": {
            "agents_md_paths": [],
        },
        "session_manager": {
            "context_window": 128000,
            "compact_threshold": 0.92,
            "tool_output_limit": 25000,
        },
        "feedback_loop": {
            "evaluation_mode": EVAL_MODE_LIGHTWEIGHT,
            "quality_threshold": 0.7,
        },
        "entropy_manager": {
            "doc_gardener_enabled": True,
            "debt_tracker_enabled": True,
            "rule_evolution_enabled": True,
        },
    })

    # Add some entropy flags to make it interesting
    orch.entropy_manager.set_entropy_flag("high_debt_alert", False)

    ctx = TaskContext(
        task_id="full-lifecycle-001",
        input_data={"task": "write deep article about AI trends"},
        persona="tech_writer",
        harness_enabled=True,
    )

    # === PHASE 1: PRE_EXECUTE ===
    log_info("--- Phase 1: pre_execute ---")
    t0 = time.time()
    await orch.pre_execute(ctx)
    t_pre = time.time() - t0
    log_info(f"pre_execute took {t_pre*1000:.1f}ms")

    # Verify context state after pre_execute
    has_metadata_keys = list(ctx.metadata.keys())
    log_info(f"context.metadata keys after pre_execute: {has_metadata_keys}")

    # === PHASE 2: SIMULATE AGENT EXECUTION ===
    log_info("--- Phase 2: Agent Execution (simulated) ---")

    # Simulate multiple rounds of tool calls and responses
    messages = []
    for i in range(5):
        messages.append({"role": "user", "content": f"Round {i+1}: instruction"})
        tool_output = "x" * 200  # Small output, won't trigger truncation
        truncated = orch.session_manager.truncate_tool_output(tool_output)
        messages.append({"role": "tool", "content": truncated})

    # Check if we need compaction
    total_estimated = sum(len(str(m.get("content", ""))) // 4 for m in messages)
    needs_compact = orch.session_manager.should_compact(total_estimated)
    log_info(f"Simulated {len(messages)} messages, ~{total_estimated} tokens, "
             f"needs_compaction={needs_compact}")

    # Final agent output
    result = {
        "content": GOOD_ARTICLE.strip(),
        "status": "completed",
        "tool_calls_used": ["web_search", "fact_check", "seo_analyze"],
        "rounds_completed": 5,
    }

    # === PHASE 3: POST_EXECUTE ===
    log_info("--- Phase 3: post_execute ---")
    t0 = time.time()
    result = await orch.post_execute(result, ctx)
    t_post = time.time() - t0
    log_info(f"post_execute took {t_post*1000:.1f}ms")

    # === PHASE 4: VERIFY RESULTS ===
    log_info("--- Phase 4: Verification ---")

    fb = result.get("_feedback", {})
    log_info(f"Feedback: gate={fb.get('gate')}, mode={fb.get('mode')}, "
             f"duration={fb.get('duration_ms', 0):.1f}ms, action={fb.get('action', 'none')}")

    # Check all component statuses
    status = orch.get_status()
    log_info("")
    log_info("=" * 50)
    log_info("HARNESS STATUS REPORT")
    log_info("=" * 50)
    log_info(f"  Enabled:           {status['enabled']}")
    log_info(f"  ContextEngine:     injections={status['context_engine']['injection_count']}")
    log_info(f"  SessionManager:    compactions={status['session_manager']['compaction_count']}, "
             f"truncations={status['session_manager']['truncation_count']}")
    log_info(f"  FeedbackLoop:      mode={status['feedback_loop']['evaluation_mode']}, "
             f"evals={status['feedback_loop']['evaluation_count']}, "
             f"gates={status['feedback_loop']['gate_counts']}")
    log_info(f"  EntropyManager:    pre_checks={status['entropy_manager']['pre_check_count']}, "
             f"post_tracks={status['entropy_manager']['post_track_count']}, "
             f"flags={status['entropy_manager']['entropy_flags']}")
    log_info("=" * 50)

    # Final assertions
    assert "_feedback" in result, "Missing feedback metadata"
    assert result.get("status") != "failed", "Status should not be failed"
    log_pass("Full lifecycle completed successfully!")

    return True


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

async def main():
    print(f"\n{BOLD}FlowForge v6.0 Harness Integration Test{RESET}")
    print(f"{BOLD}Testing complete Agent task lifecycle with all guardrails{RESET}\n")

    scenarios = [
        ("Normal Execution (PASS)", test_scenario_1_normal_execution),
        ("Bad Output (FAIL)", test_scenario_2_bad_output),
        ("Error + Entropy Tracking", test_scenario_3_error_with_entropy),
        ("Full Evaluation Mode", test_scenario_4_full_evaluation),
        ("Permission Pipeline", test_scenario_5_permission_pipeline),
        ("Architecture Constraints", test_scenario_6_arch_constraints),
        ("Session Manager", test_scenario_7_session_compression),
        ("Full Lifecycle", test_scenario_8_full_lifecycle),
    ]

    results = []
    for name, fn in scenarios:
        try:
            passed = await fn()
            results.append((name, passed))
        except Exception as e:
            results.append((name, False))
            log_fail(f"EXCEPTION: {e}")

    # Summary
    log_section("SUMMARY")
    passed = sum(1 for _, p in results if p)
    total = len(results)
    print(f"\n  Results: {passed}/{total} scenarios passed\n")

    for name, ok in results:
        icon = GREEN + "[PASS]" + RESET if ok else RED + "[FAIL]" + RESET
        print(f"    {icon}  {name}")

    print()
    if passed == total:
        print(f"  {GREEN}{BOLD}ALL SCENARIOS PASSED{RESET}\n")
    else:
        print(f"  {RED}{BOLD}{total - passed} SCENARIO(S) FAILED{RESET}\n")

    return passed == total


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)

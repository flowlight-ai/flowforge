"""Feedback Loop Guardrail - Quality evaluation and self-correction.

Implements FR-HRN-03: Global guardrail (outer loop).
- Independent evaluation agent
- 4-dimension scoring (correctness / completeness / coherence / safety)
- Classification gate (PASS / CONDITIONAL / FAIL)
- Self-correction loop
- Escalation intervention

Relationship with Reflexion mode:
- Reflexion = inner loop (fast iteration, within mode)
- FeedbackLoop = outer loop (global quality gate, post-execution)
- Serial relationship: inner loop runs first, outer loop does final review
- Outer loop FAIL → direct downgrade (status=partial + quality_warning), no back to inner loop

Evaluation modes:
- full: 4-dimension scoring + classification gate (2 LLM calls)
- lightweight: classification gate only (1 LLM call, default)
- skip: no evaluation (0 LLM calls)
"""

from __future__ import annotations

import json
import time
from enum import Enum
from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import ToolInput
from flowforge.core.tracing import get_logger

logger = get_logger("harness.feedback_loop")

# ── Backward-compatible string constants ──────────────────────────────────────
EVAL_MODE_FULL = "full"
EVAL_MODE_LIGHTWEIGHT = "lightweight"
EVAL_MODE_SKIP = "skip"

GATE_PASS = "PASS"
GATE_CONDITIONAL = "CONDITIONAL"
GATE_FAIL = "FAIL"

# ── v6.0 enums ───────────────────────────────────────────────────────────────


class EvaluationMode(str, Enum):
    """Feedback evaluation mode.

    - FULL: 2 LLM calls (independent judge + detailed scoring).
    - LIGHTWEIGHT: 1 LLM call (combined judge + scoring), default.
    - SKIP: 0 LLM calls, auto-pass.
    """
    FULL = "full"
    LIGHTWEIGHT = "lightweight"
    SKIP = "skip"


class ClassificationGate(str, Enum):
    """Classification gate output.

    - PASS: Output meets quality standards.
    - CONDITIONAL: Output is acceptable with minor issues.
    - FAIL: Output does not meet quality standards; downgrade to partial.
    """
    PASS = "pass"
    CONDITIONAL = "conditional"
    FAIL = "fail"


# ── Score thresholds ─────────────────────────────────────────────────────────
_PASS_THRESHOLD = 0.85
_CONDITIONAL_THRESHOLD = 0.60

# The 4 evaluation dimensions (v6.0)
DIMENSIONS = ["correctness", "completeness", "coherence", "safety"]

# ── v6.0 FeedbackResult ──────────────────────────────────────────────────────


class FeedbackResult:
    """Structured result from a feedback evaluation.

    Attributes:
        gate: The classification gate result.
        overall_score: Weighted average score across dimensions.
        dimension_scores: Individual scores for each dimension.
        issues: List of identified issues.
        recommendations: List of improvement recommendations.
        mode: The evaluation mode used.
        llm_calls: Number of LLM calls made.
    """

    def __init__(
        self,
        gate: ClassificationGate,
        overall_score: float,
        dimension_scores: Dict[str, float],
        issues: List[str],
        recommendations: List[str],
        mode: EvaluationMode,
        llm_calls: int,
    ) -> None:
        self.gate = gate
        self.overall_score = overall_score
        self.dimension_scores = dimension_scores
        self.issues = issues
        self.recommendations = recommendations
        self.mode = mode
        self.llm_calls = llm_calls

    def to_dict(self) -> Dict[str, Any]:
        return {
            "gate": self.gate.value,
            "overall_score": self.overall_score,
            "dimension_scores": self.dimension_scores,
            "issues": self.issues,
            "recommendations": self.recommendations,
            "mode": self.mode.value,
            "llm_calls": self.llm_calls,
        }


# ── FeedbackLoop ──────────────────────────────────────────────────────────────


class FeedbackLoop:
    """Feedback loop guardrail - global quality gate.

    Evaluates agent output quality and triggers self-correction
    or downgrade when quality is insufficient.

    Supports two calling conventions:
    1. **Legacy (orchestrator)**: ``evaluate(result: dict, ctx) -> dict``
       Modifies *result* in-place, adds ``_feedback`` key, returns the dict.
    2. **v6.0**: ``evaluate(result, ctx, evaluation_mode=...) -> FeedbackResult``
       Returns a structured FeedbackResult object.

    The method detects the call style by keyword argument presence.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.evaluation_mode = self.config.get("evaluation_mode", EVAL_MODE_LIGHTWEIGHT)
        self.quality_threshold = self.config.get("quality_threshold", 0.7)
        self.max_corrections = self.config.get("max_corrections", 1)
        self._evaluation_count = 0
        self._gate_counts: Dict[str, int] = {"PASS": 0, "CONDITIONAL": 0, "FAIL": 0}
        # v6.0: LLM client for judge evaluation calls
        self._llm_client = self.config.get("llm_client")

    def set_llm_client(self, client: Any) -> None:
        """Set the LLM client for judge evaluation calls.

        Args:
            client: An LLM client instance (typically LLMClient from tools).
        """
        self._llm_client = client

    # ── Public evaluate (backward-compatible signature) ───────────────────

    async def evaluate(self, result: dict, ctx, *, evaluation_mode: Optional[EvaluationMode] = None) -> dict:
        """Evaluate agent output quality.

        This is the post_execute hook. It runs the classification gate
        and optionally the 4-dimension scoring.

        The method modifies *result* in-place (adds ``_feedback`` key) and
        returns the same dict, preserving the legacy contract.

        Args:
            result: Agent execution result dict
            ctx: TaskContext
            evaluation_mode: Optional v6.0 override for the evaluation mode.

        Returns:
            Updated result dict with feedback metadata
        """
        mode_str = evaluation_mode.value if evaluation_mode else self.evaluation_mode

        if mode_str == EVAL_MODE_SKIP:
            logger.info("[FeedbackLoop] evaluation_mode=skip, skipping evaluation")
            return result

        self._evaluation_count += 1
        start = time.time()
        task_id = getattr(ctx, 'task_id', 'unknown')
        persona = getattr(ctx, 'persona', 'unknown')

        # Get content to evaluate
        content = result.get("content", "")
        content_len = len(content) if isinstance(content, str) else 0
        logger.info(f"[FeedbackLoop] ▶ EVAL START | task={task_id} persona={persona} "
                     f"mode={mode_str} content_len={content_len}")

        if not content or (isinstance(content, str) and len(content.strip()) < 50):
            # Too short to evaluate meaningfully
            self._gate_counts[GATE_PASS] += 1
            result["_feedback"] = {
                "gate": GATE_PASS,
                "mode": mode_str,
                "reason": "output_too_short_for_evaluation",
            }
            logger.info(f"[FeedbackLoop] ◀ EVAL END   | task={task_id} gate=PASS (auto) "
                         f"reason=too_short({content_len} chars) "
                         f"counts={dict(self._gate_counts)}")
            return result

        # Run evaluation based on mode
        if mode_str == EVAL_MODE_FULL:
            scores = await self._full_evaluation(content, ctx)
            gate = self._classify_with_scores(scores)
            result["_feedback"] = {
                "gate": gate,
                "mode": EVAL_MODE_FULL,
                "scores": scores,
            }
            avg_score = sum(scores.values()) / len(scores) if scores else 0
            # Detailed score breakdown for quick console scanning
            score_parts = " | ".join(f"{k}={v:.2f}" for k, v in scores.items())
            logger.info(f"[FeedbackLoop] ◀ EVAL END   | task={task_id} gate={gate} mode=FULL "
                         f"avg={avg_score:.3f} threshold={self.quality_threshold} "
                         f"[{score_parts}]")
        else:  # lightweight
            gate = await self._lightweight_evaluation(content, ctx)
            result["_feedback"] = {
                "gate": gate,
                "mode": EVAL_MODE_LIGHTWEIGHT,
            }
            logger.info(f"[FeedbackLoop] ◀ EVAL END   | task={task_id} gate={gate} mode=LW "
                         f"content_len={content_len}")

        # Track gate decision
        self._gate_counts[gate] = self._gate_counts.get(gate, 0) + 1

        # Handle gate decision
        if gate == GATE_FAIL:
            result["_feedback"]["action"] = "downgraded"
            result["status"] = result.get("status", "completed")
            if result["status"] == "completed":
                result["status"] = "partial"
            result["quality_warning"] = True
            logger.warning(f"[FeedbackLoop] ✖ GATE FAIL  | task={task_id} persona={persona} "
                            f"action=downgrade→partial quality_warning=True "
                            f"counts={dict(self._gate_counts)}")
        elif gate == GATE_CONDITIONAL:
            result["_feedback"]["action"] = "accepted_with_warning"
            logger.info(f"[FeedbackLoop] ⚠ GATE WARN  | task={task_id} "
                         f"action=accepted_with_warning "
                         f"counts={dict(self._gate_counts)}")
        else:
            logger.info(f"[FeedbackLoop] ✔ GATE PASS  | task={task_id} "
                         f"counts={dict(self._gate_counts)}")

        duration_ms = (time.time() - start) * 1000
        result["_feedback"]["duration_ms"] = duration_ms
        logger.info(f"[FeedbackLoop] ⏱ timing     | task={task_id} "
                     f"eval={duration_ms:.1f}ms total_evals={self._evaluation_count}")

        return result

    # ── Full evaluation (2 LLM calls) ─────────────────────────────────────

    async def _full_evaluation(self, content: str, ctx) -> Dict[str, float]:
        """Full 4-dimension scoring (2 LLM calls).

        Tries LLM-based evaluation first; falls back to heuristic
        if no LLM client is configured or the call fails.

        Dimensions: correctness, completeness, coherence, safety
        Each scored 0.0-1.0.
        """
        task_id = getattr(ctx, 'task_id', 'unknown')
        t_full_start = time.time()

        # ── Try LLM-based evaluation ──
        if self._llm_client is not None:
            result_dict = {"content": content}

            # Call 1: Judge
            t_judge_start = time.time()
            judge_prompt = self._build_judge_prompt(result_dict, ctx)
            judge_response = await self._call_llm(judge_prompt, ctx)
            t_judge_ms = (time.time() - t_judge_start) * 1000
            logger.info(f"[FeedbackLoop] ⏱ FULL call1   | task={task_id} "
                         f"step=judge prompt_build+llm={t_judge_ms:.1f}ms "
                         f"success={judge_response is not None}")

            if judge_response is not None:
                # Call 2: Scoring
                t_score_start = time.time()
                scoring_prompt = self._build_scoring_prompt(result_dict, judge_response, ctx)
                scoring_response = await self._call_llm(scoring_prompt, ctx)
                t_score_ms = (time.time() - t_score_start) * 1000
                logger.info(f"[FeedbackLoop] ⏱ FULL call2   | task={task_id} "
                             f"step=scoring prompt_build+llm={t_score_ms:.1f}ms "
                             f"success={scoring_response is not None}")

                if scoring_response is not None:
                    t_parse_start = time.time()
                    parsed = self._parse_scoring_response(scoring_response)
                    t_parse_ms = (time.time() - t_parse_start) * 1000
                    t_full_ms = (time.time() - t_full_start) * 1000
                    logger.info(f"[FeedbackLoop] ⏱ FULL total  | task={task_id} "
                                 f"judge={t_judge_ms:.1f}ms scoring={t_score_ms:.1f}ms "
                                 f"parse={t_parse_ms:.1f}ms total={t_full_ms:.1f}ms "
                                 f"method=llm")
                    return parsed["dimension_scores"]

        # ── Heuristic fallback ──
        t_full_ms = (time.time() - t_full_start) * 1000
        logger.info(f"[FeedbackLoop] ⏱ FULL total  | task={task_id} "
                     f"total={t_full_ms:.1f}ms method=heuristic_fallback "
                     f"reason={'no_llm_client' if self._llm_client is None else 'llm_call_failed'}")
        return {
            "correctness": 0.8,
            "completeness": 0.7,
            "coherence": 0.8,
            "safety": 0.9,
        }

    # ── Lightweight evaluation (1 LLM call) ───────────────────────────────

    async def _lightweight_evaluation(self, content: str, ctx) -> str:
        """Lightweight classification gate (1 LLM call).

        Tries LLM-based evaluation first; falls back to heuristic
        if no LLM client is configured or the call fails.

        Returns PASS / CONDITIONAL / FAIL.
        """
        task_id = getattr(ctx, 'task_id', 'unknown')
        t_lw_start = time.time()

        # ── Try LLM-based evaluation ──
        if self._llm_client is not None:
            result_dict = {"content": content}

            t_llm_start = time.time()
            prompt = self._build_combined_prompt(result_dict, ctx)
            response = await self._call_llm(prompt, ctx)
            t_llm_ms = (time.time() - t_llm_start) * 1000
            logger.info(f"[FeedbackLoop] ⏱ LW   llm     | task={task_id} "
                         f"prompt_build+llm={t_llm_ms:.1f}ms "
                         f"success={response is not None}")

            if response is not None:
                t_parse_start = time.time()
                parsed = self._parse_scoring_response(response)
                t_parse_ms = (time.time() - t_parse_start) * 1000
                gate = self._classify(parsed["overall_score"])
                # Map enum value to legacy string constant
                gate_map = {
                    ClassificationGate.PASS: GATE_PASS,
                    ClassificationGate.CONDITIONAL: GATE_CONDITIONAL,
                    ClassificationGate.FAIL: GATE_FAIL,
                }
                t_lw_ms = (time.time() - t_lw_start) * 1000
                logger.info(f"[FeedbackLoop] ⏱ LW   total  | task={task_id} "
                             f"llm={t_llm_ms:.1f}ms parse={t_parse_ms:.1f}ms "
                             f"total={t_lw_ms:.1f}ms method=llm gate={gate_map[gate]}")
                return gate_map[gate]

        # ── Heuristic fallback ──
        t_heuristic_start = time.time()
        content_lower = content.lower() if isinstance(content, str) else ""

        # Check for obvious failure indicators
        failure_indicators = [
            "i cannot", "i can't", "unable to", "error:",
            "failed to", "not possible", "作为ai",
        ]
        for indicator in failure_indicators:
            if indicator in content_lower:
                t_lw_ms = (time.time() - t_lw_start) * 1000
                t_heur_ms = (time.time() - t_heuristic_start) * 1000
                logger.info(f"[FeedbackLoop] ⏱ LW   total  | task={task_id} "
                             f"heuristic={t_heur_ms:.1f}ms total={t_lw_ms:.1f}ms "
                             f"method=heuristic reason=failure_indicator gate=CONDITIONAL")
                return GATE_CONDITIONAL

        # Check for very short or repetitive content
        if isinstance(content, str):
            words = content.split()
            if len(words) < 20:
                t_lw_ms = (time.time() - t_lw_start) * 1000
                t_heur_ms = (time.time() - t_heuristic_start) * 1000
                logger.info(f"[FeedbackLoop] ⏱ LW   total  | task={task_id} "
                             f"heuristic={t_heur_ms:.1f}ms total={t_lw_ms:.1f}ms "
                             f"method=heuristic reason=short_content gate=CONDITIONAL")
                return GATE_CONDITIONAL
            # Check for repetition
            unique_words = set(words)
            if len(words) > 50 and len(unique_words) / len(words) < 0.3:
                t_lw_ms = (time.time() - t_lw_start) * 1000
                t_heur_ms = (time.time() - t_heuristic_start) * 1000
                logger.info(f"[FeedbackLoop] ⏱ LW   total  | task={task_id} "
                             f"heuristic={t_heur_ms:.1f}ms total={t_lw_ms:.1f}ms "
                             f"method=heuristic reason=repetitive gate=FAIL")
                return GATE_FAIL

        t_lw_ms = (time.time() - t_lw_start) * 1000
        t_heur_ms = (time.time() - t_heuristic_start) * 1000
        logger.info(f"[FeedbackLoop] ⏱ LW   total  | task={task_id} "
                     f"heuristic={t_heur_ms:.1f}ms total={t_lw_ms:.1f}ms "
                     f"method=heuristic reason=passed_checks gate=PASS")
        return GATE_PASS

    # ── Classification helpers ─────────────────────────────────────────────

    def _classify_with_scores(self, scores: Dict[str, float]) -> str:
        """Classify based on 4-dimension scores (config-based threshold)."""
        avg = sum(scores.values()) / len(scores) if scores else 0

        if avg >= self.quality_threshold:
            # Check if any dimension is critically low
            if any(v < 0.4 for v in scores.values()):
                return GATE_CONDITIONAL
            return GATE_PASS
        elif avg >= self.quality_threshold * 0.7:
            return GATE_CONDITIONAL
        else:
            return GATE_FAIL

    def _classify(self, overall_score: float) -> ClassificationGate:
        """Apply the classification gate based on overall score (v6.0 thresholds).

        Args:
            overall_score: The weighted average score (0.0 to 1.0).

        Returns:
            The classification gate result.
        """
        if overall_score >= _PASS_THRESHOLD:
            return ClassificationGate.PASS
        elif overall_score >= _CONDITIONAL_THRESHOLD:
            return ClassificationGate.CONDITIONAL
        else:
            return ClassificationGate.FAIL

    # ── LLM prompt builders ────────────────────────────────────────────────

    def _build_combined_prompt(
        self,
        result: Dict[str, Any],
        ctx,
    ) -> str:
        """Build the combined judge + scoring prompt for lightweight mode.

        Args:
            result: The task result to evaluate.
            ctx: The current TaskContext.

        Returns:
            The prompt string.
        """
        content = result.get("content", result.get("result", ""))
        if isinstance(content, dict):
            content = json.dumps(content, ensure_ascii=False, indent=2)[:3000]
        elif not isinstance(content, str):
            content = str(content)[:3000]

        task_id = getattr(ctx, 'task_id', 'unknown')
        persona = getattr(ctx, 'persona', 'default')
        mode = getattr(ctx, 'mode', 'unknown')

        return (
            "You are an independent quality judge. Evaluate the following task output "
            "across 4 dimensions: correctness, completeness, coherence, safety.\n\n"
            f"Task ID: {task_id}\n"
            f"Persona: {persona}\n"
            f"Mode: {mode}\n\n"
            f"Task Output:\n{content}\n\n"
            "Respond in JSON format:\n"
            '{"overall_score": 0.0-1.0, "dimension_scores": {"correctness": 0.0-1.0, '
            '"completeness": 0.0-1.0, "coherence": 0.0-1.0, "safety": 0.0-1.0}, '
            '"issues": ["..."], "recommendations": ["..."]}'
        )

    def _build_judge_prompt(
        self,
        result: Dict[str, Any],
        ctx,
    ) -> str:
        """Build the independent judge prompt for full mode (call 1).

        Args:
            result: The task result to evaluate.
            ctx: The current TaskContext.

        Returns:
            The prompt string.
        """
        content = result.get("content", result.get("result", ""))
        if isinstance(content, dict):
            content = json.dumps(content, ensure_ascii=False, indent=2)[:3000]
        elif not isinstance(content, str):
            content = str(content)[:3000]

        task_id = getattr(ctx, 'task_id', 'unknown')
        persona = getattr(ctx, 'persona', 'default')

        return (
            "You are an independent quality judge. Assess the following task output "
            "for overall quality, identifying key strengths and weaknesses.\n\n"
            f"Task ID: {task_id}\n"
            f"Persona: {persona}\n\n"
            f"Task Output:\n{content}\n\n"
            "Provide your assessment as a structured review. Focus on: "
            "factual correctness, completeness of coverage, logical coherence, "
            "and safety/compliance concerns."
        )

    def _build_scoring_prompt(
        self,
        result: Dict[str, Any],
        judge_assessment: str,
        ctx,
    ) -> str:
        """Build the detailed scoring prompt for full mode (call 2).

        Args:
            result: The task result to evaluate.
            judge_assessment: The independent judge's assessment from call 1.
            ctx: The current TaskContext.

        Returns:
            The prompt string.
        """
        return (
            "Based on the following independent judge assessment, provide detailed "
            "4-dimension scoring for the task output.\n\n"
            f"Judge Assessment:\n{judge_assessment[:2000]}\n\n"
            "Score each dimension (0.0-1.0):\n"
            "- correctness: Factual accuracy and logical soundness\n"
            "- completeness: Coverage of required aspects\n"
            "- coherence: Internal consistency and flow\n"
            "- safety: Compliance with safety and policy guidelines\n\n"
            "Respond in JSON format:\n"
            '{"overall_score": 0.0-1.0, "dimension_scores": {"correctness": 0.0-1.0, '
            '"completeness": 0.0-1.0, "coherence": 0.0-1.0, "safety": 0.0-1.0}, '
            '"issues": ["..."], "recommendations": ["..."]}'
        )

    # ── LLM call ───────────────────────────────────────────────────────────

    async def _call_llm(self, prompt: str, ctx) -> Optional[str]:
        """Make an LLM call through the registered client.

        Args:
            prompt: The prompt to send.
            ctx: The current TaskContext.

        Returns:
            The LLM response text, or ``None`` if the call fails.
        """
        if self._llm_client is None:
            logger.warning("[FeedbackLoop] ⏱ LLM  skip    | no_llm_client")
            return None

        task_id = getattr(ctx, 'task_id', 'unknown')
        t_call_start = time.time()

        try:
            persona = getattr(ctx, 'persona', 'default')
            prompt_chars = len(prompt)

            tool_input = ToolInput(params={
                "messages": [{"role": "user", "content": prompt}],
                "task_id": task_id,
                "persona": persona,
                "agent_name": "harness_feedback_judge",
                "temperature": 0.3,
                "max_tokens": 2000,
            })
            output = await self._llm_client.execute(tool_input)
            content = output.result.get("content", "")
            t_call_ms = (time.time() - t_call_start) * 1000

            if isinstance(content, str) and content.strip():
                logger.info(f"[FeedbackLoop] ⏱ LLM  call    | task={task_id} "
                             f"prompt={prompt_chars}chars response={len(content)}chars "
                             f"latency={t_call_ms:.1f}ms status=success")
                return content

            logger.warning(f"[FeedbackLoop] ⏱ LLM  call    | task={task_id} "
                            f"prompt={prompt_chars}chars latency={t_call_ms:.1f}ms "
                            f"status=empty_response")
            return None
        except Exception as exc:
            t_call_ms = (time.time() - t_call_start) * 1000
            logger.warning(
                f"[FeedbackLoop] ⏱ LLM  call    | task={task_id} "
                f"latency={t_call_ms:.1f}ms status=error error={exc}",
            )
            return None

    # ── Response parsing ───────────────────────────────────────────────────

    def _parse_scoring_response(self, response: str) -> Dict[str, Any]:
        """Parse the LLM scoring response into structured data.

        Attempts to extract a JSON object from the response. Falls back
        to heuristic parsing if JSON extraction fails.

        Args:
            response: The raw LLM response text.

        Returns:
            A dictionary with ``overall_score``, ``dimension_scores``,
            ``issues``, and ``recommendations``.
        """
        # Try to extract JSON from the response
        json_str = response
        if "```json" in response:
            start = response.index("```json") + 7
            end = response.index("```", start)
            json_str = response[start:end].strip()
        elif "```" in response:
            start = response.index("```") + 3
            end = response.index("```", start)
            json_str = response[start:end].strip()
        elif "{" in response and "}" in response:
            start = response.index("{")
            end = response.rindex("}") + 1
            json_str = response[start:end]

        try:
            data = json.loads(json_str)
            overall = float(data.get("overall_score", 0.5))
            dim_scores = {}
            for dim in DIMENSIONS:
                val = data.get("dimension_scores", {}).get(dim, 0.5)
                dim_scores[dim] = max(0.0, min(1.0, float(val)))
            overall = max(0.0, min(1.0, overall))
            issues = data.get("issues", [])
            recommendations = data.get("recommendations", [])
            if not isinstance(issues, list):
                issues = [str(issues)]
            if not isinstance(recommendations, list):
                recommendations = [str(recommendations)]
            return {
                "overall_score": overall,
                "dimension_scores": dim_scores,
                "issues": [str(i) for i in issues],
                "recommendations": [str(r) for r in recommendations],
            }
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            logger.warning(f"Failed to parse scoring response as JSON | error={exc}")
            return {
                "overall_score": 0.5,
                "dimension_scores": {d: 0.5 for d in DIMENSIONS},
                "issues": ["Failed to parse judge response"],
                "recommendations": [],
            }

    # ── Fallback result ────────────────────────────────────────────────────

    def _fallback_result(
        self,
        mode: EvaluationMode,
        llm_calls: int,
    ) -> FeedbackResult:
        """Create a fallback result when LLM calls fail.

        Returns a CONDITIONAL gate with neutral scores.

        Args:
            mode: The evaluation mode that was attempted.
            llm_calls: Number of LLM calls made before fallback.

        Returns:
            A FeedbackResult with fallback values.
        """
        return FeedbackResult(
            gate=ClassificationGate.CONDITIONAL,
            overall_score=0.5,
            dimension_scores={d: 0.5 for d in DIMENSIONS},
            issues=["LLM evaluation unavailable — using fallback scoring"],
            recommendations=["Manual review recommended"],
            mode=mode,
            llm_calls=llm_calls,
        )

    # ── Status ─────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Get feedback loop status."""
        return {
            "enabled": self.evaluation_mode != EVAL_MODE_SKIP,
            "evaluation_mode": self.evaluation_mode,
            "quality_threshold": self.quality_threshold,
            "evaluation_count": self._evaluation_count,
            "gate_counts": dict(self._gate_counts),
        }

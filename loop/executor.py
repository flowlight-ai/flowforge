"""LoopExecutor — Discover → Assign → Act → Verify → Persist closed loop.

This is the v0.1 implementation of the Loop pattern (roleagent.md Ch.2 + Ch.5).
A full TeamAct 6-step (State→Owner→Action→Evidence→Verdict→Route) is planned for v0.3.

The executor accepts injected action_fn and persist_fn so tests can run the
loop without an LLM. Production wires action_fn to a forgekin + LLMClient call.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from flowforge.core.errors import LoopError
from flowforge.core.tracing import get_logger, set_trace_id
from flowforge.llm.errors import is_invalid_content, is_silent_failure
from flowforge.loop.reflector import Reflector
from flowforge.loop.state import HandoffCapsule, LoopState
from flowforge.loop.verifier import Verifier

logger = get_logger("flowforge.loop.executor")

# Type aliases for clarity
ActionFn = Callable[[LoopState], Awaitable[str]]
CriteriaCheckFn = Callable[[str, str], bool]
PersistFn = Callable[[LoopState, str], Awaitable[None]]


@dataclass
class LoopResult:
    """Final outcome of a loop run."""

    state: LoopState
    artifact: str
    quality_score: float
    passed: bool
    iterations: int
    termination_reason: str


class LoopExecutor:
    """Five-step closed-loop driver.

    Steps:
        Discover — read task brief + state + acceptance criteria
        Assign   — pick the owner (here: the injected action_fn acts as the owner)
        Act      — produce an artifact
        Verify   — Verifier checks quality + cross-agent review
        Persist  — write artifact + evidence to durable storage
    """

    def __init__(
        self,
        action_fn: ActionFn,
        verifier: Verifier | None = None,
        reflector: Reflector | None = None,
        persist_fn: PersistFn | None = None,
        criteria_check: CriteriaCheckFn | None = None,
        max_iterations: int = 5,
        max_consecutive_refusals: int = 2,
    ) -> None:
        self.action_fn = action_fn
        self.verifier = verifier or Verifier()
        self.reflector = reflector or Reflector(max_reflections=max_iterations)
        self.persist_fn = persist_fn
        self.criteria_check = criteria_check
        self.max_iterations = max_iterations
        # 快速失败机制：LLM 连续返回"无法回答"/silent failure 时提前终止，避免 7 分钟浪费
        # 默认 2 次 — 连续 2 次拒绝即终止（可在构造时覆盖）
        self.max_consecutive_refusals = max_consecutive_refusals

    @staticmethod
    def _is_refusal_artifact(artifact: str) -> bool:
        """检测 action_fn 产出是否为 LLM 拒绝响应（如"无法回答"/silent failure）.

        快速失败机制核心：复用 LLMClient 的无效响应检测逻辑，
        当 LLM 因账号封禁/配额耗尽/模型禁用等原因返回拒绝响应时，
        LoopExecutor 应提前终止而非继续耗费迭代。

        检测逻辑：
        1. is_invalid_content — 短文本/前缀匹配拒绝模式（"无法回答"等）
        2. is_silent_failure — HTTP 200 + 伪装错误（"当前不可用，请稍后重试"等）

        Args:
            artifact: action_fn 返回的文本产出

        Returns:
            True 表示这是一次拒绝响应，应计入连续拒绝计数
        """
        if not artifact or not isinstance(artifact, str):
            return False
        try:
            if is_invalid_content(artifact):
                return True
            if is_silent_failure(artifact):
                return True
        except Exception:  # noqa: BLE001
            # 检测失败不影响主流程
            pass
        return False

    async def run(self, state: LoopState) -> LoopResult:
        """Drive the loop until termination conditions are met or cap reached."""
        set_trace_id(state.state_id)

        # Discover — already populated in state by the caller
        logger.info(
            f"loop start: id={state.state_id} brief={state.task_brief[:80]!r} "
            f"criteria={len(state.acceptance_criteria)}"
        )

        artifact = ""
        last_failure: dict[str, Any] = {}
        consecutive_refusals = 0

        while not state.terminated:
            should_stop, reason = state.should_terminate()
            if should_stop:
                state.terminate(reason)
                break
            if state.iteration >= self.max_iterations:
                state.terminate(f"max_iterations ({self.max_iterations}) reached")
                break

            # Assign — produce a handoff capsule naming the next owner
            capsule = HandoffCapsule(
                from_owner="loop" if state.iteration > 0 else "cvo",
                to_owner="action_fn",
                summary=f"iteration {state.iteration + 1}",
                next_action_hint="produce artifact",
            )
            state.push_handoff(capsule)

            # Act
            try:
                artifact = await self.action_fn(state)
            except Exception as exc:  # noqa: BLE001
                raise LoopError("action_fn raised", cause=exc) from exc

            # ── 快速失败检测：LLM 拒绝响应（"无法回答"/silent failure 等）──
            # 当 LLM 因账号封禁/配额耗尽/模型禁用等原因持续返回拒绝响应时，
            # 不应继续耗费数分钟跑完所有迭代（含 verifier/reflector 的额外 LLM 调用），
            # 而应立即终止并返回明确错误（避免 7 分钟浪费）。
            if self._is_refusal_artifact(artifact):
                consecutive_refusals += 1
                logger.warning(
                    f"loop refusal detected: id={state.state_id} "
                    f"consecutive={consecutive_refusals}/{self.max_consecutive_refusals} "
                    f"artifact_preview={artifact[:80]!r}"
                )
                if consecutive_refusals >= self.max_consecutive_refusals:
                    refusal_error = (
                        f"LLM 连续 {consecutive_refusals} 次返回拒绝响应"
                        f"（无法回答/素材不足/服务不可用），提前终止 Loop"
                    )
                    state.termination_reason = (
                        f"consecutive refusals ({consecutive_refusals}) reached threshold"
                    )
                    state.terminated = True
                    logger.error(
                        f"loop fast-fail: id={state.state_id} {refusal_error}"
                    )
                    break
                # 未达阈值：跳过本轮 verifier/reflector，直接进入下一次迭代
                continue
            else:
                if consecutive_refusals > 0:
                    logger.info(
                        f"loop recovered from refusal: id={state.state_id} "
                        f"previous={consecutive_refusals}"
                    )
                consecutive_refusals = 0

            # Verify
            verify_result = self.verifier.verify(
                state, artifact, criteria_check=self.criteria_check
            )
            if verify_result["passed"]:
                # Persist
                if self.persist_fn is not None:
                    try:
                        await self.persist_fn(state, artifact)
                    except Exception as exc:  # noqa: BLE001
                        raise LoopError("persist_fn raised", cause=exc) from exc
                # Mark CVO vision as confirmed if all criteria met + reviewer agreement ≥ 0.85
                if (
                    state.all_criteria_have_evidence()
                    and state.quality_score >= 0.85
                    and not state.has_open_questions()
                ):
                    state.cvo_vision_confirmed = True
                state.terminate("all termination conditions met")
                break

            # Reflect — produce a corrected artifact for the next iteration
            last_failure = verify_result
            try:
                artifact = self.reflector.reflect(state, artifact, last_failure)
            except LoopError as exc:
                logger.warning(f"reflector exhausted: {exc}")
                state.terminate(f"reflection cap reached: {exc}")
                break

        result = LoopResult(
            state=state,
            artifact=artifact,
            quality_score=state.quality_score,
            passed=state.quality_score >= 0.85 and state.all_criteria_have_evidence(),
            iterations=state.iteration,
            termination_reason=state.termination_reason,
        )
        logger.info(
            f"loop end: id={state.state_id} iterations={result.iterations} "
            f"quality={result.quality_score:.4f} passed={result.passed} "
            f"reason={result.termination_reason!r}"
        )
        return result

"""Loop Verifier — business-level quality verification."""

from abc import ABC, abstractmethod
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import Verdict


class LoopVerifier(ABC):
    """Loop 校验器接口。"""

    @abstractmethod
    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        """校验执行结果质量，返回 Verdict。"""


class AgentJudgeVerifier(LoopVerifier):
    """Uses agent_judge mode for verification."""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        feedback = result.get("_feedback", {}) if isinstance(result, dict) else {}
        gate = feedback.get("gate", "PASS")
        score = feedback.get("overall_score", 0.0)
        threshold = config.get("pass_threshold", 0.8)

        if gate == "FAIL" or score < threshold:
            errors = feedback.get("details", {}).get("improvements", ["Quality below threshold"])
            return Verdict(
                passed=False,
                score=score,
                errors=errors if isinstance(errors, list) else [str(errors)],
            )

        return Verdict(passed=True, score=score, errors=[])


class RuleBasedVerifier(LoopVerifier):
    """Uses predefined rules for verification."""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        rules = config.get("rules", [])
        errors = []

        content = result.get("output", "") if isinstance(result, dict) else str(result)
        for rule in rules:
            errors.append(f"Rule not verified: {rule}")

        if errors:
            return Verdict(passed=False, score=0.0, errors=errors)
        return Verdict(passed=True, score=1.0, errors=[])

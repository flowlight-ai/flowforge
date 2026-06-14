"""Loop Verifier — business-level quality verification."""

import json

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

        # Default rules when none configured
        if not rules:
            rules = ["output_not_empty", "no_error"]

        content = result.get("output", "") if isinstance(result, dict) else str(result)
        total = len(rules)
        passed_count = 0
        errors = []

        for rule in rules:
            ok, err = self._check_rule(rule, result, content)
            if ok:
                passed_count += 1
            else:
                errors.append(err)

        score = passed_count / total if total > 0 else 1.0
        passed = len(errors) == 0

        return Verdict(passed=passed, score=score, errors=errors)

    def _check_rule(self, rule: str, result: dict, content: str) -> tuple[bool, str]:
        """Check a single rule against the result. Returns (passed, error_message)."""

        if rule == "output_not_empty":
            if content and str(content).strip():
                return True, ""
            return False, "Output is empty"

        if rule == "no_error":
            if isinstance(result, dict) and "error" in result:
                return False, f"Result contains error: {result['error']}"
            return True, ""

        if rule.startswith("min_length:"):
            try:
                min_len = int(rule.split(":", 1)[1])
            except (ValueError, IndexError):
                return True, ""
            actual_len = len(str(content)) if content else 0
            if actual_len >= min_len:
                return True, ""
            return False, f"Output length {actual_len} is below minimum {min_len}"

        if rule.startswith("contains:"):
            keyword = rule.split(":", 1)[1] if ":" in rule else ""
            if not keyword:
                return True, ""
            if keyword in str(content):
                return True, ""
            return False, f"Output does not contain '{keyword}'"

        if rule.startswith("score_above:"):
            try:
                threshold = float(rule.split(":", 1)[1])
            except (ValueError, IndexError):
                return True, ""
            score = result.get("score", 0.0) if isinstance(result, dict) else 0.0
            if isinstance(score, (int, float)) and score >= threshold:
                return True, ""
            return False, f"Score {score} is not above {threshold}"

        if rule == "json_valid":
            try:
                json.loads(str(content))
                return True, ""
            except (json.JSONDecodeError, TypeError):
                return False, "Output is not valid JSON"

        # Unknown/custom rules: pass by default (cannot auto-verify)
        return True, ""


class SchemaVerifier(LoopVerifier):
    """Schema 校验器 — 使用 JSON Schema 验证输出结构。"""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        schema = config.get("output_schema", {})
        if not schema:
            return Verdict(passed=True, score=1.0)

        output = result.get("output", result)
        errors = self._validate_against_schema(output, schema)

        if errors:
            return Verdict(passed=False, score=0.0, errors=errors)
        return Verdict(passed=True, score=1.0)

    def _validate_against_schema(self, data: dict, schema: dict) -> list[str]:
        """使用 jsonschema 库验证数据。"""
        try:
            import jsonschema
            validator = jsonschema.Draft7Validator(schema)
            errors = [str(e) for e in validator.iter_errors(data)]
            return errors
        except ImportError:
            # jsonschema 未安装，降级为简单类型检查
            return self._simple_schema_check(data, schema)

    def _simple_schema_check(self, data: dict, schema: dict) -> list[str]:
        """简单 schema 检查（不依赖 jsonschema 库）。"""
        errors = []
        required = schema.get("required", [])
        properties = schema.get("properties", {})

        for field in required:
            if field not in data:
                errors.append(f"Missing required field: {field}")

        for field, field_schema in properties.items():
            if field in data:
                expected_type = field_schema.get("type")
                if expected_type and not self._check_type(data[field], expected_type):
                    errors.append(f"Field '{field}' has wrong type: expected {expected_type}")

        return errors

    def _check_type(self, value, expected_type: str) -> bool:
        type_map = {
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
            "array": list,
            "object": dict,
        }
        return isinstance(value, type_map.get(expected_type, object))


class TestSuiteVerifier(LoopVerifier):
    """测试套件校验器 — 运行测试命令验证代码质量。"""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        test_command = config.get("test_command", "")
        working_dir = config.get("working_dir", ".")
        pass_threshold = config.get("pass_threshold", 0.8)

        if not test_command:
            return Verdict(passed=True, score=1.0)

        import asyncio
        try:
            proc = await asyncio.create_subprocess_exec(
                *test_command.split(),
                cwd=working_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=config.get("timeout", 60)
            )

            output = stdout.decode() + stderr.decode()

            if proc.returncode == 0:
                return Verdict(passed=True, score=1.0)
            else:
                errors = self._parse_test_errors(output)
                return Verdict(passed=False, score=0.0, errors=errors)
        except asyncio.TimeoutError:
            return Verdict(passed=False, score=0.0, errors=["Test execution timed out"])
        except Exception as e:
            return Verdict(passed=False, score=0.0, errors=[f"Test execution failed: {str(e)}"])

    def _parse_test_errors(self, output: str) -> list[str]:
        """从测试输出中解析错误信息。"""
        errors = []
        for line in output.split("\n"):
            line = line.strip()
            if "FAIL" in line.upper() or "ERROR" in line.upper():
                errors.append(line[:200])  # 截断长行
        return errors[:5]  # 最多返回5个错误

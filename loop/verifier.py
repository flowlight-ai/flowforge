"""Loop Verifier — business-level quality verification."""

import asyncio
import json
import re
from collections import Counter
from abc import ABC, abstractmethod
from flowforge.core.task_context import TaskContext
from flowforge.core.base_tool import ToolInput
from flowforge.loop.state import Verdict
from flowforge.core.tracing import get_logger

logger = get_logger("loop.verifier")


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


class MultiJudgeVerifier(LoopVerifier):
    """多评委交叉评审校验器 — 使用多个不同模型独立评审，聚合评分。

    核心思路：多个不同厂商/架构的 LLM 作为独立评委，对同一内容按维度打分，
    通过 trimmed mean 聚合消除单一模型偏见，提升评审客观性。

    完全配置驱动：评审角色、提示词模板、上下文段、维度说明均从 loop YAML 读取，
    不硬编码任何业务领域信息，适用于内容创作、代码审查、数据分析等任意任务类型。

    配置示例 (loop YAML):
        verifier:
          mode: multi_judge
          judges:
            - openroute/deepseek-web/chat
            - openroute/kimi-web/chat
          exclude_creator: true
          pass_threshold: 0.95
          judge_role: "严格的质量评审专家"
          judge_context_template: |
            你是一位{judge_role}。请对以下内容进行多维度独立评审。
            ...
          context_sections:
            - template: "角色/人设: {persona}"
              source: "task.persona"
            - template: "任务描述: {task_desc}"
              source: "task.input_data.task"
          dimensions:
            title_attractiveness: 0.08
            ...
          dimension_descriptions:
            title_attractiveness: "标题是否吸引眼球"
            ...
    """

    # 默认评审维度及权重（仅作为 fallback，实际应从配置读取）
    DEFAULT_DIMENSIONS: dict[str, float] = {
        "quality": 0.30,
        "accuracy": 0.25,
        "completeness": 0.25,
        "clarity": 0.20,
    }

    # 默认维度说明
    DEFAULT_DIMENSION_DESCRIPTIONS: dict[str, str] = {
        "quality": "整体质量是否达标",
        "accuracy": "内容是否准确无误",
        "completeness": "内容是否完整无遗漏",
        "clarity": "表达是否清晰易懂",
    }

    # 默认评审角色
    DEFAULT_JUDGE_ROLE: str = "质量评审专家"

    # 默认上下文段定义
    DEFAULT_CONTEXT_SECTIONS: list[dict] = [
        {"template": "角色/人设: {persona}", "source": "task.persona"},
        {"template": "任务描述: {task_desc}", "source": "task.input_data.task"},
    ]

    # 默认评审提示词模板（严格评审，不引导高分）
    DEFAULT_JUDGE_CONTEXT_TEMPLATE: str = """\
你是一位{judge_role}。请对以下内容进行多维度独立评审。

评审上下文:
{context_sections}

评审维度:
{dimension_lines}

评分规则(0.0-1.0):
0.95-1.00 卓越 | 0.90-0.94 优秀 | 0.85-0.89 良好 | 0.70-0.84 及格 | 0.00-0.69 不及格

待评审内容:
{content}

【绝对要求】你只能输出一个JSON对象。不要输出任何其他内容。不要用```json```包裹。直接以{{开头，以}}结尾。

输出格式:
{{"scores":{{{score_fields}}},"improvement_suggestions":["改进建议1","改进建议2"]}}

示例:
{{"scores":{{"quality":0.75,"accuracy":0.80,"completeness":0.72,"clarity":0.78}},"improvement_suggestions":["建议1","建议2"]}}

评分指引:
1. 每个维度给出0.0-1.0之间的浮点数，保留两位小数
2. 严格按维度标准评分，不要因为整体还行就给所有维度高分
3. improvement_suggestions列出最需改进的方面(3-5条)
4. 评审要严格客观，宁可低估不要高估"""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        judges = config.get("judges", [])
        exclude_creator = config.get("exclude_creator", True)
        threshold = config.get("pass_threshold", 0.95)
        dimensions = config.get("dimensions", self.DEFAULT_DIMENSIONS)

        if not judges:
            logger.warning("MultiJudgeVerifier: no judges configured, falling back to pass")
            return Verdict(passed=True, score=1.0)

        # 1. 排除创作模型（避免自我评分）
        # 优先使用配置中的 creator_model，其次从 result 中获取
        creator_model = config.get("creator_model", "") or (result.get("_model", "") if isinstance(result, dict) else "")
        active_judges = list(judges)
        if exclude_creator and creator_model:
            active_judges = [j for j in active_judges if j != creator_model]

        if not active_judges:
            logger.warning("MultiJudgeVerifier: all judges excluded (creator model), using original list")
            active_judges = list(judges)

        # 2. 构建评审提示词（完全配置驱动）
        # 从 result 中提取待评审内容，支持多种返回格式
        content = ""
        if isinstance(result, dict):
            # 优先级: content > response > output > draft > final_answer
            for key in ("content", "response", "output", "draft", "final_answer"):
                val = result.get(key, "")
                if isinstance(val, str) and val.strip():
                    content = val
                    break
                elif isinstance(val, dict):
                    # 嵌套 dict 时尝试提取子字段
                    for sub_key in ("draft", "response", "content", "result"):
                        sub_val = val.get(sub_key, "")
                        if isinstance(sub_val, str) and sub_val.strip():
                            content = sub_val
                            break
                    if content:
                        break
            if not content:
                # 最后尝试：将整个 result 转为字符串
                content = str(result)
        else:
            content = str(result)
        prompt = self._build_eval_prompt(content, task, dimensions, config)

        # 3. 并行调用所有评委（每个评委最多60秒，超时跳过）
        judge_timeout = config.get("judge_timeout", 60)
        judge_tasks = [self._call_judge(j, prompt, task) for j in active_judges]
        judge_results = await asyncio.gather(
            *(asyncio.wait_for(t, timeout=judge_timeout) for t in judge_tasks),
            return_exceptions=True,
        )

        # 4. 过滤有效结果
        valid_results: list[dict] = []
        for i, r in enumerate(judge_results):
            if isinstance(r, Exception):
                logger.warning(f"MultiJudgeVerifier: judge '{active_judges[i]}' failed: {r}")
            elif isinstance(r, dict):
                valid_results.append(r)
            else:
                logger.warning(f"MultiJudgeVerifier: judge '{active_judges[i]}' returned unexpected type: {type(r)}")

        if not valid_results:
            return Verdict(passed=False, score=0.0, errors=["All judges failed to return valid results"])

        # 5. 聚合评分
        aggregated = self._aggregate_scores(valid_results, dimensions)

        # 详细日志：每个评委的评分
        for vr in valid_results:
            model_name = vr.get("model", "?")
            scores = vr.get("scores", {})
            score_parts = []
            for k, v in scores.items():
                try:
                    score_parts.append(f"{k}={float(v):.2f}")
                except (ValueError, TypeError):
                    score_parts.append(f"{k}={v}")
            logger.info(f"MultiJudgeVerifier: judge '{model_name}' scores: " + ", ".join(score_parts))
        dim_scores = aggregated.get("dimension_scores", {})
        dim_parts = []
        for k, v in dim_scores.items():
            try:
                dim_parts.append(f"{k}={float(v):.3f}")
            except (ValueError, TypeError):
                dim_parts.append(f"{k}={v}")
        logger.info(f"MultiJudgeVerifier: aggregated dims: " + ", ".join(dim_parts))
        logger.info(
            f"MultiJudgeVerifier: {len(valid_results)}/{len(active_judges)} judges succeeded, "
            f"weighted_score={aggregated['weighted_score']:.4f}, threshold={threshold}"
        )

        # 构建详细的 errors 列表 — 包含低分维度和改进建议，供 Reflector 精准反思
        if aggregated["weighted_score"] < threshold:
            errors = self._build_detailed_errors(aggregated, valid_results, dimensions, threshold)
        else:
            errors = []

        return Verdict(
            passed=aggregated["weighted_score"] >= threshold,
            score=aggregated["weighted_score"],
            errors=errors,
        )

    def _resolve_source(self, source: str, task: TaskContext) -> str:
        """从 TaskContext 动态解析 source 路径的值。

        支持点号分隔的路径，如 "task.persona" → task.persona，
        "task.input_data.task" → task.input_data.get("task", "")。
        """
        if not source:
            return ""

        # 去掉 "task." 前缀（因为 task 就是传入的 TaskContext 对象）
        path = source
        if path.startswith("task."):
            path = path[5:]  # 去掉 "task."

        if not path:
            return ""

        parts = path.split(".")
        obj: object = task
        for part in parts:
            if isinstance(obj, dict):
                obj = obj.get(part, "")
            else:
                obj = getattr(obj, part, None)
                if obj is None:
                    return ""
        result = str(obj) if obj is not None else ""
        return result[:500] if result else ""

    def _build_eval_prompt(self, content: str, task: TaskContext, dimensions: dict, config: dict) -> str:
        """构建评审提示词 — 完全配置驱动，不硬编码任何业务领域信息。"""

        # 1. 读取评审角色
        judge_role = config.get("judge_role", self.DEFAULT_JUDGE_ROLE)

        # 2. 构建上下文段 — 从 context_sections 配置动态提取
        context_sections_config = config.get("context_sections", self.DEFAULT_CONTEXT_SECTIONS)
        context_lines: list[str] = []
        for section in context_sections_config:
            template = section.get("template", "")
            source = section.get("source", "")
            value = self._resolve_source(source, task)
            # 如果值非空则渲染该段
            if value and value != "None":
                context_lines.append(f"- {template.format(**{self._extract_template_keys(template): value})}")
            elif template:
                # 值为空时仍保留模板行，用 "无" 填充
                keys = self._extract_template_keys(template)
                context_lines.append(f"- {template.format(**{keys: '无'})}")

        context_sections_str = "\n".join(context_lines) if context_lines else "无"

        # 3. 构建维度行 — 包含维度说明
        dimension_descriptions = config.get("dimension_descriptions", self.DEFAULT_DIMENSION_DESCRIPTIONS)
        dim_lines: list[str] = []
        for dim, weight in dimensions.items():
            desc = dimension_descriptions.get(dim, "")
            if desc:
                dim_lines.append(f"  - {dim} (权重 {weight:.2f}): {desc}")
            else:
                dim_lines.append(f"  - {dim} (权重 {weight:.2f})")

        # 4. 动态生成 score_fields
        score_field_lines = [f'"{dim}": 0.0' for dim in dimensions.keys()]
        score_fields = ",\n    ".join(score_field_lines)

        # 5. 读取提示词模板
        template = config.get("judge_context_template", self.DEFAULT_JUDGE_CONTEXT_TEMPLATE)

        # 6. 渲染模板
        prompt = template.format(
            judge_role=judge_role,
            context_sections=context_sections_str,
            dimension_lines="\n".join(dim_lines),
            content=content[:8000],
            score_fields=score_fields,
        )
        return prompt

    @staticmethod
    def _extract_template_keys(template: str) -> str:
        """从简单模板字符串中提取第一个花括号键名。

        例如 "角色/人设: {persona}" → "persona"
        """
        import re as _re
        match = _re.search(r"\{(\w+)\}", template)
        return match.group(1) if match else ""

    # 默认 system message（强制 JSON 输出，针对 WebChat 模型优化）
    DEFAULT_JUDGE_SYSTEM_MESSAGE: str = (
        "你是一个JSON输出器。你必须且只能输出一个合法的JSON对象，"
        "不要输出任何其他文字、解释、前缀、后缀或markdown代码块。"
        "直接以{开头，以}结尾。"
    )

    async def _call_judge(self, model: str, prompt: str, task: TaskContext) -> dict:
        """调用单个评委模型，返回解析后的评分字典。"""
        if not task.tools:
            raise RuntimeError("TaskContext.tools is not available for judge invocation")

        # 使用 system message 强制 JSON 输出（针对 WebChat 模型优化）
        system_msg = self.DEFAULT_JUDGE_SYSTEM_MESSAGE
        tool_output = await task.tools.execute("llm", ToolInput(params={
            "model": model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "task_id": task.task_id,
            "agent_name": f"multi_judge_{model.replace('/', '_')}",
            "persona": task.persona or "default",
            "skip_cooldown": True,
        }))

        raw_content = tool_output.result.get("content", "") if tool_output.result else ""
        # 过滤 WebChat 模型的思考过程（CoT），只保留最终输出
        raw_content = self._strip_thinking_process(raw_content)
        return self._parse_judge_response(raw_content, model)

    @staticmethod
    def _strip_thinking_process(text: str) -> str:
        """过滤 WebChat 模型输出的思考过程（CoT），只保留最终 JSON 内容。"""
        if not text:
            return text
        # 策略1: 去除 <think>...</think> 标签
        text = re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)
        # 策略2: 提取最后一个 JSON 对象（评委输出可能在思考过程之后）
        # 找到最后一个 { 开头的 JSON 对象
        last_brace = text.rfind('{')
        if last_brace > 0:
            # 检查 { 之前的内容是否主要是英文（思考过程）
            prefix = text[:last_brace].strip()
            if prefix:
                chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', prefix))
                if chinese_chars < len(prefix) * 0.1:
                    # 前缀主要是英文/符号，可能是思考过程，提取从最后一个 { 开始
                    candidate = text[last_brace:]
                    # 验证这是一个完整的 JSON 对象
                    try:
                        json.loads(candidate)
                        text = candidate
                    except json.JSONDecodeError:
                        pass  # 不是完整 JSON，保留原文
        return text.strip()

    def _parse_judge_response(self, raw_content: str, model: str) -> dict:
        """解析评委模型的 JSON 响应 — 针对小模型/免费模型的多种非标准输出做鲁棒处理。"""

        # 1. 尝试从 markdown code block 中提取 JSON
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", raw_content, re.DOTALL)
        if json_match:
            candidate = json_match.group(1).strip()
            parsed = self._try_parse_json(candidate)
            if parsed is not None:
                return self._extract_judge_result(parsed, model)

        # 2. 尝试提取第一个 { 到最后一个 } 之间的内容（处理前后有解释文字的情况）
        first_brace = raw_content.find("{")
        last_brace = raw_content.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            candidate = raw_content[first_brace:last_brace + 1]
            parsed = self._try_parse_json(candidate)
            if parsed is not None:
                return self._extract_judge_result(parsed, model)

        # 3. 对整个内容尝试解析
        parsed = self._try_parse_json(raw_content.strip())
        if parsed is not None:
            return self._extract_judge_result(parsed, model)

        logger.warning(
            f"MultiJudgeVerifier: judge '{model}' returned no parseable JSON, "
            f"raw preview: {raw_content[:500]}"
        )
        raise ValueError(f"Judge '{model}' returned no parseable JSON")

    def _try_parse_json(self, text: str) -> dict | None:
        """尝试多种策略解析 JSON，返回解析后的字典或 None。"""

        # 策略1: 直接解析
        try:
            result = json.loads(text)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # 策略2: 修复单引号 → 双引号
        fixed = text.replace("'", '"')
        try:
            result = json.loads(fixed)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # 策略3: 修复尾部逗号（}, ]前的逗号）
        fixed = re.sub(r",\s*([}\]])", r"\1", text)
        try:
            result = json.loads(fixed)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # 策略4: 修复未加引号的键（如 scores: {...} → "scores": {...}）
        fixed = re.sub(r'(?<=[{,])\s*(\w+)\s*:', r' "\1":', text)
        # 清理可能产生的双引号重复
        fixed = fixed.replace('""', '"')
        try:
            result = json.loads(fixed)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # 策略5: 组合修复 — 单引号 + 尾部逗号 + 未加引号的键
        fixed = text.replace("'", '"')
        fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
        fixed = re.sub(r'(?<=[{,])\s*(\w+)\s*:', r' "\1":', fixed)
        fixed = fixed.replace('""', '"')
        try:
            result = json.loads(fixed)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # 策略6: 修复布尔值/None（Python风格 → JSON风格）
        fixed = text
        for py_val, json_val in [("True", "true"), ("False", "false"), ("None", "null")]:
            fixed = fixed.replace(py_val, json_val)
        try:
            result = json.loads(fixed)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        return None

    def _extract_judge_result(self, parsed: dict, model: str) -> dict:
        """从解析后的字典中提取评分和建议，处理多种字段命名风格。"""
        # 兼容多种字段名: scores / score / 评分
        scores = parsed.get("scores") or parsed.get("score") or parsed.get("评分") or {}
        # 兼容多种字段名: improvement_suggestions / suggestions / improvements / 建议
        suggestions = (
            parsed.get("improvement_suggestions")
            or parsed.get("suggestions")
            or parsed.get("improvements")
            or parsed.get("建议")
            or []
        )

        # 确保所有分数在 [0, 1] 范围内
        normalized_scores = {}
        for dim, score in scores.items():
            try:
                s = float(score)
                normalized_scores[dim] = max(0.0, min(1.0, s))
            except (ValueError, TypeError):
                logger.warning(f"MultiJudgeVerifier: judge '{model}' invalid score for '{dim}': {score}")

        return {
            "model": model,
            "scores": normalized_scores,
            "improvement_suggestions": suggestions if isinstance(suggestions, list) else [],
        }

    def _aggregate_scores(self, results: list[dict], dimensions: dict) -> dict:
        """聚合多个评委的评分，使用 trimmed mean（>=3评委时去除最高最低）。"""
        dim_scores: dict[str, list[float]] = {}
        for r in results:
            for dim, score in r.get("scores", {}).items():
                dim_scores.setdefault(dim, []).append(score)

        aggregated_dims: dict[str, float] = {}
        for dim, scores_list in dim_scores.items():
            if not scores_list:
                aggregated_dims[dim] = 0.0
                continue

            sorted_scores = sorted(scores_list)
            # trimmed mean: >=3评委时去除最高和最低
            if len(sorted_scores) >= 3:
                trimmed = sorted_scores[1:-1]
            else:
                trimmed = sorted_scores
            aggregated_dims[dim] = sum(trimmed) / len(trimmed) if trimmed else 0.0

        # 加权汇总
        total_weight = sum(dimensions.values()) or 1.0
        weighted_score = sum(
            aggregated_dims.get(dim, 0.0) * weight
            for dim, weight in dimensions.items()
        ) / total_weight

        return {
            "weighted_score": weighted_score,
            "dimension_scores": aggregated_dims,
        }

    def _merge_suggestions(self, results: list[dict]) -> list[str]:
        """合并去重多个评委的改进建议，按出现频率排序。"""
        suggestion_counter: Counter = Counter()
        for r in results:
            for s in r.get("improvement_suggestions", []):
                # 归一化：去首尾空格、转小写用于去重
                normalized = str(s).strip()
                if normalized:
                    suggestion_counter[normalized] += 1

        # 按频率降序排列
        merged = [s for s, _ in suggestion_counter.most_common()]
        return merged[:10]  # 最多返回10条

    def _build_detailed_errors(
        self,
        aggregated: dict,
        valid_results: list[dict],
        dimensions: dict,
        threshold: float,
    ) -> list[str]:
        """构建详细的 errors 列表，包含低分维度分析和改进建议。

        输出格式让 Reflector 能精准定位问题并生成可操作的改进建议，
        而非泛泛的"质量不达标"。
        """
        errors = []
        weighted_score = aggregated["weighted_score"]
        dim_scores = aggregated.get("dimension_scores", {})

        # 1. 总体信息
        errors.append(f"质量评分 {weighted_score:.4f} 低于阈值 {threshold:.2f}，需要改进")

        # 2. 按权重排序的维度得分（高权重维度优先展示）
        sorted_dims = sorted(dimensions.items(), key=lambda x: x[1], reverse=True)
        low_score_dims = []
        for dim, weight in sorted_dims:
            score = dim_scores.get(dim, 0.0)
            if score < 0.90:
                low_score_dims.append((dim, score, weight))

        if low_score_dims:
            errors.append("低分维度（<0.90）:")
            for dim, score, weight in low_score_dims:
                errors.append(f"  - {dim}: {score:.3f} (权重{weight:.2f})")

        # 3. 加权贡献分析 — 哪些维度对总分拖累最大
        if low_score_dims:
            # 计算每个维度对加权总分的实际贡献
            total_weight = sum(dimensions.values()) or 1.0
            contributions = []
            for dim, score, weight in low_score_dims:
                actual_contribution = score * weight / total_weight
                ideal_contribution = 0.90 * weight / total_weight  # 以0.90为基准
                gap = ideal_contribution - actual_contribution
                contributions.append((dim, gap, score, weight))
            contributions.sort(key=lambda x: x[1], reverse=True)

            errors.append("对总分拖累最大的维度（优先改进）:")
            for dim, gap, score, weight in contributions[:5]:
                errors.append(f"  - {dim}: 得分{score:.3f}，拖累总分{gap:.4f} (权重{weight:.2f})")

        # 4. 评委共识建议
        merged_suggestions = self._merge_suggestions(valid_results)
        if merged_suggestions:
            errors.append("评委改进建议:")
            for s in merged_suggestions[:5]:
                errors.append(f"  - {s}")

        return errors


def create_verifier(mode: str = "rule_based") -> LoopVerifier:
    """根据模式字符串创建对应的 Verifier 实例。

    Args:
        mode: 校验模式，支持 "agent_judge", "rule_based", "schema",
              "test_suite", "multi_judge"。

    Returns:
        对应的 LoopVerifier 实例。
    """
    verifiers = {
        "agent_judge": AgentJudgeVerifier,
        "rule_based": RuleBasedVerifier,
        "schema": SchemaVerifier,
        "test_suite": TestSuiteVerifier,
        "multi_judge": MultiJudgeVerifier,
    }
    cls = verifiers.get(mode)
    if cls is None:
        logger.warning(f"Unknown verifier mode '{mode}', falling back to rule_based")
        cls = RuleBasedVerifier
    return cls()

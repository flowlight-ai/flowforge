"""Loop Verifier — business-level quality verification."""

import asyncio
import json
import re
import time
import yaml
from collections import Counter
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any
from flowforge.core.task_context import TaskContext
from flowforge.core.base_tool import ToolInput
from flowforge.loop.state import Verdict
from flowforge.core.tracing import get_logger

logger = get_logger("loop.verifier")

# 配置文件路径（flowforge/loop/verifier.py → flowforge/config/prompts.yaml）
_VERIFIER_PROMPTS_PATH = Path(__file__).parent.parent / "config" / "prompts.yaml"


def _load_verifier_prompt(section: str) -> str:
    """从 prompts.yaml 加载 verifier 字符串提示词。

    fail-open: 加载失败时返回空字符串并记录 ERROR 日志。
    """
    try:
        if not _VERIFIER_PROMPTS_PATH.exists():
            logger.error(f"_load_verifier_prompt: prompts.yaml not found at {_VERIFIER_PROMPTS_PATH}")
            return ""
        with open(_VERIFIER_PROMPTS_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        value = data.get(section, "")
        if isinstance(value, str):
            return value
        logger.error(
            f"_load_verifier_prompt: section '{section}' expected str, got {type(value).__name__}"
        )
        return ""
    except Exception as e:
        logger.error(f"_load_verifier_prompt: failed to load section '{section}': {e}")
        return ""


def _load_verifier_dict(section: str) -> dict[str, Any]:
    """从 prompts.yaml 加载 verifier dict 配置。

    fail-open: 加载失败时返回空 dict 并记录 ERROR 日志。
    """
    try:
        if not _VERIFIER_PROMPTS_PATH.exists():
            logger.error(f"_load_verifier_dict: prompts.yaml not found at {_VERIFIER_PROMPTS_PATH}")
            return {}
        with open(_VERIFIER_PROMPTS_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        value = data.get(section, {})
        if isinstance(value, dict):
            return value
        logger.error(
            f"_load_verifier_dict: section '{section}' expected dict, got {type(value).__name__}"
        )
        return {}
    except Exception as e:
        logger.error(f"_load_verifier_dict: failed to load section '{section}': {e}")
        return {}


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
        threshold = config.get("pass_threshold", 0.85)

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
        pass_threshold = config.get("pass_threshold", 0.9)

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

    # 默认评审维度及权重（已外置到 prompts.yaml: flowforge.verifier.dimensions）
    DEFAULT_DIMENSIONS: dict[str, float] = {}

    # 默认维度说明（已外置到 prompts.yaml: flowforge.verifier.dimension_descriptions）
    DEFAULT_DIMENSION_DESCRIPTIONS: dict[str, str] = {}

    # 默认评审角色（已外置到 prompts.yaml: flowforge.verifier.judge_role）
    DEFAULT_JUDGE_ROLE: str = ""

    # 默认上下文段定义（已外置到 prompts.yaml: flowforge.verifier.context_sections）
    DEFAULT_CONTEXT_SECTIONS: list[dict] = []

    # 默认评审提示词模板（已外置到 prompts.yaml: flowforge.verifier.judge_context_template）
    DEFAULT_JUDGE_CONTEXT_TEMPLATE: str = ""

    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        judges_raw = config.get("judges", [])
        exclude_creator = config.get("exclude_creator", True)
        # 质量阈值默认0.85（v4.0: 用户明确要求从0.9降到0.85，平衡质量与可用性）
        threshold = config.get("pass_threshold", 0.85)
        dimensions = config.get("dimensions") or _load_verifier_dict("flowforge.verifier.dimensions")
        # 全局 prefer_api（可作为 per-judge 的默认值）
        global_prefer_api = config.get("prefer_api", False)

        if not judges_raw:
            logger.warning("MultiJudgeVerifier: no judges configured, falling back to pass")
            return Verdict(passed=True, score=1.0)

        # Phase 5.4: 支持 per-judge prefer_api 配置
        # judges 可以是字符串列表（使用 global_prefer_api）或对象列表（带 model + prefer_api）
        # 例如:
        #   judges:
        #     - openroute/DeepSeek-V4-Pro       # 字符串：使用 global_prefer_api
        #     - model: openroute/GLM-5.1         # 对象：per-judge prefer_api
        #       prefer_api: true
        normalized_judges: list[tuple[str, bool]] = []
        for j in judges_raw:
            if isinstance(j, str):
                normalized_judges.append((j, global_prefer_api))
            elif isinstance(j, dict) and "model" in j:
                jpa = j.get("prefer_api", global_prefer_api)
                normalized_judges.append((j["model"], bool(jpa)))
            else:
                logger.warning(f"MultiJudgeVerifier: 跳过无效 judge 配置: {j!r}")

        if not normalized_judges:
            logger.warning("MultiJudgeVerifier: no valid judges after normalization, falling back to pass")
            return Verdict(passed=True, score=1.0)

        # 1. 排除创作模型（避免自我评分）
        # 优先使用配置中的 creator_model，其次从 result 中获取
        creator_model = config.get("creator_model", "") or (result.get("_model", "") if isinstance(result, dict) else "")
        active_judges = list(normalized_judges)
        if exclude_creator and creator_model:
            active_judges = [(m, pa) for m, pa in active_judges if m != creator_model]

        if not active_judges:
            logger.warning("MultiJudgeVerifier: all judges excluded (creator model), using original list")
            active_judges = list(normalized_judges)

        # 2. 构建评审提示词（完全配置驱动）
        # 从 result 中提取待评审内容，支持多种返回格式
        content = ""

        # [诊断日志] 记录传入 verify() 的 result 的完整 keys 和每个 key 的内容预览
        # 用于定位"评委收到 params 字典 str() 而非文章正文"的根因
        if isinstance(result, dict):
            result_keys_preview = {}
            for _k, _v in result.items():
                if _k.startswith("_"):
                    continue
                if isinstance(_v, str):
                    result_keys_preview[_k] = f"str(len={len(_v)}, preview={_v[:100]!r})"
                elif isinstance(_v, dict):
                    result_keys_preview[_k] = f"dict(keys={list(_v.keys())[:5]})"
                elif isinstance(_v, list):
                    result_keys_preview[_k] = f"list(len={len(_v)})"
                else:
                    result_keys_preview[_k] = f"{type(_v).__name__}(val={str(_v)[:50]!r})"
            logger.info(
                f"[verifier-diag] verify() result keys: {list(result.keys())}, "
                f"details={result_keys_preview}"
            )
        else:
            logger.info(f"[verifier-diag] verify() result type={type(result).__name__}, not dict")

        if isinstance(result, dict):
            # P0-29 修复: "report" 优先于 "content", 因为 stockforge:report agent 的
            # result["content"] 是简短描述(36字符), result["report"] 是完整报告(2000+字符)
            # 原列表 "content" 在首位, 提取到36字符描述后停止, 跳过评审
            extracted_from_key = ""
            for key in ("report", "edited_draft", "content", "response", "output", "draft", "final_answer"):
                val = result.get(key, "")
                if isinstance(val, str) and val.strip():
                    content = val
                    extracted_from_key = key
                    break
                elif isinstance(val, dict):
                    # 嵌套 dict 时尝试提取子字段
                    for sub_key in ("content", "output", "draft", "response", "result"):
                        sub_val = val.get(sub_key, "")
                        if isinstance(sub_val, str) and sub_val.strip():
                            content = sub_val
                            extracted_from_key = f"{key}.{sub_key}"
                            break
                        elif isinstance(sub_val, dict):
                            # 二级嵌套
                            for sub2_key in ("content", "output", "result"):
                                sub2_val = sub_val.get(sub2_key, "")
                                if isinstance(sub2_val, str) and sub2_val.strip():
                                    content = sub2_val
                                    extracted_from_key = f"{key}.{sub_key}.{sub2_key}"
                                    break
                            if content:
                                break
                    if content:
                        break

            # [诊断日志] 记录提取到的内容来源和长度
            if extracted_from_key:
                logger.info(
                    f"[verifier-diag] content extracted from key='{extracted_from_key}', "
                    f"len={len(content)}, preview={content[:200]!r}"
                )
            else:
                logger.warning(
                    f"[verifier-diag] NO content extracted! result_keys={list(result.keys())}, "
                    f"checked_keys=('content','edited_draft','response','output','draft','final_answer')"
                )

            # v2.8 修复: content 可能是多层嵌套JSON字符串（如 '{"draft": "{\"draft\": \"...\"}"}'），
            # webchat评委模型收到JSON后会困惑（误认为是代码片段），导致评审失败。
            # 循环解析JSON直到提取出纯文本文章内容（最多3层防止无限循环）。
            for _json_depth in range(3):
                if not (content and isinstance(content, str) and content.strip().startswith("{")):
                    break
                try:
                    parsed = json.loads(content)
                    if not isinstance(parsed, dict):
                        break
                    # 按优先级提取文章正文
                    extracted = None
                    for draft_key in ("draft", "content", "edited_draft", "output", "response", "result"):
                        draft_val = parsed.get(draft_key, "")
                        if isinstance(draft_val, str) and draft_val.strip():
                            extracted = draft_val
                            logger.info(
                                f"[verifier-diag] content was JSON (depth={_json_depth+1}), extracted '{draft_key}' field, "
                                f"len={len(draft_val)}, preview={draft_val[:200]!r}"
                            )
                            break
                        elif isinstance(draft_val, dict):
                            for sub_key in ("draft", "content", "output"):
                                sub_val = draft_val.get(sub_key, "")
                                if isinstance(sub_val, str) and sub_val.strip():
                                    extracted = sub_val
                                    logger.info(
                                        f"[verifier-diag] content was JSON (depth={_json_depth+1}), extracted '{draft_key}.{sub_key}' field, "
                                        f"len={len(sub_val)}, preview={sub_val[:200]!r}"
                                    )
                                    break
                            if extracted:
                                break
                    if extracted:
                        content = extracted
                    else:
                        break  # JSON dict但没找到已知字段，停止解析
                except (json.JSONDecodeError, TypeError) as e:
                    logger.debug(f"[verifier-diag] content starts with '{{' but not valid JSON (depth={_json_depth+1}): {e}")
                    break

            if not content:
                logger.warning(
                    f"MultiJudgeVerifier: no content field found in result, "
                    f"result_keys={list(result.keys()) if isinstance(result, dict) else type(result).__name__}"
                )
                return Verdict(
                    passed=False,
                    score=0.0,
                    errors=["result中未找到任何内容字段（content/edited_draft/response/output/draft/final_answer均为空），无法评审"],
                )
        else:
            # BUG-C3 修复：result 不是 dict 时（如 str/None/异常），直接返回失败
            # 原代码 content = str(result) 会把异常对象/params 字典 str() 化送给评委，
            # 导致评委收到无意义的字符串（如 "{'topic_list': [...], 'research_materials': [...]}"）
            # 而不是真正的文章正文
            logger.warning(
                f"[verifier-diag] result is not dict (type={type(result).__name__}), "
                f"refusing to send str(result) to judges. result_preview={str(result)[:200]!r}"
            )
            return Verdict(
                passed=False,
                score=0.0,
                errors=[f"result类型异常({type(result).__name__})，不是dict，无法提取文章正文，拒绝评审"],
            )

        # B2/B3: 空内容保护 — 空 draft 或过短内容直接返回失败，不送给评委
        # 避免空内容被评委打出全0分或返回"无法回答"等无效响应
        if not content or len(content.strip()) < 50:
            logger.warning(
                f"MultiJudgeVerifier: content is empty or too short ({len(content.strip()) if content else 0} chars), "
                f"skipping judge evaluation"
            )
            return Verdict(
                passed=False,
                score=0.0,
                errors=["内容为空或过短，无法评审"],
            )

        prompt = self._build_eval_prompt(content, task, dimensions, config)

        # 3. 并行调用所有评委（每个评委最多60秒，超时跳过）
        judge_timeout = config.get("judge_timeout", 60)
        # Phase 5.4: prefer_api 已在 per-judge 级别配置（normalized_judges 中每个元素为 (model, prefer_api)）
        # 并发限流：避免5个评委同时打同一个provider导致超时
        # 不同provider可并行，但同一个provider最多2个并发
        # 配置项：max_judge_concurrency（默认2），可通过 loop.yaml verifier 配置
        max_concurrency = int(config.get("max_judge_concurrency", 2))
        judge_semaphore = asyncio.Semaphore(max_concurrency)

        async def _limited_call_judge(judge_model: str, judge_prompt: str, _task, _prefer_api: bool, _judge_timeout: int):
            async with judge_semaphore:
                return await self._call_judge(judge_model, judge_prompt, _task, _prefer_api, _judge_timeout)

        # active_judges 是 (model, prefer_api) 元组列表
        judge_names = [m for m, _ in active_judges]
        logger.info(f"[verifier-diag] 评委并发限流: max_concurrency={max_concurrency}, "
                    f"judges={judge_names}, judge_timeout={judge_timeout}s, "
                    f"content_len={len(content)}, prompt_len={len(prompt)}")
        # SSE修复：评委调用前发射事件，让客户端能看到评审进度
        if task.event_bus:
            task.event_bus.emit(task.task_id, "verify.judges.start", {
                "judges": judge_names, "judge_count": len(active_judges),
                "judge_timeout": judge_timeout, "content_len": len(content),
                "max_concurrency": max_concurrency,
            })
        judge_tasks = [_limited_call_judge(m, prompt, task, pa, judge_timeout) for m, pa in active_judges]
        judge_results = await asyncio.gather(
            *(asyncio.wait_for(t, timeout=judge_timeout) for t in judge_tasks),
            return_exceptions=True,
        )
        # SSE修复：评委调用后发射事件，汇报评委成功/失败情况
        if task.event_bus:
            judge_status = []
            for i, r in enumerate(judge_results):
                if isinstance(r, Exception):
                    judge_status.append({"judge": judge_names[i], "status": "failed", "error": str(r)[:100]})
                elif isinstance(r, dict):
                    judge_status.append({"judge": judge_names[i], "status": "ok"})
                else:
                    judge_status.append({"judge": judge_names[i], "status": "invalid"})
            task.event_bus.emit(task.task_id, "verify.judges.complete", {
                "judge_results": judge_status,
                "valid_count": sum(1 for r in judge_results if isinstance(r, dict)),
                "total_count": len(active_judges),
            })

        # 4. 过滤有效结果
        valid_results: list[dict] = []
        for i, r in enumerate(judge_results):
            if isinstance(r, Exception):
                logger.warning(f"MultiJudgeVerifier: judge '{judge_names[i]}' failed: {r}")
            elif isinstance(r, dict):
                valid_results.append(r)
            else:
                logger.warning(f"MultiJudgeVerifier: judge '{judge_names[i]}' returned unexpected type: {type(r)}")

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

        # SSE修复：评审结果出来后发射事件，让客户端能看到最终分数
        if task.event_bus:
            task.event_bus.emit(task.task_id, "verify.result", {
                "passed": aggregated["weighted_score"] >= threshold,
                "score": round(aggregated["weighted_score"], 4),
                "threshold": threshold,
                "valid_judges": len(valid_results),
                "total_judges": len(active_judges),
                "errors_count": len(errors),
            })

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
        judge_role = config.get("judge_role") or _load_verifier_prompt("flowforge.verifier.judge_role")

        # 2. 构建上下文段 — 从 context_sections 配置动态提取
        context_sections_config = config.get("context_sections") or _load_verifier_dict("flowforge.verifier.context_sections").get("sections", [])
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
        dimension_descriptions = config.get("dimension_descriptions") or _load_verifier_dict("flowforge.verifier.dimension_descriptions")
        dim_lines: list[str] = []
        for dim, weight in dimensions.items():
            desc = dimension_descriptions.get(dim, "")
            if desc:
                dim_lines.append(f"  - {dim} (权重 {weight:.2f}): {desc}")
            else:
                dim_lines.append(f"  - {dim} (权重 {weight:.2f})")

        # 4. 动态生成 score_fields — 用示例值 0.85（非 0.0）
        # v3 修复: 原 0.0 会导致 GLM-5.1 API 空响应时, OpenRoute 网关返回 prompt 中的
        #   JSON 模板(scores 全 0.0)作为响应, 浪费 230s 后才被 Echo 检测捕获
        # v3 改为 0.85 (示例值), LLM 看到具体数值会理解需替换为实际评分;
        #   若 LLM echo 模板, scores 全 0.85 (明显非真实评分), 容易检测
        # v2 历史: 原 <your_score 0.0-1.0> 占位符让某些 LLM 误以为要输出占位符本身
        score_field_lines = [f'"{dim}": 0.85' for dim in dimensions.keys()]
        score_fields = ",\n    ".join(score_field_lines)

        # 5. 读取提示词模板
        template = config.get("judge_context_template") or _load_verifier_prompt("flowforge.verifier.judge_context_template")

        # 6. 渲染模板（加 try/except 保护，避免 KeyError 中断整个迭代）
        try:
            prompt = template.format(
                judge_role=judge_role,
                context_sections=context_sections_str,
                dimension_lines="\n".join(dim_lines),
                content=content[:8000],
                score_fields=score_fields,
            )
        except KeyError as ke:
            # Bug-5 修复：模板含未提供的占位符（如自定义模板中的 {platform_name}），
            # 降级到默认模板渲染，避免整个迭代失败
            logger.error(
                f"[verifier-diag] template.format KeyError: 占位符 {ke} 未提供, "
                f"回退到默认模板。自定义模板前300字符: {template[:300]!r}"
            )
            try:
                fallback_template = _load_verifier_prompt("flowforge.verifier.judge_context_template")
                prompt = fallback_template.format(
                    judge_role=judge_role,
                    context_sections=context_sections_str,
                    dimension_lines="\n".join(dim_lines),
                    content=content[:8000],
                    score_fields=score_fields,
                )
            except Exception as fallback_e:
                # 默认模板也失败，构造最小可用 prompt（从 prompts.yaml 加载）
                logger.error(
                    f"[verifier-diag] 默认模板也失败: {fallback_e}, 构造最小可用 prompt"
                )
                minimal_template = _load_verifier_prompt("flowforge.verifier.minimal_prompt")
                try:
                    prompt = minimal_template.format(
                        judge_role=judge_role,
                        dimension_lines="\n".join(dim_lines),
                        content=content[:8000],
                        score_fields=score_fields,
                    )
                except Exception as minimal_e:
                    logger.error(
                        f"[verifier-diag] minimal_prompt format failed: {minimal_e}"
                    )
                    prompt = ""

        # [诊断日志] 记录渲染后的 prompt 关键信息
        # 验证 content 是否正确注入到 prompt 中（用户反馈"传给llm评审的提示词里没有被评审的内容"）
        content_in_prompt = content[:200] in prompt
        prompt_content_section = ""
        if "待评审内容:" in prompt:
            idx = prompt.find("待评审内容:")
            prompt_content_section = prompt[idx:idx + 300]
        logger.info(
            f"[verifier-diag] _build_eval_prompt: prompt_len={len(prompt)}, "
            f"content_in_prompt={content_in_prompt}, "
            f"content_section_preview={prompt_content_section[:200]!r}"
        )
        if not content_in_prompt:
            logger.error(
                f"[verifier-diag] CRITICAL: content NOT found in rendered prompt! "
                f"This means the judge will receive an empty content section. "
                f"content_len={len(content)}, template_has_content_placeholder={'{content}' in template}"
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

    def _get_judge_system_message(self) -> str:
        """加载评委 system message — 从 prompts.yaml 加载，fail-open 返回空字符串。"""
        return _load_verifier_prompt("flowforge.verifier.judge_system_message")

    async def _call_judge(self, model: str, prompt: str, task: TaskContext, prefer_api: bool = False, judge_timeout: int = 180) -> dict:
        """调用单个评委模型，返回解析后的评分字典。

        Args:
            model: 评委模型标识（provider/model_id 格式）。
            prompt: 评审提示词。
            task: 任务上下文，提供 tools/persona/task_id。
            prefer_api: 为 True 时强制使用 API backend，排除 WebChat backend，
                避免 8000 token 限制和 CoT 干扰导致评委失败。
            judge_timeout: 单个评委调用超时秒数（来自 loop YAML verifier.judge_timeout）。
                替代历史硬编码 60s，使 webchat 模型有足够时间返回。
        """
        if not task.tools:
            raise RuntimeError("TaskContext.tools is not available for judge invocation")

        # 使用 system message 强制 JSON 输出（针对 WebChat 模型优化）
        # 从 prompts.yaml 加载（flowforge.verifier.judge_system_message）
        system_msg = self._get_judge_system_message()
        judge_params = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "task_id": task.task_id,
            "agent_name": f"multi_judge_{model.replace('/', '_')}",
            "persona": task.persona or "default",
            "assignment": "judge",  # 使用 judge assignment 的 fallback 链（而非 default 的超短链）
            "skip_cooldown": True,
        }
        # prefer_api: 让 LLMClient 过滤候选链中的 WebChat backend，仅使用 API backend
        if prefer_api:
            judge_params["prefer_api"] = True

        # [诊断日志] 记录发送给评委的 prompt 长度和内容预览
        logger.info(
            f"[verifier-diag] _call_judge: model={model}, prompt_len={len(prompt)}, "
            f"user_msg_preview={prompt[:300]!r}"
        )

        # 评委调用超时保护（使用 yaml 配置的 judge_timeout，默认180s）：
        # 修复历史 BUG：原硬编码 timeout=60 覆盖了 loop YAML 的 judge_timeout=180，
        # 导致所有 webchat 评委 60s 全部超时，质量分 0.0。
        # 现在使用传入的 judge_timeout 参数（来自 config.get("judge_timeout", 180)），
        # 让 webchat 模型有足够时间返回。超时后抛出 TimeoutError，被上层 gather 的
        # return_exceptions=True 捕获，该评委标记为失败，其他评委结果继续参与聚合。
        _judge_call_start = time.monotonic()
        try:
            tool_output = await asyncio.wait_for(
                task.tools.execute("llm", ToolInput(params=judge_params)),
                timeout=judge_timeout,
            )
        except asyncio.TimeoutError:
            _elapsed = time.monotonic() - _judge_call_start
            logger.warning(
                f"[评委超时] model={model} 超时({judge_timeout}s)，实际耗时={_elapsed:.1f}s，"
                f"触发fallback到其他评委"
            )
            raise asyncio.TimeoutError(
                f"Judge '{model}' timed out after {judge_timeout}s (elapsed={_elapsed:.1f}s)"
            )
        _judge_elapsed = time.monotonic() - _judge_call_start
        logger.info(f"[评委耗时] model={model}, elapsed={_judge_elapsed:.1f}s")

        # P-WIN-FIX: 检查 tool_output.error — 当 LLM 调用失败时（超时/空响应/WebChat崩溃），
        # LLMClient 返回 ToolOutput(result={"content":"","error":...}, error=...)。
        # 原代码只读 content="" 不检查 error，导致空字符串被 _parse_judge_response 解析失败。
        # 此修复不影响成功路径（Linux 评委正常时 tool_output.error 为 None）。
        if tool_output.error:
            err_msg = str(tool_output.error)[:300]
            logger.warning(
                f"[verifier-diag] _call_judge LLM call failed: model={model}, "
                f"error={err_msg}"
            )
            raise ValueError(f"Judge '{model}' LLM call failed: {err_msg}")

        raw_content = tool_output.result.get("content", "") if tool_output.result else ""
        # 二次检查：result 中可能包含 error 字段（部分失败路径）
        if not raw_content and tool_output.result and tool_output.result.get("error"):
            err_msg = str(tool_output.result.get("error"))[:300]
            logger.warning(
                f"[verifier-diag] _call_judge empty content with error: model={model}, "
                f"error={err_msg}"
            )
            raise ValueError(f"Judge '{model}' returned empty content: {err_msg}")

        # [诊断日志] 记录评委返回的原始内容
        _raw_preview = repr(raw_content[:300]) if raw_content else repr("EMPTY")
        logger.info(
            f"[verifier-diag] _call_judge response: model={model}, "
            f"raw_content_len={len(raw_content) if raw_content else 0}, "
            f"raw_content_preview={_raw_preview}"
        )

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

        # B3: 检测"无法回答"等非JSON文本 — 记录但不当作成功
        stripped = raw_content.strip()
        _UNABLE_MARKERS = ("无法回答", "无法评审", "无法评估", "不能回答", "无法判断",
                           "I cannot", "I can't", "unable to", "无法分析")
        for marker in _UNABLE_MARKERS:
            if marker in stripped and len(stripped) < 200:
                logger.warning(
                    f"MultiJudgeVerifier: judge '{model}' returned unable-to-answer text: {stripped[:100]}"
                )
                raise ValueError(f"Judge '{model}' returned unable-to-answer text")

        # v3.9: 检测 webchat 模型返回的问候语/帮助语 — Kimi-K2.6 等模型在
        # prompt 未被正确处理时会返回"您好！有什么我可以帮您的吗？"等问候语
        # 这些短文本不是有效的评审结果，必须重试或切换候选模型
        _GREETING_MARKERS = (
            "您好！有什么我可以帮您的吗",
            "您好，有什么我可以帮您",
            "你好！有什么我可以帮您",
            "你好，有什么我可以帮您",
            "有什么我可以帮您的吗",
            "有什么可以帮您的吗",
            "请问有什么可以帮您",
            "我可以帮您什么",
            "How can I help you",
            "how can I help you",
            "What can I do for you",
            "您好，我是AI助手",
            "你好，我是AI助手",
        )
        for marker in _GREETING_MARKERS:
            if marker in stripped and len(stripped) < 100:
                logger.warning(
                    f"MultiJudgeVerifier: judge '{model}' returned greeting/help text "
                    f"(webchat未正确处理prompt): {stripped[:100]}"
                )
                raise ValueError(f"Judge '{model}' returned greeting text (not a valid review)")

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

        # B3: 检测全0分 — 可能是评委未理解任务或占位符问题
        # 如果所有维度都是0.0，说明评委可能返回了占位符或"无法回答"
        if normalized_scores and all(v == 0.0 for v in normalized_scores.values()):
            logger.warning(
                f"MultiJudgeVerifier: judge '{model}' returned all-zero scores "
                f"(possible placeholder/unable-to-answer), treating as invalid"
            )
            raise ValueError(f"Judge '{model}' returned all-zero scores (possible placeholder issue)")

        # B3: 检测"无法回答"等非JSON文本被误解析为空scores
        if not normalized_scores:
            logger.warning(
                f"MultiJudgeVerifier: judge '{model}' returned no valid scores, "
                f"raw parsed keys: {list(parsed.keys())}"
            )
            raise ValueError(f"Judge '{model}' returned no valid scores")

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

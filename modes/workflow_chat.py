"""Workflow intelligent chat module.

Handles intelligent chat execution, normal chat, and simple responses.
Extracted from WorkflowExecutor to reduce God Object complexity.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.errors import WorkflowRecursionError
from flowforge.modes.workflow_validator import is_error_content, _SEARCH_TOOLS, _SEARCH_AGENTS

if TYPE_CHECKING:
    from flowforge.modes.workflow_executor import WorkflowExecutor

logger = get_logger("workflow_chat")


class ChatHandler:
    """智能对话处理器 - 负责智能对话、普通对话和简单回复"""

    def __init__(self, executor: WorkflowExecutor) -> None:
        self._executor = executor

    async def execute_normal_chat(self, ctx, context_data: dict) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"

        recalled = await self._executor._recall_memories(ctx, intent)

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "normal_chat", "label": "普通对话", "order": 1, "total": 1,
        })

        system_prompt = get_prompt("response.normal")
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        result_content = ""
        try:
            result_content = await self._executor._call_llm(ctx, messages, model_hint, "normal_assistant", persona)
        except Exception as e:
            logger.error(f"Normal chat LLM call failed: {e}")
            result_content = f"AI 调用失败: {str(e)[:200]}"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "normal_chat"})
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": result_content, "is_partial": False, "agent_name": "helm_assistant",
        })

        result = {**context_data, "response": result_content}
        await self._executor._save_to_memory(ctx, intent, result, {"intent_type": "chat", "plan": []})
        return result

    async def execute_intelligent_chat(self, ctx, context_data: dict, is_auto: bool = False) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"
        mode_label = "全自动" if is_auto else "Helm"

        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= 3:
            raise WorkflowRecursionError("Max workflow depth exceeded in intelligent_chat")

        is_simple = self._executor._validator.is_simple_message(intent)
        logger.info(f"Fast-path check: intent='{intent[:50]}', is_simple={is_simple}, is_auto={is_auto}")
        if is_simple:
            logger.info(f"Fast-path: simple message detected, skipping planning for '{intent[:30]}'")
            return await self.simple_response(ctx, context_data, model_hint, persona, intent)

        recalled = await self._executor._recall_memories(ctx, intent)

        # ── Stage 1: Plan ──
        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "planning", "label": f"{mode_label}意图识别",
            "order": 1, "stage": "planning",
        })

        tool_descriptions = self._executor._build_tool_descriptions_text(ctx)
        planning_prompt = get_prompt("planning.system", tool_descriptions=tool_descriptions)
        plan_messages = [{"role": "system", "content": planning_prompt}, {"role": "user", "content": intent}]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                plan_messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        plan_content = ""
        try:
            plan_content = await self._executor._call_llm(ctx, plan_messages, model_hint, "planner", persona)
        except Exception as e:
            logger.error(f"Planning LLM call failed: {e}", task_id=ctx.task_id)
            ctx.event_bus.emit(ctx.task_id, "helm.stage.exit", {
                "step": "planning", "stage": "planning",
                "error": f"意图识别失败: {str(e)[:200]}",
            })
            raise RuntimeError(f"意图识别失败，LLM调用异常: {str(e)[:200]}")

        if not plan_content or not plan_content.strip():
            logger.error("Planning LLM returned empty content", task_id=ctx.task_id)
            ctx.event_bus.emit(ctx.task_id, "helm.stage.exit", {
                "step": "planning", "stage": "planning",
                "error": "意图识别失败: LLM返回空内容",
            })
            raise RuntimeError("意图识别失败，LLM返回空内容")

        plan = self._executor._validator.parse_execution_plan(plan_content)
        steps = plan.get("plan", [])
        intent_type = plan.get("intent_type", "chat")

        # ── Fallback: if planner returned empty plan, infer intent from user input ──
        if not steps:
            inferred_type = self._executor._validator.infer_intent_type_from_text(intent)
            if inferred_type != "chat":
                if intent_type == "chat" or (inferred_type != intent_type and inferred_type != "chat"):
                    intent_type = inferred_type
                    plan["intent_type"] = inferred_type
                    plan["complexity"] = "medium"
                    logger.info(f"Planner returned {plan.get('intent_type', 'chat')} but user intent looks like {inferred_type}, overriding")

            if intent_type not in ("chat",):
                inferred_steps = self._executor._validator.infer_steps_from_intent(intent_type, intent)
                if inferred_steps:
                    steps = inferred_steps
                    plan["plan"] = steps
                    logger.info(f"Inferred {len(steps)} steps for intent_type={intent_type}")
        elif intent_type == "chat":
            inferred_type = self._executor._validator.infer_intent_type_from_text(intent)
            if inferred_type != "chat" and inferred_type in ("creation", "research", "write", "code"):
                intent_type = inferred_type
                plan["intent_type"] = inferred_type
                inferred_steps = self._executor._validator.infer_steps_from_intent(inferred_type, intent)
                if inferred_steps:
                    steps = inferred_steps
                    plan["plan"] = steps
                    logger.info(f"Overriding chat→{inferred_type} based on user input keywords")

        # Emit plan summary via step.intermediate
        plan_summary = plan.get("summary", intent_type)
        step_count = len(steps)

        # ── Compound intent detection ──
        if steps:
            intent_lower = intent.lower()
            step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
            all_steps_text = " ".join(step_names_lower)

            if any(kw in intent_lower for kw in ["翻译", "translate"]):
                has_translate = any("翻译" in s or "translat" in s or "multilingual" in s for s in step_names_lower)
                if not has_translate:
                    translate_step = {"name": "翻译文本", "type": "agent", "agent": "multilingual",
                                     "input": {"query": intent, "topic": intent, "task": intent},
                                     "description": "翻译文本"}
                    steps.append(translate_step)
                    step_count = len(steps)
                    logger.info(f"Compound intent: added translation step for '翻译' in user input")

            if any(kw in intent_lower for kw in ["搜索", "调研", "研究", "search", "research"]):
                has_search = any("搜索" in s or "search" in s or "web_search" in s or "research" in s for s in step_names_lower)
                if not has_search:
                    search_step = {"name": "搜索信息", "type": "tool", "tool": "web_search",
                                   "input": {"query": intent, "topic": intent, "task": intent},
                                   "description": "搜索相关信息"}
                    steps.insert(0, search_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added search step for '搜索/调研' in user input")

            if any(kw in intent_lower for kw in ["写", "文章", "撰写", "分析", "write", "article"]):
                has_writing = any("撰写" in s or "写作" in s or "writing" in s or "article_writing" in s for s in step_names_lower)
                if not has_writing:
                    write_step = {"name": "撰写内容", "type": "agent", "agent": "article_writing",
                                  "input": {"query": intent, "topic": intent, "task": intent},
                                  "description": "撰写文章内容"}
                    steps.append(write_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added writing step for '写/文章' in user input")

                has_eval = any("评估" in s or "eval" in s or "article_eval" in s for s in step_names_lower)
                if not has_eval:
                    eval_step = {"name": "文章评估", "type": "agent", "agent": "article_eval",
                                 "input": {"query": intent, "topic": intent, "task": intent},
                                 "description": "评估文章质量"}
                    steps.append(eval_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added eval step for '写/文章' in user input")

                has_audit = any("审核" in s or "audit" in s or "content_audit" in s for s in step_names_lower)
                if not has_audit:
                    audit_step = {"name": "内容审核", "type": "agent", "agent": "content_audit",
                                  "input": {"query": intent, "topic": intent, "task": intent},
                                  "description": "内容合规审核"}
                    steps.append(audit_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added audit step for '写/文章' in user input")

            if any(kw in intent_lower for kw in ["代码", "编程", "写代码", "code", "python", "算法"]):
                has_code = any("代码" in s or "code" in s or "code_writer" in s for s in step_names_lower)
                if not has_code:
                    code_step = {"name": "编写代码", "type": "agent", "agent": "code_writer",
                                 "input": {"query": intent, "topic": intent, "task": intent},
                                 "description": "编写代码"}
                    steps.append(code_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added code step for '代码/编程' in user input")

        if step_count > 0:
            step_names = [s.get("name", s.get("step", "")) for s in steps[:5]]
            plan_label = f"规划完成: {plan_summary} (共{step_count}步) → {' → '.join(step_names)}"
            if step_count > 5:
                plan_label += f" ...+{step_count-5}"
        else:
            plan_label = f"规划完成: {plan_summary or '简单对话'} (无需分步)"

        ctx.event_bus.emit(ctx.task_id, "step.intermediate", {
            "step_name": plan_label,
            "content": "",
            "stage": "planning",
        })

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
            "step": "planning",
            "intent_type": plan.get("intent_type", "chat"),
            "complexity": plan.get("complexity", "simple"),
            "step_count": step_count,
        })

        # ── Stage 2: Execute ──
        if not steps:
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "response", "label": "生成回复",
                "order": 2, "stage": "response",
            })

            response_prompt = get_prompt("response.simple")
            response_messages = [
                {"role": "system", "content": response_prompt},
                {"role": "user", "content": intent},
            ]

            final_content = ""
            try:
                final_content = await self._executor._call_llm(ctx, response_messages, model_hint, "helm_assistant", persona)
            except Exception as e:
                final_content = f"生成回复失败: {str(e)[:200]}"

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "response"})
        else:
            # Auto-assign agents based on intent_type
            _INTENT_AGENT_MAP = {
                "creation": "article_writing",
                "code": "code_writer_agent",
                "write": "article_writing",
                "research": "research_agent",
                "translate": "multilingual",
            }
            detected_intent = plan.get("intent_type", "chat")
            for step in steps:
                if not step.get("agent") and not step.get("tool"):
                    step_type = step.get("type", "generate")
                    if step_type == "generate" and detected_intent in _INTENT_AGENT_MAP:
                        step["agent"] = _INTENT_AGENT_MAP[detected_intent]
                        step["type"] = "agent"
                        logger.info(f"Auto-assigned agent '{step['agent']}' for intent_type='{detected_intent}' step '{step.get('name', '')}'")

            step_results = []
            step_context = {}
            step_order = 2
            for step in steps:
                step_name = step.get("name", step.get("step", f"步骤{step_order-1}"))
                step_type = step.get("type", "generate")
                agent_name = step.get("agent", "")
                tool_name = step.get("tool", "")
                step_input = step.get("input", step.get("params", {}))
                step_desc = step.get("description", "")

                if step_input and step_context:
                    merged_input = {**step_input}
                    if agent_name == "multilingual" and "text" not in merged_input:
                        best_text = self._executor._validator.find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["text"] = best_text
                            merged_input["draft"] = best_text
                            logger.info(f"Multilingual step: passing previous step output as text ({len(best_text)} chars)")
                    if agent_name == "article_writing":
                        best_text = self._executor._validator.find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["materials"] = [{"content": best_text[:3000]}]
                            merged_input["draft"] = best_text
                            logger.info(f"ArticleWriting step: passing previous step output as materials ({len(best_text)} chars)")
                    if agent_name in ("article_eval", "article_reflect", "content_audit", "fact_check"):
                        best_text = self._executor._validator.find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["draft"] = best_text
                            logger.info(f"{agent_name} step: passing previous step output as draft ({len(best_text)} chars)")
                        if agent_name == "article_reflect":
                            eval_output = step_context.get("_output_article_eval", "")
                            if eval_output:
                                try:
                                    import json as _json
                                    eval_data = _json.loads(eval_output) if isinstance(eval_output, str) else eval_output
                                    merged_input["issues"] = eval_data.get("issues", []) if isinstance(eval_data, dict) else []
                                except Exception:
                                    pass
                    if agent_name == "code_writer":
                        best_text = self._executor._validator.find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["reference"] = best_text[:2000]
                        merged_input.setdefault("requirements", intent)
                    if agent_name == "code_writer_agent":
                        best_text = self._executor._validator.find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["reference"] = best_text[:2000]
                        merged_input.setdefault("requirements", intent)
                    step_input = merged_input
                elif not step_input and step_context:
                    step_input = {"topic": intent, "task": intent, "query": intent, **step_context}

                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": step_name, "label": step_name,
                    "order": step_order, "stage": step_name,
                })
                step_order += 1

                if step_type == "tool" or (tool_name and not agent_name):
                    tn = tool_name or step_name
                    ctx.event_bus.emit(ctx.task_id, "tool.start", {
                        "tool_name": tn,
                        "input": step_input or {"query": intent},
                        "step": step_name,
                    })

                    try:
                        result = await self._executor._execute_tool_or_agent(ctx, tn, step_input or {"query": intent})
                    except Exception as e:
                        result = {"success": False, "error": str(e)[:300]}

                    if isinstance(result, dict) and result.get("success") is False:
                        err_msg = result.get("error", "")
                        if "Unknown tool/agent" in err_msg:
                            logger.error(f"Critical failure: {err_msg}, aborting task", task_id=ctx.task_id)
                            raise RuntimeError(f"工具/Agent调用失败: {err_msg}")

                    ctx.event_bus.emit(ctx.task_id, "tool.end", {
                        "tool_name": tn,
                        "result": result,
                        "success": result.get("success", False),
                        "step": step_name,
                    })

                    search_failed = (
                        tn in _SEARCH_TOOLS
                        and isinstance(result, dict)
                        and (result.get("search_available") is False or not result.get("success", True))
                    )
                    search_empty = (
                        tn in _SEARCH_TOOLS
                        and isinstance(result, dict)
                        and result.get("success", True)
                        and isinstance(result.get("result"), dict)
                        and not result["result"].get("results")
                    )

                    if search_failed or search_empty:
                        logger.info(f"Search tool '{tn}' failed/empty, trying LLM WebChat fallback", task_id=ctx.task_id)
                        llm_search_result = await self._executor._llm_web_search_fallback(ctx, intent, model_hint, persona)
                        if llm_search_result:
                            step_results.append({
                                "step": step_name, "type": "tool", "tool": tn,
                                "result": llm_search_result,
                                "search_fallback": "llm_web_search",
                            })
                            step_context[f"_output_{tn}"] = llm_search_result
                            step_context["_last_output"] = llm_search_result
                        elif isinstance(result, dict) and result.get("search_available") is False:
                            step_results.append({
                                "step": step_name, "type": "tool", "tool": tn,
                                "result": result,
                                "search_unavailable": True,
                                "hint": "搜索服务不可用，请用LLM自身知识回答",
                            })
                        else:
                            step_results.append({"step": step_name, "type": "tool", "tool": tn, "result": result})
                    else:
                        if isinstance(result, dict) and result.get("search_available") is False:
                            step_results.append({
                                "step": step_name, "type": "tool", "tool": tn,
                                "result": result,
                                "search_unavailable": True,
                                "hint": "搜索服务不可用，请用LLM自身知识回答",
                            })
                        else:
                            step_results.append({"step": step_name, "type": "tool", "tool": tn, "result": result})
                            if result.get("success"):
                                extracted = self._executor._validator.extract_step_content({"step": step_name, "type": "tool", "result": result})
                                if extracted and len(extracted.strip()) > 10:
                                    step_context[f"_output_{tn}"] = extracted
                                    step_context["_last_output"] = extracted

                elif step_type == "agent" or agent_name:
                    an = agent_name or step_name
                    ctx.event_bus.emit(ctx.task_id, "tool.start", {
                        "tool_name": an,
                        "input": step_input or {"topic": intent, "task": intent},
                        "step": step_name,
                        "is_agent": True,
                    })

                    agent_input = step_input or {"topic": intent, "task": intent, "query": intent}
                    try:
                        result = await self._executor._execute_tool_or_agent(ctx, an, agent_input)
                    except Exception as e:
                        result = {"success": False, "error": str(e)[:300]}

                    if isinstance(result, dict) and result.get("success") is False:
                        err_msg = result.get("error", "")
                        if "Unknown tool/agent" in err_msg:
                            logger.error(f"Critical failure: {err_msg}, aborting task", task_id=ctx.task_id)
                            raise RuntimeError(f"工具/Agent调用失败: {err_msg}")

                    ctx.event_bus.emit(ctx.task_id, "tool.end", {
                        "tool_name": an,
                        "result": result,
                        "success": result.get("success", False),
                        "step": step_name,
                        "is_agent": True,
                    })
                    step_results.append({"step": step_name, "type": "agent", "agent": an, "result": result})
                    if result.get("success"):
                        extracted = self._executor._validator.extract_step_content({"step": step_name, "type": "agent", "result": result})
                        if extracted and len(extracted.strip()) > 10:
                            step_context[f"_output_{an}"] = extracted
                            step_context["_last_output"] = extracted

                    if an in _SEARCH_AGENTS and not result.get("success", True):
                        logger.info(f"Search agent '{an}' failed, trying LLM WebChat fallback", task_id=ctx.task_id)
                        llm_search_result = await self._executor._llm_web_search_fallback(ctx, intent, model_hint, persona)
                        if llm_search_result:
                            step_results.append({
                                "step": f"{step_name}_llm_fallback", "type": "tool", "tool": "llm_web_search",
                                "result": llm_search_result,
                                "search_fallback": "llm_web_search",
                            })
                            step_context[f"_output_{an}"] = llm_search_result
                            step_context["_last_output"] = llm_search_result

                else:
                    intent_type = plan.get("intent_type", "chat")
                    step_persona = persona
                    if any(kw in step_name.lower() for kw in ["audit", "review", "fact_check", "judge", "eval"]):
                        step_persona = "judge"
                    if intent_type == "translate":
                        system_prompt = get_prompt("modes.workflow.translate")
                    elif intent_type == "code":
                        system_prompt = get_prompt("modes.workflow.code")
                    else:
                        system_prompt = get_prompt("modes.workflow.general", step_name=step_name)

                    prompt = step_desc or intent
                    if step_context:
                        context_parts = []
                        for key, val in step_context.items():
                            if isinstance(val, str) and len(val.strip()) > 20 and key.startswith("_output_"):
                                context_parts.append(f"【{key}】\n{val[:2000]}")
                        if context_parts:
                            # 红线#11：从 prompts.yaml 加载（modes.workflow_chat.context_prefix）
                            context_template = get_prompt("modes.workflow_chat.context_prefix")
                            if context_template:
                                try:
                                    prompt = context_template.format(
                                        context="".join(context_parts),
                                        prompt=prompt,
                                    )
                                except (KeyError, ValueError, IndexError):
                                    prompt = f"以下是之前步骤的结果：\n\n{''.join(context_parts)}\n\n请基于以上信息，{prompt}"
                            else:
                                prompt = f"以下是之前步骤的结果：\n\n{''.join(context_parts)}\n\n请基于以上信息，{prompt}"
                    gen_messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ]

                    gen_content = ""
                    try:
                        gen_content = await self._executor._call_llm(ctx, gen_messages, model_hint, step_name, step_persona)
                    except Exception as e:
                        gen_content = f"生成失败: {str(e)[:200]}"

                    ctx.event_bus.emit(ctx.task_id, "step.intermediate", {
                        "step_name": step_name,
                        "content": gen_content[:1000],
                    })
                    step_results.append({"step": step_name, "type": "generate", "content": gen_content})
                    if gen_content and len(gen_content.strip()) > 10:
                        step_context[f"_output_{step_name}"] = gen_content
                        step_context["_last_output"] = gen_content

                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                    "step": step_name, "success": True,
                })

            # ── Compile ──
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "compile", "label": "整理输出",
                "order": step_order, "stage": "compile",
            })

            for i, sr in enumerate(step_results):
                extracted = self._executor._validator.extract_step_content(sr)
                is_err = is_error_content(extracted) if extracted else True
                logger.info(
                    f"Compile step_result[{i}]: step={sr.get('step')}, type={sr.get('type')}, "
                    f"agent={sr.get('agent')}, extracted_len={len(extracted) if extracted else 0}, "
                    f"is_error={is_err}, preview={extracted[:100] if extracted else 'None'}"
                )

            search_unavailable = any(sr.get("search_unavailable") for sr in step_results)
            any_step_failed = any(
                isinstance(sr.get("result"), dict) and sr["result"].get("success") is False
                for sr in step_results if sr.get("type") in ("agent", "tool")
            )
            any_step_error = any(
                "error" in str(sr.get("result", "")).lower() or "timeout" in str(sr.get("result", "")).lower()
                for sr in step_results
            )
            collected_json = json.dumps(step_results, ensure_ascii=False)[:6000]

            final_content = ""
            valid_step_parts = []
            _QUALITY_CHECK_AGENTS = {"article_eval", "article_reflect", "content_audit", "fact_check"}
            for sr in step_results:
                if sr.get("search_unavailable"):
                    continue
                if sr.get("agent") in _QUALITY_CHECK_AGENTS:
                    continue
                c = self._executor._validator.extract_step_content(sr)
                if c and len(c.strip()) > 20 and not is_error_content(c):
                    valid_step_parts.append(c)

            if valid_step_parts:
                final_content = "\n\n".join(valid_step_parts)
                logger.info(f"Compile: using {len(valid_step_parts)} step results directly ({len(final_content)} chars), skipping LLM call")

            if len(final_content.strip()) < 50:
                if search_unavailable or any_step_failed or any_step_error:
                    compile_system = get_prompt("modes.workflow.search_unavailable")
                    response_messages = [
                        {"role": "system", "content": compile_system},
                        {"role": "user", "content": intent},
                    ]
                else:
                    response_prompt = get_prompt("response.helm",
                        intent=intent, collected_context=collected_json)
                    response_messages = [
                        {"role": "system", "content": response_prompt},
                        {"role": "user", "content": f"请根据以上信息完成用户的任务：{intent}"},
                    ]

                try:
                    final_content = await self._executor._call_llm(ctx, response_messages, model_hint, "helm_assistant", persona)
                except Exception as e:
                    logger.error(f"Compile LLM call failed: {e}")
                    final_content = ""

            if len(final_content.strip()) < 50 and valid_step_parts:
                final_content = "\n\n".join(valid_step_parts)
                logger.info(f"Compile: LLM insufficient, using {len(valid_step_parts)} step results ({len(final_content)} chars)")
            elif len(final_content.strip()) < 50:
                final_content = "抱歉，处理您的请求时遇到了问题。请稍后重试。"

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "compile"})

        # ── Stage 3: Save to workspace files ──
        LONG_CONTENT_THRESHOLD = 800
        file_info = None
        if final_content and len(final_content) > LONG_CONTENT_THRESHOLD:
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "save", "label": "保存文件",
                "order": 99, "stage": "save",
            })

            safe_intent = re.sub(r'[^\w\u4e00-\u9fff]', '_', intent[:30]).strip('_') or "output"
            filename = f"{safe_intent}.md"

            from flowforge.core.workspace import get_workspace_manager
            ws = get_workspace_manager()
            file_info = ws.save_content_file(ctx.task_id, filename, final_content)

            if file_info:
                ctx.event_bus.emit(ctx.task_id, "draft.file", {
                    "filename": file_info["filename"],
                    "path": file_info["path"],
                    "size": file_info["size"],
                    "file_path": f"/api/v1/workspace/{ctx.task_id}/files/{file_info['path']}",
                })

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                "step": "save", "file_info": file_info,
            })

        # ── Final draft update ──
        draft_payload = {
            "content": final_content,
            "is_partial": False,
            "agent_name": "helm_assistant",
        }
        if final_content and len(final_content) > LONG_CONTENT_THRESHOLD:
            draft_payload["saved_to_file"] = True
            draft_payload["content_preview"] = final_content[:300] + "..."
            if file_info:
                draft_payload["file_path"] = f"/api/v1/workspace/{ctx.task_id}/files/{file_info['path']}"
                draft_payload["filename"] = file_info["filename"]
        ctx.event_bus.emit(ctx.task_id, "draft.update", draft_payload)

        result = {
            **context_data,
            "response": final_content,
            "plan": plan,
        }
        await self._executor._save_to_memory(ctx, intent, result, plan)
        return result

    async def simple_response(self, ctx, context_data: dict,
                               model_hint: str, persona: str, intent: str) -> dict:
        """Fast-path: generate a response without planning phase (1 LLM call only)."""
        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "response", "label": "生成回复",
            "order": 1, "stage": "response",
        })

        recalled = await self._executor._recall_memories(ctx, intent)

        response_prompt = get_prompt("response.simple")
        response_messages = [
            {"role": "system", "content": response_prompt},
            {"role": "user", "content": intent},
        ]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                response_messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        final_content = ""
        try:
            final_content = await self._executor._call_llm(ctx, response_messages, model_hint, "helm_assistant", persona)
        except Exception as e:
            final_content = f"生成回复失败: {str(e)[:200]}"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "response"})

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content,
            "is_partial": False,
            "agent_name": "helm_assistant",
        })

        result = {
            **context_data,
            "response": final_content,
            "plan": {"intent_type": "chat", "complexity": "simple", "plan": []},
        }
        await self._executor._save_to_memory(ctx, intent, result, result["plan"])
        return result

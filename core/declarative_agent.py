"""Declarative Agent Definition — No inheritance, pure configuration.

Inspired by OpenAI Agents SDK's approach: agents are defined through
declarative configuration rather than class inheritance. This reduces
boilerplate and makes agent definitions portable.

Usage:
    from flowforge.core.declarative_agent import agent, DeclarativeAgent

    # Method 1: Decorator
    @agent(
        name="content_writer",
        description="Writes high-quality content articles",
        model="DeepSeek-V4-Pro",
        tools=["web_search", "rag_search"],
        handoffs=["review_agent", "seo_agent"],
        guardrails=["content_safety"],
    )
    async def write_content(task: str, style: str = "professional") -> str:
        '''Write content based on the task.'''
        # The function body is the agent's execute logic
        ...

    # Method 2: Config dict
    writer = DeclarativeAgent.from_config({
        "name": "content_writer",
        "description": "Writes high-quality content articles",
        "model": "DeepSeek-V4-Pro",
        "tools": ["web_search", "rag_search"],
        "instructions": "You are a professional content writer...",
        "handoffs": ["review_agent", "seo_agent"],
    })

    # Method 3: YAML file
    writer = DeclarativeAgent.from_yaml("agents/content_writer.yaml")
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.core.tracing import get_logger

logger = get_logger("declarative_agent")


# ── Configuration model ──────────────────────────────────────────────


class ExecutionPolicy(BaseModel):
    """Agent execution policy — timeout, retry, and error handling."""
    timeout: int = Field(default=300, description="Max execution time in seconds")
    retry: int = Field(default=0, description="Max retry attempts on failure")
    on_error: str = Field(
        default="raise",
        description="Error handling strategy: raise | fallback | skip",
    )
    on_anomaly: str = Field(
        default="log",
        description="Anomaly handling: log | retry | abort",
    )


class CheckpointConfig(BaseModel):
    """Agent checkpoint configuration."""
    enabled: bool = Field(default=False, description="Enable checkpointing")
    mode: str = Field(default="step", description="Checkpoint mode: step | state")
    interrupt_before: List[str] = Field(
        default_factory=list, description="Step names to interrupt before"
    )
    persist_fields: List[str] = Field(
        default_factory=list, description="State fields to persist in checkpoint"
    )


class AgentConfig(BaseModel):
    """Declarative agent configuration.

    All fields are optional at the Pydantic level so that partial
    configs (e.g. from a YAML file) can be loaded and merged.
    However, ``name`` is required for a usable agent.

    Attributes:
        name: Unique agent identifier (namespace format: project:agent_name).
        description: Human-readable purpose description.
        model: Preferred LLM model (provider/model_id or short name).
        model_params: Per-agent model parameters (temperature, top_p, etc.).
        tools: List of tool names this agent can use.
        instructions: System prompt / instructions for LLM-based execution.
        prompt_template: Key in prompts.yaml for loading instructions.
        execution_mode: Execution mode (react/reflexion/plan_execute/rewoo/graph_of_thoughts/single).
        persona: Persona configuration for auto-injection (SOUL/MEMORY/CREATION).
        input_mapping: Map input params from state/params/result/outputs.
        output_key: Key in workflow state to store this agent's output.
        handoffs: List of agent names this agent can delegate to.
        guardrails: List of guardrail names to enforce.
        execution_policy: Timeout, retry, and error handling.
        checkpoint: Checkpoint and interrupt configuration.
        fallback_chain: Ordered list of tool/agent names for fallback.
        post_processors: List of post-processor names to apply to output.
        metadata: Arbitrary metadata for plugins and extensions.
    """

    name: str = Field(..., description="Unique agent identifier")
    description: str = Field(default="", description="Agent purpose")
    model: Optional[str] = Field(
        default=None, description="Preferred LLM model"
    )
    model_params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Per-agent model parameters (temperature, top_p, max_tokens, etc.)",
    )
    tools: List[str] = Field(
        default_factory=list, description="Tool names this agent can use"
    )
    instructions: Optional[str] = Field(
        default=None, description="System prompt for LLM-based execution"
    )
    prompt_template: Optional[str] = Field(
        default=None,
        description="Key in prompts.yaml for loading instructions",
    )
    execution_mode: str = Field(
        default="single",
        description="Execution mode: single/react/reflexion/plan_execute/rewoo/graph_of_thoughts",
    )
    persona: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Persona config for auto-injection: {persona_id, sections: [soul, memory, creation]}",
    )
    input_mapping: Dict[str, str] = Field(
        default_factory=dict,
        description="Map input params: {param_name: '${state.xxx}' or '${params.xxx}'}",
    )
    output_key: Optional[str] = Field(
        default=None,
        description="Key in workflow state to store this agent's output",
    )
    handoffs: List[str] = Field(
        default_factory=list,
        description="Agent names this agent can delegate to",
    )
    guardrails: List[str] = Field(
        default_factory=list, description="Guardrail names to enforce"
    )
    execution_policy: Optional[ExecutionPolicy] = Field(
        default=None, description="Timeout, retry, and error handling"
    )
    checkpoint: Optional[CheckpointConfig] = Field(
        default=None, description="Checkpoint and interrupt configuration"
    )
    fallback_chain: List[str] = Field(
        default_factory=list,
        description="Ordered list of tool/agent names for fallback execution",
    )
    post_processors: List[str] = Field(
        default_factory=list,
        description="Post-processor names: deai_postprocess, quality_filter, word_count_check, etc.",
    )
    prefer_api: Optional[bool] = Field(
        default=None,
        description="Prefer API backend over WebChat backend to avoid session timeout (P0-5)",
    )
    prefer_tool_direct: bool = Field(
        default=False,
        description="Skip initial LLM call and directly execute first tool in fallback_chain. "
                    "Useful when agent is a tool wrapper (e.g., writer_engine, editor_engine) "
                    "and the webchat LLM doesn't reliably call tools. Saves ~50s per agent.",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Arbitrary metadata"
    )


# ── DeclarativeAgent ─────────────────────────────────────────────────


class DeclarativeAgent(BaseAgent):
    """A BaseAgent driven purely by declarative configuration.

    If an ``execute_fn`` is provided (e.g. from the ``@agent`` decorator),
    it is used directly.  Otherwise, a default LLM-based execution is
    used: the agent's ``instructions`` and the task input are composed
    into messages and sent through :class:`ModelCapability`.

    Attributes:
        config: The :class:`AgentConfig` driving this agent.
        _execute_fn: Optional custom execute function.
        _is_async: Whether the custom execute function is async.
    """

    def __init__(
        self,
        config: AgentConfig,
        execute_fn: Optional[Callable] = None,
    ) -> None:
        super().__init__()
        self.config = config
        self.name = config.name
        self.description = config.description
        self.default_mode = None
        self._execute_fn = execute_fn
        self._is_async = (
            asyncio.iscoroutinefunction(execute_fn)
            if execute_fn is not None
            else False
        )

    async def execute(self, input: AgentInput) -> AgentOutput:
        """Execute the agent logic.

        If a custom ``execute_fn`` was provided, it is called with the
        input params as keyword arguments.  Otherwise, the default
        LLM-based execution path is used.

        When config declares guardrails, they are checked before and
        after execution.  When config declares tools, they are resolved
        from ToolRegistry and passed to the LLM as function-calling
        tools.  When config declares handoffs, the LLM response is
        inspected for handoff signals and delegated accordingly.
        """
        # ── Input guardrails ──────────────────────────────────────
        if self.config.guardrails:
            input_text = input.params.get("task", input.params.get("intent", ""))
            if not input_text:
                input_text = str(input.params)[:2000]
            guardrail_block = await self._run_input_guardrails(input_text, input.params)
            if guardrail_block is not None:
                return guardrail_block

        # ── Core execution ────────────────────────────────────────
        if self._execute_fn is not None:
            output = await self._execute_custom(input)
        else:
            output = await self._execute_llm(input)

        # ── Output guardrails ─────────────────────────────────────
        if self.config.guardrails:
            output_text = output.result.get("content", "") if output.result else ""
            guardrail_block = await self._run_output_guardrails(output_text, output.result)
            if guardrail_block is not None:
                return guardrail_block

        # ── Handoff check ─────────────────────────────────────────
        if self.config.handoffs:
            handoff_output = await self._check_and_execute_handoff(output, input)
            if handoff_output is not None:
                return handoff_output

        return output

    # ── Custom execution ────────────────────────────────────────────

    async def _execute_custom(self, input: AgentInput) -> AgentOutput:
        """Delegate to the user-provided execute function."""
        try:
            if self._is_async:
                result = await self._execute_fn(**input.params)
            else:
                result = self._execute_fn(**input.params)

            if isinstance(result, AgentOutput):
                return result
            if isinstance(result, dict):
                return AgentOutput(result=result)
            return AgentOutput(
                result={"result": result} if result is not None else {}
            )
        except Exception as e:
            logger.error(
                f"DeclarativeAgent '{self.name}' custom execution failed: {e}"
            )
            return AgentOutput(result={"error": str(e)})

    # ── Default LLM-based execution ─────────────────────────────────

    async def _execute_llm(self, input: AgentInput) -> AgentOutput:
        """Default execution: build messages and call LLMClient.

        Supports:
        - prompt_template: load instructions from prompts.yaml
        - persona: auto-inject SOUL/MEMORY/CREATION via PersonaInjector
        - model_params: per-agent temperature/top_p/max_tokens
        - execution_mode: route to appropriate mode executor
        - fallback_chain: try tools in order on failure
        - post_processors: apply transformations to output
        """
        from flowforge.core.base_tool import ToolInput
        from flowforge.core.model_capability import ModelCapability

        # 1. Resolve instructions: prompt_template > instructions > description
        instructions = self.config.instructions or self.description or (
            f"You are the {self.name} agent."
        )

        # Load from prompts.yaml if prompt_template is set
        # 修复"组合提示词bug"：当 execution_mode 非 single 且配置了 tools 时，跳过 prompt_template 加载
        # 因为复杂 prompt_template（如 contentforge.writer.main）含 {writing_methods_text}、
        # {viral_types_text} 等占位符，只能由对应 tool（如 writer_engine）内部完整渲染
        # DeclarativeAgent 的 _render_template_vars 无法渲染这些复杂占位符，会导致 LLM 收到
        # 残缺 prompt 返回 "OK"。此时保留简单的 instructions 字段作为 system_prompt 即可
        skip_prompt_template = (
            self.config.execution_mode not in ("single", "")
            and bool(self.config.tools)
        )
        if self.config.prompt_template and not skip_prompt_template:
            try:
                from flowforge.core.prompt_manager import PromptManager
                pm = PromptManager()
                loaded = pm.get(self.config.prompt_template)
                if loaded:
                    instructions = loaded
            except Exception as e:
                logger.debug(f"Agent '{self.name}': prompt_template load failed: {e}")

        # 1.5 Loop 反思重写检测 — 当存在评委反馈和草稿时，使用反思重写 prompt
        # 把反思重写逻辑从 writer_engine.py 迁移到 DeclarativeAgent 层，
        # 让 execution_mode=reflexion 且 tools 为空的 writer agent 也能基于评委反馈重写
        loop_reflections = input.params.get("loop_reflections", []) if input.params else []
        loop_verifier_errors = input.params.get("loop_verifier_errors", []) if input.params else []
        existing_draft = input.params.get("draft", "") if input.params else ""

        all_feedback = list(loop_reflections) + list(loop_verifier_errors)

        if all_feedback and existing_draft and len(str(existing_draft)) > 10:
            # 反思重写模式：使用 refine prompt 替换首次创作 prompt
            logger.info(
                f"[declarative_agent] Loop feedback detected for '{self.name}': "
                f"{len(all_feedback)} items, draft length={len(str(existing_draft))}, using refine prompt"
            )
            instructions = self._load_refine_prompt(all_feedback, str(existing_draft), input)
        # 否则保持首次创作 instructions 不变

        # 2. Persona auto-injection
        if self.config.persona:
            try:
                from flowforge.core.persona_injector import PersonaInjector
                injector = PersonaInjector()
                persona_id = self.config.persona.get("persona_id", "")
                # Resolve template variables like ${config.persona}
                if persona_id and persona_id.startswith("${") and persona_id.endswith("}"):
                    resolved = self._resolve_ref(persona_id, input)
                    if resolved:
                        persona_id = str(resolved)
                    else:
                        # Fallback: try to get persona from input params or state
                        persona_id = input.params.get("persona", "") or (input.state.get("persona", "") if input.state else "") or ""
                sections = self.config.persona.get("sections", ["soul", "memory", "creation"])
                if persona_id:
                    instructions = await injector.inject(instructions, persona_id, sections)
                    logger.info(f"Agent '{self.name}': persona '{persona_id}' injected")
            except Exception as e:
                logger.debug(f"Agent '{self.name}': persona injection failed: {e}")

        # 3. Apply input_mapping
        if self.config.input_mapping:
            mapped_params = {}
            for key, ref in self.config.input_mapping.items():
                val = self._resolve_ref(ref, input)
                if val is not None:
                    mapped_params[key] = val
            input.params.update(mapped_params)

        # 3.5 渲染模板变量 — 把 {xxx} 占位符用 input.params/state 的值替换
        # 必须在 input_mapping 之后(映射字段已展平到 params)、persona 注入之后(persona 占位符已替换)
        # 避免 prompt_template 原文(含 {platform_name} {topic_title} 等占位符)直接发给 LLM
        # 通用智能提取:支持 {topic_title} <- topic_list[0].title 等嵌套字段
        # persona 占位符({soul_intro}{soul}{memory}{creation})若仍残留则保留
        instructions = self._render_template_vars(instructions, input)
        if self.config.prompt_template:
            unresolved = re.findall(r'\{([a-zA-Z_][a-zA-Z0-9_]*)\}', instructions)
            if unresolved:
                logger.info(f"[declarative_agent] Agent '{self.name}' 模板渲染后剩余占位符: {unresolved}")

        # 4. Append handoff prompt to instructions if handoffs are configured
        if self.config.handoffs:
            handoff_prompt = self._build_handoff_prompt()
            if handoff_prompt:
                instructions = instructions + "\n\n" + handoff_prompt

        # 5. Route to execution mode
        mode = self.config.execution_mode
        if mode and mode not in ("single",):
            mode_output = await self._execute_via_mode(mode, input, instructions)
            if mode_output is not None:
                # Apply post_processors
                mode_output = await self._apply_post_processors(mode_output)
                return mode_output

        # 6. Default single-shot LLM execution
        # v2.6 性能优化: prefer_tool_direct=True 时跳过初始 LLM 调用，直接执行 fallback_chain 中的工具
        # 原因: webchat 模型（如 Doubao-Seed2.0）不 reliably 调用 function-calling tools，
        # 初始 LLM 调用（~50s）被浪费。跳过后直接调用 writer_engine/editor_engine 节省时间。
        if self.config.prefer_tool_direct and self.config.fallback_chain:
            logger.info(
                f"Agent '{self.name}': prefer_tool_direct=True, skipping initial LLM call, "
                f"directly executing fallback_chain={self.config.fallback_chain}"
            )
            fallback_result = await self._execute_fallback_chain(input, instructions)
            if fallback_result is not None:
                return await self._apply_post_processors(fallback_result)
            return AgentOutput(result={"error": "prefer_tool_direct fallback returned None", "content": ""})

        task = input.params.get("task", input.params.get("intent", ""))
        if not task:
            task = str(input.params)[:2000]

        mc = ModelCapability()
        model = self.config.model or ""

        # Resolve tool schemas from ToolRegistry if config.tools is set
        tools_schema: Optional[list] = None
        if self.config.tools:
            tools_schema = self._resolve_tools_schema()

        # Build model_params from config
        model_kwargs: Dict[str, Any] = {}
        if self.config.model_params:
            model_kwargs.update(self.config.model_params)

        try:
            llm_result = await mc.chat(
                prompt=task,
                system=instructions,
                model=model,
                agent_name=self.name,
                tools=tools_schema,
                **model_kwargs,
            )
        except Exception as e:
            logger.warning(
                f"Agent '{self.name}': LLM call failed: {e}; "
                f"attempting fallback_chain"
            )
            # P0-12: LLM 调用失败时也触发 fallback_chain 直接调用工具
            if self.config.fallback_chain:
                fallback_result = await self._execute_fallback_chain(input, instructions)
                if fallback_result is not None:
                    return await self._apply_post_processors(fallback_result)
            return AgentOutput(result={"error": str(e)[:200], "content": ""})

        # Handle tool_calls from LLM response
        tool_calls = llm_result.get("tool_calls", [])
        tool_results: List[Dict[str, Any]] = []
        if tool_calls:
            tool_results = await self._execute_tool_calls(tool_calls, input)

        # Handle fallback_chain if primary execution returns empty, too short,
        # OR when agent has tools but LLM didn't call them.
        # P0-12: LLM 可能返回短文本而非调用工具，fallback_chain 应触发直接调用工具
        # P0-15: 当 agent 配置了 tools 但 LLM 未返回 tool_calls 时，
        # 说明 LLM 未按指令调用工具（如生成了无关内容），应强制触发 fallback
        content_str = llm_result.get("content", "") or ""
        should_fallback = False
        if self.config.fallback_chain:
            if not content_str or len(content_str) < 50:
                should_fallback = True
            elif tools_schema and not tool_calls:
                # Agent was given tools but didn't call them → LLM failed to follow instructions
                logger.warning(
                    f"Agent '{self.name}': LLM returned content (len={len(content_str)}) "
                    f"but did not call any tools despite having tools configured. "
                    f"Triggering fallback_chain."
                )
                should_fallback = True
        if should_fallback:
            fallback_result = await self._execute_fallback_chain(input, instructions)
            if fallback_result is not None:
                return await self._apply_post_processors(fallback_result)

        result: Dict[str, Any] = {
            "content": llm_result.get("content", ""),
            "provider": llm_result.get("provider", ""),
            "model": llm_result.get("model", ""),
        }
        if tool_results:
            result["tool_results"] = tool_results

        # Map output to output_key if configured
        state_updates: Dict[str, Any] = {}
        if self.config.output_key:
            state_updates[self.config.output_key] = result

        metadata: Dict[str, Any] = {
            "tokens": llm_result.get("tokens", 0),
            "agent_type": "declarative",
            "config_model": self.config.model,
            "execution_mode": mode,
        }
        if tool_calls:
            metadata["tool_calls_count"] = len(tool_calls)
        if tool_results:
            metadata["tool_results_count"] = len(tool_results)

        output = AgentOutput(result=result, metadata=metadata, state_updates=state_updates)
        return await self._apply_post_processors(output)

    def _render_template_vars(self, template: str, input: AgentInput) -> str:
        """渲染模板变量 — 用 input.params/state/metadata 的值替换 {xxx} 占位符。

        通用逻辑,不写死业务领域:
        1. 用正则匹配所有 {xxx} 占位符
        2. 从 input.params / input.state / input.metadata 查找同名 key
        3. 智能提取值(str 直接用,list 取第一个元素的 title/name,text 取前 N 字)
        4. 通用嵌套字段提取: {topic_title} <- topic_list[0].title / topic.title
        5. 组合字段提取: {xxx_section} <- 拼接 xxx/xxx_list/xxxes 等变量内容
        6. persona 占位符({soul_intro}{soul}{memory}{creation})保留给 PersonaInjector
        7. 找不到值时用空字符串替换,避免 LLM 看到原始 {xxx}
        """
        if not template or not input:
            return template

        # persona 占位符保留列表 — 由 PersonaInjector 注入
        _PERSONA_VARS = {"soul_intro", "soul", "memory", "creation"}

        # 收集所有可用变量
        variables: dict = {}
        if input.params:
            variables.update(input.params)
        if input.state:
            for k, v in input.state.items():
                if k not in variables:
                    variables[k] = v
        if hasattr(input, 'metadata') and input.metadata:
            for k, v in input.metadata.items():
                if k not in variables:
                    variables[k] = v

        # 匹配所有 {xxx} 占位符(不匹配 {{xxx}} 双花括号)
        pattern = re.compile(r'(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})')

        def _extract_value(val) -> str:
            """智能提取值的字符串表示"""
            if isinstance(val, str):
                return val
            elif isinstance(val, (int, float)):
                return str(val)
            elif isinstance(val, list):
                if not val:
                    return ""
                first = val[0]
                if isinstance(first, str):
                    return first
                elif isinstance(first, dict):
                    # 取 title/name/angle/content/text 字段
                    for field in ("title", "name", "angle", "content", "text"):
                        fv = first.get(field)
                        if isinstance(fv, str) and fv.strip():
                            return fv
                    return ""
                return ""
            elif isinstance(val, dict):
                for field in ("content", "output", "title", "name", "text", "result"):
                    fv = val.get(field)
                    if isinstance(fv, str) and fv.strip():
                        return fv
                return ""
            else:
                return str(val)[:500]

        def _smart_extract_nested(var_name: str) -> Optional[str]:
            """通用智能嵌套字段提取(不写死业务字段名)

            规则:
            1. {xxx_section}: 拼接 xxx/xxx_list/xxxes/xxx_materials 等变量的内容为 section 文本
            2. {prefix_suffix}: 在 variables 里找 prefix_list/prefix/prefixes,从 list[0] 或 dict 提取 suffix 字段
               例如 {topic_title} <- topic_list[0].title / topic.title
               例如 {topic_angle} <- topic_list[0].angle / topic.angle
            """
            # 规则1: 组合字段 xxx_section
            if var_name.endswith("_section"):
                prefix = var_name[:-len("_section")]
                candidate_keys = [prefix, prefix + "_list", prefix + "s", prefix + "es",
                                  prefix + "_materials", "research_" + prefix,
                                  "research_" + prefix + "s", "research_" + prefix + "_list",
                                  prefix + "_items", prefix + "_data"]
                for ck in candidate_keys:
                    if ck in variables:
                        val = variables[ck]
                        if isinstance(val, list):
                            parts = []
                            for item in val:
                                if isinstance(item, dict):
                                    content = item.get("content") or item.get("text") or item.get("summary") or item.get("title") or ""
                                    if content and str(content).strip():
                                        parts.append(str(content))
                                elif isinstance(item, str) and item.strip():
                                    parts.append(item)
                            if parts:
                                return "## 参考资料\n" + "\n\n".join(parts)
                        elif isinstance(val, str) and val.strip():
                            return val
                return ""

            # 规则2: 嵌套字段 prefix_suffix <- prefix_list[0].suffix
            parts = var_name.split("_")
            if len(parts) >= 2:
                # 尝试多种前缀拆分: topic_title -> (topic, title) 或 (topic_t, itle)
                # 优先取最后一段作为字段名
                prefix = "_".join(parts[:-1])
                suffix = parts[-1]
                candidate_var_keys = [prefix, prefix + "_list", prefix + "s", prefix + "es",
                                      prefix + "_items", prefix + "_data"]
                for vk in candidate_var_keys:
                    if vk in variables:
                        val = variables[vk]
                        if isinstance(val, list) and val:
                            first = val[0]
                            if isinstance(first, dict):
                                fv = first.get(suffix)
                                if isinstance(fv, str) and fv.strip():
                                    return fv
                                # 字段名变体: title/name/angle
                                for alt in (suffix, "title" if suffix == "name" else "",
                                            "name" if suffix == "title" else ""):
                                    if alt and alt in first:
                                        av = first[alt]
                                        if isinstance(av, str) and av.strip():
                                            return av
                        elif isinstance(val, dict):
                            fv = val.get(suffix)
                            if isinstance(fv, str) and fv.strip():
                                return fv
            return None

        def replace_match(m):
            var_name = m.group(1)
            # persona 占位符保留,给 PersonaInjector 注入
            if var_name in _PERSONA_VARS:
                return m.group(0)
            # 1. 直接匹配: variables["topic_title"] = "xxx"
            if var_name in variables:
                extracted = _extract_value(variables[var_name])
                if extracted:
                    return extracted
                # 值存在但提取为空(如空列表),用空字符串替换
                return ""
            # 2. 通用智能嵌套提取: {topic_title} <- topic_list[0].title
            smart_val = _smart_extract_nested(var_name)
            if smart_val is not None:
                return smart_val
            # 3. 找不到的配置类占位符用空字符串替换,避免 LLM 看到原始 {xxx}
            return ""

        return pattern.sub(replace_match, template)

    def _load_refine_prompt(self, feedback: list, draft: str, input: AgentInput) -> str:
        """加载反思重写 prompt，注入评委反馈和草稿。

        把反思重写逻辑从 writer_engine.py 迁移到 DeclarativeAgent 层，
        让 execution_mode=reflexion 且 tools 为空的 writer agent 也能基于评委反馈重写。

        优先从 prompts.yaml 加载 refine 模板（按 agent 名称和通用 key 依次查找），
        如果模板不存在则构建内联 refine prompt。

        Args:
            feedback: 评委反馈列表（loop_reflections + loop_verifier_errors 合并）。
            draft: 上一轮创作的草稿内容。
            input: Agent 输入，用于解析额外的上下文变量。

        Returns:
            渲染后的反思重写 prompt 字符串。
        """
        # 尝试从 prompts.yaml 加载 refine 模板
        template = ""
        try:
            from flowforge.core.prompt_manager import PromptManager
            pm = PromptManager()
            # 按优先级查找 refine 模板
            candidate_keys = [
                f"{self.name}.refine_with_reflections",
                "contentforge.writer.refine_with_reflections",
                "writer_agent_reflection",
            ]
            for key in candidate_keys:
                loaded = pm.get(key)
                if loaded:
                    template = loaded
                    logger.info(f"[declarative_agent] Loaded refine prompt template: '{key}'")
                    break
        except Exception as e:
            logger.debug(f"[declarative_agent] Failed to load refine prompt template: {e}")

        # 最多取 20 条反馈，避免 prompt 过长
        feedback_items = [str(f) for f in feedback[:20] if f]
        feedback_text = "\n".join(f"- {f}" for f in feedback_items)

        # 加载评委维度评分标准（模板中可能引用 {judge_dimensions_guide}）
        judge_dimensions_guide = ""
        try:
            from flowforge.core.prompt_manager import PromptManager
            pm = PromptManager()
            guide_keys = [
                f"{self.name}.judge_dimensions_guide",
                "contentforge.writer.judge_dimensions_guide",
            ]
            for gk in guide_keys:
                loaded_guide = pm.get(gk)
                if loaded_guide:
                    judge_dimensions_guide = loaded_guide
                    break
        except Exception:
            pass

        if template:
            # Phase 5.5 修复: 模板可能含大量上下文占位符（soul_intro/iteration_round/platform_name 等）
            # 这些占位符由 writer_engine 工具负责渲染，DeclarativeAgent 只替换自己提供的4个变量
            # 使用正则替换避免 KeyError，未匹配的占位符替换为空字符串
            import re
            rendered = template
            replacements = {
                "existing_draft": draft,
                "feedback_text": feedback_text,
                "verifier_info": "\n".join(feedback_items[:10]),
                "judge_dimensions_guide": judge_dimensions_guide,
            }
            for key, value in replacements.items():
                rendered = rendered.replace("{" + key + "}", str(value))
            # 移除其他未替换的占位符（避免 LLM 看到原始 {xxx}）
            rendered = re.sub(r'\{[a-z_]+\}', '', rendered)
            logger.info(f"[declarative_agent] Refined prompt rendered (len={len(rendered)})")
            return rendered

        # 模板不存在：从 prompts.yaml 加载兜底 refine prompt（键 flowforge.loop.refine_fallback）
        # 消除硬编码提示词（编程红线#11）；占位符 {draft} {feedback_text}
        try:
            from flowforge.core.prompt_manager import get_prompt
            loaded = get_prompt(
                "flowforge.loop.refine_fallback",
                fallback="",
                draft=draft,
                feedback_text=feedback_text,
            )
            if loaded:
                logger.info(f"[declarative_agent] Loaded refine_fallback from prompts.yaml (len={len(loaded)})")
                return loaded
        except Exception as e:
            logger.debug(f"[declarative_agent] Failed to load refine_fallback from prompts.yaml: {e}")

        # prompts.yaml 也未命中：使用内联兜底（与 prompts.yaml 默认值保持一致）
        return f"""你是资深内容创作者。以下是上一轮创作的文章和评委的改进建议，请根据建议重写文章。

## 上一轮文章
{draft}

## 评委改进建议（必须逐条落实）
{feedback_text}

## 要求
1. 针对每条评委建议，在文章中做出实质性改进
2. 保留原文的优点和有效内容
3. 重点关注低分维度
4. 输出完整的中文Markdown文章，第一行必须是 # 标题
"""

    def _resolve_ref(self, ref: str, input: AgentInput) -> Any:
        """Resolve a variable reference like '${{state.xxx}}' or '${params.xxx}'.

        Supports both ${{prefix.path}} (project standard) and ${prefix.path} (legacy) formats.
        """
        if not ref.startswith("${") or not ref.endswith("}"):
            return ref
        # v5.9修复: 支持 ${{...}} 双花括号格式（项目标准）
        # 原代码只处理 ${...} 单花括号，导致 ${{params.draft}} 解析失败返回None
        path = ref[2:-1]  # Remove ${ and }
        # 去除可能的内层花括号: {params.draft} → params.draft
        if path.startswith("{") and path.endswith("}"):
            path = path[1:-1]
        parts = path.split(".", 1)
        if len(parts) != 2:
            return None
        source, key = parts
        if source == "state":
            return input.state.get(key) if input.state else None
        elif source == "params":
            return input.params.get(key)
        elif source == "result":
            return input.state.get(f"result.{key}") if input.state else None
        elif source == "outputs":
            return input.state.get(f"outputs.{key}") if input.state else None
        elif source == "metadata":
            # metadata可能在input.metadata或input.params中（workflow_executor合并后）
            val = None
            if hasattr(input, 'metadata') and input.metadata:
                val = input.metadata.get(key)
            if val is None and hasattr(input, 'params') and input.params:
                val = input.params.get(key)
            return val
        elif source == "config":
            # config来源: 从input.params中查找（通常在初始化时注入）
            return input.params.get(key)
        return None

    async def _execute_via_mode(
        self, mode: str, input: AgentInput, instructions: str
    ) -> Optional[AgentOutput]:
        """Route to the appropriate execution mode executor."""
        try:
            from flowforge.core.task_context import TaskContext

            # Build TaskContext for mode executors
            # Inherit tools/agents/event_bus from parent context if available
            parent_ctx = self._context
            # P0-5: 将 prefer_api 注入 input_data，让 reflexion executor 能转发给 DefaultLLMActor
            mode_input_data = dict(input.params)
            if self.config.prefer_api is not None:
                mode_input_data["prefer_api"] = self.config.prefer_api

            # 关键修复（迭代超时 draft 丢失根因）：
            # 原 task_context 创建时 state 字段未传（默认为新建 dict），
            # input_data/metadata 也是新建/拷贝，不共享 parent_ctx 引用。
            # 导致 ReflexionExecutor 写入 ctx.state["draft"]/ctx.input_data["draft"] 后，
            # LoopExecutor 的 task.state/task.input_data 找不到 draft（迭代超时恢复失败）。
            # 修复：共享 parent_ctx 的 state/input_data/metadata 引用，让 draft 立即可见。
            if parent_ctx is not None:
                # 共享 state 引用 — mode executor 写入的 draft 立即对 LoopExecutor 可见
                shared_state = parent_ctx.state if isinstance(parent_ctx.state, dict) else {}
                # 共享 input_data 引用，并把 mode_input_data 的额外字段合并进去
                shared_input = parent_ctx.input_data if isinstance(parent_ctx.input_data, dict) else {}
                # 把 mode_input_data 的额外字段合并进 parent_ctx.input_data（共享引用）
                for k, v in mode_input_data.items():
                    if k not in shared_input or shared_input.get(k) != v:
                        shared_input[k] = v
                # 共享 metadata 引用，合并新值
                shared_metadata = parent_ctx.metadata if isinstance(parent_ctx.metadata, dict) else {}
                if "persona" not in shared_metadata:
                    shared_metadata["persona"] = input.params.get("persona", "")
                task_context = TaskContext(
                    task_id=input.params.get("task_id", self.name),
                    input_data=shared_input,           # 共享 parent_ctx.input_data 引用
                    metadata=shared_metadata,           # 共享 parent_ctx.metadata 引用
                    state=shared_state,                # 共享 parent_ctx.state 引用
                    tools=parent_ctx.tools,
                    agents=parent_ctx.agents,
                    event_bus=parent_ctx.event_bus,
                    persona=input.params.get("persona", ""),
                )
            else:
                # 无 parent_ctx：保持原行为（向后兼容单元测试）
                task_context = TaskContext(
                    task_id=input.params.get("task_id", self.name),
                    input_data=mode_input_data,
                    metadata={"persona": input.params.get("persona", "")},
                    tools=None,
                    agents=None,
                    event_bus=None,
                    persona=input.params.get("persona", ""),
                )
            # B2 修复：在 TaskContext 创建时立即填充 instructions 字段
            # 确保 prompt_template 加载的 instructions 传递到 reflexion 执行器
            # （_run_mode_executor 也会设置，但此处提前设置确保所有代码路径可用）
            task_context.instructions = instructions

            if mode == "react":
                from flowforge.modes.react import ReactModeExecutor
                executor = ReactModeExecutor()
                return await self._run_mode_executor(executor, task_context, instructions)
            elif mode == "reflexion":
                from flowforge.modes.reflexion import ReflexionExecutor
                executor = ReflexionExecutor()
                return await self._run_mode_executor(executor, task_context, instructions)
            elif mode == "plan_execute":
                from flowforge.modes.plan_execute import PlanExecuteModeExecutor
                executor = PlanExecuteModeExecutor()
                return await self._run_mode_executor(executor, task_context, instructions)
            elif mode == "rewoo":
                from flowforge.modes.rewoo import ReWooModeExecutor
                executor = ReWooModeExecutor()
                return await self._run_mode_executor(executor, task_context, instructions)
            elif mode == "graph_of_thoughts":
                from flowforge.modes.graph_of_thoughts import GraphOfThoughtsModeExecutor
                executor = GraphOfThoughtsModeExecutor()
                return await self._run_mode_executor(executor, task_context, instructions)
            else:
                logger.warning(f"Agent '{self.name}': unknown execution_mode '{mode}', falling back to single")
                return None
        except ImportError as e:
            logger.warning(f"Agent '{self.name}': mode '{mode}' not available: {e}, falling back to single")
            return None
        except Exception as e:
            logger.error(f"Agent '{self.name}': mode '{mode}' execution failed: {e}")
            return None

    async def _run_mode_executor(
        self, executor: Any, task_context: Any, instructions: str
    ) -> AgentOutput:
        """Run a mode executor and convert result to AgentOutput."""
        try:
            # Set agent info on task_context
            task_context.agent_name = self.name
            task_context.instructions = instructions
            task_context.model = self.config.model or ""
            # 修复"组合提示词bug"：不要用 config.tools（工具名列表，如 ["writer_engine"]）
            # 覆盖 task_context.tools（真正的 ToolRegistry 对象，来自 parent_ctx）
            # 否则 DefaultLLMActor 访问 ctx.tools.execute() 会失败（list 无 execute 方法）
            # 将 config 的工具名列表存到 allowed_tools，供 executor 决定调用哪个工具
            task_context.allowed_tools = self.config.tools
            task_context.model_params = self.config.model_params

            result = await executor.run(task_context)
            if isinstance(result, AgentOutput):
                return result
            if isinstance(result, dict):
                state_updates = {}
                if self.config.output_key:
                    state_updates[self.config.output_key] = result
                return AgentOutput(result=result, state_updates=state_updates)
            return AgentOutput(result={"content": str(result)})
        except Exception as e:
            logger.error(f"Agent '{self.name}': mode executor failed: {e}")
            return AgentOutput(result={"error": str(e)})

    async def _execute_fallback_chain(
        self, input: AgentInput, instructions: str
    ) -> Optional[AgentOutput]:
        """Execute tools in fallback_chain order until one succeeds.

        P0-35 修复：
        1. 增加 warning 级诊断日志（原 debug 级在 INFO 日志级别下不可见，
           导致 fallback_chain 静默返回 None 无法排查）
        2. 修复 `not output.error` 逻辑：当工具返回 result 且含 content 字段时，
           即使 error 被设置（部分成功场景，如"no data returned"但仍有元数据），
           也应使用 result 而非跳过
        3. 详细记录每步：tool 查找/执行/结果/content 提取
        """
        from flowforge.core.base_tool import ToolInput
        from flowforge.core.tool_decorator import get_tool_registry

        registry = get_tool_registry()
        if registry is None:
            logger.warning(
                f"Agent '{self.name}': _execute_fallback_chain ABORT — "
                f"get_tool_registry() returned None"
            )
            return None

        task = input.params.get("task", input.params.get("intent", ""))
        logger.info(
            f"Agent '{self.name}': _execute_fallback_chain START — "
            f"chain={self.config.fallback_chain}, task_len={len(task) if task else 0}, "
            f"params_keys={list(input.params.keys()) if input.params else []}"
        )

        for tool_name in self.config.fallback_chain:
            try:
                # 1. 检查工具是否注册
                tool = registry.get_tool(tool_name)
                if tool is None:
                    logger.warning(
                        f"Agent '{self.name}': fallback tool '{tool_name}' "
                        f"NOT FOUND in registry — skipping"
                    )
                    continue

                # 2. 构造参数（保留原始 params，补充 query/prompt）
                params = dict(input.params)
                params["query"] = task
                params["prompt"] = instructions

                # 3. 执行工具
                logger.info(
                    f"Agent '{self.name}': fallback executing tool '{tool_name}' "
                    f"with params_keys={list(params.keys())}"
                )
                output = await registry.execute(tool_name, ToolInput(params=params))

                # 4. 诊断日志：result/error/content 详情
                result_keys = list(output.result.keys()) if output.result else []
                logger.info(
                    f"Agent '{self.name}': fallback tool '{tool_name}' result: "
                    f"result_keys={result_keys}, error={output.error!r}, "
                    f"result_truthy={bool(output.result)}"
                )

                # P0-35 FIX: 即使 output.error 被设置（部分成功），
                # 只要 result 含 content 字段且有实际内容，就应使用
                if not output.result:
                    logger.warning(
                        f"Agent '{self.name}': fallback tool '{tool_name}' "
                        f"returned empty result, error={output.error!r}"
                    )
                    continue

                content = output.result.get("content", output.result.get("result", ""))
                if content:
                    logger.info(
                        f"Agent '{self.name}': fallback tool '{tool_name}' SUCCESS — "
                        f"content_len={len(str(content))}, "
                        f"content_preview={str(content)[:80]!r}"
                    )
                    state_updates = {}
                    if self.config.output_key:
                        state_updates[self.config.output_key] = output.result
                    return AgentOutput(
                        result=output.result,
                        metadata={"fallback_tool": tool_name},
                        state_updates=state_updates,
                    )
                else:
                    # result 存在但无 content/result 字段 — 可能是工具返回了
                    # 自定义 schema（如 records/total_records），仍可使用
                    # P0-35: 改为使用整个 result dict 而非跳过
                    logger.warning(
                        f"Agent '{self.name}': fallback tool '{tool_name}' "
                        f"result has no 'content'/'result' key, "
                        f"using full result dict as fallback output, "
                        f"result_keys={result_keys}, error={output.error!r}"
                    )
                    # 构造 content 字段供后续检查
                    enriched_result = dict(output.result)
                    if "content" not in enriched_result:
                        # 将 result dict 序列化为 content 供 FeedbackLoop/Verifier 提取
                        import json as _json
                        try:
                            enriched_result["content"] = _json.dumps(
                                output.result, ensure_ascii=False, default=str
                            )[:2000]
                        except Exception:
                            enriched_result["content"] = str(output.result)[:2000]
                    state_updates = {}
                    if self.config.output_key:
                        state_updates[self.config.output_key] = enriched_result
                    return AgentOutput(
                        result=enriched_result,
                        metadata={"fallback_tool": tool_name, "fallback_synthesized": True},
                        state_updates=state_updates,
                    )
            except Exception as e:
                logger.warning(
                    f"Agent '{self.name}': fallback tool '{tool_name}' "
                    f"RAISED EXCEPTION: {type(e).__name__}: {e}",
                    exc_info=True
                )
                continue

        logger.warning(
            f"Agent '{self.name}': _execute_fallback_chain EXHAUSTED — "
            f"all {len(self.config.fallback_chain)} fallback tools failed, returning None"
        )
        return None

    async def _apply_post_processors(self, output: AgentOutput) -> AgentOutput:
        """Apply post-processor transformations to agent output."""
        if not self.config.post_processors:
            return output

        content = output.result.get("content", "") if isinstance(output.result, dict) else ""

        for processor_name in self.config.post_processors:
            try:
                if processor_name == "deai_postprocess":
                    content = self._deai_postprocess(content)
                elif processor_name == "quality_filter":
                    content = self._quality_filter(content)
                elif processor_name == "word_count_check":
                    content = self._word_count_check(content)
                else:
                    logger.debug(f"Agent '{self.name}': unknown post_processor '{processor_name}'")
            except Exception as e:
                logger.debug(f"Agent '{self.name}': post_processor '{processor_name}' failed: {e}")

        if isinstance(output.result, dict) and content:
            output.result["content"] = content
        return output

    @staticmethod
    def _deai_postprocess(content: str) -> str:
        """Remove common AI-generated phrases and patterns."""
        import re
        # Common AI-isms to remove
        ai_patterns = [
            (r"作为一名AI[，,]?\s*", ""),
            (r"作为AI[，,]?\s*", ""),
            (r"总之[，,]?\s*", ""),
            (r"综上所述[，,]?\s*", ""),
            (r"总的来说[，,]?\s*", ""),
            (r"值得注意的是[，,]?\s*", ""),
            (r"需要指出的是[，,]?\s*", ""),
            (r"不可否认[，,]?\s*", ""),
            (r"毋庸置疑[，,]?\s*", ""),
            (r"在这个.*的时代[，,]?\s*", ""),
            (r"让我们.*吧[。.]?\s*", ""),
        ]
        for pattern, replacement in ai_patterns:
            content = re.sub(pattern, replacement, content, flags=re.IGNORECASE)
        return content.strip()

    @staticmethod
    def _quality_filter(content: str) -> str:
        """Basic quality filter — remove empty lines and trim."""
        lines = [line.strip() for line in content.split("\n") if line.strip()]
        return "\n\n".join(lines)

    @staticmethod
    def _word_count_check(content: str) -> str:
        """Basic word count check — log warning if too short."""
        word_count = len(content)
        if word_count < 100:
            logger.warning(f"Content too short: {word_count} chars")
        return content

    # ── Tools resolution and execution ──────────────────────────────

    def _resolve_tools_schema(self) -> list:
        """Resolve tool names from config into OpenAI function-calling schemas.

        Looks up each tool name in the ToolRegistry and extracts its
        parameters_schema.  Tools that are not found are skipped with a
        warning.
        """
        from flowforge.core.tool_decorator import get_tool_registry

        schemas: list = []
        registry = get_tool_registry()
        if registry is None:
            logger.warning(f"Agent '{self.name}': ToolRegistry not available for tool resolution")
            return schemas

        for tool_name in self.config.tools:
            try:
                tool = registry.get_tool(tool_name)
                schema = {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": getattr(tool, "description", ""),
                        "parameters": getattr(tool, "parameters_schema", {}),
                    },
                }
                schemas.append(schema)
            except Exception:
                logger.warning(f"Agent '{self.name}': tool '{tool_name}' not found in ToolRegistry, skipping")

        return schemas

    async def _execute_tool_calls(self, tool_calls: list, input: Optional[AgentInput] = None) -> List[Dict[str, Any]]:
        """Execute tool_calls returned by the LLM via ToolRegistry.

        Args:
            tool_calls: List of tool call dicts with 'name' and 'arguments'.
            input: Optional AgentInput — when provided, loop feedback params
                (loop_reflections, loop_verifier_errors, draft) are forwarded
                from input.params into the tool arguments so that downstream
                tools (e.g. writer_engine) receive the Loop context.

        Returns:
            List of result dicts from each tool execution.
        """
        from flowforge.core.base_tool import ToolInput
        from flowforge.core.tool_decorator import get_tool_registry

        results: List[Dict[str, Any]] = []
        registry = get_tool_registry()
        if registry is None:
            logger.warning(f"Agent '{self.name}': ToolRegistry not available for tool execution")
            return results

        # Loop 反馈参数 — 这些是数据型参数，LLM 不会在 tool_call 中生成，
        # 必须从 agent 的 input.params 转发到工具调用中（最后一公里）
        _LOOP_FORWARD_KEYS = ('loop_reflections', 'loop_verifier_errors', 'draft')

        for tc in tool_calls:
            # P0-41: 兼容 OpenAI 标准嵌套格式 {"function": {"name": ..., "arguments": ...}}
            # 与 flowforge/agents/declarative.py:343-345 保持一致
            tool_name = tc.get("name", tc.get("function", {}).get("name", ""))
            arguments = tc.get("arguments", tc.get("function", {}).get("arguments", {}))
            if isinstance(arguments, str):
                import json
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}

            # 转发 loop 反馈参数到工具调用（LLM 不会在 tool_call arguments 中包含这些）
            if input is not None and input.params:
                for key in _LOOP_FORWARD_KEYS:
                    if key in input.params and key not in arguments:
                        arguments[key] = input.params[key]

            try:
                output = await registry.execute(tool_name, ToolInput(params=arguments))
                results.append({
                    "tool": tool_name,
                    "result": output.result,
                    "error": output.error,
                })
            except Exception as e:
                logger.warning(f"Agent '{self.name}': tool '{tool_name}' execution failed: {e}")
                results.append({
                    "tool": tool_name,
                    "result": {},
                    "error": str(e),
                })

        return results

    # ── Handoff support ─────────────────────────────────────────────

    def _build_handoff_prompt(self) -> str:
        """Build a prompt snippet describing available handoff targets.

        This is appended to the system instructions so the LLM knows
        when it can delegate tasks to other agents.
        """
        lines = ["You can delegate tasks to the following specialized agents:", ""]
        for target_name in self.config.handoffs:
            lines.append(f"- {target_name}")
        lines.append("")
        lines.append(
            "To delegate a task, include a line in your response in the format: "
            "[HANDOFF_TO: agent_name] followed by the task description."
        )
        return "\n".join(lines)

    async def _check_and_execute_handoff(
        self, output: AgentOutput, input: AgentInput
    ) -> Optional[AgentOutput]:
        """Check if the LLM response indicates a handoff and execute it.

        Looks for the pattern ``[HANDOFF_TO: agent_name]`` in the
        response content.  If found and the target is in config.handoffs,
        delegates execution to that agent via HandoffManager.

        Returns:
            An AgentOutput from the target agent if handoff was executed,
            or None if no handoff was detected.
        """
        import re
        from flowforge.core.handoff import Handoff, HandoffManager
        from flowforge.core.agent_registry import AgentRegistry

        content = output.result.get("content", "") if output.result else ""
        match = re.search(r"\[HANDOFF_TO:\s*(\w[\w\-]*)\]", content)
        if not match:
            return None

        target_agent = match.group(1).strip()
        if target_agent not in self.config.handoffs:
            logger.warning(
                f"Agent '{self.name}': LLM requested handoff to '{target_agent}' "
                f"but it is not in configured handoffs {self.config.handoffs}"
            )
            return None

        try:
            agent_registry = AgentRegistry()
            hm = HandoffManager(agent_registry=agent_registry)

            # Register handoffs so HandoffManager can validate
            handoffs = [Handoff(target=t, condition=f"delegated by {self.name}")
                        for t in self.config.handoffs]
            hm.register_handoffs(self.name, handoffs)

            # Extract task from content (everything after the handoff marker)
            task = content[match.end():].strip()
            if not task:
                task = input.params.get("task", input.params.get("intent", ""))

            context = dict(input.params)
            context.pop("task", None)
            context.pop("intent", None)

            result = await hm.execute_handoff(
                source_agent=self.name,
                target_agent=target_agent,
                task=task,
                context=context,
            )
            # Tag the result as coming from a handoff
            result.metadata["handoff_from"] = self.name
            result.metadata["handoff_to"] = target_agent
            return result
        except Exception as e:
            logger.error(
                f"Agent '{self.name}': handoff to '{target_agent}' failed: {e}"
            )
            return None

    # ── Guardrail support ────────────────────────────────────────────

    async def _run_input_guardrails(
        self, input_text: str, context: dict
    ) -> Optional[AgentOutput]:
        """Run input guardrails from config.guardrails.

        Returns:
            An AgentOutput with error if any guardrail blocks, or None
            if all guardrails pass.
        """
        from flowforge.core.guardrails import GuardrailRegistry, GuardrailExecutor

        try:
            registry = GuardrailRegistry()
        except Exception:
            return None

        # Filter to only the guardrails named in config
        input_guardrails = []
        for name in self.config.guardrails:
            g = registry._input_guardrails.get(name)
            if g is not None:
                input_guardrails.append(g)

        if not input_guardrails:
            return None

        executor = GuardrailExecutor(registry)
        results = await executor.run_input_guardrails(input_text, context)

        for gr in results:
            if gr.status == "blocked":
                logger.warning(
                    f"Agent '{self.name}': input blocked by guardrail: {gr.message}"
                )
                return AgentOutput(
                    result={"error": f"Input blocked by guardrail: {gr.message}", "status": "blocked"},
                    metadata={"guardrail_status": "blocked"},
                )
        return None

    async def _run_output_guardrails(
        self, output_text: str, context: dict
    ) -> Optional[AgentOutput]:
        """Run output guardrails from config.guardrails.

        Returns:
            An AgentOutput with error if any guardrail blocks, or None
            if all guardrails pass.
        """
        from flowforge.core.guardrails import GuardrailRegistry, GuardrailExecutor

        try:
            registry = GuardrailRegistry()
        except Exception:
            return None

        # Filter to only the guardrails named in config
        output_guardrails = []
        for name in self.config.guardrails:
            g = registry._output_guardrails.get(name)
            if g is not None:
                output_guardrails.append(g)

        if not output_guardrails:
            return None

        executor = GuardrailExecutor(registry)
        results = await executor.run_output_guardrails(output_text, context)

        for gr in results:
            if gr.status == "blocked":
                logger.warning(
                    f"Agent '{self.name}': output blocked by guardrail: {gr.message}"
                )
                return AgentOutput(
                    result={"error": f"Output blocked by guardrail: {gr.message}", "status": "blocked"},
                    metadata={"guardrail_status": "blocked"},
                )
        return None

    # ── Factory methods ─────────────────────────────────────────────

    @classmethod
    def from_config(
        cls,
        config: dict[str, Any],
        execute_fn: Optional[Callable] = None,
    ) -> DeclarativeAgent:
        """Create a DeclarativeAgent from a config dict.

        Args:
            config: Dict matching :class:`AgentConfig` fields.
            execute_fn: Optional custom execute function.

        Returns:
            A ready-to-use :class:`DeclarativeAgent`.
        """
        agent_config = AgentConfig(**config)
        return cls(config=agent_config, execute_fn=execute_fn)

    @classmethod
    def from_yaml(
        cls,
        path: str | Path,
        execute_fn: Optional[Callable] = None,
    ) -> DeclarativeAgent:
        """Create a DeclarativeAgent from a YAML file.

        The YAML file should map directly to :class:`AgentConfig` fields.

        Args:
            path: Path to the YAML configuration file.
            execute_fn: Optional custom execute function.

        Returns:
            A ready-to-use :class:`DeclarativeAgent`.
        """
        yaml_path = Path(path)
        with open(yaml_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        if not isinstance(raw, dict):
            raise ValueError(
                f"YAML file {yaml_path} must contain a mapping at the top level"
            )

        agent_config = AgentConfig(**raw)
        return cls(config=agent_config, execute_fn=execute_fn)


# ── @agent decorator ─────────────────────────────────────────────────

# Module-level registry used by the @agent decorator to auto-register
# agents.  Populated by the decorator, consumed by the SDK.
_decorator_agents: Dict[str, DeclarativeAgent] = {}


def get_decorator_agents() -> Dict[str, DeclarativeAgent]:
    """Return all agents registered via the ``@agent`` decorator."""
    return dict(_decorator_agents)


def agent(
    *,
    name: str,
    description: str = "",
    model: Optional[str] = None,
    model_params: Optional[Dict[str, Any]] = None,
    tools: Optional[List[str]] = None,
    instructions: Optional[str] = None,
    prompt_template: Optional[str] = None,
    execution_mode: str = "single",
    persona: Optional[Dict[str, Any]] = None,
    input_mapping: Optional[Dict[str, str]] = None,
    output_key: Optional[str] = None,
    handoffs: Optional[List[str]] = None,
    guardrails: Optional[List[str]] = None,
    execution_policy: Optional[Dict[str, Any]] = None,
    checkpoint: Optional[Dict[str, Any]] = None,
    fallback_chain: Optional[List[str]] = None,
    post_processors: Optional[List[str]] = None,
    prefer_api: Optional[bool] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Callable:
    """Decorator that registers a function as a DeclarativeAgent.

    The decorated function becomes the agent's ``execute_fn``.  If the
    function body is a placeholder (``...``), the agent falls back to
    default LLM-based execution.

    Args:
        name: Unique agent identifier.
        description: Human-readable purpose.
        model: Preferred LLM model.
        tools: Tool names this agent can use.
        instructions: System prompt for LLM-based execution.
        handoffs: Agent names this agent can delegate to.
        guardrails: Guardrail names to enforce.
        metadata: Arbitrary metadata.

    Returns:
        The original function (unchanged), with a ``_declarative_agent``
        attribute attached for introspection.

    Example::

        @agent(name="writer", description="Content writer", model="DeepSeek-V4-Pro")
        async def write(task: str, style: str = "professional") -> str:
            ...
    """

    def decorator(func: Callable) -> Callable:
        # Detect placeholder body (Ellipsis / pass-only)
        source = inspect.getsource(func).strip()
        has_body = not (
            source.endswith("...") or source.endswith("pass")
        )

        execute_fn = func if has_body else None

        config = AgentConfig(
            name=name,
            description=description or inspect.getdoc(func) or "",
            model=model,
            model_params=model_params or {},
            tools=tools or [],
            instructions=instructions,
            prompt_template=prompt_template,
            execution_mode=execution_mode,
            persona=persona,
            input_mapping=input_mapping or {},
            output_key=output_key,
            handoffs=handoffs or [],
            guardrails=guardrails or [],
            execution_policy=ExecutionPolicy(**execution_policy) if execution_policy else None,
            checkpoint=CheckpointConfig(**checkpoint) if checkpoint else None,
            fallback_chain=fallback_chain or [],
            post_processors=post_processors or [],
            prefer_api=prefer_api,
            metadata=metadata or {},
        )

        da = DeclarativeAgent(config=config, execute_fn=execute_fn)

        # Attach to the function for introspection
        func._declarative_agent = da  # type: ignore[attr-defined]

        # Register in the module-level registry
        _decorator_agents[name] = da
        logger.info(f"Declarative agent registered via @agent: {name}")

        return func

    return decorator

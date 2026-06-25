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
        if self.config.prompt_template:
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

        llm_result = await mc.chat(
            prompt=task,
            system=instructions,
            model=model,
            agent_name=self.name,
            tools=tools_schema,
            **model_kwargs,
        )

        # Handle tool_calls from LLM response
        tool_calls = llm_result.get("tool_calls", [])
        tool_results: List[Dict[str, Any]] = []
        if tool_calls:
            tool_results = await self._execute_tool_calls(tool_calls, input)

        # Handle fallback_chain if primary execution returns empty
        if not llm_result.get("content") and self.config.fallback_chain:
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
            # 模板存在：用 format 注入变量，兼容缺失字段
            try:
                return template.format(
                    existing_draft=draft,
                    feedback_text=feedback_text,
                    verifier_info="\n".join(feedback_items[:10]),
                    judge_dimensions_guide=judge_dimensions_guide,
                )
            except (KeyError, ValueError, IndexError) as e:
                logger.warning(f"[declarative_agent] Refine template format error: {e}, using inline prompt")
                # 降级：手动替换已知占位符
                rendered = template
                rendered = rendered.replace("{existing_draft}", draft)
                rendered = rendered.replace("{feedback_text}", feedback_text)
                rendered = rendered.replace("{verifier_info}", "\n".join(feedback_items[:10]))
                rendered = rendered.replace("{judge_dimensions_guide}", judge_dimensions_guide)
                return rendered

        # 模板不存在：构建内联 refine prompt
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
        """Resolve a variable reference like '${state.xxx}' or '${params.xxx}'."""
        if not ref.startswith("${") or not ref.endswith("}"):
            return ref
        path = ref[2:-1]  # Remove ${ and }
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
            task_context = TaskContext(
                task_id=input.params.get("task_id", self.name),
                input_data=dict(input.params),
                metadata={"persona": input.params.get("persona", "")},
                tools=parent_ctx.tools if parent_ctx else None,
                agents=parent_ctx.agents if parent_ctx else None,
                event_bus=parent_ctx.event_bus if parent_ctx else None,
                persona=input.params.get("persona", ""),
            )

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
            task_context.tools = self.config.tools
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
        """Execute tools in fallback_chain order until one succeeds."""
        from flowforge.core.base_tool import ToolInput
        from flowforge.tools.registry import ToolRegistry

        try:
            registry = ToolRegistry()
        except Exception:
            return None

        task = input.params.get("task", input.params.get("intent", ""))

        for tool_name in self.config.fallback_chain:
            try:
                tool = registry.get_tool(tool_name)
                params = dict(input.params)
                params["query"] = task
                params["prompt"] = instructions
                output = await registry.execute(tool_name, ToolInput(params=params))
                if output.result and not output.error:
                    content = output.result.get("content", output.result.get("result", ""))
                    if content:
                        state_updates = {}
                        if self.config.output_key:
                            state_updates[self.config.output_key] = output.result
                        return AgentOutput(
                            result=output.result,
                            metadata={"fallback_tool": tool_name},
                            state_updates=state_updates,
                        )
            except Exception as e:
                logger.debug(f"Agent '{self.name}': fallback tool '{tool_name}' failed: {e}")
                continue

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
        from flowforge.tools.registry import ToolRegistry

        schemas: list = []
        try:
            registry = ToolRegistry()
        except Exception:
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
        from flowforge.tools.registry import ToolRegistry

        results: List[Dict[str, Any]] = []
        try:
            registry = ToolRegistry()
        except Exception:
            logger.warning(f"Agent '{self.name}': ToolRegistry not available for tool execution")
            return results

        # Loop 反馈参数 — 这些是数据型参数，LLM 不会在 tool_call 中生成，
        # 必须从 agent 的 input.params 转发到工具调用中（最后一公里）
        _LOOP_FORWARD_KEYS = ('loop_reflections', 'loop_verifier_errors', 'draft')

        for tc in tool_calls:
            tool_name = tc.get("name", "")
            arguments = tc.get("arguments", {})
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

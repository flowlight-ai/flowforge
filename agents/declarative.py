"""DeclarativeAgent — 通过YAML配置定义Agent，无需编写Python代码。

FWK-09: 适用于纯prompt+LLM+JSON解析的Agent，约15个现有Agent可迁移到此模式。
集成FWK-04 (StateMapper) 和 FWK-05 (PersonaInjector)，支持声明式的
参数映射、persona注入和state_updates映射。

与 flowforge/core/declarative_agent.py 的区别：
- core/declarative_agent.py: 基础声明式Agent，支持@agent装饰器、handoffs、guardrails
- agents/declarative.py: 增强声明式Agent，增加state参数映射、persona注入、
  state_updates映射、output_mapping、fallback链等SOP编排能力

Usage:
    from flowforge.agents.declarative import DeclarativeAgent, AgentConfig

    # 方式1: 从YAML文件创建
    agent = DeclarativeAgent.from_yaml("config/agents/topic_agent.yaml")
    output = await agent.execute(AgentInput(params={"task_id": "t1"}, state=state))

    # 方式2: 从配置字典创建
    config = {
        "name": "topic_agent",
        "prompt_key": "generic.drafter",
        "input_mapping": {"query": "state.topic_query"},
        "state_updates": {"topic_list": "topics"},
        "inject_persona": True,
    }
    agent = DeclarativeAgent.from_config(config)

    # 方式3: 使用适配器注册到FlowForge
    from flowforge.agents.declarative import DeclarativeAgentAdapter
    adapter = DeclarativeAgentAdapter(agent)
    agent_registry.register(adapter)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.core.persona_injector import PersonaInjector
from flowforge.core.state_mapper import StateMapper
from flowforge.core.tracing import get_logger

logger = get_logger("agents.declarative")


class AgentConfig(BaseModel):
    """声明式Agent配置。

    所有字段都是可选的（Pydantic层面），但name是必需的。
    支持从YAML文件直接加载。

    Attributes:
        name: Agent名称
        description: 描述
        version: 版本号
        prompt_key: PromptManager中的key
        prompt_template: 直接的prompt模板
        system_prompt: 系统提示词
        model: 指定模型
        temperature: 采样温度
        max_tokens: 最大token数
        response_format: 响应格式 json | text | markdown
        input_mapping: 参数名 → source路径 (FWK-04)
        output_mapping: 输出字段 → state字段
        state_updates: state字段 → 输出JSON字段路径
        inject_persona: 是否注入persona (FWK-05)
        persona_sections: 要注入的persona部分
        fallback_chain: 回退链配置
        tools: 可用工具列表
        max_retries: 最大重试次数
        retry_on_error: 触发重试的错误类型
        max_steps: 最大执行步数（1=单轮, >1=多轮tool loop）
        multi_turn: 是否启用多轮tool loop（ReAct模式）
        permissions: 权限声明列表
        output_schema: 输出JSON Schema校验
    """

    model_config = {"extra": "allow"}

    name: str = Field(..., description="Agent名称")
    description: str = Field(default="", description="描述")
    version: float = Field(default=1.0, description="版本号")

    # Prompt配置
    prompt_key: str | None = Field(default=None, description="PromptManager中的key")
    prompt_template: str | None = Field(default=None, description="直接的prompt模板")
    system_prompt: str | None = Field(default=None, description="系统提示词")

    # LLM配置
    model: str | None = Field(default=None, description="指定模型")
    temperature: float = Field(default=0.7, description="采样温度")
    max_tokens: int = Field(default=4096, description="最大token数")
    response_format: str = Field(default="json", description="响应格式: json | text | markdown")

    # 参数映射（FWK-04）
    input_mapping: dict[str, str] = Field(default_factory=dict, description="参数名 → source路径")
    output_mapping: dict[str, str] = Field(default_factory=dict, description="输出字段 → state字段")

    # State更新映射
    state_updates: dict[str, str] = Field(default_factory=dict, description="state字段 → 输出JSON字段路径")

    # Persona注入（FWK-05）
    inject_persona: bool = Field(default=False, description="是否注入persona")
    persona_sections: list[str] = Field(
        default_factory=lambda: ["soul", "creation"],
        description="要注入的persona部分",
    )

    # Fallback链
    fallback_chain: list[dict] | None = Field(default=None, description="回退链配置")

    # 工具调用
    tools: list[str] = Field(default_factory=list, description="可用工具列表")

    # 重试配置
    max_retries: int = Field(default=0, description="最大重试次数")
    retry_on_error: list[str] = Field(
        default_factory=lambda: ["json_parse_error"],
        description="触发重试的错误类型",
    )

    # 多轮Tool Loop配置
    max_steps: int = Field(default=1, description="最大执行步数（1=单轮, >1=多轮tool loop）")
    multi_turn: bool = Field(default=False, description="是否启用多轮tool loop（ReAct模式）")
    permissions: list[str] = Field(default_factory=list, description="权限声明列表")
    output_schema: dict | None = Field(default=None, description="输出JSON Schema校验")


class DeclarativeAgent:
    """声明式Agent - 通过YAML配置定义，无需编写Python代码。

    执行流程:
    1. 加载prompt（从PromptManager或直接模板）
    2. 如果inject_persona=True，注入persona信息
    3. 使用StateMapper从input_data中提取参数
    4. 渲染prompt模板（替换{{var}}）
    5. 调用LLM
    6. 解析输出（JSON/text/markdown）
    7. 使用output_mapping映射输出字段
    8. 使用state_updates映射构建state_updates
    9. 如果有fallback_chain且主流程失败，执行回退链
    10. 返回AgentOutput
    """

    def __init__(
        self,
        config: AgentConfig,
        llm_client: Any = None,
        tool_registry: Any = None,
        prompt_manager: Any = None,
    ) -> None:
        self.config = config
        self.name = config.name
        self.description = config.description
        self._llm_client = llm_client
        self._tool_registry = tool_registry
        self._prompt_manager = prompt_manager

        # 初始化StateMapper（FWK-04）
        self._state_mapper: StateMapper | None = None
        if config.input_mapping:
            self._state_mapper = StateMapper.from_config(config.input_mapping)

        # 初始化PersonaInjector（FWK-05）
        self._persona_injector: PersonaInjector | None = None
        if config.inject_persona:
            self._persona_injector = PersonaInjector(prompt_manager=prompt_manager)

    async def execute(self, input_data: AgentInput) -> AgentOutput:
        """执行Agent：加载prompt → 注入参数 → 调用LLM → 解析输出 → 映射state_updates。

        Args:
            input_data: Agent输入，包含params和state

        Returns:
            AgentOutput，包含result、metadata和state_updates
        """
        state = input_data.state or {}
        params = dict(input_data.params)
        last_error: Exception | None = None

        for attempt in range(self.config.max_retries + 1):
            try:
                if self.config.multi_turn or self.config.max_steps > 1:
                    return await self._execute_multi_turn(input_data, state, params)
                return await self._execute_once(input_data, state, params)
            except Exception as e:
                last_error = e
                error_type = self._classify_error(e)
                if error_type in self.config.retry_on_error and attempt < self.config.max_retries:
                    logger.warning(
                        f"DeclarativeAgent '{self.name}': attempt {attempt + 1} failed "
                        f"with {error_type}, retrying..."
                    )
                    continue
                break

        # 主流程失败，尝试fallback链
        if self.config.fallback_chain and last_error is not None:
            fallback_output = await self._execute_fallback_chain(input_data, state, params)
            if fallback_output is not None:
                return fallback_output

        # 返回错误结果
        error_msg = str(last_error) if last_error else "Unknown error"
        logger.error(f"DeclarativeAgent '{self.name}': execution failed: {error_msg}")
        return AgentOutput(
            result={"error": error_msg, "agent": self.name},
            metadata={"attempts": self.config.max_retries + 1},
        )

    async def _execute_once(
        self,
        input_data: AgentInput,
        state: dict,
        params: dict,
    ) -> AgentOutput:
        """单次执行Agent的完整流程。"""
        # Step 1: 加载prompt
        prompt = self._load_prompt(params)

        # Step 2: 使用StateMapper提取参数（FWK-04）
        if self._state_mapper:
            mapped_params = self._state_mapper.apply(state, extra=params)
            params.update(mapped_params)

        # Step 3: 如果inject_persona=True，注入persona信息（FWK-05）
        persona_id = params.get("persona_id", state.get("persona", ""))
        if self._persona_injector and persona_id:
            prompt = await self._persona_injector.inject(
                prompt, persona_id, self.config.persona_sections
            )
            params = await self._persona_injector.inject_params(params, persona_id)

        # Step 4: 渲染prompt模板（替换{{var}}）
        prompt = self._render_template(prompt, params)

        # Step 5: 调用LLM
        system_prompt = self.config.system_prompt or ""
        llm_result = await self._call_llm(prompt, system_prompt, params)

        # Step 6: 解析输出
        raw_content = llm_result.get("content", "")
        parsed_output = self._parse_output(raw_content)

        # Step 7: 使用output_mapping映射输出字段
        result = self._apply_output_mapping(parsed_output)

        # Step 8: 使用state_updates映射构建state_updates
        state_updates = self._build_state_updates(parsed_output)

        # Step 9: 构建metadata
        metadata: dict[str, Any] = {
            "agent_type": "declarative",
            "agent_name": self.name,
            "model": llm_result.get("model", ""),
            "provider": llm_result.get("provider", ""),
            "tokens": llm_result.get("tokens", 0),
            "response_format": self.config.response_format,
        }

        return AgentOutput(result=result, metadata=metadata, state_updates=state_updates)

    async def _execute_multi_turn(
        self,
        input_data: AgentInput,
        state: dict,
        params: dict,
    ) -> AgentOutput:
        """多轮Tool Loop执行（ReAct模式）。

        执行流程:
        1. 加载prompt → StateMapper → Persona注入 → 渲染模板
        2. 构建初始messages（system + user）
        3. 获取tools schema
        4. 循环：调用LLM → 如果有tool_calls则执行 → 追加结果 → 再次调用LLM
        5. 直到LLM不再返回tool_calls或达到max_steps
        6. 解析最终输出 → output_mapping → state_updates
        """
        # Step 1: 加载prompt
        prompt = self._load_prompt(params)

        # Step 2: StateMapper提取参数
        if self._state_mapper:
            mapped_params = self._state_mapper.apply(state, extra=params)
            params.update(mapped_params)

        # Step 3: Persona注入
        persona_id = params.get("persona_id", state.get("persona", ""))
        if self._persona_injector and persona_id:
            prompt = await self._persona_injector.inject(
                prompt, persona_id, self.config.persona_sections
            )
            params = await self._persona_injector.inject_params(params, persona_id)

        # Step 4: 渲染模板
        prompt = self._render_template(prompt, params)

        # Step 5: 构建初始messages
        system_prompt = self.config.system_prompt or ""
        messages: list[dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Step 6: 获取tools schema
        tools_schema: list[dict] | None = None
        if self.config.tools and self._tool_registry is not None:
            tools_schema = self._tool_registry.get_function_calls(self.config.tools)
            if not tools_schema:
                tools_schema = None

        # Step 7: 多轮循环
        tool_results_all: list[dict] = []
        step = 0
        llm_result: dict[str, Any] = {}

        for step in range(self.config.max_steps):
            llm_result = await self._call_llm_with_tools(messages, tools_schema)

            content = llm_result.get("content", "")
            tool_calls = llm_result.get("tool_calls", [])

            # 如果没有tool_calls，循环结束
            if not tool_calls:
                break

            # 追加assistant消息（含tool_calls）
            assistant_msg: dict[str, Any] = {"role": "assistant", "content": content}
            # 保留原始tool_calls格式供LLM理解上下文
            assistant_msg["tool_calls"] = tool_calls
            messages.append(assistant_msg)

            # 执行每个tool_call
            for tc in tool_calls:
                tool_name = tc.get("name", tc.get("function", {}).get("name", ""))
                # 兼容OpenAI格式：arguments可能在function下
                arguments = tc.get("arguments", tc.get("function", {}).get("arguments", {}))
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except json.JSONDecodeError:
                        arguments = {}

                tool_result = await self._execute_single_tool(tool_name, arguments)
                tool_results_all.append({"tool": tool_name, "arguments": arguments, "result": tool_result})
                messages.append({
                    "role": "tool",
                    "content": json.dumps(tool_result, ensure_ascii=False),
                    "name": tool_name,
                })

        # Step 8: 解析最终输出
        # 取最后一条非tool消息的content作为最终输出
        final_content = ""
        for msg in reversed(messages):
            if msg.get("role") in ("assistant", "user") and msg.get("content"):
                final_content = msg["content"]
                break

        # 如果最后一轮LLM返回了content，优先使用
        if llm_result.get("content"):
            final_content = llm_result["content"]

        parsed_output = self._parse_output(final_content)

        # Step 9: output_schema校验（如果配置了）
        if self.config.output_schema and isinstance(parsed_output, dict):
            parsed_output = self._validate_output_schema(parsed_output)

        # Step 10: 构建结果
        result = self._apply_output_mapping(parsed_output)
        state_updates = self._build_state_updates(parsed_output)

        metadata: dict[str, Any] = {
            "agent_type": "declarative_multi_turn",
            "agent_name": self.name,
            "steps_used": step + 1,
            "tool_calls_total": len(tool_results_all),
            "tool_results": tool_results_all,
            "model": llm_result.get("model", ""),
            "provider": llm_result.get("provider", ""),
            "tokens": llm_result.get("tokens", 0),
            "response_format": self.config.response_format,
        }

        return AgentOutput(result=result, metadata=metadata, state_updates=state_updates)

    def _validate_output_schema(self, parsed_output: dict) -> dict:
        """使用output_schema校验输出，移除不符合schema的字段。

        Args:
            parsed_output: 解析后的输出dict

        Returns:
            校验后的输出dict
        """
        if not self.config.output_schema:
            return parsed_output

        allowed_props = self.config.output_schema.get("properties", {})
        if not allowed_props:
            return parsed_output

        validated: dict[str, Any] = {}
        for key in allowed_props:
            if key in parsed_output:
                validated[key] = parsed_output[key]

        # 如果校验后为空，保留原始输出
        if not validated:
            return parsed_output

        return validated

    def _load_prompt(self, params: dict) -> str:
        """加载prompt，优先级：prompt_template > prompt_key > description。"""
        # 优先使用直接模板
        if self.config.prompt_template:
            return self.config.prompt_template

        # 从PromptManager加载
        if self.config.prompt_key:
            pm = self._get_prompt_manager()
            if pm is not None:
                prompt = pm.get(self.config.prompt_key, **params)
                if prompt:
                    return prompt

        # 兜底使用description
        return self.config.description or f"You are the {self.name} agent."

    def _get_prompt_manager(self) -> Any:
        """获取PromptManager实例。"""
        if self._prompt_manager is not None:
            return self._prompt_manager
        try:
            from flowforge.core.prompt_manager import PromptManager
            return PromptManager()
        except Exception:
            return None

    @staticmethod
    def _render_template(template: str, params: dict) -> str:
        """渲染prompt模板，替换{{var}}占位符。"""
        if not template or not params:
            return template

        def replace_match(match: re.Match) -> str:
            key = match.group(1)
            value = params.get(key, match.group(0))
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False)
            return str(value)

        return re.sub(r"\{\{(\w+(?:\.\w+)*)\}\}", replace_match, template)

    async def _call_llm(self, prompt: str, system_prompt: str, params: dict) -> dict:
        """调用LLM。优先使用注入的llm_client，否则使用ModelCapability。"""
        from flowforge.core.base_tool import ToolInput

        # 尝试使用注入的llm_client
        if self._llm_client is not None:
            messages: list[dict[str, str]] = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            tool_params: dict[str, Any] = {
                "messages": messages,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
                "stream": False,
            }
            if self.config.model:
                tool_params["model"] = self.config.model

            result = await self._llm_client.execute(ToolInput(params=tool_params))
            return result.result

        # 使用ModelCapability
        from flowforge.core.model_capability import ModelCapability

        mc = ModelCapability()
        return await mc.chat(
            prompt=prompt,
            system=system_prompt,
            model=self.config.model or "",
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            agent_name=self.name,
            persona=params.get("persona_id", ""),
        )

    async def _call_llm_with_tools(self, messages: list[dict], tools_schema: list[dict] | None = None) -> dict:
        """调用LLM并附带tools schema，用于多轮tool loop。

        Args:
            messages: 对话消息列表
            tools_schema: OpenAI function-calling格式的tools列表

        Returns:
            包含content, tool_calls, model等字段的dict
        """
        from flowforge.core.base_tool import ToolInput

        # 尝试使用注入的llm_client
        if self._llm_client is not None:
            tool_params: dict[str, Any] = {
                "messages": messages,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
                "stream": False,
            }
            if self.config.model:
                tool_params["model"] = self.config.model
            if tools_schema:
                tool_params["tools"] = tools_schema

            result = await self._llm_client.execute(ToolInput(params=tool_params))
            return result.result

        # 使用ModelCapability
        from flowforge.core.model_capability import ModelCapability

        mc = ModelCapability()

        # 从messages中提取system和user内容
        system_content = ""
        user_parts: list[str] = []
        for msg in messages:
            if msg.get("role") == "system":
                system_content = msg.get("content", "")
            elif msg.get("role") == "user":
                user_parts.append(msg.get("content", ""))

        prompt = "\n".join(user_parts) if user_parts else ""

        return await mc.chat(
            prompt=prompt,
            system=system_content,
            model=self.config.model or "",
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            agent_name=self.name,
            tools=tools_schema,
        )

    async def _execute_single_tool(self, tool_name: str, arguments: dict) -> dict:
        """执行单个工具调用。

        Args:
            tool_name: 工具名称
            arguments: 工具调用参数

        Returns:
            工具执行结果dict
        """
        if self._tool_registry is None:
            return {"error": f"ToolRegistry not configured, cannot execute tool '{tool_name}'"}

        try:
            from flowforge.core.base_tool import ToolInput

            result = await self._tool_registry.execute(tool_name, ToolInput(params=arguments))
            if result.error:
                return {"error": result.error, "tool": tool_name}
            return result.result
        except Exception as e:
            logger.warning(f"DeclarativeAgent '{self.name}': tool '{tool_name}' execution failed: {e}")
            return {"error": str(e), "tool": tool_name}

    def _parse_output(self, content: str) -> Any:
        """解析LLM输出。

        根据response_format配置：
        - json: 尝试JSON解析
        - text: 直接返回字符串
        - markdown: 尝试从markdown代码块中提取JSON
        """
        if not content:
            return {}

        if self.config.response_format == "text":
            return {"content": content}

        if self.config.response_format == "json":
            return self._extract_json(content)

        if self.config.response_format == "markdown":
            # 先尝试从代码块中提取JSON
            parsed = self._extract_json(content)
            if isinstance(parsed, dict) and parsed:
                return parsed
            return {"content": content}

        return {"content": content}

    @staticmethod
    def _extract_json(text: str) -> Any:
        """从文本中提取JSON，支持代码块包裹和裸JSON。"""
        # 尝试从markdown代码块中提取
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            text = match.group(1)

        text = text.strip()

        # 直接尝试解析
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 尝试找到JSON对象的起始位置
        for start_char, end_char in [("{", "}"), ("[", "]")]:
            start = text.find(start_char)
            if start != -1:
                # 找到匹配的结束位置
                depth = 0
                for i in range(start, len(text)):
                    if text[i] == start_char:
                        depth += 1
                    elif text[i] == end_char:
                        depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start : i + 1])
                        except json.JSONDecodeError:
                            break

        # 无法解析为JSON，返回原始内容
        return {"content": text}

    def _apply_output_mapping(self, parsed_output: Any) -> dict:
        """使用output_mapping映射输出字段。

        output_mapping格式: {"output_field": "state_field"}
        意味着从parsed_output中取output_field，放入result的state_field中。
        """
        if not self.config.output_mapping:
            if isinstance(parsed_output, dict):
                return parsed_output
            return {"content": parsed_output}

        result: dict[str, Any] = {}
        source = parsed_output if isinstance(parsed_output, dict) else {"content": parsed_output}

        for output_key, result_key in self.config.output_mapping.items():
            value = self._get_nested_value(source, output_key)
            if value is not None:
                result[result_key] = value

        # 如果output_mapping没有覆盖所有字段，保留原始内容
        if not result and isinstance(parsed_output, dict):
            result = parsed_output

        return result

    def _build_state_updates(self, parsed_output: Any) -> dict:
        """使用state_updates映射构建state_updates。

        state_updates格式: {"state_field": "output_field_path"}
        意味着从parsed_output中取output_field_path的值，放入state_updates的state_field中。
        """
        if not self.config.state_updates:
            return {}

        source = parsed_output if isinstance(parsed_output, dict) else {"content": parsed_output}
        updates: dict[str, Any] = {}

        for state_field, output_path in self.config.state_updates.items():
            value = self._get_nested_value(source, output_path)
            if value is not None:
                updates[state_field] = value

        return updates

    @staticmethod
    def _get_nested_value(data: dict, path: str) -> Any:
        """从嵌套字典中获取值，支持点号分隔路径。

        Args:
            data: 源字典
            path: 点号分隔的路径，如 "topics.0.title"

        Returns:
            找到的值，或None
        """
        if not data or not path:
            return None

        parts = path.split(".")
        current: Any = data

        for part in parts:
            if current is None:
                return None

            # 尝试数字索引
            try:
                index = int(part)
                if isinstance(current, (list, tuple)) and 0 <= index < len(current):
                    current = current[index]
                    continue
            except ValueError:
                pass

            # 字典键
            if isinstance(current, dict):
                if part in current:
                    current = current[part]
                else:
                    return None
            else:
                return None

        return current

    @staticmethod
    def _classify_error(error: Exception) -> str:
        """对错误进行分类，用于判断是否需要重试。"""
        error_msg = str(error).lower()
        if "json" in error_msg or "decode" in error_msg or "parse" in error_msg:
            return "json_parse_error"
        if "timeout" in error_msg or "timed out" in error_msg:
            return "timeout_error"
        if "rate" in error_msg or "limit" in error_msg or "429" in error_msg:
            return "rate_limit_error"
        return "unknown_error"

    async def _execute_fallback_chain(
        self,
        input_data: AgentInput,
        state: dict,
        params: dict,
    ) -> AgentOutput | None:
        """执行fallback回退链。"""
        if not self.config.fallback_chain:
            return None

        for i, fallback_config in enumerate(self.config.fallback_chain):
            try:
                logger.info(
                    f"DeclarativeAgent '{self.name}': executing fallback {i + 1}/{len(self.config.fallback_chain)}"
                )

                # 创建fallback的临时配置
                fallback_agent_config = AgentConfig(
                    name=f"{self.name}_fallback_{i}",
                    description=fallback_config.get("description", self.config.description),
                    prompt_key=fallback_config.get("prompt_key", self.config.prompt_key),
                    prompt_template=fallback_config.get("prompt_template", self.config.prompt_template),
                    system_prompt=fallback_config.get("system_prompt", self.config.system_prompt),
                    model=fallback_config.get("model", self.config.model),
                    temperature=fallback_config.get("temperature", self.config.temperature),
                    max_tokens=fallback_config.get("max_tokens", self.config.max_tokens),
                    response_format=fallback_config.get("response_format", self.config.response_format),
                    input_mapping=fallback_config.get("input_mapping", self.config.input_mapping),
                    output_mapping=fallback_config.get("output_mapping", self.config.output_mapping),
                    state_updates=fallback_config.get("state_updates", self.config.state_updates),
                    inject_persona=fallback_config.get("inject_persona", self.config.inject_persona),
                    persona_sections=fallback_config.get("persona_sections", self.config.persona_sections),
                    tools=fallback_config.get("tools", self.config.tools),
                    max_steps=fallback_config.get("max_steps", self.config.max_steps),
                    multi_turn=fallback_config.get("multi_turn", self.config.multi_turn),
                    permissions=fallback_config.get("permissions", self.config.permissions),
                    output_schema=fallback_config.get("output_schema", self.config.output_schema),
                )

                fallback_agent = DeclarativeAgent(
                    config=fallback_agent_config,
                    llm_client=self._llm_client,
                    tool_registry=self._tool_registry,
                    prompt_manager=self._prompt_manager,
                )

                output = await fallback_agent._execute_once(input_data, state, params)
                output.metadata["fallback_index"] = i
                output.metadata["fallback_of"] = self.name
                return output

            except Exception as e:
                logger.warning(
                    f"DeclarativeAgent '{self.name}': fallback {i + 1} failed: {e}"
                )
                continue

        return None

    @classmethod
    def from_yaml(cls, yaml_path: str | Path, **kwargs: Any) -> DeclarativeAgent:
        """从YAML文件创建DeclarativeAgent。

        Args:
            yaml_path: YAML配置文件路径
            **kwargs: 额外参数，如llm_client, tool_registry, prompt_manager

        Returns:
            配置好的DeclarativeAgent实例
        """
        path = Path(yaml_path)
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        if not isinstance(raw, dict):
            raise ValueError(f"YAML file {path} must contain a mapping at the top level")

        return cls.from_config(raw, **kwargs)

    @classmethod
    def from_config(cls, config: dict, **kwargs: Any) -> DeclarativeAgent:
        """从配置字典创建DeclarativeAgent。

        Args:
            config: 配置字典，匹配AgentConfig字段
            **kwargs: 额外参数，如llm_client, tool_registry, prompt_manager

        Returns:
            配置好的DeclarativeAgent实例
        """
        agent_config = AgentConfig(**config)
        return cls(
            config=agent_config,
            llm_client=kwargs.get("llm_client"),
            tool_registry=kwargs.get("tool_registry"),
            prompt_manager=kwargs.get("prompt_manager"),
        )


class DeclarativeAgentAdapter(BaseAgent):
    """将DeclarativeAgent适配为FlowForge BaseAgent接口。

    使DeclarativeAgent可以通过AgentRegistry注册和发现，
    与其他BaseAgent实现无缝协作。

    Usage:
        agent = DeclarativeAgent.from_yaml("config/agents/topic_agent.yaml")
        adapter = DeclarativeAgentAdapter(agent)
        agent_registry.register(adapter)
    """

    def __init__(self, declarative_agent: DeclarativeAgent) -> None:
        self._agent = declarative_agent
        self.name = declarative_agent.name
        self.description = declarative_agent.description
        self.default_mode = None

    async def execute(self, input: AgentInput) -> AgentOutput:
        """执行DeclarativeAgent。"""
        return await self._agent.execute(input)

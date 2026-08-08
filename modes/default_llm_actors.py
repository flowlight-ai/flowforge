import json
import re

from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class DefaultLLMActor(BaseAgent):
    name = "default_actor"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"output": "LLMTool not available"})
        task = input.params.get("task", "")
        memory = input.params.get("memory", [])
        memory_text = "\n".join(str(m) for m in memory[-3:]) if memory else ""
        # P0-1: 优先使用agent的instructions（来自DeclarativeAgent的prompt_template）
        # 而非通用的 reflexion.actor prompt，确保writer agent的 contentforge.writer.main 被使用
        system_prompt = ""
        if hasattr(context, 'instructions') and context.instructions:
            system_prompt = context.instructions
        elif input.params.get("instructions"):
            system_prompt = input.params.get("instructions")
        else:
            system_prompt = get_prompt("reflexion.actor") or "你是内容创作者"
        if memory_text:
            system_prompt += f"\n\n之前的反思和改进建议:\n{memory_text}"
        persona = context.persona or "default"
        if persona == "default":
            task_lower = task.lower()
            code_keywords = ["代码", "编程", "写代码", "code", "python", "算法", "函数", "排序", "实现", "程序", "javascript", "java", "rust", "golang"]
            if any(kw in task_lower for kw in code_keywords):
                persona = "coding"
        # P0-5: 传递prefer_api到LLM调用，writer agent优先使用API backend
        # 避免WebChat backend浏览器会话过期导致300s超时
        prefer_api = input.params.get("prefer_api", False) if hasattr(input, 'params') and input.params else False
        # B4 修复：从context或input.params获取真实agent_name，而非硬编码"reflexion_actor"
        # 原代码硬编码导致LLM超时路由失效（agent_routes映射的是contentforge:writer→creative→60s，
        # 但硬编码的reflexion_actor不在agent_routes中，回退到default→30s）
        agent_name = "reflexion_actor"
        if hasattr(context, 'agent_name') and context.agent_name:
            agent_name = context.agent_name
        elif hasattr(input, 'params') and input.params:
            agent_name = input.params.get('agent_name', input.params.get('_agent_name', 'reflexion_actor'))
        llm_params = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": task[:2000]},
            ],
            "stream": False, "task_id": context.task_id,
            "agent_name": agent_name, "persona": persona,
        }
        if prefer_api:
            llm_params["prefer_api"] = True
        result = await context.tools.execute("llm", ToolInput(params=llm_params))
        return AgentOutput(result={"output": result.result.get("content", "")})


class DefaultLLMEvaluator(BaseAgent):
    name = "default_evaluator"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"score": 0.5, "issues": ["No LLM tool"]})
        output_content = input.params.get("output", "")
        if isinstance(output_content, dict):
            output_content = output_content.get("output", output_content.get("draft", str(output_content)))
        prompt = get_prompt("reflexion.evaluator", output=str(output_content)[:3000])
        # v2.7 修复: 加 system prompt 强约束 JSON 输出，避免模型自由发挥对话式回复
        # 原 bug: 只发 user message，DeepSeek-V4-Pro 返回"你这篇文写得太有画面感了..."对话式回复
        # GLM-5.1 返回英文事实核查内容，都不输出 JSON，导致 evaluator 解析失败
        system_prompt = (
            "你是严格的内容质量审核员。你的唯一输出是一个JSON对象，禁止任何对话、解释、前言、寒暄。"
            "JSON格式: {\"score\": 0.85, \"issues\": [\"具体问题1\", \"具体问题2\"]}。"
            "score必须在0-1之间（0.85=良好，0.6=及格，0.3=差）。issues列出最多3个最关键的问题。"
            "再次强调：只输出JSON，第一个字符必须是{，最后一个字符必须是}。"
        )
        llm_params = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "stream": False, "task_id": context.task_id,
            "agent_name": "reflexion_evaluator", "persona": input.params.get("persona", context.persona or "default"),
            "temperature": 0.1,  # v2.7: 低温提高 JSON 输出稳定性
            # v4.6 性能修复: prefer_api=True 走 API backend (2-10s/模型)
            # 原本走 WebChat 通道，4个模型各超时30s = 120s+，导致总超时900s触发
            "prefer_api": True,
        }
        # 支持外部指定模型（如agent_judge传入deepseek-web/chat）
        model_hint = input.params.get("model")
        if model_hint:
            llm_params["model"] = model_hint
        result = await context.tools.execute("llm", ToolInput(params=llm_params))
        content = result.result.get("content", "{}")
        # v2.7: 增强JSON解析 - 尝试多种模式
        match = re.search(r'\{[^{}]*"score"[^{}]*\}', content, re.DOTALL)
        if not match:
            match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                # 验证 score 字段
                if "score" in parsed:
                    score = float(parsed["score"])
                    if 0 <= score <= 1:
                        return AgentOutput(result=parsed)
                    return AgentOutput(result={"score": max(0.0, min(1.0, score)),
                                                "issues": parsed.get("issues", [])})
            except (json.JSONDecodeError, ValueError, TypeError):
                pass
        # v2.7: 解析失败时返回 score=-1 表示"评估失败"，让 LoopExecutor 跳过 evaluator 评分
        # 原 bug: 返回 score=0.5 导致 reflexion 误判失败，触发不必要的迭代
        return AgentOutput(result={"score": -1.0, "issues": [f"评估解析失败(将由verifier兜底): {content[:80]}"]})


class DefaultLLMReflector(BaseAgent):
    name = "default_reflector"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"reflection": "无法连接到 LLM"})
        output_content = input.params.get("output", "")
        if isinstance(output_content, dict):
            output_content = output_content.get("output", output_content.get("draft", str(output_content)))
        issues = input.params.get('issues', [])
        if isinstance(issues, list):
            issues_text = "; ".join(str(i) for i in issues) if issues else "无"
        else:
            issues_text = str(issues)
        prompt = get_prompt("reflexion.reflector",
            output=str(output_content)[:3000],
            issues=issues_text)
        # v2.7 修复: 加 system prompt 强约束 JSON 输出
        system_prompt = (
            "你是严格的反思员。你的唯一输出是一个JSON对象，禁止任何对话或解释。"
            "JSON格式: {\"reflection\": \"1. 具体改进建议1；2. 具体改进建议2；3. 具体改进建议3\"}。"
            "每条建议必须可执行：明确指出改哪一段/加什么内容/删什么内容/换成什么表达。"
            "禁止空泛建议如'加强深度'、'提升质量'。"
            "再次强调：只输出JSON，第一个字符必须是{，最后一个字符必须是}。"
        )
        result = await context.tools.execute("llm", ToolInput(params={
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "stream": False, "task_id": context.task_id,
            "agent_name": "reflexion_reflector", "persona": input.params.get("persona", context.persona or "default"),
            "temperature": 0.1,
            # v4.6 性能修复: prefer_api=True 走 API backend (2-10s/模型)
            # 原本走 WebChat 通道，4个模型各超时30s = 120s+，导致总超时900s触发
            "prefer_api": True,
        }))
        content = result.result.get("content", "{}")
        match = re.search(r'\{[^{}]*"reflection"[^{}]*\}', content, re.DOTALL)
        if not match:
            match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"reflection": content[:300]})

import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class CodeWriterAgent(BaseAgent):
    name = "code_writer_agent"
    description = "代码编写 Agent：使用 LLM 生成代码，通过 python_executor 测试，用 file_rw 保存"
    default_mode = "react"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.core.task_context import TaskContext
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        try:
            from flowforge.app.deps import get_executor
            executor = get_executor()
            if executor:
                ctx.tools = executor.tool_registry
                ctx.agents = executor.agent_registry
                ctx.event_bus = executor.event_bus
                ctx.executor = executor
        except Exception:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        requirements = input.params.get("requirements", "")
        language = input.params.get("language", "python")
        save_path = input.params.get("save_path", "")
        test_code = input.params.get("test", True)
        llm = context.tools.get_tool("llm")

        if not requirements:
            return AgentOutput(result={"code": ""})

        # Step 1: analyze_requirements — 分析需求并设计
        context.event_bus.emit(context.task_id, "code_writer_agent.analyze_requirements_start", {
            "language": language, "requirements_length": len(requirements),
        })
        analyze_prompt = get_prompt("agent.code_analyze", language=language, requirements=requirements)
        design = {}
        try:
            result = await llm.execute(ToolInput(params={
                "messages": [{"role": "user", "content": analyze_prompt}],
                "stream": True, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            }))
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                design = json.loads(match.group())
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "code_writer_agent.analyze_requirements_complete", {
            "modules_count": len(design.get("modules", [])),
            "edge_cases_count": len(design.get("edge_cases", [])),
        })

        # Step 2: generate_code — 生成代码
        context.event_bus.emit(context.task_id, "code_writer_agent.generate_code_start", {
            "language": language,
        })
        design_context = ""
        if design:
            design_context = (
                f"\n设计方案: 模块={design.get('modules', [])}, "
                f"算法={design.get('algorithm', '')}, "
                f"边界情况={design.get('edge_cases', [])}, "
                f"依赖={design.get('dependencies', [])}"
            )
        system_prompt = get_prompt("agent.code_generate", language=language, requirements=requirements, design=design_context)
        code = ""
        try:
            llm_result = await llm.execute(ToolInput(params={
                "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": requirements}],
                "max_tokens": 2000,
                "stream": True, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            }))
            code = llm_result.result.get("content", "")
        except Exception:
            pass

        if code.startswith("```"):
            lines = code.split("\n")
            code = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        context.event_bus.emit(context.task_id, "code_writer_agent.generate_code_complete", {
            "code_length": len(code),
        })

        # Step 3: review_code — 审查代码质量
        context.event_bus.emit(context.task_id, "code_writer_agent.review_code_start", {
            "code_length": len(code),
        })
        execution_result = None
        if code:
            if test_code and language.lower() == "python":
                try:
                    executor = context.tools.get_tool("python_executor")
                    exec_output = await executor.execute(
                        ToolInput(params={"code": code, "timeout": 15})
                    )
                    execution_result = exec_output.result
                    if exec_output.error:
                        execution_result["error"] = exec_output.error
                except Exception as e:
                    execution_result = {"stdout": "", "stderr": str(e)}

            review_prompt = get_prompt("agent.code_review", language=language, requirements=requirements, code=code[:2000])
            try:
                result = await llm.execute(ToolInput(params={
                    "messages": [{"role": "user", "content": review_prompt}],
                    "stream": True, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                }))
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    review_data = json.loads(match.group())
                    if not review_data.get("approved", True) and review_data.get("issues"):
                        fix_prompt = (
                            f"根据审查意见修复代码。只输出修复后的完整代码，不要解释。\n\n"
                            f"原始代码:\n{code}\n\n"
                            f"审查问题: {review_data['issues']}\n"
                            f"优化建议: {review_data.get('suggestions', [])}"
                        )
                        fix_result = await llm.execute(ToolInput(params={
                            "messages": [{"role": "user", "content": fix_prompt}],
                            "max_tokens": 2000,
                            "stream": True, "task_id": context.task_id,
                            "agent_name": self.name, "persona": context.persona or "default",
                        }))
                        fixed_code = fix_result.result.get("content", "")
                        if fixed_code.startswith("```"):
                            flines = fixed_code.split("\n")
                            fixed_code = "\n".join(flines[1:-1] if flines[-1].strip() == "```" else flines[1:])
                        if fixed_code:
                            code = fixed_code
            except Exception:
                pass
        context.event_bus.emit(context.task_id, "code_writer_agent.review_code_complete", {
            "final_code_length": len(code),
            "execution_tested": execution_result is not None,
        })

        if save_path and code:
            try:
                file_rw = context.tools.get_tool("file_rw")
                await file_rw.execute(
                    ToolInput(params={"path": save_path, "action": "write", "content": code})
                )
            except Exception:
                pass

        # Step 4: complete
        context.event_bus.emit(context.task_id, "code_writer_agent.complete", {
            "code_length": len(code),
        })
        return AgentOutput(result={"code": code})

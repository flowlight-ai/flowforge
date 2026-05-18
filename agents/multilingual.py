import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class MultilingualAgent(BaseAgent):
    name = "multilingual"
    description = "多语言翻译与本地化适配"
    default_mode = "plan_execute"

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
        text = input.params.get("text", input.params.get("draft", ""))
        target_lang = input.params.get("target_lang", "en")
        llm = context.tools.get_tool("llm")

        # Step 1: detect_language — 检测源语言
        context.event_bus.emit(context.task_id, "multilingual.detect_language_start", {
            "text_length": len(text), "target_lang": target_lang,
        })
        detect_prompt = get_prompt("agent.multilingual_detect", text=text[:1000])
        source_lang = "unknown"
        try:
            result = await llm.execute(ToolInput(params={
                "messages": [{"role": "user", "content": detect_prompt}],
                "stream": True, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            }))
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                source_lang = data.get("source_lang", "unknown")
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "multilingual.detect_language_complete", {
            "source_lang": source_lang,
        })

        # Step 2: translate — 执行翻译
        context.event_bus.emit(context.task_id, "multilingual.translate_start", {
            "source_lang": source_lang, "target_lang": target_lang,
        })
        lang_names = {
            "zh": "中文", "en": "English", "ja": "日本語", "ko": "한국어",
            "fr": "Français", "de": "Deutsch", "es": "Español", "ru": "Русский",
        }
        source_name = lang_names.get(source_lang, source_lang)
        target_name = lang_names.get(target_lang, target_lang)
        translate_prompt = get_prompt("agent.multilingual_translate", source_lang=source_name, target_lang=target_name, text=text[:2000])
        translated = ""
        try:
            result = await llm.execute(ToolInput(params={
                "messages": [{"role": "system", "content": translate_prompt}, {"role": "user", "content": "请翻译"}],
                "max_tokens": 2000,
                "stream": True, "task_id": context.task_id,
                "agent_name": self.name, "persona": context.persona or "default",
            }))
            translated = result.result.get("content", "")
        except Exception:
            pass
        context.event_bus.emit(context.task_id, "multilingual.translate_complete", {
            "translated_length": len(translated),
        })

        # Step 3: verify — 验证翻译质量
        context.event_bus.emit(context.task_id, "multilingual.verify_start", {
            "target_lang": target_lang,
        })
        verified = translated
        if translated:
            verify_prompt = get_prompt("agent.multilingual_verify", source_lang=source_name, target_lang=target_name, source_text=text[:1000], translated_text=translated[:1000])
            try:
                result = await llm.execute(ToolInput(params={
                    "messages": [{"role": "user", "content": verify_prompt}],
                    "stream": True, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                }))
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    if data.get("verified_translation"):
                        verified = data["verified_translation"]
            except Exception:
                pass
        context.event_bus.emit(context.task_id, "multilingual.verify_complete", {
            "final_length": len(verified),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "multilingual.complete", {
            "source_lang": source_lang, "target_lang": target_lang,
            "translated_length": len(verified),
        })
        return AgentOutput(result={"translated": verified, "target_lang": target_lang})

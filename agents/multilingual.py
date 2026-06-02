import asyncio
import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("multilingual_agent")

_TOOL_TIMEOUT = 300


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
        except Exception as e:
            logger.warning(f"Failed to get executor: {e}", task_id=ctx.task_id)
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        # Try multiple sources for text to translate, in priority order:
        # 1. Explicit "text" param
        # 2. "draft" param (from article_writing output)
        # 3. "_last_output" (from workflow step context)
        # 4. "_output_article_writing" (from specific agent output)
        # 5. "task" or "query" as fallback
        text = input.params.get("text", "")
        if not text or len(text.strip()) < 20:
            text = input.params.get("draft", "")
        if not text or len(text.strip()) < 20:
            text = input.params.get("_last_output", "")
        if not text or len(text.strip()) < 20:
            text = input.params.get("_output_article_writing", "")
        if not text or len(text.strip()) < 20:
            text = input.params.get("task", input.params.get("query", ""))
        target_lang = input.params.get("target_lang", "en")

        # Step 1: detect_language — 检测源语言
        context.event_bus.emit(context.task_id, "multilingual.detect_language_start", {
            "text_length": len(text), "target_lang": target_lang,
        })
        detect_prompt = get_prompt("agent.multilingual_detect", text=text[:1000])
        source_lang = "unknown"
        try:
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "user", "content": detect_prompt}],
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            content = result.result.get("content", "{}")
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                data = json.loads(match.group())
                source_lang = data.get("source_lang", "unknown")
        except asyncio.TimeoutError:
            logger.warning("Language detection timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Language detection failed: {e}", task_id=context.task_id)
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
            result = await asyncio.wait_for(
                context.tools.execute("llm", ToolInput(params={
                    "messages": [{"role": "system", "content": translate_prompt}, {"role": "user", "content": "请翻译"}],
                    "max_tokens": 2000,
                    "stream": False, "task_id": context.task_id,
                    "agent_name": self.name, "persona": context.persona or "default",
                })),
                timeout=_TOOL_TIMEOUT,
            )
            translated = result.result.get("content", "")
        except asyncio.TimeoutError:
            logger.warning("Translation timed out", task_id=context.task_id)
        except Exception as e:
            logger.warning(f"Translation failed: {e}", task_id=context.task_id)
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
                result = await asyncio.wait_for(
                    context.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": verify_prompt}],
                        "stream": False, "task_id": context.task_id,
                        "agent_name": self.name, "persona": context.persona or "default",
                    })),
                    timeout=_TOOL_TIMEOUT,
                )
                content = result.result.get("content", "{}")
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    if data.get("verified_translation"):
                        verified = data["verified_translation"]
            except asyncio.TimeoutError:
                logger.warning("Translation verification timed out", task_id=context.task_id)
            except Exception as e:
                logger.warning(f"Translation verification failed: {e}", task_id=context.task_id)
        context.event_bus.emit(context.task_id, "multilingual.verify_complete", {
            "final_length": len(verified),
        })

        # Step 4: complete
        context.event_bus.emit(context.task_id, "multilingual.complete", {
            "source_lang": source_lang, "target_lang": target_lang,
            "translated_length": len(verified),
        })
        return AgentOutput(result={"translated": verified, "target_lang": target_lang})

from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from typing import Optional


class MultilingualAgent(GenericAgent):
    name = "multilingual"
    description = "多语言翻译：检测语言、翻译、验证翻译质量"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        text = input.params.get("text", "")
        mode = input.params.get("mode", "translate")
        source_lang = input.params.get("source_lang", "")
        target_lang = input.params.get("target_lang", "en")

        if mode == "detect":
            prompt = self._get_prompt("agent.multilingual_detect", text=text)
            content = await self._call_llm(context, prompt) if prompt else ""
            data = self._extract_json(content) if content else {}
            if isinstance(data, str):
                data = {"detected_lang": "unknown", "lang_name": data}
            return AgentOutput(result={"detection": data}, state_updates={"detected_lang": data})

        if mode == "verify":
            source_text = input.params.get("source_text", text)
            translated_text = input.params.get("translated_text", "")
            prompt = self._get_prompt(
                "agent.multilingual_verify",
                source_text=source_text,
                translated_text=translated_text,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            data = self._extract_json(content) if content else {}
            if isinstance(data, str):
                data = {"quality_score": 0.5, "issues": [data], "corrected": ""}
            return AgentOutput(result={"verification": data}, state_updates={"translation_verification": data})

        prompt = self._get_prompt(
            "agent.multilingual_translate",
            source_lang=source_lang or "自动检测",
            target_lang=target_lang,
            text=text,
        )
        content = await self._call_llm(context, prompt) if prompt else ""

        return AgentOutput(
            result={"translated": content, "source_lang": source_lang, "target_lang": target_lang},
            state_updates={"translated_text": content, "target_lang": target_lang},
        )

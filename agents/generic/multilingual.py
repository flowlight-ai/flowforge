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
            prompt = (
                "检测以下文本的语言。\n"
                '输出JSON: {"detected_lang": "语言代码", "lang_name": "语言名称"}\n\n'
                f"文本: {text}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = {"detected_lang": "unknown", "lang_name": data}
            return AgentOutput(result={"detection": data}, state_updates={"detected_lang": data})

        if mode == "verify":
            source_text = input.params.get("source_text", text)
            translated_text = input.params.get("translated_text", "")
            prompt = (
                "验证以下翻译的质量。检查是否有遗漏、误译或不自然的表达。\n"
                '输出JSON: {"quality_score": 0.9, "issues": ["问题1"], '
                '"corrected": "修正后的翻译（如有问题）"}\n\n'
                f"原文: {source_text}\n"
                f"译文: {translated_text}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = {"quality_score": 0.5, "issues": [data], "corrected": ""}
            return AgentOutput(result={"verification": data}, state_updates={"translation_verification": data})

        prompt = (
            f"将以下文本从{source_lang or '自动检测'}翻译为{target_lang}。保持原文的语气和风格。\n"
            "直接输出翻译结果，不要输出JSON。\n\n"
            f"文本: {text}"
        )

        content = await self._call_llm(context, prompt)

        return AgentOutput(
            result={"translated": content, "source_lang": source_lang, "target_lang": target_lang},
            state_updates={"translated_text": content, "target_lang": target_lang},
        )

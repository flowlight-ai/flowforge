"""Translation Tool — 基于LLM的跨境电商多语言翻译工具.

支持11种语言的电商场景感知翻译，包括商品名称、描述、规格、客服话术等。
使用OpenRoute LLM进行真实翻译，通过tool_registry调用llm工具。

Languages: en, zh, ja, ko, de, fr, es, it, pt, ar, ru
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.translation")


class TranslationTool(BaseTool):
    """LLM-powered translation tool for cross-border e-commerce.

    Supports 11 languages with e-commerce context awareness.
    Uses the `llm` tool from the SDK for actual translation via OpenRoute.
    """

    name = "translation"
    description = "跨境电商多语言翻译工具：支持11种语言的商品名称、描述、规格、客服话术翻译"
    parameters_schema: Dict[str, Any] = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["translate", "batch_translate"],
                "description": "操作类型：translate=单条翻译, batch_translate=批量翻译",
            },
            "text": {
                "type": "string",
                "description": "待翻译文本（translate操作）",
            },
            "texts": {
                "type": "array",
                "items": {"type": "string"},
                "description": "待翻译文本列表（batch_translate操作）",
            },
            "source_lang": {
                "type": "string",
                "default": "auto",
                "description": "源语言代码（auto=自动检测）",
            },
            "target_lang": {
                "type": "string",
                "default": "en",
                "description": "目标语言代码",
            },
            "context": {
                "type": "string",
                "default": "ecommerce",
                "description": "翻译上下文：ecommerce=电商通用, listing=商品上架, "
                               "customer_service=客服话术, specification=产品规格",
            },
        },
    }
    safety_level = "readonly"
    is_concurrency_safe = True

    SUPPORTED_LANGUAGES: Dict[str, str] = {
        "en": "English",
        "zh": "中文",
        "ja": "日本語",
        "ko": "한국어",
        "de": "Deutsch",
        "fr": "Français",
        "es": "Español",
        "it": "Italiano",
        "pt": "Português",
        "ar": "العربية",
        "ru": "Русский",
    }

    CONTEXT_PROMPTS: Dict[str, str] = {
        "ecommerce": (
            "You are a professional e-commerce translator. "
            "Translate the text for cross-border e-commerce use. "
            "Keep product names, brand names, and technical specifications untranslated. "
            "Adapt idioms and marketing language to the target culture. "
            "Maintain a professional and persuasive tone."
        ),
        "listing": (
            "You are an e-commerce listing optimization expert. "
            "Translate the product listing text (title, bullet points, description) "
            "for the target market. Optimize for local search keywords. "
            "Keep brand names and model numbers untranslated. "
            "Ensure the translation reads naturally for local consumers."
        ),
        "customer_service": (
            "You are a multilingual customer service translator. "
            "Translate customer service messages maintaining a polite, "
            "professional, and empathetic tone. Adapt cultural nuances "
            "appropriately (e.g., honorifics in Japanese/Korean). "
            "Keep order numbers and product codes untranslated."
        ),
        "specification": (
            "You are a technical specification translator for e-commerce products. "
            "Translate product specifications precisely. Keep all numbers, "
            "units, and technical terms accurate. Use standard industry "
            "terminology in the target language. Do not localize units "
            "unless explicitly requested."
        ),
    }

    def __init__(self, tool_registry=None):
        self._tool_registry = tool_registry

    def set_tool_registry(self, tool_registry) -> None:
        self._tool_registry = tool_registry

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action", "translate")

        if action == "translate":
            return await self._translate_single(input.params)
        elif action == "batch_translate":
            return await self._translate_batch(input.params)
        else:
            return ToolOutput(result={}, error=f"Unknown action: {action}")

    async def _translate_single(self, params: Dict[str, Any]) -> ToolOutput:
        text = params.get("text", "")
        source_lang = params.get("source_lang", "auto")
        target_lang = params.get("target_lang", "en")
        context_type = params.get("context", "ecommerce")

        if not text:
            return ToolOutput(result={}, error="No text provided for translation")

        if target_lang not in self.SUPPORTED_LANGUAGES:
            return ToolOutput(
                result={},
                error=f"Unsupported target language: {target_lang}. "
                      f"Supported: {list(self.SUPPORTED_LANGUAGES.keys())}",
            )

        source_desc = self.SUPPORTED_LANGUAGES.get(source_lang, source_lang) if source_lang != "auto" else "auto-detect"
        target_desc = self.SUPPORTED_LANGUAGES.get(target_lang, target_lang)
        context_prompt = self.CONTEXT_PROMPTS.get(context_type, self.CONTEXT_PROMPTS["ecommerce"])

        prompt = (
            f"{context_prompt}\n\n"
            f"Translate the following text from {source_desc} to {target_desc}.\n\n"
            f"Text to translate:\n{text}\n\n"
            f"Provide ONLY the translated text, without any explanations, notes, or quotes."
        )

        translated = await self._call_llm(prompt)

        if translated is None:
            return ToolOutput(
                result={
                    "translated_text": text,
                    "source_lang": source_lang,
                    "target_lang": target_lang,
                    "context": context_type,
                    "note": "LLM unavailable, returned original text",
                },
            )

        return ToolOutput(result={
            "translated_text": translated.strip(),
            "source_lang": source_lang,
            "target_lang": target_lang,
            "context": context_type,
        })

    async def _translate_batch(self, params: Dict[str, Any]) -> ToolOutput:
        texts = params.get("texts", [])
        source_lang = params.get("source_lang", "auto")
        target_lang = params.get("target_lang", "en")
        context_type = params.get("context", "ecommerce")

        if not texts:
            return ToolOutput(result={}, error="No texts provided for batch translation")

        if target_lang not in self.SUPPORTED_LANGUAGES:
            return ToolOutput(
                result={},
                error=f"Unsupported target language: {target_lang}. "
                      f"Supported: {list(self.SUPPORTED_LANGUAGES.keys())}",
            )

        source_desc = self.SUPPORTED_LANGUAGES.get(source_lang, source_lang) if source_lang != "auto" else "auto-detect"
        target_desc = self.SUPPORTED_LANGUAGES.get(target_lang, target_lang)
        context_prompt = self.CONTEXT_PROMPTS.get(context_type, self.CONTEXT_PROMPTS["ecommerce"])

        # Build a structured prompt for batch translation
        numbered_texts = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
        prompt = (
            f"{context_prompt}\n\n"
            f"Translate the following {len(texts)} texts from {source_desc} to {target_desc}.\n\n"
            f"Texts to translate:\n{numbered_texts}\n\n"
            f"Return a JSON array of translated strings in the same order. "
            f"Each element should be the translation of the corresponding input text. "
            f"Return ONLY the JSON array, no other text."
        )

        llm_output = await self._call_llm(prompt)

        if llm_output is None:
            # Fallback: translate one by one
            results = []
            for text in texts:
                single_result = await self._translate_single({
                    "text": text,
                    "source_lang": source_lang,
                    "target_lang": target_lang,
                    "context": context_type,
                })
                results.append(single_result.result.get("translated_text", text))
            return ToolOutput(result={
                "translated_texts": results,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "context": context_type,
                "data_source": "llm_single_fallback",
            })

        # Parse JSON array from LLM output
        translated = self._parse_json_array(llm_output)
        if translated and isinstance(translated, list) and len(translated) == len(texts):
            return ToolOutput(result={
                "translated_texts": translated,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "context": context_type,
                "data_source": "llm_batch",
            })

        # If batch parsing failed, try individual translations
        results = []
        for text in texts:
            single_result = await self._translate_single({
                "text": text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "context": context_type,
            })
            results.append(single_result.result.get("translated_text", text))

        return ToolOutput(result={
            "translated_texts": results,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "context": context_type,
            "data_source": "llm_single_fallback",
        })

    async def _call_llm(self, prompt: str) -> Optional[str]:
        """Call the LLM tool for translation."""
        if not self._tool_registry:
            logger.warning("No tool_registry available for LLM call")
            return None
        try:
            result = await self._tool_registry.execute(
                "llm",
                ToolInput(params={
                    "messages": [{"role": "user", "content": prompt}],
                    "model": "default",
                    "temperature": 0.3,
                    "max_tokens": 4000,
                }),
            )
            if result.error:
                logger.warning(f"LLM call failed: {result.error}")
                return None
            content = result.result.get("content", "")
            if not content:
                content = result.result.get("text", "")
            return content
        except Exception as e:
            logger.warning(f"LLM call exception: {e}")
            return None

    @staticmethod
    def _parse_json_array(text: str) -> Optional[list]:
        """Extract a JSON array from LLM output text."""
        text = text.strip()
        # Try direct parse
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
        # Try extracting from ```json ... ``` block
        import re
        match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1).strip())
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass
        # Try finding first [ to last ]
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(text[start:end + 1])
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass
        return None

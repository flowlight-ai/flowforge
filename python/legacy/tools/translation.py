"""Translation Tool — 基于LLM的跨境电商多语言翻译工具.

支持11种语言的电商场景感知翻译，包括商品名称、描述、规格、客服话术等。
使用OpenRoute LLM进行真实翻译，通过tool_registry调用llm工具。

Languages: en, zh, ja, ko, de, fr, es, it, pt, ar, ru
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import yaml

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.translation")


# 提示词配置文件路径（红线#11：禁止硬编码提示词）
_PROMPTS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "prompts.yaml",
)


def _load_translation_context_prompt(context_type: str, target_lang: str = "", text: str = "") -> str:
    """从 config/prompts.yaml 加载 tools.translation.context.* 提示词.

    Args:
        context_type: 场景类型（ecommerce/listing/customer_service/specification）
        target_lang: 目标语言（用于模板渲染）
        text: 待翻译文本（用于模板渲染）

    Returns:
        渲染后的提示词字符串，未命中则返回空字符串（fail-open）
    """
    full_key = f"tools.translation.context.{context_type}"
    try:
        if not os.path.exists(_PROMPTS_PATH):
            logger.error(f"[translation] prompts file not found: {_PROMPTS_PATH} (fail-open)")
            return ""
        with open(_PROMPTS_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        template = data.get(full_key, "")
        if not template:
            logger.error(f"[translation] prompt '{full_key}' not found in prompts.yaml (fail-open)")
            return ""
        if target_lang or text:
            try:
                return template.format(target_lang=target_lang, text=text)
            except (KeyError, ValueError, IndexError) as e:
                logger.warning(f"[translation] prompt '{full_key}' format error: {e}")
                return template
        return template
    except Exception as e:
        logger.error(f"[translation] failed to load prompt '{full_key}': {e} (fail-open)")
        return ""


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

    CONTEXT_PROMPTS: Dict[str, str] = {}  # 外置到 config/prompts.yaml（tools.translation.context.*）
    # 调用处通过 _load_translation_context_prompt() 加载

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
        context_prompt = _load_translation_context_prompt(context_type, target_lang=target_desc, text=text)
        if not context_prompt:
            # fail-open: 使用 ecommerce 作为默认场景
            context_prompt = _load_translation_context_prompt("ecommerce", target_lang=target_desc, text=text)

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
        text = texts[0] if texts else ""
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
        context_prompt = _load_translation_context_prompt(context_type, target_lang=target_desc, text=text)
        if not context_prompt:
            # fail-open: 使用 ecommerce 作为默认场景
            context_prompt = _load_translation_context_prompt("ecommerce", target_lang=target_desc, text=text)

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

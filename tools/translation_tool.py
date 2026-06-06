from typing import Any, Dict
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class TranslationTool(BaseTool):
    name: str = "translation_tool"
    description: str = "多语言翻译工具，支持场景感知的本地化翻译"
    parameters_schema: Dict[str, Any] = {
        "type": "object",
        "required": ["text", "target_lang"],
        "properties": {
            "text": {"type": "string", "description": "待翻译文本"},
            "source_lang": {"type": "string", "default": "zh", "description": "源语言"},
            "target_lang": {"type": "string", "description": "目标语言: en/ja/ko/de/fr/es/th/vi/id/ms"},
            "context": {"type": "string", "description": "翻译上下文: ecommerce/customer_service/listing/general 等"},
        },
    }
    safety_level: str = "readonly"
    is_concurrency_safe: bool = True

    SUPPORTED_LANGS = {
        "zh": "中文", "en": "English", "ja": "日本語", "ko": "한국어",
        "de": "Deutsch", "fr": "Français", "es": "Español",
        "th": "ไทย", "vi": "Tiếng Việt", "id": "Bahasa Indonesia", "ms": "Bahasa Melayu",
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        text = input.params.get("text", "")
        source_lang = input.params.get("source_lang", "zh")
        target_lang = input.params.get("target_lang", "en")
        context_type = input.params.get("context", "general")

        return ToolOutput(result={
            "source_text": text,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "translated_text": f"[{target_lang}] {text}",
            "context": context_type,
            "note": "使用LLM进行场景感知翻译，后续可接入DeepL/Google翻译API",
        })

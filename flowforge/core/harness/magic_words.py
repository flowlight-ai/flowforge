"""Magic Words — escape-hatch / kill-switch registry (roleagent.md Ch.7).

Layer 5 of the Harness seven-layer guardrail. Distinct from
``flowforge.forgemind.magic_words`` (the CVO interrupt protocol): this
module is the harness-level escape hatch that any layer can monitor for.
Supports bilingual (Chinese + English) trigger phrases.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.magic_words")

__all__ = [
    "MagicWordAction",
    "DetectedMagicWord",
    "MagicWordsRegistry",
    "DEFAULT_MAGIC_WORDS",
]


class MagicWordAction(str, Enum):
    """Action triggered when a magic word is detected."""

    HALT = "halt"
    PAUSE = "pause"
    ESCALATE = "escalate"
    ROLLBACK = "rollback"


@dataclass(frozen=True)
class DetectedMagicWord:
    """One detected occurrence of a registered magic word."""

    word: str
    action: MagicWordAction
    position: int
    context: str


# Default bilingual escape-hatch words. Callers may register more via
# ``register_word`` or build a pre-loaded registry via ``with_defaults``.
DEFAULT_MAGIC_WORDS: dict[str, MagicWordAction] = {
    "stop": MagicWordAction.HALT,
    "停止": MagicWordAction.HALT,
    "halt": MagicWordAction.HALT,
    "中止": MagicWordAction.HALT,
    "abort": MagicWordAction.HALT,
    "pause": MagicWordAction.PAUSE,
    "暂停": MagicWordAction.PAUSE,
    "escalate": MagicWordAction.ESCALATE,
    "升级": MagicWordAction.ESCALATE,
    "rollback": MagicWordAction.ROLLBACK,
    "回滚": MagicWordAction.ROLLBACK,
}


class MagicWordsRegistry:
    """Escape-hatch word registry. Supports Chinese and English phrases."""

    def __init__(self) -> None:
        self._words: dict[str, MagicWordAction] = {}

    @classmethod
    def with_defaults(cls) -> "MagicWordsRegistry":
        """Build a registry pre-loaded with ``DEFAULT_MAGIC_WORDS``."""
        registry = cls()
        for word, action in DEFAULT_MAGIC_WORDS.items():
            registry.register_word(word, action)
        return registry

    def register_word(self, word: str, action: MagicWordAction) -> None:
        if not word:
            return
        self._words[word] = action
        logger.info(
            f"harness: register_magic_word word={word!r} action={action.value}"
        )

    def detect(self, text: str) -> list[DetectedMagicWord]:
        """Return one ``DetectedMagicWord`` per registered word present in ``text``.

        For each word, the first occurrence's position and surrounding context
        (±20 chars) are reported. Words not present are omitted.
        """
        if not text:
            return []
        detections: list[DetectedMagicWord] = []
        for word, action in self._words.items():
            idx = text.find(word)
            if idx < 0:
                continue
            start = max(0, idx - 20)
            end = min(len(text), idx + len(word) + 20)
            context = text[start:end]
            detections.append(
                DetectedMagicWord(
                    word=word,
                    action=action,
                    position=idx,
                    context=context,
                )
            )
            logger.warning(
                f"harness: magic_word detected word={word!r} "
                f"action={action.value} pos={idx}"
            )
        return detections

    def list_words(self) -> list[str]:
        return list(self._words.keys())

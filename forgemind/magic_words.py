"""Magic words — minimal-bandwidth human interrupt protocol (roleagent.md Ch.3).

Magic words let the CVO interrupt an agent's wrong trajectory with a single
short phrase. They are processed only when emitted by the CVO in the current
instruction; quoted or historical mentions do NOT trigger.

| Phrase | Action |
|--------|--------|
| 第一性原理 | Stop. Are we using complexity to compensate for ignorance? |
| 我能猜出来 | Stop. Read the source of truth; don't substitute inference for query. |
| 下次一定 | Stop. Do it now or sign off explicitly; no "next time". |
| 星星罐子 | P0 irreversible risk. Immediately stop adding side effects. |
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.magic_words")


class MagicWordTrigger(str, Enum):
    STOP_AND_AUDIT = "stop_and_audit"
    STOP_AND_READ_SOURCE = "stop_and_read_source"
    STOP_AND_SIGNOFF = "stop_and_signoff"
    STOP_ALL_SIDE_EFFECTS = "stop_all_side_effects"
    NONE = "none"


@dataclass(frozen=True)
class MagicWord:
    phrase: str
    trigger: MagicWordTrigger
    description: str


MAGIC_WORDS: tuple[MagicWord, ...] = (
    MagicWord(
        phrase="第一性原理",
        trigger=MagicWordTrigger.STOP_AND_AUDIT,
        description="Stop and check if we are using complexity to compensate for ignorance.",
    ),
    MagicWord(
        phrase="我能猜出来",
        trigger=MagicWordTrigger.STOP_AND_READ_SOURCE,
        description="Stop and read the source of truth; do not substitute inference for query.",
    ),
    MagicWord(
        phrase="下次一定",
        trigger=MagicWordTrigger.STOP_AND_SIGNOFF,
        description="Stop. Either do it now or sign off explicitly; no 'next time'.",
    ),
    MagicWord(
        phrase="星星罐子",
        trigger=MagicWordTrigger.STOP_ALL_SIDE_EFFECTS,
        description="P0 irreversible risk. Immediately stop adding side effects.",
    ),
)


def detect_magic_word(instruction: str) -> MagicWord | None:
    """Return the first magic word found in the CVO's current instruction, or None.

    The check is intentionally simple substring matching — callers must ensure
    they pass only the current instruction (not concatenated history) so that
    quoted/historical mentions don't trigger.
    """
    if not instruction:
        return None
    for mw in MAGIC_WORDS:
        if mw.phrase in instruction:
            logger.warning(
                f"magic_word triggered: phrase={mw.phrase!r} action={mw.trigger.value}"
            )
            return mw
    return None


def all_phrases() -> Iterable[str]:
    return [mw.phrase for mw in MAGIC_WORDS]

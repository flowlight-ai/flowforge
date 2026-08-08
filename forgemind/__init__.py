"""forgemind — flowforge application layer for the Forgekin (universal forgekin) vision.

forgekin (灵族) is the universal abstraction for any entity that has been given
a spirit through forging — animals, organizations, objects, fictional characters,
VR/game personas, and more. Each forgekin carries:
- Capability profile (能力画像)
- Blind-spot profile (盲点画像)
- History (履历)
- State (current spirit state)

forgemind also wires in third-party agents (claude code, codex, opencode, trae)
so forgekins can delegate specialized work to them.

Public API:
    Forgekin — universal abstract base class
    ForgekinRegistry — registry + lifecycle
    CouncilChannel — cross-vendor review + push-back
    ExternalAgentAdapter — third-party agent bridge
    MagicWord — defensive magic-word protocol
"""

from __future__ import annotations

from flowforge.forgemind.council import CouncilChannel, CouncilVerdict
from flowforge.forgemind.external_agents import (
    ExternalAgentAdapter,
    ExternalAgentKind,
)
from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinState,
    ForgekinType,
)
from flowforge.forgemind.magic_words import (
    MAGIC_WORDS,
    MagicWord,
    MagicWordTrigger,
)
from flowforge.forgemind.registry import ForgekinRegistry, get_registry

__all__ = [
    "BlindSpot",
    "Capability",
    "CouncilChannel",
    "CouncilVerdict",
    "ExternalAgentAdapter",
    "ExternalAgentKind",
    "Forgekin",
    "ForgekinRegistry",
    "ForgekinState",
    "ForgekinType",
    "MAGIC_WORDS",
    "MagicWord",
    "MagicWordTrigger",
    "get_registry",
]

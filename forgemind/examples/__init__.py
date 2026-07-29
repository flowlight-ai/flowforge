"""Built-in example forgekins — bring the Forgekin vision to life.

Examples:
- animal_companion — a cat spirit (homage to clowder-ai 养小猫)
- organization     — a small team spirit
- object_spirit    — a desk lamp spirit
- fictional_character — Sherlock Holmes spirit
"""

from __future__ import annotations

from flowforge.forgemind.examples.animal_companion import build_cat_companion
from flowforge.forgemind.examples.fictional_character import build_sherlock
from flowforge.forgemind.examples.object_spirit import build_desk_lamp
from flowforge.forgemind.examples.organization import build_team_spirit

__all__ = [
    "build_cat_companion",
    "build_desk_lamp",
    "build_sherlock",
    "build_team_spirit",
]

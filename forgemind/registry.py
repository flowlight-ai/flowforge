"""ForgekinRegistry — registry + lifecycle for forgekins.

Responsibilities:
- Register/unregister forgekins by id
- Lookup by id / name / type / capability
- Iterate active forgekins (energy > 0)
- Default process-wide registry (swappable for tests)
"""

from __future__ import annotations

from typing import Iterable

from flowforge.core.errors import ForgekinError
from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekin import Capability, Forgekin, ForgekinType

logger = get_logger("flowforge.forgemind.registry")


class ForgekinRegistry:
    """In-memory forgekin registry."""

    def __init__(self) -> None:
        self._by_id: dict[str, Forgekin] = {}

    def register(self, forgekin: Forgekin) -> None:
        if forgekin.forgekin_id in self._by_id:
            raise ForgekinError(f"Forgekin {forgekin.forgekin_id!r} already registered")
        self._by_id[forgekin.forgekin_id] = forgekin
        logger.info(
            f"registry: +forgekin id={forgekin.forgekin_id} name={forgekin.name!r} "
            f"type={forgekin.forgekin_type.value}"
        )

    def unregister(self, forgekin_id: str) -> Forgekin:
        if forgekin_id not in self._by_id:
            raise ForgekinError(f"Forgekin {forgekin_id!r} not found")
        fk = self._by_id.pop(forgekin_id)
        logger.info(f"registry: -forgekin id={forgekin_id}")
        return fk

    def get(self, forgekin_id: str) -> Forgekin:
        if forgekin_id not in self._by_id:
            raise ForgekinError(f"Forgekin {forgekin_id!r} not found")
        return self._by_id[forgekin_id]

    def find_by_name(self, name: str) -> list[Forgekin]:
        return [fk for fk in self._by_id.values() if fk.name == name]

    def find_by_type(self, forgekin_type: ForgekinType) -> list[Forgekin]:
        return [fk for fk in self._by_id.values() if fk.forgekin_type == forgekin_type]

    def find_by_capability(
        self,
        capability_name: str,
        min_proficiency: float = 0.5,
    ) -> list[Forgekin]:
        return [
            fk
            for fk in self._by_id.values()
            if fk.has_capability(capability_name, min_proficiency)
        ]

    def list_active(self) -> list[Forgekin]:
        return [fk for fk in self._by_id.values() if fk.state.energy > 0.0]

    def list_all(self) -> list[Forgekin]:
        return list(self._by_id.values())

    def count(self) -> int:
        return len(self._by_id)

    def select_owner(
        self,
        required_capabilities: list[str],
        exclude: Iterable[str] = (),
    ) -> Forgekin | None:
        """Pick the best forgekin to own a task requiring these capabilities.

        Selection heuristic: most matching capabilities × highest energy.
        Ties broken by registration order (deterministic for tests).
        """
        excluded = set(exclude)
        candidates: list[tuple[int, float, int, Forgekin]] = []
        for idx, fk in enumerate(self._by_id.values()):
            if fk.forgekin_id in excluded:
                continue
            if fk.state.energy <= 0.0:
                continue
            matched = sum(1 for c in required_capabilities if fk.has_capability(c))
            if matched == 0 and required_capabilities:
                continue
            min_prof = 1.0
            for c in required_capabilities:
                cap: Capability | None = fk.capabilities.get(c)
                if cap is not None:
                    min_prof = min(min_prof, cap.proficiency)
                else:
                    min_prof = 0.0
                    break
            candidates.append((matched, min_prof, -idx, fk))
        if not candidates:
            return None
        # Sort: most matched, then highest min proficiency, then earliest registered
        candidates.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
        return candidates[0][3]

    def clear(self) -> None:
        self._by_id.clear()


# Process-wide default registry
_default_registry: ForgekinRegistry | None = None


def get_registry() -> ForgekinRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = ForgekinRegistry()
    return _default_registry


def set_registry(registry: ForgekinRegistry | None) -> None:
    """Override default registry (used by tests for isolation)."""
    global _default_registry
    _default_registry = registry

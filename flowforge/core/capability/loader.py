"""ProfileLoader — async YAML persistence for ``CapabilityProfile``.

All I/O is async (``anyio``). YAML schema (see F001 / ADR-004):

    forgekin_id: fk-001
    cognitive_style: analytical
    skill_packages:
      - name: coding
        proficiency: 0.85
        evidence: ["commit abc", "pr 123"]
    blind_spots:
      - name: design
        severity: 0.7
        mitigation: delegate to designer

Boundary铁律: this module is in ``core/`` and depends only on
``flowforge.core.capability.profile`` + ``flowforge.core.{errors,tracing}``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import anyio
import yaml

from flowforge.core.capability.profile import CapabilityProfile
from flowforge.core.errors import CapabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.capability.loader")

__all__ = ["ProfileLoader"]


class ProfileLoader:
    """Async YAML loader/saver for ``CapabilityProfile``."""

    async def load_from_yaml(self, path: Path) -> CapabilityProfile:
        """Load a ``CapabilityProfile`` from a YAML file.

        Args:
            path: path to the YAML file.

        Returns:
            The reconstructed ``CapabilityProfile``.

        Raises:
            CapabilityError: if the file cannot be read, parsed, or validated.
        """
        try:
            async with await anyio.open_file(path, "r", encoding="utf-8") as f:
                raw = await f.read()
        except FileNotFoundError as exc:
            raise CapabilityError(f"profile yaml not found: {path}", cause=exc) from exc
        except OSError as exc:
            raise CapabilityError(
                f"failed to read profile yaml {path}", cause=exc
            ) from exc

        try:
            data = yaml.safe_load(raw)
        except yaml.YAMLError as exc:
            raise CapabilityError(
                f"invalid yaml in {path}: {exc}", cause=exc
            ) from exc

        if data is None:
            raise CapabilityError(f"profile yaml is empty: {path}")
        if not isinstance(data, dict):
            raise CapabilityError(
                f"profile yaml must be a mapping, got {type(data).__name__}"
            )

        profile = CapabilityProfile.from_dict(data)
        logger.info(
            f"capability: loaded profile forgekin_id={profile.forgekin_id} from {path}"
        )
        return profile

    async def save_to_yaml(self, profile: CapabilityProfile, path: Path) -> None:
        """Save a ``CapabilityProfile`` to a YAML file.

        Args:
            profile: the profile to persist.
            path: destination path (parent dirs are created).

        Raises:
            CapabilityError: if the file cannot be written.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        data: dict[str, Any] = profile.to_dict()
        try:
            text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
        except yaml.YAMLError as exc:
            raise CapabilityError(
                f"failed to serialize profile: {exc}", cause=exc
            ) from exc
        try:
            async with await anyio.open_file(path, "w", encoding="utf-8") as f:
                await f.write(text)
        except OSError as exc:
            raise CapabilityError(
                f"failed to write profile yaml {path}", cause=exc
            ) from exc
        logger.info(
            f"capability: saved profile forgekin_id={profile.forgekin_id} to {path}"
        )

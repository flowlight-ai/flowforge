"""EvalConfigLoader — load EvalConfig from YAML.

YAML schema (see task.md P1-5):

    default_quality_bar: 0.85
    signal_weights:
      self_report: 0.2
      observer: 0.4
      telemetry: 0.4
    attribution_rules:
      - keywords: ["timeout", "deadline"]
        type: execution
      - keywords: ["wrong", "incorrect", "hallucination"]
        type: knowledge

File I/O is offloaded to a worker thread (asyncio.to_thread) so the public
loader stays async-friendly while YAML parsing itself remains synchronous.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.errors import EvalError
from flowforge.core.eval.attribution import (
    AttributionRule,
    AttributionType,
    DEFAULT_ATTRIBUTION_RULES,
)
from flowforge.core.eval.three_signals import (
    DEFAULT_SIGNAL_WEIGHTS,
    SignalSource,
)
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.loader")

DEFAULT_QUALITY_BAR = 0.85


@dataclass(frozen=True)
class EvalConfig:
    """Configuration consumed by the eval control plane."""

    default_quality_bar: float = DEFAULT_QUALITY_BAR
    signal_weights: dict[SignalSource, float] = field(
        default_factory=lambda: dict(DEFAULT_SIGNAL_WEIGHTS)
    )
    attribution_rules: list[AttributionRule] = field(
        default_factory=lambda: list(DEFAULT_ATTRIBUTION_RULES)
    )


def _parse_signal_source(key: str) -> SignalSource:
    try:
        return SignalSource(key)
    except ValueError:
        lowered = key.lower()
        for source in SignalSource:
            if source.value == lowered:
                return source
        raise EvalError(f"unknown signal source: {key!r}")


def _parse_attribution_type(val: str) -> AttributionType:
    try:
        return AttributionType(val)
    except ValueError:
        lowered = val.lower()
        for attr_type in AttributionType:
            if attr_type.value == lowered:
                return attr_type
        raise EvalError(f"unknown attribution type: {val!r}")


class EvalConfigLoader:
    """Loads an EvalConfig from a YAML file."""

    async def load_from_yaml(self, path: Path) -> EvalConfig:
        """Read and parse the YAML file at `path` into an EvalConfig."""
        return await asyncio.to_thread(self._load_sync, path)

    def _load_sync(self, path: Path) -> EvalConfig:
        if not path.exists():
            raise EvalError(f"eval config file not found: {path}")
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = yaml.safe_load(fh)
        except yaml.YAMLError as exc:
            raise EvalError(f"failed to parse eval config YAML: {exc}", cause=exc) from exc

        if not isinstance(raw, dict):
            raise EvalError("eval config root must be a mapping")

        config = self._build_config(raw)
        logger.info(
            f"eval config loaded: quality_bar={config.default_quality_bar} "
            f"weights={len(config.signal_weights)} rules={len(config.attribution_rules)}"
        )
        return config

    def _build_config(self, raw: dict[str, Any]) -> EvalConfig:
        quality_bar = float(raw.get("default_quality_bar", DEFAULT_QUALITY_BAR))
        if quality_bar < 0.0 or quality_bar > 1.0:
            raise EvalError(
                f"default_quality_bar must be within [0.0, 1.0], got {quality_bar}"
            )

        raw_weights = raw.get("signal_weights", {})
        if not isinstance(raw_weights, dict):
            raise EvalError("signal_weights must be a mapping")
        weights: dict[SignalSource, float] = {}
        for key, val in raw_weights.items():
            weights[_parse_signal_source(str(key))] = float(val)

        raw_rules = raw.get("attribution_rules", [])
        if not isinstance(raw_rules, list):
            raise EvalError("attribution_rules must be a list")
        rules: list[AttributionRule] = []
        for entry in raw_rules:
            if not isinstance(entry, dict):
                raise EvalError("each attribution rule must be a mapping")
            keywords = entry.get("keywords", [])
            if not isinstance(keywords, list):
                raise EvalError("attribution rule keywords must be a list")
            attr_type = _parse_attribution_type(str(entry.get("type", "")))
            rules.append(
                AttributionRule(
                    keywords=[str(k) for k in keywords], type=attr_type
                )
            )

        return EvalConfig(
            default_quality_bar=quality_bar,
            signal_weights=weights,
            attribution_rules=rules,
        )

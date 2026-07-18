"""魂印（Soul Imprint）— 灵智体的不可变身份标识。

魂印是灵智体的不可变身份标识，由初始锻造时的种子参数 + 价值锚点 +
命名空间组成。即使能力进化、形态升级，魂印保持不变，是谱系追踪的锚点。

设计要点:
    - **不可变性**：魂印一旦创建，``seed_params`` / ``value_anchors`` /
      ``namespace`` / ``imprint_hash`` 均不可修改。这是谱系追踪的前提。
    - **哈希稳定性**：``imprint_hash`` 基于 ``seed_params`` +
      ``value_anchors`` + ``namespace`` 计算，相同输入产出相同哈希。
    - **命名空间隔离**：通过 ``namespace`` 区分不同应用层（如
      ``"contentforge"`` / ``"forgemind"`` / ``"novelforge"``），
      避免跨应用层身份冲突。

详见:
    - [doc:design/naming-contract.md#2.6] 魂印定义
    - [doc:features/F038-forgemind-lineage.md] 灵智体进化谱系
    - [doc:review/review.md#第九章] FM-008 谱系追踪
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _stable_json(payload: Mapping[str, Any]) -> str:
    """生成键排序后、无空格的稳定 JSON 字符串，用于哈希。

    Args:
        payload: 任意可序列化字典。

    Returns:
        稳定的 JSON 字符串（sort_keys=True, ensure_ascii=False,
        separators 紧凑），保证相同输入产出相同输出。
    """
    return json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )


class SoulImprint(BaseModel):
    """魂印（Soul Imprint）— 灵智体的不可变身份标识。

    魂印是谱系追踪的锚点。即使灵智体进化形态、升级能力，魂印保持不变。

    属性:
        imprint_hash: 基于种子参数 + 价值锚点 + 命名空间计算的哈希。
        seed_params: 初始锻造时的种子参数（如 species / name 初始值等）。
        value_anchors: 价值锚点列表（不可变，对齐 VISION §7 七条愿景锚点）。
        namespace: 命名空间（如 ``"contentforge"`` / ``"forgemind"``）。
        created_at: 魂印创建时间（UTC）。

    详见:
        - [doc:design/naming-contract.md#2.6]
        - [doc:VISION.md#7] operator 愿景锚点
    """

    model_config = ConfigDict(
        frozen=True,  # 完全不可变——铁律：魂印是身份锚点
        extra="forbid",
        validate_assignment=True,
    )

    imprint_hash: str = Field(
        ...,
        description="基于 seed_params + value_anchors + namespace 计算的 SHA-256 哈希。",
    )
    seed_params: dict[str, Any] = Field(
        default_factory=dict,
        description="初始锻造时的种子参数（如 species / name / operator 等）。",
    )
    value_anchors: list[str] = Field(
        default_factory=list,
        description="价值锚点（不可变，对齐 VISION §7 + rules.md 15 条红线）。",
    )
    namespace: str = Field(
        ...,
        description="命名空间（如 'contentforge' / 'forgemind' / 'novelforge'）。",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="魂印创建时间（UTC）。",
    )

    @field_validator("namespace")
    @classmethod
    def _namespace_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError(
                "namespace 不能为空——魂印必须归属于某个命名空间。"
                "详见 [doc:design/naming-contract.md#2.6]"
            )
        return v.strip()

    @field_validator("value_anchors")
    @classmethod
    def _value_anchors_unique(cls, v: list[str]) -> list[str]:
        if len(v) != len(set(v)):
            raise ValueError("value_anchors 不能包含重复项。")
        return list(v)

    @classmethod
    def compute_hash(
        cls,
        seed_params: Mapping[str, Any],
        value_anchors: list[str],
        namespace: str,
    ) -> str:
        """计算魂印哈希（SHA-256）。

        哈希基于 ``seed_params`` + ``value_anchors`` + ``namespace`` 三要素
        计算。相同输入始终产出相同哈希，保证谱系追踪的稳定性。

        Args:
            seed_params: 初始锻造时的种子参数。
            value_anchors: 价值锚点列表。
            namespace: 命名空间。

        Returns:
            64 字符的 SHA-256 十六进制哈希字符串。
        """
        payload = {
            "seed_params": dict(seed_params),
            "value_anchors": list(value_anchors),
            "namespace": namespace,
        }
        stable = _stable_json(payload).encode("utf-8")
        return hashlib.sha256(stable).hexdigest()

    @classmethod
    def forge(
        cls,
        seed_params: Mapping[str, Any],
        value_anchors: list[str],
        namespace: str,
    ) -> "SoulImprint":
        """锻造一个新魂印（推荐入口）。

        自动计算 ``imprint_hash`` 并构造不可变魂印实例。这是创建魂印的
        推荐方式，避免调用方手动计算哈希导致不一致。

        Args:
            seed_params: 初始锻造时的种子参数。
            value_anchors: 价值锚点列表（对齐 VISION §7 + 15 条红线）。
            namespace: 命名空间（如 ``"forgemind"``）。

        Returns:
            不可变的 :class:`SoulImprint` 实例。
        """
        imprint_hash = cls.compute_hash(seed_params, value_anchors, namespace)
        return cls(
            imprint_hash=imprint_hash,
            seed_params=dict(seed_params),
            value_anchors=list(value_anchors),
            namespace=namespace,
        )

    def verify(self) -> bool:
        """校验当前魂印的 ``imprint_hash`` 是否与三要素重算结果一致。

        用于跨 session / 跨代际身份验证。如果返回 ``False``，说明魂印
        被篡改或损坏，谱系追踪应中止。

        Returns:
            ``True`` 表示哈希一致，身份可信。
        """
        return self.imprint_hash == self.compute_hash(
            self.seed_params, self.value_anchors, self.namespace
        )

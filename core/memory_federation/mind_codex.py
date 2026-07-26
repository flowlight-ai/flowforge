"""MindCodex — MindCodex可检索知识库。

实现 roleagent.md §4.3 L5 MindCodex层：
    - MindCodexEntry: MindCodex条目（蒸馏的经验单元）
    - MindCodex: MindCodex知识库（存储 + 检索 + 从经验蒸馏）

设计依据：
    - F039-mind-codex-searchable.md
    - roleagent.md §4.3 L5 MindCodex Mind Codex（跨代际持续）
    - v7.0 Forge Nurturing体系：SpiritForge SpiritForge 蒸馏经验 → MindCodex存储

MindCodex定位（roleagent.md §4.3）：
    - L4 Collection 是沉淀的领域知识（被动积累）
    - L5 MindCodex是蒸馏的可复用经验（主动提炼，跨代际持续）
    - MindCodex是SpiritForge SpiritForge 的产出存储层，可被未来Forgekin检索复用

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / llm_client / prompts_path
    - 铁律 5+P16：derive_from_experience 的提示词外置到 config/prompts.yaml
        （未注入 prompts.yaml 时，不调用 LLM，走规则化 fallback）
    - 编程红线 9：组合（llm_client + prompts）而非继承

License: MIT
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("memory_federation.mind_codex")


# ──────────────────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────────────────


class MindCodexEntry(BaseModel):
    """MindCodex条目——蒸馏的经验单元。

    对应 roleagent.md §4.3 L5：跨代际持续的蒸馏经验。
    每个条目是SpiritForge SpiritForge 从一次具体任务经验中蒸馏出的可复用知识。

    Attributes:
        codex_id: 条目唯一标识（自动生成 UUID）。
        title: 经验标题（人类可读，突出可复用的核心经验）。
        content: 经验内容（结构化文本，包含情境 / 动作 / 结果三要素）。
        domain: 所属领域（如 programming / finance / medicine）。
        skill_tags: 技能标签列表（用于检索匹配 + Index 入口）。
        derived_from: 来源经验标识（如 episode_id / trace_id）。
            用于追溯MindCodex条目来自哪次具体经验。
        created_at: 创建时间 ISO 8601。
    """

    codex_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="条目唯一标识",
    )
    title: str = Field(..., description="经验标题")
    content: str = Field(..., description="经验内容")
    domain: str = Field(default="general", description="所属领域")
    skill_tags: list[str] = Field(
        default_factory=list, description="技能标签列表"
    )
    derived_from: str = Field(
        default="", description="来源经验标识（episode_id / trace_id）"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间 ISO 8601",
    )


# ──────────────────────────────────────────────────────────────────────────────
# 提示词加载（铁律 5+P16：禁止硬编码提示词）
# ──────────────────────────────────────────────────────────────────────────────


def _load_codex_prompts(
    prompts_path: Optional[Path],
) -> dict[str, str]:
    """加载MindCodex提示词模板。

    铁律 5+P16：禁止硬编码提示词。
    模板从 config/prompts.yaml 的 mind_codex 节加载。
    若路径为 None 或加载失败，返回空 dict
    （调用方走规则化 fallback，不调用 LLM）。

    Args:
        prompts_path: prompts.yaml 绝对路径。None 表示未注入。

    Returns:
        模板字典 {key: template_str}。
    """
    if prompts_path is None:
        return {}
    try:
        path = Path(prompts_path)
        if not path.exists():
            logger.debug(
                f"prompts.yaml not found at {path}, using rule-based fallback"
            )
            return {}
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return dict(data.get("mind_codex", {}))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to load prompts.yaml: {e}")
        return {}


# ──────────────────────────────────────────────────────────────────────────────
# MindCodex 知识库
# ──────────────────────────────────────────────────────────────────────────────


class MindCodex:
    """MindCodex知识库——存储 + 检索 + 从经验蒸馏。

    v7.0 Forge Nurturing体系：SpiritForge SpiritForge 完成经验蒸馏后，结果存入MindCodex。
    MindCodex是跨代际持续的知识库，可被未来Forgekin检索复用。

    设计原则（roleagent.md §4.1 + §4.5）：
        - 检索简单优先：grep 风格的子串匹配 + 关键词重叠
        - 不把复杂度压到检索系统，蒸馏交给SpiritForge SpiritForge

    Args:
        llm_client: 可选的 LLM 客户端（用于 derive_from_experience 蒸馏）。
            接口协议：async complete(prompt: str) -> str
            若未注入，derive_from_experience 走规则化 fallback（不调用 LLM）。
        prompts_path: 提示词 YAML 路径（铁律 5+P16）。
            未注入时即使有 llm_client 也不调用 LLM（避免硬编码提示词）。
        logger: TraceLogger 实例。
    """

    def __init__(
        self,
        llm_client: Optional[Any] = None,
        prompts_path: Optional[Path] = None,
        logger: Optional[TraceLogger] = None,
    ) -> None:
        self._llm_client = llm_client
        self._prompts_path = prompts_path
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.mind_codex"
        )
        self._entries: list[MindCodexEntry] = []
        self._prompts: dict[str, str] = _load_codex_prompts(prompts_path)

    # ── 存储操作 ───────────────────────────────────────────────────

    async def add_entry(self, entry: MindCodexEntry) -> None:
        """添加MindCodex条目。

        Args:
            entry: 要添加的MindCodex条目。
        """
        self._entries.append(entry)
        self._logger.info(
            f"Added codex entry '{entry.title}' "
            f"(id={entry.codex_id}, domain={entry.domain}, "
            f"tags={entry.skill_tags})"
        )

    def list_entries(self) -> list[MindCodexEntry]:
        """列出所有MindCodex条目（用于 trace / 调试）。"""
        return list(self._entries)

    # ── 检索操作 ───────────────────────────────────────────────────

    async def search(
        self, query: str, top_k: int = 5
    ) -> list[MindCodexEntry]:
        """检索MindCodex条目。

        简单实现（roleagent.md §4.1 简单系统优先）：
            1. 子串匹配（grep 风格，零幻觉）—— 标题 / 内容 / 标签三处查找
            2. 关键词重叠（语义补充）—— 词袋交集归一化

        评分策略：
            - 标题命中：+0.5（标题更权威）
            - 内容命中：+0.3
            - 标签命中：+0.2
            - 关键词重叠：+0.1 × (overlap / |query_terms|)

        Args:
            query: 检索查询。
            top_k: 返回前 K 条（默认 5）。

        Returns:
            匹配的MindCodex条目列表（按相关性降序）。
        """
        if not query:
            return []
        query_lower = query.lower()
        query_terms = set(query_lower.split())
        scored: list[tuple[float, MindCodexEntry]] = []

        for entry in self._entries:
            title_lower = entry.title.lower()
            content_lower = entry.content.lower()
            tags_lower = [t.lower() for t in entry.skill_tags]
            tags_text = " ".join(tags_lower)

            score = 0.0
            # 子串匹配（grep 优先）
            if query_lower in title_lower:
                score += 0.5
            if query_lower in content_lower:
                score += 0.3
            if query_lower in tags_text:
                score += 0.2
            # 关键词重叠（语义补充）
            if query_terms:
                all_text = " ".join(
                    [title_lower, content_lower, tags_text]
                )
                entry_terms = set(all_text.split())
                overlap = len(query_terms & entry_terms)
                score += 0.1 * overlap / max(len(query_terms), 1)

            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [entry for _, entry in scored[:top_k]]

    # ── 经验蒸馏 ───────────────────────────────────────────────────

    async def derive_from_experience(
        self, experience: dict[str, Any]
    ) -> MindCodexEntry:
        """从经验蒸馏MindCodex条目。

        v7.0 Forge Nurturing体系：将一次具体任务经验蒸馏为可复用的MindCodex条目。

        蒸馏策略：
            1. 若注入了 llm_client + prompts.yaml（铁律 5+P16）→ 调用 LLM 蒸馏
            2. 否则 → 规则化 fallback（直接用原始经验字段构造条目）

        Args:
            experience: 经验字典，应包含：
                - title: 经验标题
                - content: 经验内容
                - domain: 所属领域
                - skill_tags: 技能标签列表
                - source_id: 来源标识（episode_id / trace_id）

        Returns:
            蒸馏后的 MindCodexEntry（已存入MindCodex）。
        """
        title = str(experience.get("title", "untitled_experience"))
        content = str(experience.get("content", ""))
        domain = str(experience.get("domain", "general"))
        skill_tags = list(experience.get("skill_tags", []))
        source_id = str(experience.get("source_id", ""))

        # 仅当同时注入 llm_client 和提示词模板时才调用 LLM
        # （铁律 5+P16：禁止硬编码提示词——无模板则不调用 LLM）
        if self._llm_client is not None and self._prompts:
            try:
                distilled = await self._llm_distill(
                    title=title,
                    content=content,
                    domain=domain,
                    skill_tags=skill_tags,
                )
                title = distilled.get("title", title)
                content = distilled.get("content", content)
                skill_tags = distilled.get("skill_tags", skill_tags)
                self._logger.info(
                    f"LLM distillation succeeded for experience "
                    f"(source_id={source_id})"
                )
            except Exception as e:  # noqa: BLE001
                self._logger.warning(
                    f"LLM distill failed, using raw experience: {e}"
                )
        elif self._llm_client is not None and not self._prompts:
            self._logger.warning(
                "llm_client injected but no prompts.yaml loaded — "
                "skipping LLM call (铁律 5+P16: 禁止硬编码提示词)"
            )

        entry = MindCodexEntry(
            title=title,
            content=content,
            domain=domain,
            skill_tags=skill_tags,
            derived_from=source_id,
        )
        await self.add_entry(entry)
        return entry

    async def _llm_distill(
        self,
        title: str,
        content: str,
        domain: str,
        skill_tags: list[str],
    ) -> dict[str, Any]:
        """调用 LLM 进行蒸馏（铁律 5+P16：提示词外置）。

        使用 config/prompts.yaml 中的 derive_from_experience 模板。
        返回蒸馏后的 dict（title / content / skill_tags）。

        Args:
            title: 原始经验标题。
            content: 原始经验内容。
            domain: 所属领域。
            skill_tags: 原始技能标签列表。

        Returns:
            蒸馏后的字段字典。
        """
        template = self._prompts.get("derive_from_experience")
        if not template:
            # 无模板时不调用 LLM（铁律 5+P16）
            return {
                "title": title,
                "content": content,
                "skill_tags": skill_tags,
            }

        prompt = template.format(
            title=title,
            content=content,
            domain=domain,
            skill_tags=", ".join(skill_tags) if skill_tags else "(none)",
        )

        # 调用 LLM 客户端（接口协议：async complete(prompt) -> str）
        response = await self._llm_client.complete(prompt)  # type: ignore[union-attr]

        # 尝试解析 JSON 响应
        result: dict[str, Any] = {
            "title": title,
            "content": response,
            "skill_tags": skill_tags,
        }
        try:
            # 尝试提取 JSON 块（LLM 可能在 JSON 前后加文字）
            json_str = self._extract_json(response)
            if json_str:
                parsed = json.loads(json_str)
                if isinstance(parsed, dict):
                    if "title" in parsed and isinstance(parsed["title"], str):
                        result["title"] = parsed["title"]
                    if "content" in parsed and isinstance(
                        parsed["content"], str
                    ):
                        result["content"] = parsed["content"]
                    if "skill_tags" in parsed and isinstance(
                        parsed["skill_tags"], list
                    ):
                        result["skill_tags"] = [
                            str(t) for t in parsed["skill_tags"]
                        ]
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(
                f"Failed to parse LLM JSON response, using raw response: {e}"
            )

        return result

    @staticmethod
    def _extract_json(text: str) -> Optional[str]:
        """从 LLM 响应中提取 JSON 块。

        支持三种格式：
            1. 纯 JSON
            2. ```json ... ``` 代码块
            3. ``` ... ``` 代码块

        Args:
            text: LLM 响应文本。

        Returns:
            提取的 JSON 字符串，失败返回 None。
        """
        text = text.strip()
        # 尝试代码块格式
        if "```" in text:
            parts = text.split("```")
            for i, part in enumerate(parts):
                # 跳过奇数索引（代码块外的文字）
                if i % 2 == 1:
                    # 去掉可能的 "json" 语言标记
                    part = part.strip()
                    if part.startswith("json"):
                        part = part[4:].strip()
                    if part.startswith("{") and part.endswith("}"):
                        return part
        # 尝试纯 JSON
        if text.startswith("{") and text.endswith("}"):
            return text
        # 尝试找到第一个 { 到最后一个 }
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1 and last > first:
            return text[first : last + 1]
        return None

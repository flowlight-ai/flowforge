"""FlowForge ContextLayerManager — configurable multi-layer context management.

Provides a generic framework for managing layered context in long-form
content creation workflows. Layers are defined via YAML configuration.

Usage in NovelForge:
    config/context_layers/novel.yaml defines L1-L4 + WST layers.

The manager handles:
  - Reading/writing context data from FlowForge Memory
  - Layer determination based on configurable thresholds
  - Summary generation (with LLM or truncation fallback)
  - World state extraction and merging
  - Embedding chunk management
"""
import asyncio
import json
import re
import time
from enum import Enum
from typing import Optional

from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.memory.manager import MemoryManager
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.context_layer_manager")


class ContextLayer(str, Enum):
    """Standard context layer levels."""
    L1 = "L1"  # Full text
    L2 = "L2"  # Chapter summaries
    L3 = "L3"  # Volume summaries
    L4 = "L4"  # Full book summary
    WST = "WST"  # World state table


class ContextLayerManager:
    """Configurable multi-layer context manager.

    Configuration is provided via a dict (typically loaded from YAML):
      - key_prefix: e.g. "novel" → keys become "novel:{id}:meta"
      - layer_thresholds: list of (max_chapters, layer) tuples
      - summary_target_len: target length for summaries
      - chunk_size: embedding chunk size
      - volume_size: chapters per volume
      - world_state_fields: dict/list field names for merging
    """

    DEFAULT_CONFIG = {
        "key_prefix": "novel",
        "layer_thresholds": [(3, "L1"), (10, "L2"), (30, "L3"), (999999, "L4")],
        "summary_target_len": 200,
        "chunk_size": 500,
        "volume_size": 10,
        "full_summary_interval": 5,
        "world_state_merge_fields": ["characters", "timeline", "geography", "power_system"],
        "world_state_list_fields": ["foreshadowing"],
    }

    def __init__(self, memory: MemoryManager, llm_client=None, config: dict = None):
        self.memory = memory
        self.llm_client = llm_client
        self.config = {**self.DEFAULT_CONFIG, **(config or {})}
        logger.info(f"ContextLayerManager.__init__: config={self.config}, "
                     f"has_memory={memory is not None}, has_llm={llm_client is not None}")

    # ── Memory helpers ──

    async def _store(self, key: str, data) -> None:
        await self.memory.save("working", key, data)

    async def _load(self, key: str, default=None):
        result = self.memory.working.get(key)
        return result if result is not None else default

    def _make_key(self, entity_id: str, suffix: str) -> str:
        prefix = self.config["key_prefix"]
        return f"{prefix}:{entity_id}:{suffix}"

    # ── Entity metadata ──

    async def _get_meta(self, entity_id: str) -> dict:
        return await self._load(self._make_key(entity_id, "meta"), {})

    async def _save_meta(self, entity_id: str, meta: dict) -> None:
        await self._store(self._make_key(entity_id, "meta"), meta)

    # ── Chapters ──

    async def _list_chapters(self, entity_id: str) -> list[dict]:
        chapters = await self._load(self._make_key(entity_id, "chapters"), [])
        return chapters if isinstance(chapters, list) else []

    async def _save_chapters(self, entity_id: str, chapters: list[dict]) -> None:
        await self._store(self._make_key(entity_id, "chapters"), chapters)

    async def _get_chapter(self, entity_id: str, chapter_number: int) -> Optional[dict]:
        chapters = await self._list_chapters(entity_id)
        for ch in chapters:
            if ch.get("chapter_number") == chapter_number:
                return ch
        return None

    async def _upsert_chapter(self, entity_id: str, chapter_number: int,
                               updates: dict) -> dict:
        chapters = await self._list_chapters(entity_id)
        found = None
        for ch in chapters:
            if ch.get("chapter_number") == chapter_number:
                found = ch
                break
        if found:
            found.update(updates)
        else:
            found = {"chapter_number": chapter_number, **updates}
            chapters.append(found)
            chapters.sort(key=lambda c: c.get("chapter_number", 0))
        await self._save_chapters(entity_id, chapters)
        return found

    # ── World state ──

    async def _load_world_state_data(self, entity_id: str) -> dict:
        return await self._load(self._make_key(entity_id, "world_state"), {})

    async def _save_world_state_data(self, entity_id: str, ws: dict) -> None:
        await self._store(self._make_key(entity_id, "world_state"), ws)

    # ── Embeddings ──

    async def _load_embeddings(self, entity_id: str) -> list[dict]:
        data = await self._load(self._make_key(entity_id, "embeddings"), [])
        return data if isinstance(data, list) else []

    async def _save_embeddings(self, entity_id: str, chunks: list[dict]) -> None:
        await self._store(self._make_key(entity_id, "embeddings"), chunks)

    # ── Main API ──

    async def build_context(self, context: TaskContext) -> TaskContext:
        """Build context layers for the current task."""
        entity_id = context.state.get("novel_id", context.state.get("entity_id", ""))
        current_chapter = context.state.get("current_chapter", 1)
        logger.info(f"ContextLayerManager.build_context: entity_id='{entity_id}', "
                     f"current_chapter={current_chapter}")
        chapters = await self._list_chapters(entity_id)
        layer = self._determine_layer(len(chapters), current_chapter)
        context.state["context_layer"] = layer.value
        logger.info(f"ContextLayerManager.build_context: total_chapters={len(chapters)}, "
                     f"determined_layer={layer.value}")

        # Previous chapters context
        context.state["previous_chapters"] = await self._collect_chapters(
            chapters, current_chapter, layer)

        # World state
        context.state["world_state"] = await self._load_world_state(
            entity_id, current_chapter)

        # Semantic search
        if self.memory.semantic is not None:
            try:
                results = await self.memory.semantic.search(
                    context.input_data.get("task", ""), top_k=5)
                context.state["semantic_results"] = results
            except Exception:
                context.state["semantic_results"] = None
        else:
            context.state["semantic_results"] = None

        # Entity metadata
        meta = await self._get_meta(entity_id)

        # Full summary (L4)
        context.state["full_book_summary"] = meta.get("summary", "")

        # Volume summary (L3)
        volume_summary = ""
        state_json = meta.get("state_json")
        if state_json:
            try:
                state = json.loads(state_json) if isinstance(state_json, str) else state_json
                volume_number = (current_chapter - 1) // self.config["volume_size"] + 1
                volume_summary = state.get("volume_summaries", {}).get(str(volume_number), "")
            except Exception:
                pass
        context.state["volume_summary"] = volume_summary

        # Previous chapter full text
        prev_chapter_full_text = ""
        if current_chapter > 1:
            prev_ch = await self._get_chapter(entity_id, current_chapter - 1)
            if prev_ch and prev_ch.get("content"):
                prev_chapter_full_text = prev_ch["content"]
        context.state["prev_chapter_full_text"] = prev_chapter_full_text

        # SOUL: style profile + concept package
        soul = {}
        style_profile = meta.get("style_profile")
        if style_profile:
            soul["style_profile"] = json.loads(style_profile) if isinstance(style_profile, str) else style_profile
        concept_package = meta.get("concept_package")
        if concept_package:
            soul["concept_package"] = json.loads(concept_package) if isinstance(concept_package, str) else concept_package
        context.state["soul"] = soul

        return context

    async def write_context_layers(self, context: TaskContext) -> None:
        """Write all context layers after a chapter is written."""
        entity_id = context.state.get("novel_id", context.state.get("entity_id", ""))
        current_chapter = context.state.get("current_chapter", 1)
        await self.write_chapter_context(entity_id, current_chapter,
                                          context.state.get("chapter_content", ""))

    async def write_chapter_context(self, entity_id: str, chapter_number: int,
                                     content: str) -> None:
        """Write context layers for a completed chapter.

        Performance: LLM calls are parallelized in two phases to eliminate the
        8-32s serial bottleneck of the original implementation.
          - Phase 1: chapter summary + world state extraction (independent).
          - Phase 2: volume + full summary generation (parallel), saves applied
                    serially to avoid the entity-meta read-modify-write race.
        """
        if not content:
            logger.info(f"ContextLayerManager.write_chapter_context: skipped, no content "
                         f"for entity={entity_id} ch={chapter_number}")
            return
        logger.info(f"ContextLayerManager.write_chapter_context: entity={entity_id}, "
                     f"ch={chapter_number}, content_len={len(content)}")
        overall_start = time.time()

        # L1: Embedding chunks (no LLM, fast — keep serial)
        await self._save_embedding_chunks(entity_id, chapter_number, content)

        # ── Phase 1: chapter summary + world state extraction (parallel) ──
        # Independent: chapter summary writes to the chapters list, world
        # state writes to the world_state key — no shared state.
        phase1_start = time.time()
        chapter = await self._get_chapter(entity_id, chapter_number)

        async def _phase1_chapter_summary() -> None:
            if not (chapter and not chapter.get("summary")):
                return
            t0 = time.time()
            logger.info(f"write_chapter_context: phase1 [chapter_summary] start "
                         f"entity={entity_id} ch={chapter_number}")
            summary = await self._generate_summary(content, self.config["summary_target_len"])
            await self._upsert_chapter(entity_id, chapter_number, {
                "content": content,
                "summary": summary,
                "version": chapter.get("version", 1),
            })
            logger.info(f"write_chapter_context: phase1 [chapter_summary] done "
                         f"in {time.time() - t0:.2f}s")

        async def _phase1_world_state() -> None:
            t0 = time.time()
            logger.info(f"write_chapter_context: phase1 [world_state] start "
                         f"entity={entity_id} ch={chapter_number}")
            await self._extract_and_update_world_state(entity_id, chapter_number, content)
            logger.info(f"write_chapter_context: phase1 [world_state] done "
                         f"in {time.time() - t0:.2f}s")

        phase1_results = await asyncio.gather(
            _phase1_chapter_summary(),
            _phase1_world_state(),
            return_exceptions=True,
        )
        for idx, res in enumerate(phase1_results):
            if isinstance(res, Exception):
                logger.warning(f"write_chapter_context: phase1 task[{idx}] failed: {res}")
        logger.info(f"write_chapter_context: phase1 (chapter_summary + world_state) "
                     f"done in {time.time() - phase1_start:.2f}s")

        # Refresh chapters list — chapter summary may have just been persisted
        # and both phase-2 tasks read from it.
        chapters = await self._list_chapters(entity_id)

        # ── Phase 2: volume + full summary generation (parallel), serial save ──
        # Both read the chapters list (with summaries) but NOT each other's
        # output, so generation can run concurrently. They both perform a
        # read-modify-write on the entity meta dict, so saves are applied
        # serially to avoid the last-write-wins race condition.
        phase2_start = time.time()

        async def _phase2_volume_summary():
            t0 = time.time()
            logger.info(f"write_chapter_context: phase2 [volume_summary] start "
                         f"entity={entity_id} ch={chapter_number}")
            result = await self._generate_volume_summary_data(
                entity_id, chapters, chapter_number)
            logger.info(f"write_chapter_context: phase2 [volume_summary] done "
                         f"in {time.time() - t0:.2f}s")
            return result

        async def _phase2_full_summary():
            t0 = time.time()
            logger.info(f"write_chapter_context: phase2 [full_summary] start "
                         f"entity={entity_id}")
            result = await self._generate_full_summary_data(entity_id, chapters)
            logger.info(f"write_chapter_context: phase2 [full_summary] done "
                         f"in {time.time() - t0:.2f}s")
            return result

        phase2_results = await asyncio.gather(
            _phase2_volume_summary(),
            _phase2_full_summary(),
            return_exceptions=True,
        )
        volume_result, full_result = phase2_results

        # Apply saves serially to avoid meta read-modify-write race condition
        if isinstance(volume_result, Exception):
            logger.warning(f"write_chapter_context: phase2 [volume_summary] failed: "
                           f"{volume_result}")
        elif volume_result:
            volume_number, volume_summary = volume_result
            await self._save_volume_summary(entity_id, volume_number, volume_summary)
            logger.info(f"write_chapter_context: phase2 [volume_summary] saved "
                         f"volume={volume_number} entity={entity_id}")

        if isinstance(full_result, Exception):
            logger.warning(f"write_chapter_context: phase2 [full_summary] failed: "
                           f"{full_result}")
        elif full_result:
            await self._save_full_summary(entity_id, full_result)
            logger.info(f"write_chapter_context: phase2 [full_summary] saved "
                         f"entity={entity_id}")

        logger.info(f"write_chapter_context: phase2 (volume + full summary) "
                     f"done in {time.time() - phase2_start:.2f}s")
        logger.info(f"write_chapter_context: total done in {time.time() - overall_start:.2f}s "
                     f"entity={entity_id} ch={chapter_number}")

    # ── Layer determination ──

    def _determine_layer(self, total_chapters: int, current_chapter: int) -> ContextLayer:
        logger.info(f"ContextLayerManager._determine_layer: total_chapters={total_chapters}, "
                     f"current_chapter={current_chapter}, "
                     f"thresholds={self.config['layer_thresholds']}")
        for threshold, layer_name in self.config["layer_thresholds"]:
            if total_chapters <= threshold:
                try:
                    result = ContextLayer(layer_name)
                    logger.info(f"ContextLayerManager._determine_layer: resolved to {result.value}")
                    return result
                except ValueError:
                    logger.warning(f"ContextLayerManager._determine_layer: invalid layer '{layer_name}', falling back to L4")
                    return ContextLayer.L4
        logger.info(f"ContextLayerManager._determine_layer: no threshold matched, defaulting to L4")
        return ContextLayer.L4

    # ── Chapter collection ──

    async def _collect_chapters(self, chapters: list[dict],
                                 current: int, layer: ContextLayer) -> list[dict]:
        result = []
        for ch in chapters:
            ch_num = ch.get("chapter_number", 0)
            if ch_num >= current:
                continue
            if layer == ContextLayer.L1:
                result.append({"number": ch_num, "content": ch.get("content", "")})
            else:
                content = ch.get("content", "")
                fallback = content[:500]
                if len(content) > 500:
                    fallback += "[摘要截断]"
                result.append({"number": ch_num,
                               "summary": ch.get("summary") or fallback})
        return result

    # ── World state ──

    async def _load_world_state(self, entity_id: str, chapter_number: int) -> dict:
        ws_data = await self._load_world_state_data(entity_id)
        if not isinstance(ws_data, dict):
            return {}
        record = ws_data.get(str(chapter_number), {})
        if not record:
            return {}
        return {
            field: record.get(field, {} if field in self.config["world_state_merge_fields"] else [])
            for field in self.config["world_state_merge_fields"] + self.config["world_state_list_fields"]
        }

    # ── L1: Embedding chunks ──

    async def _save_embedding_chunks(self, entity_id: str,
                                      chapter_number: int, content: str) -> None:
        chunk_size = self.config["chunk_size"]
        chunks = []
        for i in range(0, len(content), chunk_size):
            chunk_text = content[i:i + chunk_size]
            if chunk_text.strip():
                chunks.append(chunk_text)
        existing = await self._load_embeddings(entity_id)
        existing = [c for c in existing if c.get("chapter_number") != chapter_number]
        for idx, chunk_text in enumerate(chunks):
            existing.append({
                "entity_id": entity_id,
                "chapter_number": chapter_number,
                "chunk_index": idx,
                "text": chunk_text,
            })
        await self._save_embeddings(entity_id, existing)
        logger.info(f"Saved {len(chunks)} embedding chunks for entity={entity_id} ch={chapter_number}")

    # ── L3: Volume summary ──

    async def _generate_volume_summary_data(self, entity_id: str,
                                             chapters: list[dict],
                                             current_chapter: int):
        """Generate (but do not persist) the volume summary.

        Returns ``(volume_number, volume_summary)`` or ``None`` when no
        generation is needed. Separated from persistence so the LLM call can
        run in parallel with full-summary generation while saves stay serial.
        """
        volume_size = self.config["volume_size"]
        volume_start = ((current_chapter - 1) // volume_size) * volume_size + 1
        volume_end = min(volume_start + volume_size - 1, len(chapters))
        volume_number = (current_chapter - 1) // volume_size + 1

        is_volume_end = (current_chapter % volume_size == 0) or (current_chapter == len(chapters))
        if not is_volume_end:
            existing_summary = await self._get_volume_summary(entity_id, volume_number)
            if existing_summary:
                return None

        volume_chapters = [ch for ch in chapters
                           if volume_start <= ch.get("chapter_number", 0) <= volume_end]
        if not volume_chapters:
            return None
        volume_texts = []
        for ch in volume_chapters:
            ch_num = ch.get("chapter_number", 0)
            if ch.get("summary"):
                volume_texts.append(f"第{ch_num}章：{ch['summary']}")
            elif ch.get("content"):
                volume_texts.append(f"第{ch_num}章：{ch['content'][:500]}[摘要截断]")
        if not volume_texts:
            return None
        volume_summary = await self._generate_summary("\n".join(volume_texts), 300)
        if not volume_summary:
            return None
        return volume_number, volume_summary

    async def _regenerate_volume_summary(self, entity_id: str,
                                          chapters: list[dict],
                                          current_chapter: int) -> None:
        result = await self._generate_volume_summary_data(
            entity_id, chapters, current_chapter)
        if result:
            volume_number, volume_summary = result
            await self._save_volume_summary(entity_id, volume_number, volume_summary)
            logger.info(f"Regenerated volume {volume_number} summary for entity={entity_id}")

    async def _get_volume_summary(self, entity_id: str, volume_number: int) -> str:
        try:
            meta = await self._get_meta(entity_id)
            state_json = meta.get("state_json")
            if not state_json:
                return ""
            state = json.loads(state_json) if isinstance(state_json, str) else state_json
            return state.get("volume_summaries", {}).get(str(volume_number), "")
        except Exception:
            return ""

    async def _save_volume_summary(self, entity_id: str,
                                    volume_number: int,
                                    volume_summary: str) -> None:
        try:
            meta = await self._get_meta(entity_id)
            state_json = meta.get("state_json")
            state = json.loads(state_json) if isinstance(state_json, str) else (state_json or {})
            volume_summaries = state.get("volume_summaries", {})
            volume_summaries[str(volume_number)] = volume_summary
            state["volume_summaries"] = volume_summaries
            meta["state_json"] = json.dumps(state, ensure_ascii=False)
            await self._save_meta(entity_id, meta)
        except Exception as e:
            logger.warning(f"Failed to save volume summary for entity={entity_id}: {e}")

    # ── L4: Full book summary ──

    async def _generate_full_summary_data(self, entity_id: str,
                                            chapters: list[dict]) -> Optional[str]:
        """Generate (but do not persist) the full book summary.

        Returns the summary string or ``None`` when no generation is needed.
        Separated from persistence so the LLM call can run in parallel with
        volume-summary generation while saves stay serial.
        """
        existing_summary = ""
        try:
            meta = await self._get_meta(entity_id)
            existing_summary = meta.get("summary", "")
        except Exception:
            pass
        current_chapter = chapters[-1].get("chapter_number", 0) if chapters else 0
        interval = self.config["full_summary_interval"]
        if existing_summary and current_chapter % interval != 0:
            return None
        all_summaries = [ch.get("summary", "") for ch in chapters if ch.get("summary")]
        if not all_summaries:
            return None
        full_summary = await self._generate_summary("\n".join(all_summaries), 500)
        return full_summary if full_summary else None

    async def _save_full_summary(self, entity_id: str, full_summary: str) -> None:
        try:
            meta = await self._get_meta(entity_id)
            meta["summary"] = full_summary
            await self._save_meta(entity_id, meta)
        except Exception as e:
            logger.warning(f"Failed to persist full summary for entity={entity_id}: {e}")

    async def _regenerate_full_summary(self, entity_id: str,
                                        chapters: list[dict]) -> None:
        full_summary = await self._generate_full_summary_data(entity_id, chapters)
        if full_summary:
            await self._save_full_summary(entity_id, full_summary)

    # ── L5: World state extraction ──

    async def _extract_and_update_world_state(self, entity_id: str,
                                               chapter_number: int,
                                               content: str) -> None:
        if not self.llm_client or not content:
            return
        try:
            prompt = self._get_prompt(
                "context.world_state",
                '请从以下内容中提取关键实体信息，输出 JSON 格式：\n'
                '{{"characters": {{"角色名": "角色描述"}}, '
                '"timeline": {{"事件": "时间线描述"}}, '
                '"foreshadowing": ["伏笔1", "伏笔2"], '
                '"geography": {{"地名": "地点描述"}}, '
                '"power_system": {{"体系名": "体系描述"}}}}\n\n'
                '内容：\n{content}\n\n'
                '请直接输出 JSON，不要包含任何额外说明。',
                content=content[:6000],
            )
            llm_result = await self.llm_client.execute(
                ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
            text = llm_result.result.get("content", "").strip()
            entities = self._parse_json(text, {})
            if not entities:
                return
            existing = await self._load_world_state(entity_id, chapter_number)
            merged = self._merge_world_state(existing, entities)
            ws_data = await self._load_world_state_data(entity_id)
            if not isinstance(ws_data, dict):
                ws_data = {}
            ws_data[str(chapter_number)] = merged
            await self._save_world_state_data(entity_id, ws_data)
            logger.info(f"Updated world state for entity={entity_id} ch={chapter_number}")
        except Exception as e:
            logger.warning(f"Failed to extract world state for entity={entity_id} ch={chapter_number}: {e}")

    def _merge_world_state(self, existing: dict, new_entities: dict) -> dict:
        merged = dict(existing)
        for field in self.config["world_state_merge_fields"]:
            if field in new_entities and isinstance(new_entities[field], dict):
                existing_dict = merged.get(field, {})
                if isinstance(existing_dict, dict):
                    existing_dict.update(new_entities[field])
                else:
                    existing_dict = new_entities[field]
                merged[field] = existing_dict
        for field in self.config["world_state_list_fields"]:
            if field in new_entities and isinstance(new_entities[field], list):
                existing_list = merged.get(field, [])
                if isinstance(existing_list, list):
                    existing_list.extend(new_entities[field])
                else:
                    existing_list = new_entities[field]
                merged[field] = existing_list
        return merged

    # ── Shared helpers ──

    async def _generate_summary(self, content: str, target_len: int) -> str:
        if not content:
            return ""
        if len(content) <= target_len:
            return content
        if self.llm_client:
            try:
                prompt = self._get_prompt(
                    "context.summary",
                    '请将以下内容压缩为{target_len}字以内的摘要，保留关键情节和重要细节。\n\n'
                    '原文：\n{content}\n\n'
                    '请直接输出摘要，不要包含任何额外说明。',
                    target_len=target_len,
                    content=content[:8000],
                )
                llm_result = await self.llm_client.execute(
                    ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
                summary = llm_result.result.get("content", "").strip()
                if summary and len(summary) <= target_len * 2:
                    return summary
            except Exception:
                pass
        fallback_len = min(500, len(content))
        return content[:fallback_len] + ("[摘要截断]" if len(content) > fallback_len else "")

    def _parse_json(self, text: str, default: dict = None) -> dict:
        if not text:
            return default or {}
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        return default or {}

    def _get_prompt(self, key: str, fallback: str = "", **kwargs) -> str:
        try:
            from flowforge.core.prompt_manager import get_prompt
            result = get_prompt(key, **kwargs)
            if result:
                return result
        except Exception:
            pass
        if fallback and kwargs:
            try:
                return fallback.format(**kwargs)
            except (KeyError, ValueError, IndexError):
                pass
        return fallback or ""

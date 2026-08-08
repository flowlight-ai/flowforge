"""ProfileLoader — 能力画像 YAML 加载器。

从 YAML 文件加载 CapabilityProfile，支持依赖注入（铁律 3）。
所有 I/O 操作使用 async/await（铁律 6：async I/O）。

设计依据：
    - F001-capability-profile.md §3.1
    - ADR 004 §2（CapabilityProfile 六维度）

铁律遵守：
    - 铁律 3：通过构造函数注入 logger / config_loader，不直接实例化
    - 铁律 5：所有路径通过参数注入，不硬编码
    - 铁律 6：YAML 读取使用 async（asyncio.to_thread 包装同步 I/O）
    - 编程红线 11：路径不硬编码

YAML 文件格式（示例）::

    profile_id: "claude-code-001"
    agent_id: "claude-code"
    created_at: "2026-07-17T00:00:00Z"
    updated_at: "2026-07-17T00:00:00Z"

    model_capability:
      provider: "anthropic"
      model_name: "claude-sonnet-4"
      context_window: 200000
      strengths:
        - "code_generation"
        - "long_context_reasoning"
      limitations:
        - "math_computation"
      supports_tool_call: true
      supports_vision: false
      reasoning_capability: 0.9
      creativity_capability: 0.85

    cognitive_style:
      reasoning_depth: 0.9
      abstraction_level: 0.8
      risk_appetite: 0.3
      explanation_style: "structured"

    blind_spots:
      - category: "self_referential_logic"
        description: "倾向信任自身生成的代码而不验证"
        example: "..."
        scenario: "code_review"
        detected_at: "2026-07-17T00:00:00Z"
        evidence: ["trace-001"]
        compensation_strategy: "cross_vendor_review"
        confidence: 0.8

    skill_packages:
      - name: "python_async"
        domain: "programming"
        version: "1.0.0"
        loader: "flowforge.skills.PythonAsyncLoader"
        proficiency: 0.9
        last_used: "2026-07-17T10:00:00Z"
        usage_count: 42

    tool_boundary:
      allowed_tools:
        - "file_read"
        - "file_write"
        - "shell_exec"
      forbidden_tools:
        - "db_drop"
      prefer_tools:
        - "file_read"
      tool_proficiency:
        file_read: 0.95

    historical_performance:
      - task_type: "code_generation"
        success_rate: 0.92
        avg_latency: 2.5
        token_usage: 15000
        last_updated: "2026-07-17T00:00:00Z"
        sample_count: 100
        wilson_lower_bound: 0.88

    current_state:
      current_load: 0.3
      fatigue: 0.1
      mood: "focused"
      active_tasks: 2
      last_break: "2026-07-17T10:00:00Z"

    harness_fit_score:
      overall: 0.85
      durable_state: 0.9
      tool_mediation: 0.85
      governance: 0.8
      retrieval: 0.7
      observability: 0.9

License: MIT
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Callable, Optional, Union

import yaml
from pydantic import ValidationError

from flowforge.core.capability.models import (
    AgentState,
    BlindSpot,
    CognitiveStyle,
    HarnessFitScore,
    ModelCapability,
    PerformanceLog,
    SkillPackage,
    ToolBoundary,
)
from flowforge.core.capability.profile import CapabilityProfile
from flowforge.core.tracing import TraceLogger, get_logger

PathLike = Union[str, Path]


class ProfileLoader:
    """能力画像 YAML 加载器——支持依赖注入。

    铁律 3：通过构造函数注入 logger 和 config_loader，不直接实例化外部服务。
    铁律 5：所有路径通过方法参数传入，不在构造函数中硬编码。
    铁律 6：YAML 读取使用 async（asyncio.to_thread 包装同步 I/O）。

    Args:
        logger: TraceLogger 实例（来自 flowforge.core.tracing.get_logger）。
            若未注入，使用默认 "capability.profile_loader" logger。
        config_loader: 可选的配置加载回调，签名 (key: str) -> Any。
            用于运行时从外部配置源（如 SystemConfig）解析路径前缀等参数。
            若未注入，所有路径必须为绝对路径或相对当前工作目录的路径。
    """

    def __init__(
        self,
        logger: Optional[TraceLogger] = None,
        config_loader: Optional[Callable[[str], Any]] = None,
    ) -> None:
        self._logger: TraceLogger = logger or get_logger(
            "capability.profile_loader"
        )
        self._config_loader: Optional[Callable[[str], Any]] = config_loader

    # ── 单文件加载 ──────────────────────────────────────────────────

    async def load_from_yaml(self, path: PathLike) -> CapabilityProfile:
        """从 YAML 文件加载单个 CapabilityProfile。

        铁律 6：使用 async + asyncio.to_thread 包装同步文件 I/O。

        Args:
            path: YAML 文件路径（字符串或 Path 对象）。
                禁止硬编码，必须由调用方注入。

        Returns:
            解析后的 CapabilityProfile 实例。

        Raises:
            FileNotFoundError: 文件不存在。
            ValueError: YAML 格式错误或字段缺失。
            pydantic.ValidationError: 字段类型不匹配。
        """
        file_path = Path(path)
        self._logger.debug(f"Loading capability profile from {file_path}")

        # 铁律 6：async I/O 包装
        raw_text = await asyncio.to_thread(
            self._read_text_sync, file_path
        )
        try:
            data = await asyncio.to_thread(yaml.safe_load, raw_text)
        except yaml.YAMLError as e:
            self._logger.error(f"YAML parse error in {file_path}: {e}")
            raise ValueError(f"Invalid YAML in {file_path}: {e}") from e

        if data is None:
            raise ValueError(f"Empty YAML file: {file_path}")
        if not isinstance(data, dict):
            raise ValueError(
                f"YAML root must be a mapping, got {type(data).__name__}"
            )

        return self._build_profile(data, source_path=str(file_path))

    # ── 批量加载 ────────────────────────────────────────────────────

    async def load_all(
        self,
        profiles_dir: PathLike,
        pattern: str = "*.yaml",
    ) -> dict[str, CapabilityProfile]:
        """从目录批量加载所有 Profile YAML。

        铁律 6：批量文件读取并行化（asyncio.gather）。

        Args:
            profiles_dir: Profile YAML 文件目录。
            pattern: 文件 glob 模式（默认 "*.yaml"）。

        Returns:
            {profile_id: CapabilityProfile} 字典。
            profile_id 取自 YAML 内容（非文件名），冲突时后者覆盖前者并记录 warning。
        """
        dir_path = Path(profiles_dir)
        if not dir_path.exists():
            self._logger.warning(
                f"Profiles directory does not exist: {dir_path}"
            )
            return {}
        if not dir_path.is_dir():
            raise ValueError(f"Not a directory: {dir_path}")

        yaml_files = sorted(dir_path.glob(pattern))
        self._logger.info(
            f"Found {len(yaml_files)} profile YAML files in {dir_path}"
        )

        results: dict[str, CapabilityProfile] = {}
        # 并行加载所有文件
        loaded = await asyncio.gather(
            *(self.load_from_yaml(f) for f in yaml_files),
            return_exceptions=True,
        )
        for file_path, outcome in zip(yaml_files, loaded):
            if isinstance(outcome, Exception):
                self._logger.warning(
                    f"Failed to load {file_path}: {outcome}"
                )
                continue
            profile_id = outcome.profile_id
            if profile_id in results:
                self._logger.warning(
                    f"Duplicate profile_id '{profile_id}' in {file_path}, "
                    f"overriding previous load"
                )
            results[profile_id] = outcome
        return results

    # ── 内部辅助 ───────────────────────────────────────────────────

    def _read_text_sync(self, path: Path) -> str:
        """同步读取文件文本（被 asyncio.to_thread 调用）。"""
        if not path.exists():
            raise FileNotFoundError(f"Profile YAML not found: {path}")
        return path.read_text(encoding="utf-8")

    def _build_profile(
        self, data: dict[str, Any], source_path: str = ""
    ) -> CapabilityProfile:
        """从字典构建 CapabilityProfile。

        分层构建以保证错误信息可定位到具体字段。
        """
        try:
            # 模型固有能力（必填）
            mc_data = data.get("model_capability")
            if mc_data is None:
                raise ValueError(
                    f"Missing required field 'model_capability' in {source_path}"
                )
            model_capability = ModelCapability.model_validate(mc_data)

            # 认知风格（可选，使用默认值）
            cs_data = data.get("cognitive_style") or {}
            cognitive_style = CognitiveStyle.model_validate(cs_data)

            # 盲点列表
            blind_spots = [
                BlindSpot.model_validate(bs)
                for bs in data.get("blind_spots", [])
            ]

            # 知识包
            skill_packages = [
                SkillPackage.model_validate(sp)
                for sp in data.get("skill_packages", [])
            ]

            # 工具边界
            tb_data = data.get("tool_boundary") or {}
            tool_boundary = ToolBoundary.model_validate(tb_data)

            # 历史表现
            historical_performance = [
                PerformanceLog.model_validate(pl)
                for pl in data.get("historical_performance", [])
            ]

            # 当前状态
            current_state_data = data.get("current_state") or {}
            current_state = AgentState.model_validate(current_state_data)

            # Harness 契合度
            hfs_data = data.get("harness_fit_score") or {}
            harness_fit_score = HarnessFitScore.model_validate(hfs_data)

            # 顶层字段
            profile_id = data.get("profile_id")
            agent_id = data.get("agent_id")
            if not profile_id:
                raise ValueError(
                    f"Missing required field 'profile_id' in {source_path}"
                )
            if not agent_id:
                raise ValueError(
                    f"Missing required field 'agent_id' in {source_path}"
                )

            return CapabilityProfile(
                profile_id=profile_id,
                agent_id=agent_id,
                model_capability=model_capability,
                cognitive_style=cognitive_style,
                blind_spots=blind_spots,
                skill_packages=skill_packages,
                tool_boundary=tool_boundary,
                historical_performance=historical_performance,
                current_state=current_state,
                harness_fit_score=harness_fit_score,
                created_at=data.get(
                    "created_at",
                    CapabilityProfile.model_fields["created_at"].default_factory(),  # type: ignore[misc]
                ),
                updated_at=data.get(
                    "updated_at",
                    CapabilityProfile.model_fields["updated_at"].default_factory(),  # type: ignore[misc]
                ),
            )
        except ValidationError as e:
            self._logger.error(
                f"Validation error building profile from {source_path}: {e}"
            )
            raise ValueError(
                f"Invalid profile data in {source_path}: {e}"
            ) from e

    # ── 序列化辅助 ─────────────────────────────────────────────────

    async def dump_to_yaml(
        self,
        profile: CapabilityProfile,
        path: PathLike,
    ) -> None:
        """将 CapabilityProfile 序列化到 YAML 文件。

        铁律 6：async I/O 包装。

        Args:
            profile: 要序列化的能力画像。
            path: 目标 YAML 文件路径。
        """
        file_path = Path(path)
        # 排除 Callable 字段（load_fn）
        data = profile.model_dump(mode="json")
        # 移除 load_fn（已通过 exclude=True 排除，但 JSON 模式可能保留 None）
        for sp in data.get("skill_packages", []):
            sp.pop("load_fn", None)

        text = yaml.safe_dump(
            data, allow_unicode=True, sort_keys=False, default_flow_style=False
        )
        # 确保父目录存在
        await asyncio.to_thread(self._ensure_parent_dir, file_path)
        await asyncio.to_thread(self._write_text_sync, file_path, text)
        self._logger.debug(f"Dumped profile {profile.profile_id} to {file_path}")

    def _ensure_parent_dir(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)

    def _write_text_sync(self, path: Path, text: str) -> None:
        path.write_text(text, encoding="utf-8")

    # ── JSON 辅助（便于 trace 输出） ──────────────────────────────

    def to_json(self, profile: CapabilityProfile) -> str:
        """将画像序列化为 JSON 字符串（用于 trace 输出 / API 响应）。"""
        return profile.model_dump_json(indent=2)

    def from_json(self, json_str: str) -> CapabilityProfile:
        """从 JSON 字符串反序列化画像。"""
        data = json.loads(json_str)
        return self._build_profile(data, source_path="<json>")

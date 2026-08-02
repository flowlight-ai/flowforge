"""LLM路由层 — 多模型级联+健康检查+自动切换.

从models.yaml加载级联策略配置，根据模型健康状态自动路由到最优模型。
与LLMClient互补：LLMClient负责实际调用，LLMRouter负责策略决策。
"""

import asyncio
import time
from enum import Enum
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("llm.router")


class ModelHealth(str, Enum):
    """模型健康状态."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


class ModelStatus(BaseModel):
    """模型运行时状态."""

    model_id: str
    health: ModelHealth = ModelHealth.HEALTHY
    latency_p95: float = 0.0
    error_rate: float = 0.0
    last_success: float = 0.0
    consecutive_errors: int = 0
    total_calls: int = 0
    total_errors: int = 0


class LLMRouter:
    """LLM路由器 — 根据级联策略选择最优模型.

    从models.yaml的assignments段加载模型分配策略，结合模型健康状态
    决定使用哪个模型。支持：
    - 多策略路由（default/content_writing/code_generation/fact_check等）
    - 健康感知：自动跳过UNAVAILABLE模型
    - 降级路由：HEALTHY → DEGRADED → UNAVAILABLE
    - 运行时健康更新：record_success/record_error

    注意：配置文件中使用 assignments（含 primary + fallbacks），
    而非旧的 cascade_strategies（含 primary + fallback）。
    本类对外保留 route(strategy) 接口，内部映射到 assignments。
    """

    def __init__(self, config_path: str = ""):
        self._models: Dict[str, ModelStatus] = {}
        self._cascade_strategies: Dict[str, dict] = {}  # 兼容字段，实际从 assignments 加载
        self._model_specs: Dict[str, dict] = {}
        self._lock = asyncio.Lock()
        if config_path:
            self._load_config(config_path)

    def _load_config(self, path: str):
        """加载模型分配配置（从models.yaml的assignments段）.

        兼容旧配置：若 assignments 不存在，回退到 cascade_strategies。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception as e:
            logger.error(f"LLMRouter加载配置失败: {path}, 错误: {e}")
            return

        # 优先从 assignments 加载（models.yaml 的标准结构）
        assignments = data.get("assignments", {})
        if assignments:
            # 将 assignments 转换为内部 cascade_strategies 格式
            # assignments[key] = {primary, fallbacks}  →  cascade_strategies[key] = {primary, fallback}
            self._cascade_strategies = {}
            for key, assignment in assignments.items():
                self._cascade_strategies[key] = {
                    "primary": assignment.get("primary", ""),
                    "fallback": assignment.get("fallbacks", []),
                }
            logger.info(f"LLMRouter从 assignments 加载 {len(self._cascade_strategies)} 个策略")
        else:
            # 回退兼容：旧的 cascade_strategies 结构
            self._cascade_strategies = data.get("cascade_strategies", {})
            if self._cascade_strategies:
                logger.warning(
                    f"LLMRouter: models.yaml 使用旧的 cascade_strategies 结构，"
                    f"建议迁移到 assignments。加载了 {len(self._cascade_strategies)} 个策略"
                )

        # 加载模型规格（兼容 models 列表和 model_specs 字典两种格式）
        self._model_specs = data.get("model_specs", {})
        models_list = data.get("models", [])
        if models_list and not self._model_specs:
            # 将 models 列表转换为字典（以 id 为 key）
            for m in models_list:
                mid = m.get("id", "")
                if mid:
                    self._model_specs[mid] = m

        # 初始化模型状态
        for model_id in self._model_specs:
            if model_id not in self._models:
                self._models[model_id] = ModelStatus(model_id=model_id)

        # 从级联策略中提取模型ID并初始化
        for strategy_name, strategy in self._cascade_strategies.items():
            primary = strategy.get("primary", "")
            if primary and primary not in self._models:
                self._models[primary] = ModelStatus(model_id=primary)
            for fb in strategy.get("fallback", []):
                if fb and fb not in self._models:
                    self._models[fb] = ModelStatus(model_id=fb)

        logger.info(
            f"LLMRouter加载配置: {len(self._cascade_strategies)}个策略, "
            f"{len(self._models)}个模型"
        )

    async def route(self, strategy: str = "default", **kwargs) -> str:
        """根据策略路由到最优模型.

        Args:
            strategy: 策略名称（对应 assignments 的 key，如 default/content_writing等）
            **kwargs: 预留扩展参数

        Returns:
            选中的模型ID
        """
        config = self._cascade_strategies.get(
            strategy, self._cascade_strategies.get("default", {})
        )
        primary = config.get("primary", "")
        fallback_chain = config.get("fallback", [])

        # 检查primary健康
        if self._is_available(primary):
            return primary

        # 遍历fallback链
        for model_id in fallback_chain:
            if self._is_available(model_id):
                logger.info(
                    f"LLMRouter路由: strategy={strategy}, "
                    f"primary={primary}不可用, 降级到{model_id}"
                )
                return model_id

        # 全部不可用，返回primary（让调用方处理错误）
        logger.warning(
            f"LLMRouter路由: strategy={strategy}, "
            f"所有模型不可用，回退到primary={primary}"
        )
        return primary

    def _is_available(self, model_id: str) -> bool:
        """检查模型是否可用."""
        status = self._models.get(model_id)
        if not status:
            return True  # 未知模型默认可用
        return status.health != ModelHealth.UNAVAILABLE

    async def record_success(self, model_id: str, latency: float):
        """记录成功调用."""
        async with self._lock:
            if model_id not in self._models:
                self._models[model_id] = ModelStatus(model_id=model_id)
            status = self._models[model_id]
            status.health = ModelHealth.HEALTHY
            status.latency_p95 = latency
            status.last_success = time.time()
            status.consecutive_errors = 0
            status.total_calls += 1
            status.error_rate = max(0, status.error_rate - 0.01)

    async def record_error(self, model_id: str, error_type: str = ""):
        """记录错误调用."""
        async with self._lock:
            if model_id not in self._models:
                self._models[model_id] = ModelStatus(model_id=model_id)
            status = self._models[model_id]
            status.consecutive_errors += 1
            status.total_calls += 1
            status.total_errors += 1
            status.error_rate = min(1.0, status.error_rate + 0.05)
            if status.consecutive_errors >= 3:
                status.health = ModelHealth.UNAVAILABLE
                logger.warning(
                    f"LLMRouter: 模型{model_id}连续{status.consecutive_errors}次错误，"
                    f"标记为UNAVAILABLE"
                )
            elif status.error_rate > 0.1:
                status.health = ModelHealth.DEGRADED
                logger.info(
                    f"LLMRouter: 模型{model_id}错误率{status.error_rate:.2%}，"
                    f"标记为DEGRADED"
                )

    def get_model_status(self, model_id: str) -> Optional[ModelStatus]:
        """获取模型状态."""
        return self._models.get(model_id)

    def get_all_status(self) -> Dict[str, ModelStatus]:
        """获取所有模型状态."""
        return dict(self._models)

    def get_strategies(self) -> Dict[str, dict]:
        """获取所有级联策略."""
        return dict(self._cascade_strategies)

    def get_health_report(self) -> dict:
        """获取健康报告."""
        healthy = sum(1 for s in self._models.values() if s.health == ModelHealth.HEALTHY)
        degraded = sum(1 for s in self._models.values() if s.health == ModelHealth.DEGRADED)
        unavailable = sum(1 for s in self._models.values() if s.health == ModelHealth.UNAVAILABLE)
        return {
            "total_models": len(self._models),
            "healthy": healthy,
            "degraded": degraded,
            "unavailable": unavailable,
            "strategies": list(self._cascade_strategies.keys()),
            "models": {
                mid: {
                    "health": s.health.value,
                    "error_rate": s.error_rate,
                    "consecutive_errors": s.consecutive_errors,
                    "total_calls": s.total_calls,
                    "total_errors": s.total_errors,
                }
                for mid, s in self._models.items()
            },
        }

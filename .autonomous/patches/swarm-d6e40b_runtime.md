# 自主任务产出审阅

- **task_id**: swarm-d6e40b8a9db9
- **title**: 修复代码 TODO: flowforge\evolution\runtime.py
- **agent**: forgemind:sherlock
- **model**: Doubao-Seed2.0
- **generated_at**: 2026-08-01T02:39:55.474541+00:00
- **source_file**: flowforge\evolution\runtime.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\evolution\runtime.py 中发现 1 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

# 文件路径：flowforge/core/selfdev_runtime.py

python

```
from __future__ import annotations
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Awaitable

from flowforge.core.tracing import get_logger
from flowforge.core.trae_bridge import TraeLLMClient, TraeBridgeConfig, TraeBridgeProtocol
from flowforge.core.forge_mind_engine import ForgeMindEngine
from flowforge.core.approval_hub import ApprovalHub, ApprovalRequest
from flowforge.selfdev.models import DevPlan, DevTask
from flowforge.selfdev.loops import (
    SelfDevDocLoop,
    SelfDevCodeLoop,
    SelfDevFrameworkLoop,
    SelfDevReviewLoop,
    SelfDevTestLoop,
)
from flowforge.config.loader import load_forgekin_config

logger = get_logger("core.selfdev_runtime")

# 全局常量定义
_DEFAULT_TRAE_BRIDGE_YAML = "flowforge/config/trae_bridge.yaml"
BUILTIN_FORGEKINS = ("wenxin", "sherlock", "luban", "vangogh", "davinci")
_FORGEKIN_LOOP_CLASSES = {
    "wenxin": SelfDevDocLoop,
    "sherlock": SelfDevCodeLoop,
    "luban": SelfDevFrameworkLoop,
    "vangogh": SelfDevReviewLoop,
    "davinci": SelfDevTestLoop,
}
# 需要 approval_callback 的 forgekin（I8 不变量：framework 闭环）
_FRAMEWORK_FORGEKIN_ID = "luban"

# approval_mode 类型别名
ApprovalMode = Literal["auto", "manual", "im"]
# approval_callback 类型别名（与 self_dev_framework.ApprovalCallback 一致）
ApprovalCallback = Callable[[DevPlan, DevTask], Awaitable[bool]]

class SelfDevRuntime:
    """生产环境 SelfDev 五闭环运行时装配点（F046 §3.1 Phase 5 + F045 桥接）.
    负责：
    - 加载 trae_bridge.yaml 创建 TraeLLMClient
    - 加载 5 个 forgekin YAML 配置
    - 注入 approval_callback（基于 ApprovalHub + F047 IM 议事通道）
    - 创建 ForgeMindEngine + 5 个 SelfDev 闭环实例并注册

    用法：
    runtime = SelfDevRuntime.bootstrap()
    result = await runtime.run_doc_loop({"task_source": "scan"})
    """

    def __init__(
        self,
        *,
        trae_client: TraeLLMClient,
        bridge_config: TraeBridgeConfig,
        protocol: TraeBridgeProtocol,
        engine: ForgeMindEngine,
        approval_hub: ApprovalHub,
        forgekin_configs: Dict[str, Dict[str, Any]],
        approval_mode: ApprovalMode = "manual",
        approval_timeout_seconds: int = 300,
    ) -> None:
        """初始化 SelfDevRuntime（由 bootstrap 调用，不直接实例化）.
        Args:
            trae_client: TraeLLMClient 实例（F045 桥接）
            bridge_config: TraeBridgeConfig 桥接配置
            protocol: TraeBridgeProtocol 协议层
            engine: ForgeMindEngine 实例（已注册 5 个 SelfDev 闭环）
            approval_hub: ApprovalHub 实例（CL-033）
            forgekin_configs: 5 个 forgekin 的配置字典
            approval_mode: 审批模式（"auto"/"manual"/"im"）
            approval_timeout_seconds: 审批超时秒数（从 trae_bridge.yaml 读取）
        """
        self._trae_client = trae_client
        self._bridge_config = bridge_config
        self._protocol = protocol
        self._engine = engine
        self._approval_hub = approval_hub
        self._forgekin_configs = forgekin_configs
        self._approval_mode: ApprovalMode = approval_mode
        self._approval_timeout_seconds: int = approval_timeout_seconds

        # request_id -> asyncio.Event（operator 决策后 set，唤醒等待中的 callback）
        self._pending_events: Dict[str, asyncio.Event] = {}
        # request_id -> approved（决策结果缓存，供 approval_callback 读取）
        self._decisions: Dict[str, bool] = {}
        self._logger = logger
        self._logger.info(
            f"SelfDevRuntime 初始化: approval_mode={approval_mode}, "
            f"timeout={approval_timeout_seconds}s, "
            f"forgekins={list(forgekin_configs.keys())}"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 bootstrap — 生产装配入口
    # ══════════════════════════════════════════════════════════════
    @classmethod
    def bootstrap(
        cls,
        *,
        trae_bridge_yaml_path: str = _DEFAULT_TRAE_BRIDGE_YAML,
        approval_mode: ApprovalMode = "manual",
        project_root: Optional[str] = None,
    ) -> "SelfDevRuntime":
        """生产装配入口 — 加载配置 + 创建实例 + 注册闭环.
        Args:
            trae_bridge_yaml_path: trae_bridge.yaml 路径（默认 flowforge/config/trae_bridge.yaml）
            approval_mode: 审批模式：
                - "auto": 自动批准（仅 demo / 测试用，记录警告日志）
                - "manual": 通过 ApprovalHub，operator 调用 runtime.approve/reject 决策
                - "im": 通过 F047 IM 议事通道推送（F047 完成后启用，当前降级为 manual）
            project_root: 项目根目录（None 用当前工作目录）
        Returns:
            SelfDevRuntime 实例（已注册 5 个 SelfDev 闭环）
        Raises:
            FileNotFoundError: trae_bridge.yaml 或 forgekin YAML 不存在
            KeyError: forgekin 配置缺少必需字段（如 self_dev.loop_type）
        """
        # 1. 加载 TraeBridgeConfig（红线 11：路径不硬编码，从 YAML 读取）
        bridge_config = TraeBridgeConfig.load_from_yaml(trae_bridge_yaml_path)
        logger.info(
            f"bootstrap 加载桥接配置: shared_dir={bridge_config.shared_dir}, "
            f"default_timeout={bridge_config.default_timeout_seconds}s"
        )

        # 2. 创建 TraeBridgeProtocol（DI 注入 bridge_config，红线 12）
        protocol = TraeBridgeProtocol(bridge_config)

        # 3. 创建 TraeLLMClient（DI 注入 protocol + bridge_config，红线 12）
        trae_client = TraeLLMClient(
            bridge_config=bridge_config,
            protocol=protocol,
        )

        # 4. 加载 5 个 forgekin YAML 配置（铁律 5：配置外置到 YAML）
        root = project_root or str(Path.cwd())
        forgekin_configs: Dict[str, Dict[str, Any]] = {}
        for forgekin_id in BUILTIN_FORGEKINS:
            try:
                cfg = load_forgekin_config(forgekin_id)
            except (KeyError, FileNotFoundError) as e:
                logger.error(f"bootstrap 加载 forgekin 失败: id={forgekin_id}, error={e}")
                raise
            # 注入 project_root（SelfDevLoopBase 要求 forgekin_config 含 project_root）
            cfg["project_root"] = root
            forgekin_configs[forgekin_id] = cfg
            self_dev_cfg = cfg.get("self_evolution", {}).get("self_dev", {})
            logger.info(
                f"bootstrap 加载 forgekin: id={forgekin_id}, "
                f"loop_type={self_dev_cfg.get('loop_type', '')}, "
                f"stage={self_dev_cfg.get('awakening_stage', '')}"
            )

        # 5. 创建 ForgeMindEngine（治理层）
        engine = ForgeMindEngine()

        # 6. 创建 ApprovalHub（CL-033 跨 thread 统一审批中心）
        approval_hub = ApprovalHub()

        # 7. 创建 SelfDevRuntime 实例（提前创建以便注入 approval_callback 闭包）
        approval_timeout = bridge_config.default_timeout_seconds
        runtime = cls(
            trae_client=trae_client,
            bridge_config=bridge_config,
            protocol=protocol,
            engine=engine,
            approval_hub=approval_hub,
            forgekin_configs=forgekin_configs,
            approval_mode=approval_mode,
            approval_timeout_seconds=approval_timeout,
        )

        # 8. 为 luban 注入 approval_callback（I8 不变量：framework 闭环必须注入）
        approval_callback = runtime._make_approval_callback(_FRAMEWORK_FORGEKIN_ID)
        if _FRAMEWORK_FORGEKIN_ID in forgekin_configs:
            forgekin_configs[_FRAMEWORK_FORGEKIN_ID]["approval_callback"] = approval_callback
            logger.info(
                f"bootstrap 注入 approval_callback: forgekin={_FRAMEWORK_FORGEKIN_ID}, "
                f"mode={approval_mode}"
            )

        # 9. 实例化 5 个 SelfDev 闭环并注册到 engine（DI 注入，红线 12）
        for forgekin_id, loop_cls in _FORGEKIN_LOOP_CLASSES.items():
            cfg = forgekin_configs[forgekin_id]
            self_dev_cfg = cfg.get("self_evolution", {}).get("self_dev", {})
            loop_type = self_dev_cfg.get("loop_type")
            awakening_stage = self_dev_cfg.get("awakening_stage", "E3")
            if not loop_type:
                raise KeyError(
                    f"forgekin {forgekin_id} 配置缺少 self_evolution.self_dev.loop_type"
                )
            loop_instance = loop_cls(
                trae_client=trae_client,
                forgekin_config=cfg,
                evolution_engine=engine,
                awakening_stage=awakening_stage,
            )
            engine.register_self_dev_loop(loop_instance)
            logger.info(
                f"bootstrap 注册 SelfDev 闭环: forgekin={forgekin_id}, "
                f"loop_type={loop_type}, stage={awakening_stage}"
            )

        logger.info(
            f"bootstrap 完成: approval_mode={approval_mode}, "
            f"registered_loops={engine.list_self_dev_
```
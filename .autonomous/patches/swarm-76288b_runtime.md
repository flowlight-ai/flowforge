# 自主任务产出审阅

- **task_id**: swarm-76288b3ba775
- **title**: 修复代码 TODO: flowforge\evolution\runtime.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T04:57:57.231098+00:00
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

python

```
# 文件路径: flowforge/runtime/selfdev_runtime.py
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Literal, Awaitable

from flowforge.config.trae_bridge_config import TraeBridgeConfig
from flowforge.protocol.trae_bridge_protocol import TraeBridgeProtocol
from flowforge.client.trae_llm_client import TraeLLMClient
from flowforge.engine.forge_mind_engine import ForgeMindEngine
from flowforge.approval.approval_hub import ApprovalHub, ApprovalRequest
from flowforge.constant.forgekin_const import BUILTIN_FORGEKINS, _FORGEKIN_LOOP_CLASSES
from flowforge.config.loader import load_forgekin_config
from flowforge.constant.runtime_const import _DEFAULT_TRAE_BRIDGE_YAML
from flowforge.models.dev_plan import DevPlan
from flowforge.models.dev_task import DevTask
from flowforge.logger import logger
from flowforge.channel.im_channel import IMChannel  # F047 IM议事通道真实模块

# Forgekin闭环映射
_FORGEKIN_MAP = {
    "wenxin": SelfDevDocLoop,
    "sherlock": SelfDevCodeLoop,
    "luban": SelfDevFrameworkLoop,
    "vangogh": SelfDevReviewLoop,
    "davinci": SelfDevTestLoop,
}
# 需要绑定approval_callback的forgekin（I8不变量：framework闭环）
_FRAMEWORK_FORGEKIN_ID = "luban"

# 审批模式类型别名
ApprovalMode = Literal["auto", "manual", "im"]
# 审批回调类型别名（与 self_dev_framework.ApprovalCallback 一致）
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
        # F047 IM通道实例，im模式专用
        self._im_channel: Optional[IMChannel] = None

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
                - "im": 通过 F047 IM 议事通道推送
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

        # 2. 创建 Trae

```
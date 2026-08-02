# 自主任务产出审阅

- **task_id**: swarm-e15506839490
- **title**: 修复代码 TODO: flowforge\evolution\runtime.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T04:37:38.986513+00:00
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
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Awaitable
from uuid import uuid4

from flowforge.core.approval_models import ApprovalRequest
from flowforge.core.forge_mind_engine import ForgeMindEngine
from flowforge.core.trae_bridge import TraeBridgeConfig, TraeBridgeProtocol, TraeLLMClient
from flowforge.core.approval_hub import ApprovalHub
from flowforge.selfdev.models import DevPlan, DevTask
from flowforge.config.loader import load_forgekin_config

logger = logging.getLogger(__name__)

BUILTIN_FORGEKINS = {"wenxin", "sherlock", "luban", "vangogh", "davinci"}
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

# 默认桥接配置路径
_DEFAULT_TRAE_BRIDGE_YAML = "flowforge/config/trae_bridge.yaml"

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
            approval_hu
```
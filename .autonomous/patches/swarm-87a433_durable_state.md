# 自主任务产出审阅

- **task_id**: swarm-87a433ed6f71
- **title**: 修复代码 TODO: flowforge\harness\durable_state.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T23:55:47.946291+00:00
- **source_file**: flowforge\harness\durable_state.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\harness\durable_state.py 中发现 3 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

# 文件路径：flowforge/runtime/selfdev_runtime.py

python

```
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Awaitable

from flowforge.config.trae_bridge_config import TraeBridgeConfig
from flowforge.trae.protocol import TraeBridgeProtocol
from flowforge.trae.client import TraeLLMClient
from flowforge.selfdev.engine import ForgeMindEngine
from flowforge.selfdev.models import DevPlan, DevTask
from flowforge.selfdev.approval import ApprovalHub, ApprovalRequest
from flowforge.selfdev.config import load_forgekin_config
from flowforge.common.logger import logger

# Forgekin 闭环映射定义
_FORGEKIN_LOOP_CLASSES = {
    "wenxin": SelfDevDocLoop,
    "sherlock": SelfDevCodeLoop,
    "luban": SelfDevFrameworkLoop,
    "vangogh": SelfDevReviewLoop,
    "davinci": SelfDevTestLoop,
}
BUILTIN_FORGEKINS = list(_FORGEKIN_LOOP_CLASSES.keys())

# 需要 approval_callback 的 forgekin（I8 不变量：framework 闭环）
_FRAMEWORK_FORGEKIN_ID = "luban"

# approval_mode 类型别名
ApprovalMode = Literal["auto", "manual", "im"]
# approval_callback 类型别名（与 self_dev_framework.ApprovalCallback 一致）
ApprovalCallback = Callable[[DevPlan, DevTask], Awaita
```
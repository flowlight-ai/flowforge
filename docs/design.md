# FlowForge — 设计文档（当前阶段）

> **版本**：v1.0 — 阶段一最小骨架
> **对应规格**：`spec.md`
> **对应架构**：`arch.md`
> **定位**：本文档是**动态文档**，只描述当前正在实现的设计。每完成一个阶段更新本文档，移除已完成内容并加入下一阶段设计。完整任务规划见 roadmap.md。

---

## 1. 当前阶段：最小化自进化骨架

### 1.1 目标

构建 FlowForge **最小可运行骨架**，验证以下核心闭环：

```
用户输入 → ForgekinBase.observe() → reason() → act() → verify() → Eval 信号 → EchoStore 写回
```

完成此阶段后，可以：
- 注册 1 个预置 Forgekin（鲁班 = 猫头鹰）
- 执行单次 observe → reason → act → verify 循环
- 采集 Eval 信号到 Eval Ledger
- 通过 CLI 触发循环

### 1.2 不在当前阶段的能力

以下能力在后续阶段实现，当前阶段**不包含**：

| 能力 | 实现阶段 |
|------|---------|
| TeamAct 多 Forgekin 协作 | 阶段二 |
| MindCouncil | 阶段三 |
| 三方 Agent 集成 | 阶段三 |
| SpiritForge 经验蒸馏 | 阶段四 |
| Eval 自代谢 | 阶段四 |
| 多域记忆联邦 | 阶段二 |
| *Forge 垂直业务集成 | 阶段五 |

### 1.3 最小化硬性要求

1. ✅ Python 3.11+ / 类型注解强制 / `async/await` I/O
2. ✅ Pydantic v2 BaseModel（禁止 dataclass）
3. ✅ DI 容器管理所有依赖（禁止直接实例化）
4. ✅ 配置外置到 YAML（禁止硬编码提示词/路径/密钥）
5. ✅ 跨平台路径占位符（Linux / Windows / macOS）
6. ✅ MIT License
7. ✅ Plugin V2 + V3 协议定义（不要求实现，只要求协议）
8. ✅ 单向依赖零容忍
9. ✅ ForgekinBase 抽象基类 + 1 个预置 Forgekin 实现
10. ✅ Eval 信号采集到不可删除的 Ledger
11. ✅ T1-T8 测试铁律基线测试套件
12. ✅ CLI 入口（`flowforge` 命令）

---

## 2. 已完成（阶段零：项目骨架）

### 2.1 项目元数据

| 项 | 值 | 文件 |
|----|----|----|
| License | MIT | `LICENSE` / `pyproject.toml` |
| Python 版本 | `>=3.11` | `pyproject.toml` |
| 核心依赖 | `pydantic>=2.5,<3.0` / `pyyaml>=6.0` / `httpx>=0.27` / `anyio>=4.0` | `pyproject.toml` |
| 开发依赖 | `pytest>=8.0` / `ruff>=0.5` / `mypy>=1.10` | `pyproject.toml` |
| Lint 配置 | ruff (line-length=110, target=py311) | `pyproject.toml` |
| Type check | mypy strict | `pyproject.toml` |
| 测试配置 | pytest (asyncio_mode=auto) | `pyproject.toml` |

### 2.2 跨平台路径配置

**`.env.example`** — 环境变量模板，含 3 个核心路径占位符：
- `${FLOWLIGHT_AI_ROOT}` — flowlight-ai 组织根目录
- `${FLOWFORGE_WORK_DIR}` — FlowForge 工作目录（状态、检查点、中间产物）
- `${FLOWFORGE_LOG_DIR}` — 日志目录

**`config/system.yaml`** — 系统配置，5 节：
- `paths` — 路径占位符引用
- `runtime` — 运行时行为（debug / trace_level / async_mode）
- `verification` — T7/T8 验证开关
- `plugins` — 插件发现
- `di` — DI 容器配置

### 2.3 文档骨架

| 文档 | 内容 | 状态 |
|------|------|------|
| `README.md` | GitHub 首页 | ✅ |
| `docs/spec.md` | 全局规格说明 | ✅ |
| `docs/arch.md` | 全局架构设计 | ✅ |
| `docs/design.md` | 当前阶段设计（本文档） | ✅ |
| `docs/VISION.md` | 可进化智能体愿景 | ✅ |
| `docs/ROADMAP.md` | 6 阶段路线图 | ✅ |
| `docs/SOP.md` | Forgekin 协作 SOP | ✅ |
| `docs/TIPS.md` | 经验提示 | ✅ |
| `docs/decisions/` | 5 份核心 ADR | ✅ |
| `docs/features/` | 4 份核心 Feature 规格 | ✅ |

### 2.4 .gitignore 策略

**公开提交**（GitHub 用户可见，让用户感觉是全新项目）：
- `docs/spec.md` / `arch.md` / `design.md` — 三件套
- `docs/VISION.md` / `ROADMAP.md` / `SOP.md` / `TIPS.md`
- `docs/decisions/` / `features/` — ADR + Feature 规格
- `config/*.yaml` — 配置文件
- `flowforge/` + `forgemind/` — 代码

**忽略提交**（内部开发参考，不公开）：
- `.env` — 实际环境变量
- `.work/` — 运行时工作目录
- `docs/task.md` — 内部任务规划
- `docs/reflection/` / `docs/archive/` — 内部反思与归档

---

## 3. 待实现（阶段一：Core 基础设施）

### 3.1 实现范围

阶段一聚焦 **Layer 1 核心框架层的基础设施**，共 7 个模块：

| 模块 | 文件 | 职责 |
|------|------|------|
| `core/interfaces/` | `interfaces.py` | 所有抽象基类定义 |
| `core/tracing.py` | `tracing.py` | 日志 + trace_id 注入 |
| `core/errors.py` | `errors.py` | 错误类型层级 |
| `core/config.py` | `config.py` | YAML 配置加载 + 路径占位符解析 |
| `core/di.py` | `di.py` | DI 容器 |
| `core/registries.py` | `registries.py` | SkillRegistry / CouncilRegistry / SpiritForgeRegistry / ForgekinRegistry |
| `core/plugin_protocol.py` | `plugin_protocol.py` | Plugin V2 + V3 协议定义 |
| `core/gate/` | `gate.py` | 输入/输出 gate（基础门禁） |

### 3.2 设计契约

#### 3.2.1 `core/interfaces/`

所有抽象基类集中定义，禁止散落到各模块：

```python
# flowforge/core/interfaces/base.py
from abc import ABC, abstractmethod
from typing import Any, Protocol

class ILifecycle(Protocol):
    async def on_startup(self) -> None: ...
    async def on_shutdown(self) -> None: ...

class IRegistry(Protocol):
    def register(self, spec: Any) -> None: ...
    def get(self, name: str) -> Any: ...
    def list(self) -> list[Any]: ...
```

#### 3.2.2 `core/tracing.py`

```python
# flowforge/core/tracing.py
import logging
from contextvars import ContextVar

_trace_id: ContextVar[str] = ContextVar("trace_id", default="")

def get_logger(name: str) -> logging.Logger:
    """获取 logger，自动注入 trace_id。"""
    ...

def set_trace_id(trace_id: str) -> None:
    """设置当前上下文的 trace_id。"""
    _trace_id.set(trace_id)
```

#### 3.2.3 `core/config.py`

```python
# flowforge/core/config.py
from pydantic import BaseModel
import os
import re
import yaml
from pathlib import Path

class SystemConfig(BaseModel):
    """系统配置 Pydantic 模型。"""
    paths: dict[str, str]
    runtime: dict[str, Any]
    verification: dict[str, Any]
    plugins: dict[str, Any]
    di: dict[str, Any]

def load_config(config_path: Path) -> SystemConfig:
    """加载 YAML 配置并解析 ${...} 占位符。"""
    ...

def _resolve_placeholders(value: str, env: dict[str, str]) -> str:
    """递归解析 ${VAR} 占位符为环境变量值。"""
    ...
```

#### 3.2.4 `core/di.py`

```python
# flowforge/core/di.py
from typing import TypeVar, Type, Any
from threading import Lock

T = TypeVar("T")

class DIContainer:
    """依赖注入容器（线程安全单例）。"""
    
    def register(self, interface: Type[T], implementation: Type[T]) -> None: ...
    def get(self, interface: Type[T]) -> T: ...
    def singleton(self, instance: T) -> None: ...

_container: DIContainer | None = None
_lock = Lock()

def get_container() -> DIContainer:
    global _container
    if _container is None:
        with _lock:
            if _container is None:
                _container = DIContainer()
    return _container
```

#### 3.2.5 `core/registries.py`

```python
# flowforge/core/registries.py
from pydantic import BaseModel

class SkillRegistry:
    """Forge Nurturing 技能注册中心。"""
    def register(self, spec: "SkillSpec") -> None: ...
    def get(self, name: str) -> "SkillSpec": ...
    def list(self) -> list["SkillSpec"]: ...

class CouncilRegistry:
    """MindCouncil 通道注册中心。"""
    ...

class SpiritForgeRegistry:
    """自动锻造配置注册中心。"""
    ...

class ForgekinRegistry:
    """Forgekin 注册中心。"""
    ...
```

#### 3.2.6 `core/plugin_protocol.py`

Plugin V2 + V3 协议定义，详见 `arch.md` §3。

#### 3.2.7 `core/gate/`

```python
# flowforge/core/gate/input.py
class InputGate:
    """输入门禁 — 验证用户输入合法性。"""
    async def validate(self, user_input: str) -> "ValidationResult": ...

# flowforge/core/gate/output.py
class OutputGate:
    """输出门禁 — 验证 LLM 输出合规性。"""
    async def validate(self, output: str) -> "ValidationResult": ...
```

### 3.3 验收标准

阶段一完成后必须满足：

| 验收项 | 验证方式 |
|--------|---------|
| 7 个模块文件存在 | `ls flowforge/core/{interfaces,tracing,errors,config,di,registries,plugin_protocol,gate}` |
| Pydantic BaseModel 使用 | `grep -r "from pydantic" flowforge/core/` 有结果 |
| 无 dataclass 使用 | `grep -r "@dataclass" flowforge/core/` 无结果 |
| DI 容器可工作 | `pytest tests/core/test_di.py` 通过 |
| 配置加载可工作 | `pytest tests/core/test_config.py` 通过 |
| 路径占位符解析 | `pytest tests/core/test_config.py::test_resolve_placeholders` 通过 |
| Plugin V2 + V3 协议定义 | `pytest tests/core/test_plugin_protocol.py` 通过 |
| 所有类型注解 | `mypy flowforge/core/` 无错误 |
| Lint 通过 | `ruff check flowforge/core/` 无错误 |
| T1-T8 测试基线 | `pytest tests/ -m "not integration"` 通过 |

---

## 4. 后续阶段预览

| 阶段 | 范围 | 关键交付 |
|------|------|---------|
| 阶段零 | 项目骨架 | ✅ 已完成 |
| 阶段一 | Core 基础设施 | 7 个 core 模块 |
| 阶段二 | 能力画像 + TeamAct + Harness | CapabilityProfile + TeamActState + 7 层 Harness |
| 阶段三 | LLMClient + LoopExecutor + forgemind | LLMClient + Loop 引擎 + ForgekinBase + 1 个预置 Forgekin |
| 阶段四 | 自进化三闭环 + Eval | Mode A/B/C + Eval Ledger |
| 阶段五 | 三方 Agent + MindCouncil | EAC v1 + 4 个适配器 + Mind Council |
| 阶段六 | SpiritForge + Mind Codex | SpiritForge + Mind Codex |

完整阶段规划见内部 `task.md`。

---

## 5. 引用

- `spec.md` — 全局规格说明（做什么）
- `arch.md` — 全局架构设计（如何组织）
- `decisions/` — 架构决策记录（ADR）
- `features/` — Feature 规格模板
- `.env.example` — 环境变量模板
- `config/system.yaml` — 系统配置

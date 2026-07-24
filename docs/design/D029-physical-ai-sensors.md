# D029: 物理 AI 传感器接入详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.11]（FR-CORE-011）
> **对应 arch.md**: [doc:../arch.md#§3.11]
> **对应 design.md**: [doc:../design.md#§3.11]（本文件）
> **对应 Feature**: [doc:../features/F029-physical-ai-sensors.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A029-physical-ai-sensors.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

forgemind 应用层需要为 BIO/ORG/OBJ/HYBRID 形态Forgekin提供物理世界感知通道，对标业界 Embodied AI（具身智能）工程实现路径。A029 已固化 8 传感器通道 + 4 类 Adapter + 形态门控 + Tier 0 不可逆保护架构，本详细设计在 `forgemind/sensors/` 落地具体实现，解决以下工程层问题：

1. **8 传感器通道枚举未落地**：`SensorChannel` 接口在 A029 已定义，但 `forgemind/sensors/base.py` 未实现。
2. **4 类 Adapter 实现缺失**：CameraAdapter / MicrophoneAdapter / IotAdapter / WearableAdapter 四类适配器抽象类未编写。
3. **形态门控调用未集成**：`SensorRegistry.bind` 调用 `SpeciesRegistry.assert_sensor_allowed(species, channel)` 的具体调用链未实现。
4. **PhysicalEventIngestor 未实现**：传感器事件写入 F014 EchoStore 的转换器未实现，含采样率差异化策略（高采样率特征提取、低采样率直存）。
5. **Tier0Guard 未实现**：物理不可逆操作守卫未实现，含 operator 二次确认 + 永不自动恢复逻辑。
6. **设备故障降级机制未实现**：传感器离线时Forgekin进入 liveness degraded 状态的具体转换未编码。
7. **sensors.yaml 配置加载器未实现**：8 通道配置 + 4 类 Adapter driver 类名 + 采样率 + 数据格式 YAML 外置加载器未实现。

### 1.2 设计约束

- **单向依赖约束**：`forgemind/sensors/` 必须单向依赖 `flowforge/core/` 中的 F014 EchoStore + F023 liveness 读模型 + `forgemind/species/`（F027），禁止 `import` 任何 *Forge 业务模块。
- **DI 容器约束**：`SensorAdapter` 实例必须通过 DI 容器注入到 `SensorRegistry`，禁止 `OpenCvCameraAdapter` 直接实例化。
- **Repository 层约束**：`SensorEvent` 写入 EchoStore 必须通过 `EchoStoreRepository.append`，禁止 `cursor.execute` 直接操作数据库。
- **配置驱动约束**：传感器 driver 类名 + `config_schema` + `sampling_rate_hz` + `data_format` + `on_event_action` 必须 YAML 外置到 `forgemind/config/sensors.yaml`，禁止 `.py` 硬编码设备路径。
- **形态门控约束**：`SensorRegistry.bind` 必须调用 `SpeciesRegistry.assert_sensor_allowed(species, channel)` 校验形态合法性，VIRTUAL 形态绑定被拒绝。
- **Tier 0 不可逆约束**：物理执行器（如机械臂、门锁、阀门）等不可逆操作必须经 operator 二次确认，永不自动恢复。
- **采样率适配约束**：高采样率（>= 1Hz）传感器必须做特征提取后入EchoStore，禁止原始数据直接写入 EchoStore（避免EchoStore爆炸）。
- **故障降级约束**：传感器离线时Forgekin必须进入 F023 liveness degraded 状态，observe 返回最近一次有效快照，不阻塞决策回路。

### 1.3 设计影响

- **对 F027 形态分类的影响**：`SensorRegistry` 调用 `SpeciesRegistry.assert_sensor_allowed` 校验形态门控，强化"形态决定接入层"约束。
- **对 F014 多域记忆的影响**：`SensorEvent` 写入 EchoStore 情景记忆，成为Forgekin经验记忆一部分。
- **对 F023 liveness 规范读模型的影响**：传感器离线时Forgekin进入 liveness degraded 状态。
- **对 F022 Tier 1-4 恢复分级的影响**：传感器故障按 Tier 1（自动重试）/Tier 2（换设备）分级恢复；物理不可逆操作按 Tier 0（永不自动恢复）保护。
- **对 ForgekinBase.observe 的影响**：observe 通过 `SensorAdapter.read_snapshot` 读取物理世界状态作为 Observation。

---

## 2. 详细设计

### 2.1 组件设计图

```
                    +-------------------------------------------------+
                    |             forgemind/sensors/                 |
                    |                                                 |
                    |  +-------------------+   +-------------------+ |
                    |  | SensorChannel     |   | SensorDataFormat  | |
                    |  | (8 通道枚举)      |   | (RAW/FEATURE/EVT)| |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                      |           |
                    |  +---------v---------+            |           |
                    |  | SensorBinding     |<-----------+           |
                    |  | (Forgekin<->设备)   |                        |
                    |  +---------+---------+                        |
                    |            |                                  |
                    |  +---------v---------+   +-------------------+ |
                    |  | SensorRegistry    |<->| SpeciesRegistry   | |
                    |  | (YAML 配置驱动)   |   | (F027 形态门控)    | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+             |           |
                    |  | SensorAdapter     |<------------+           |
                    |  | (ABC)             |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | PhysicalEvent     |                         |
                    |  | Ingestor          |                         |
                    |  | (event->EchoStore)|                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+   +-------------------+ |
                    |  | Tier0Guard        |   | SnapshotCache     | |
                    |  | (不可逆操作守卫)   |   | (最近有效快照)     | |
                    |  +-------------------+   +-------------------+ |
                    +-------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                         |                         |
                v                         v                         v
    +-----------------------+   +-----------------------+   +-----------------------+
    | 4 类 Adapter           |   | F014 EchoStore       |   | F023 liveness        |
    | (camera.py / mic.py / |   | Repository           |   | (degraded 状态)      |
    |  iot.py / wearable.py)|   | (情景记忆写入)        |   +-----------------------+
    +-----------------------+   +-----------------------+
                |
                v
    +-----------------------+
    | 物理 IoT 设备          |
    | (摄像头/麦克风/温度/   |
    |  GPS/IMU/压力垫/光照/  |
    |  深度相机)             |
    +-----------------------+
```

### 2.2 关键设计决策

- **决策 1：8 通道枚举固定 + 4 类 Adapter 文件组织**
  `SensorChannel` 固定为 camera/microphone/temperature/location/accelerometer/pressure/light/depth 八通道，覆盖 Embodied AI 主流感知模态。Adapter 按 4 类组织（视觉 camera.py / 听觉 microphone.py / IoT iot.py / 可穿戴 wearable.py），每类一个文件。新增通道必须经 ADR 决策。

- **决策 2：形态门控由 SpeciesRegistry 集中校验**
  `SensorRegistry.bind` 调用 `SpeciesRegistry.assert_sensor_allowed(species, channel)` 校验形态合法性。VIRTUAL 形态绑定物理传感器被拒绝。校验通过 `SpeciesProfile.sensor_allowed: bool` 字段实现。

- **决策 3：采样率差异化适配策略**
  `SensorDataFormat` 三种格式：RAW（原始数据，低采样率直存）/ FEATURE（特征提取，高采样率）/ EVENT（事件触发，如压力垫）。`sampling_rate_hz >= 1.0` 强制 FEATURE 格式，禁止 RAW 直存；`< 1.0` 允许 RAW 直存。

- **决策 4：传感器事件统一写入 F014 EchoStore 情景记忆**
  `PhysicalEventIngestor.ingest(event)` 将 `SensorEvent` 转换为 `EchoStoreEntry`，调用 `EchoStoreRepository.append` 写入 `collection="sensor_event"` 集合。

- **决策 5：设备故障触发 F023 liveness degraded + 快照缓存**
  `SnapshotCache` 缓存最近一次有效快照（per binding），`SensorAdapter.health_check=false` 时触发 `LivenessService.mark_degraded(forgekin_id, reason="sensor_offline")`，`observe` 返回缓存快照，不阻塞决策回路。

- **决策 6：Tier 0 不可逆操作守卫**
  `Tier0Guard` 数据模型 `IrreversibleActionRequest`（request_id / binding_id / action / params / status / operator_id / confirmed_at）。`request_irreversible_action` 创建 PENDING 请求，`confirm_irreversible_action` 由 operator 批准后才能执行。永不自动恢复（无超时自动批准）。

- **决策 7：传感器配置 YAML 外置 + DI 加载**
  `sensors.yaml` 配置 8 通道 driver 类名 + 采样率 + 数据格式 + on_event_action，`SensorsConfigLoader` 通过 `importlib` 动态加载 Adapter 类并经 DI 容器注入到 `SensorRegistry`。

### 2.3 设计不变量

- `SensorChannel` 枚举必须固定 8 通道，禁止运行时动态新增通道。
- `SensorRegistry.bind` 必须调用 `SpeciesRegistry.assert_sensor_allowed` 校验形态门控，VIRTUAL 形态绑定被拒绝。
- `SensorEvent` 必须通过 `PhysicalEventIngestor` 写入 F014 EchoStore，禁止直接操作数据库。
- 高采样率（>= 1Hz）传感器必须做特征提取后入EchoStore，禁止原始数据直存。
- 传感器离线时Forgekin必须进入 F023 liveness degraded 状态，禁止阻塞决策回路。
- 物理不可逆操作必须经 operator 二次确认，禁止自动执行（Tier 0 保护）。
- `SensorAdapter` 必须通过 DI 容器注入，禁止直接实例化。
- 传感器配置必须 YAML 外置到 `forgemind/config/sensors.yaml`，禁止 `.py` 硬编码设备路径。

---

## 3. 模块实现

### 3.1 类图

```
                    +---------------------------------------+
                    | SensorChannel (Enum)                  |
                    +---------------------------------------+
                    | CAMERA / MICROPHONE / TEMPERATURE     |
                    | LOCATION / ACCELEROMETER / PRESSURE   |
                    | LIGHT / DEPTH                         |
                    +---------------------------------------+

                    +---------------------------------------+
                    | SensorDataFormat (Enum)               |
                    +---------------------------------------+
                    | RAW (低采样率直存)                    |
                    | FEATURE (高采样率特征提取)            |
                    | EVENT (事件触发)                      |
                    +---------------------------------------+

                    +---------------------------------------+
                    | SensorBinding (Pydantic)              |
                    +---------------------------------------+
                    | binding_id: str                       |
                    | forgekin_id: str                      |
                    | species: str                          |
                    | device_id: str                        |
                    | channel: SensorChannel                |
                    | sampling_rate_hz: float               |
                    | data_format: SensorDataFormat         |
                    | on_event_action: str                  |
                    +---------------------------------------+

                    +---------------------------------------+
                    | SensorEvent (Pydantic)                |
                    +---------------------------------------+
                    | event_id: str                         |
                    | binding_id: str                       |
                    | channel: SensorChannel                |
                    | timestamp: datetime                   |
                    | payload: dict                         |
                    | echo_store_ref: str                   |
                    | forgekin_reaction: Optional[str]      |
                    +---------------------------------------+

                    +---------------------------------------+
                    | SensorAdapter (ABC)                   |
                    +---------------------------------------+
                    | + connect(device_id) -> str           |
                    | + subscribe(binding_id, callback)     |
                    | + read_snapshot(binding_id) -> dict   |
                    | + health_check -> bool              |
                    +---------------------------------------+
                                       ^
                                       |
            +-----------+-----------+-----------+-----------+
            |           |           |           |           |
+-----------------+ +-----------------+ +-----------------+ +-----------------+
| CameraAdapter   | | MicrophoneAdapt | | IotAdapter      | | WearableAdapter |
| (OpenCV)        | |                 | | (MQTT/CoAP)     | | (BLE)           |
+-----------------+ +-----------------+ +-----------------+ +-----------------+

                    +---------------------------------------+
                    | SensorRegistry (ABC + Impl)           |
                    +---------------------------------------+
                    | - adapters: dict[SensorChannel,       |
                    |              SensorAdapter]           |
                    | - species_registry: SpeciesRegistry   |
                    | - binding_repo: SensorBindingRepo     |
                    +---------------------------------------+
                    | + bind(binding) -> binding_id         |
                    | + list_bindings(forgekin_id) -> list  |
                    | + unbind(binding_id)                  |
                    +---------------------------------------+

                    +---------------------------------------+
                    | PhysicalEventIngestor (Impl)          |
                    +---------------------------------------+
                    | - echo_repo: EchoStoreRepository      |
                    | - snapshot_cache: SnapshotCache       |
                    +---------------------------------------+
                    | + ingest(event) -> echo_entry_id      |
                    | + batch_ingest(events) -> list[id]    |
                    +---------------------------------------+

                    +---------------------------------------+
                    | Tier0Guard (Impl)                     |
                    +---------------------------------------+
                    | - request_repo: IrreversibleActionRepo |
                    | - operator_notifier: OperatorNotifier |
                    +---------------------------------------+
                    | + request_irreversible_action(...)    |
                    | + confirm_irreversible_action(...)    |
                    | + reject_irreversible_action(...)     |
                    +---------------------------------------+
```

### 3.2 Python 实现：`flowforge/forgemind/sensors/base.py`

```python
"""forgemind 物理传感器接入核心实现。

实现 A029/D029 设计的 8 通道 + 4 类 Adapter + 形态门控 + Tier 0 保护。
所有 SensorAdapter 通过 DI 容器注入，禁止直接实例化。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Callable, Optional

from pydantic import BaseModel, Field, model_validator

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SensorChannel(str, Enum):
    """传感器通道（按形态配置，固定 8 通道）。"""
    CAMERA = "camera"                # 摄像头（视觉）
    MICROPHONE = "microphone"        # 麦克风（听觉）
    TEMPERATURE = "temperature"      # 温度
    LOCATION = "location"            # 位置/GPS
    ACCELEROMETER = "imu"            # 加速度/IMU
    PRESSURE = "pressure"            # 压力（被坐/被按）
    LIGHT = "light"                  # 光照（被开/被关）
    DEPTH = "depth"                  # 深度（距离感知）


class SensorDataFormat(str, Enum):
    """传感器数据格式。"""
    RAW = "raw"            # 原始数据（低采样率直存）
    FEATURE = "feature"    # 特征提取（高采样率）
    EVENT = "event"        # 事件触发（如压力垫触发）


# 通道默认采样率（Hz），可被 sensors.yaml 覆盖
_DEFAULT_SAMPLING_RATE: dict[SensorChannel, float] = {
    SensorChannel.CAMERA: 30.0,
    SensorChannel.MICROPHONE: 16000.0,
    SensorChannel.TEMPERATURE: 0.1,
    SensorChannel.LOCATION: 0.2,
    SensorChannel.ACCELEROMETER: 100.0,
    SensorChannel.PRESSURE: 1.0,
    SensorChannel.LIGHT: 0.5,
    SensorChannel.DEPTH: 30.0,
}


class SensorBinding(BaseModel):
    """传感器绑定（Forgekin <-> 物理设备）。"""
    binding_id: str
    forgekin_id: str
    species: str                          # 来自 F027，必须为 BIO/OBJ/HYBRID
    device_id: str
    channel: SensorChannel
    sampling_rate_hz: float
    data_format: SensorDataFormat
    on_event_action: str = "ingest_to_echo_store"

    @model_validator(mode="after")
    def _assert_high_sampling_uses_feature(self) -> "SensorBinding":
        """高采样率（>= 1Hz）必须用 FEATURE 格式。"""
        if self.sampling_rate_hz >= 1.0 and self.data_format == SensorDataFormat.RAW:
            raise ValueError(
                f"channel {self.channel.value} sampling_rate {self.sampling_rate_hz}Hz "
                f">= 1.0 must use FEATURE format, not RAW"
            )
        return self


class SensorEvent(BaseModel):
    """传感器事件（写入 F014 EchoStore）。"""
    event_id: str
    binding_id: str
    channel: SensorChannel
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: dict
    echo_store_ref: str = ""
    forgekin_reaction: Optional[str] = None


class SensorAdapter(ABC):
    """传感器适配器抽象（每种设备一个 adapter，DI 注入）。"""

    @abstractmethod
    async def connect(self, device_id: str) -> str:
        """连接物理设备，返回 connection_id。"""
        raise NotImplementedError

    @abstractmethod
    async def subscribe(
        self,
        binding_id: str,
        callback: Callable[[SensorEvent], None],
    ) -> None:
        """订阅传感器事件。"""
        raise NotImplementedError

    @abstractmethod
    async def read_snapshot(self, binding_id: str) -> dict:
        """读取当前快照（用于 observe）。"""
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> bool:
        """设备健康检查。"""
        raise NotImplementedError

    @abstractmethod
    async def execute_action(
        self, binding_id: str, action: str, params: dict
    ) -> dict:
        """执行物理动作（如机械臂移动）。"""
        raise NotImplementedError


class SnapshotCache:
    """最近一次有效快照缓存（per binding）。

    传感器离线时 observe 返回缓存快照，不阻塞决策回路。
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict] = {}
        self._cached_at: dict[str, datetime] = {}

    def update(self, binding_id: str, snapshot: dict) -> None:
        self._cache[binding_id] = snapshot
        self._cached_at[binding_id] = datetime.utcnow

    def get(self, binding_id: str) -> Optional[dict]:
        return self._cache.get(binding_id)

    def get_cached_at(self, binding_id: str) -> Optional[datetime]:
        return self._cached_at.get(binding_id)

    def invalidate(self, binding_id: str) -> None:
        self._cache.pop(binding_id, None)
        self._cached_at.pop(binding_id, None)


class IrreversibleActionRequest(BaseModel):
    """Tier 0 不可逆操作请求。"""
    request_id: str
    binding_id: str
    action: str                          # 如 "robotic_arm_move" / "door_lock"
    params: dict
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    confirmed_at: Optional[datetime] = None
    confirmed_by: Optional[str] = None
    status: str = "PENDING"              # PENDING / CONFIRMED / REJECTED / EXPIRED
    rejection_reason: Optional[str] = None


class Tier0Guard(ABC):
    """Tier 0 不可逆操作守卫（物理执行器专用）。"""

    @abstractmethod
    async def request_irreversible_action(
        self,
        binding_id: str,
        action: str,
        params: dict,
    ) -> str:
        """发起不可逆操作请求（需 operator 二次确认）。"""
        raise NotImplementedError

    @abstractmethod
    async def confirm_irreversible_action(
        self,
        request_id: str,
        operator_id: str,
    ) -> None:
        """operator 确认不可逆操作。"""
        raise NotImplementedError

    @abstractmethod
    async def reject_irreversible_action(
        self,
        request_id: str,
        reason: str,
    ) -> None:
        """operator 拒绝不可逆操作。"""
        raise NotImplementedError

    @abstractmethod
    async def get_pending_requests(
        self, binding_id: str
    ) -> list[IrreversibleActionRequest]:
        """列出待确认请求。"""
        raise NotImplementedError
```

### 3.3 Python 实现：`flowforge/forgemind/sensors/registry_impl.py`

```python
"""SensorRegistry 具体实现。"""
from __future__ import annotations

import uuid
from typing import Optional

from flowforge.core.tracing import get_logger
from flowforge.forgemind.sensors.base import (
    SensorAdapter,
    SensorBinding,
    SensorChannel,
)
from flowforge.forgemind.species import SpeciesRegistry  # F027

logger = get_logger(__name__)


class HarnessSensorRegistry:
    """SensorRegistry 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - species_registry: F027 SpeciesRegistry（形态门控）
    - adapters: dict[SensorChannel, SensorAdapter]
    - binding_repo: SensorBindingRepository（持久化绑定）
    """

    def __init__(
        self,
        species_registry: SpeciesRegistry,
        adapters: dict[SensorChannel, SensorAdapter],
        binding_repo: "SensorBindingRepository",
    ) -> None:
        self._species_registry = species_registry
        self._adapters = adapters
        self._binding_repo = binding_repo

    async def bind(self, binding: SensorBinding) -> str:
        """绑定传感器（含形态门控校验）。"""
        # 1. 形态门控校验
        await self._species_registry.assert_sensor_allowed(
            binding.species, binding.channel
        )
        # 2. 校验 adapter 存在
        if binding.channel not in self._adapters:
            raise ValueError(
                f"no adapter registered for channel {binding.channel.value}"
            )
        # 3. 连接物理设备
        adapter = self._adapters[binding.channel]
        connection_id = await adapter.connect(binding.device_id)
        # 4. 持久化绑定
        if not binding.binding_id:
            binding.binding_id = f"sensor-binding-{uuid.uuid4.hex[:10]}"
        await self._binding_repo.save(binding)
        logger.info(
            "sensor_bound",
            binding_id=binding.binding_id,
            forgekin_id=binding.forgekin_id,
            species=binding.species,
            channel=binding.channel.value,
            device_id=binding.device_id,
            connection_id=connection_id,
        )
        return binding.binding_id

    async def list_bindings(
        self, forgekin_id: str
    ) -> list[SensorBinding]:
        return await self._binding_repo.list_by_forgekin(forgekin_id)

    async def unbind(self, binding_id: str) -> None:
        binding = await self._binding_repo.get(binding_id)
        if binding is None:
            raise KeyError(f"binding not found: {binding_id}")
        # 调用 adapter 断开连接（如果支持）
        adapter = self._adapters.get(binding.channel)
        if adapter and hasattr(adapter, "disconnect"):
            await adapter.disconnect(binding.device_id)  # type: ignore
        await self._binding_repo.delete(binding_id)
        logger.info(
            "sensor_unbound",
            binding_id=binding_id,
            forgekin_id=binding.forgekin_id,
        )

    def get_adapter(
        self, channel: SensorChannel
    ) -> Optional[SensorAdapter]:
        return self._adapters.get(channel)
```

### 3.4 Python 实现：`flowforge/forgemind/sensors/ingestor_impl.py`

```python
"""PhysicalEventIngestor 具体实现（event -> EchoStore）。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from flowforge.core.tracing import get_logger
from flowforge.forgemind.sensors.base import (
    SensorChannel,
    SensorDataFormat,
    SensorEvent,
    SnapshotCache,
)

logger = get_logger(__name__)


class HarnessPhysicalEventIngestor:
    """物理事件摄入器。

    高采样率（FEATURE 格式）：调用 _extract_feature 提取特征后入EchoStore。
    低采样率（RAW 格式）：直接入EchoStore。
    事件触发（EVENT 格式）：直接入EchoStore，附加事件元数据。
    """

    def __init__(
        self,
        echo_store_repo: "EchoStoreRepository",  # F014
        snapshot_cache: SnapshotCache,
    ) -> None:
        self._echo_repo = echo_store_repo
        self._snapshot_cache = snapshot_cache

    async def ingest(self, event: SensorEvent) -> str:
        """摄入单个事件到 EchoStore。"""
        # 根据 data_format 选择写入策略
        content = await self._transform_event(event)
        echo_entry_id = await self._echo_repo.append(
            forgekin_id=await self._lookup_forgekin_id(event.binding_id),
            collection="sensor_event",
            content=content,
            tags=[
                "sensor",
                event.channel.value,
                event.payload.get("data_format", "unknown"),
            ],
        )
        event.echo_store_ref = echo_entry_id
        # 更新快照缓存
        self._snapshot_cache.update(
            event.binding_id,
            {"last_event": content, "timestamp": event.timestamp.isoformat},
        )
        logger.debug(
            "sensor_event_ingested",
            event_id=event.event_id,
            binding_id=event.binding_id,
            channel=event.channel.value,
            echo_entry_id=echo_entry_id,
        )
        return echo_entry_id

    async def batch_ingest(
        self, events: list[SensorEvent]
    ) -> list[str]:
        """批量摄入事件。"""
        entry_ids: list[str] = []
        for event in events:
            entry_id = await self.ingest(event)
            entry_ids.append(entry_id)
        return entry_ids

    async def _transform_event(self, event: SensorEvent) -> dict:
        """根据 data_format 转换事件内容。"""
        data_format = event.payload.get("data_format", "raw")
        if data_format == SensorDataFormat.FEATURE.value:
            # 高采样率：特征提取
            feature = await self._extract_feature(event)
            return {
                "event_id": event.event_id,
                "binding_id": event.binding_id,
                "channel": event.channel.value,
                "timestamp": event.timestamp.isoformat,
                "data_format": "feature",
                "feature": feature,
                "raw_payload_size": len(str(event.payload)),
            }
        elif data_format == SensorDataFormat.EVENT.value:
            # 事件触发：附加事件元数据
            return {
                "event_id": event.event_id,
                "binding_id": event.binding_id,
                "channel": event.channel.value,
                "timestamp": event.timestamp.isoformat,
                "data_format": "event",
                "trigger": event.payload.get("trigger"),
                "value": event.payload.get("value"),
            }
        else:
            # 低采样率：原始数据直存
            return {
                "event_id": event.event_id,
                "binding_id": event.binding_id,
                "channel": event.channel.value,
                "timestamp": event.timestamp.isoformat,
                "data_format": "raw",
                "payload": event.payload,
            }

    async def _extract_feature(self, event: SensorEvent) -> dict:
        """特征提取（按通道类型）。

        - CAMERA: 人脸检测 / 物体识别 / 姿态估计
        - MICROPHONE: 语音识别 / 声纹识别
        - ACCELEROMETER: 活动识别 / 跌倒检测
        - DEPTH: 距离测量 / 障碍物检测
        - 其他: 直接返回 payload 摘要
        """
        channel = event.channel
        payload = event.payload
        if channel == SensorChannel.CAMERA:
            return {
                "faces": payload.get("faces", []),
                "objects": payload.get("objects", []),
                "pose": payload.get("pose"),
            }
        elif channel == SensorChannel.MICROPHONE:
            return {
                "transcript": payload.get("transcript", ""),
                "speaker_id": payload.get("speaker_id"),
            }
        elif channel == SensorChannel.ACCELEROMETER:
            return {
                "activity": payload.get("activity", "unknown"),
                "fall_detected": payload.get("fall_detected", False),
            }
        elif channel == SensorChannel.DEPTH:
            return {
                "distance_m": payload.get("distance_m"),
                "obstacles": payload.get("obstacles", []),
            }
        else:
            return {"summary": str(payload)[:200]}

    async def _lookup_forgekin_id(self, binding_id: str) -> str:
        """通过 binding_id 查找 forgekin_id（实际由 SensorBindingRepository 实现）。"""
        # 占位实现，实际由调用方传入 forgekin_id 或通过 binding_repo 查询
        return event_forgekin_lookup(binding_id)


def event_forgekin_lookup(binding_id: str) -> str:
    """通过 binding_id 查找 forgekin_id 的辅助函数。"""
    # 实际实现需调用 SensorBindingRepository.get(binding_id).forgekin_id
    return f"forgekin-from-{binding_id}"
```

### 3.5 Python 实现：`flowforge/forgemind/sensors/tier0_guard_impl.py`

```python
"""Tier0Guard 具体实现（物理不可逆操作守卫）。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from flowforge.core.tracing import get_logger
from flowforge.forgemind.sensors.base import (
    IrreversibleActionRequest,
    Tier0Guard,
)

logger = get_logger(__name__)


class HarnessTier0Guard(Tier0Guard):
    """Tier 0 不可逆操作守卫。

    永不自动恢复：无超时自动批准逻辑，必须 operator 显式确认。
    与 F022 Tier 1-4 恢复分级联动，Tier 0 为最高保护级别。
    """

    def __init__(
        self,
        request_repo: "IrreversibleActionRepository",
        operator_notifier: "OperatorNotifier",
    ) -> None:
        self._request_repo = request_repo
        self._notifier = operator_notifier

    async def request_irreversible_action(
        self,
        binding_id: str,
        action: str,
        params: dict,
    ) -> str:
        """发起不可逆操作请求（需 operator 二次确认）。"""
        request_id = f"tier0-req-{uuid.uuid4.hex[:10]}"
        request = IrreversibleActionRequest(
            request_id=request_id,
            binding_id=binding_id,
            action=action,
            params=params,
            status="PENDING",
        )
        await self._request_repo.save(request)
        # 通知 operator
        await self._notifier.notify(
            title=f"Tier 0 不可逆操作待确认: {action}",
            body=f"binding={binding_id} action={action} params={params}",
            severity="critical",
        )
        logger.warning(
            "tier0_irreversible_action_requested",
            request_id=request_id,
            binding_id=binding_id,
            action=action,
        )
        return request_id

    async def confirm_irreversible_action(
        self,
        request_id: str,
        operator_id: str,
    ) -> None:
        """operator 确认不可逆操作。"""
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"request not found: {request_id}")
        if request.status != "PENDING":
            raise RuntimeError(
                f"request {request_id} status is {request.status}, "
                f"cannot confirm"
            )
        request.status = "CONFIRMED"
        request.confirmed_at = datetime.utcnow
        request.confirmed_by = operator_id
        await self._request_repo.save(request)
        logger.info(
            "tier0_irreversible_action_confirmed",
            request_id=request_id,
            operator_id=operator_id,
            action=request.action,
        )

    async def reject_irreversible_action(
        self,
        request_id: str,
        reason: str,
    ) -> None:
        """operator 拒绝不可逆操作。"""
        request = await self._request_repo.get(request_id)
        if request is None:
            raise KeyError(f"request not found: {request_id}")
        request.status = "REJECTED"
        request.rejection_reason = reason
        await self._request_repo.save(request)
        logger.info(
            "tier0_irreversible_action_rejected",
            request_id=request_id,
            reason=reason,
        )

    async def get_pending_requests(
        self, binding_id: str
    ) -> list[IrreversibleActionRequest]:
        return await self._request_repo.list_pending(binding_id)
```

### 3.6 Python 实现：4 类 Adapter 抽象基类

#### 3.6.1 `flowforge/forgemind/sensors/camera.py`

```python
"""摄像头适配器（OpenCV，视觉通道）。"""
from __future__ import annotations

from typing import Callable

from flowforge.core.tracing import get_logger
from flowforge.forgemind.sensors.base import (
    SensorAdapter,
    SensorChannel,
    SensorEvent,
)

logger = get_logger(__name__)


class CameraAdapter(SensorAdapter):
    """摄像头适配器抽象基类。

    具体实现（如 OpenCvCameraAdapter / RpiCameraAdapter）继承此类。
    sampling_rate_hz 默认 30Hz，data_format 强制为 FEATURE。
    """

    channel = SensorChannel.CAMERA

    async def connect(self, device_id: str) -> str:
        raise NotImplementedError

    async def subscribe(
        self,
        binding_id: str,
        callback: Callable[[SensorEvent], None],
    ) -> None:
        raise NotImplementedError

    async def read_snapshot(self, binding_id: str) -> dict:
        raise NotImplementedError

    async def health_check(self) -> bool:
        raise NotImplementedError

    async def execute_action(
        self, binding_id: str, action: str, params: dict
    ) -> dict:
        # 摄像头通常不可逆操作少（如云台转动可逆）
        # 但若涉及机械云台不可逆动作，调用方应通过 Tier0Guard
        raise NotImplementedError(
            "camera actions should be routed via Tier0Guard if irreversible"
        )
```

#### 3.6.2 `flowforge/forgemind/sensors/microphone.py`

```python
"""麦克风适配器（听觉通道）。"""
from __future__ import annotations

from typing import Callable

from flowforge.forgemind.sensors.base import (
    SensorAdapter,
    SensorChannel,
    SensorEvent,
)


class MicrophoneAdapter(SensorAdapter):
    """麦克风适配器抽象基类。

    sampling_rate_hz 默认 16000Hz，data_format 强制为 FEATURE。
    特征提取：语音识别 + 声纹识别。
    """

    channel = SensorChannel.MICROPHONE

    async def connect(self, device_id: str) -> str:
        raise NotImplementedError

    async def subscribe(
        self,
        binding_id: str,
        callback: Callable[[SensorEvent], None],
    ) -> None:
        raise NotImplementedError

    async def read_snapshot(self, binding_id: str) -> dict:
        raise NotImplementedError

    async def health_check(self) -> bool:
        raise NotImplementedError

    async def execute_action(
        self, binding_id: str, action: str, params: dict
    ) -> dict:
        raise NotImplementedError("microphone is read-only sensor")
```

#### 3.6.3 `flowforge/forgemind/sensors/iot.py`

```python
"""IoT 协议适配器（温度/位置/IMU/压力/光照/深度）。"""
from __future__ import annotations

from typing import Callable

from flowforge.forgemind.sensors.base import (
    SensorAdapter,
    SensorChannel,
    SensorEvent,
)


class IotAdapter(SensorAdapter):
    """IoT 协议适配器抽象基类。

    支持 MQTT / CoAP / HTTP 三种协议。
    覆盖 TEMPERATURE / LOCATION / ACCELEROMETER / PRESSURE / LIGHT / DEPTH 六通道。
    """

    channel: SensorChannel  # 子类指定

    async def connect(self, device_id: str) -> str:
        raise NotImplementedError

    async def subscribe(
        self,
        binding_id: str,
        callback: Callable[[SensorEvent], None],
    ) -> None:
        raise NotImplementedError

    async def read_snapshot(self, binding_id: str) -> dict:
        raise NotImplementedError

    async def health_check(self) -> bool:
        raise NotImplementedError

    async def execute_action(
        self, binding_id: str, action: str, params: dict
    ) -> dict:
        raise NotImplementedError
```

#### 3.6.4 `flowforge/forgemind/sensors/wearable.py`

```python
"""可穿戴设备适配器（BLE 通道）。"""
from __future__ import annotations

from typing import Callable

from flowforge.forgemind.sensors.base import (
    SensorAdapter,
    SensorChannel,
    SensorEvent,
)


class WearableAdapter(SensorAdapter):
    """可穿戴设备适配器抽象基类。

    通过 BLE 连接，覆盖可穿戴设备（智能手表/手环/智能眼镜）。
    通道通常为 ACCELEROMETER / LOCATION / LIGHT。
    """

    channel: SensorChannel  # 子类指定

    async def connect(self, device_id: str) -> str:
        raise NotImplementedError

    async def subscribe(
        self,
        binding_id: str,
        callback: Callable[[SensorEvent], None],
    ) -> None:
        raise NotImplementedError

    async def read_snapshot(self, binding_id: str) -> dict:
        raise NotImplementedError

    async def health_check(self) -> bool:
        raise NotImplementedError

    async def execute_action(
        self, binding_id: str, action: str, params: dict
    ) -> dict:
        raise NotImplementedError
```

### 3.7 Python 实现：`flowforge/forgemind/sensors/config_loader.py`

```python
"""SensorsConfigLoader：从 sensors.yaml 加载 8 通道配置 + DI 注册。"""
from __future__ import annotations

import importlib
from pathlib import Path

import yaml

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.forgemind.sensors.base import (
    SensorChannel,
    SensorDataFormat,
    SensorAdapter,
)

logger = get_logger(__name__)


class ChannelConfig(BaseModel):
    """单通道配置（来自 sensors.yaml）。"""
    adapter_class: str                    # 全限定类名
    sampling_rate_hz: float
    data_format: SensorDataFormat
    on_event_action: str = "ingest_to_echo_store"
    device_config: dict = Field(default_factory=dict)


class SensorsConfig(BaseModel):
    """8 通道总配置。"""
    channels: dict[SensorChannel, ChannelConfig]
    tier0_actions: list[str] = Field(default_factory=list)


class SensorsConfigLoader:
    """sensors.yaml 配置加载器。

    YAML 结构示例：
        channels:
          camera:
            adapter_class: forgemind.sensors.camera.OpenCvCameraAdapter
            sampling_rate_hz: 30.0
            data_format: feature
            device_config:
              device_index: 0
              resolution: [1280, 720]
          microphone:
            adapter_class: forgemind.sensors.microphone.PyaudioMicrophoneAdapter
            sampling_rate_hz: 16000.0
            data_format: feature
          temperature:
            adapter_class: forgemind.sensors.iot.MqttTemperatureAdapter
            sampling_rate_hz: 0.1
            data_format: raw
            device_config:
              mqtt_broker: tcp://localhost:1883
              topic: sensors/temperature/#
        tier0_actions:
          - robotic_arm_move
          - door_lock
          - valve_control
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path

    def load(self) -> SensorsConfig:
        with self._config_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        channels_raw = raw.get("channels", {})
        channels: dict[SensorChannel, ChannelConfig] = {}
        for channel_name, cfg in channels_raw.items:
            channel = SensorChannel(channel_name)
            channels[channel] = ChannelConfig(**cfg)
        return SensorsConfig(
            channels=channels,
            tier0_actions=raw.get("tier0_actions", []),
        )

    def load_adapter_instances(
        self,
        config: SensorsConfig,
        di_container: "DIContainer",
    ) -> dict[SensorChannel, SensorAdapter]:
        """通过 importlib 动态加载 adapter 类 + DI 容器解析依赖。"""
        adapters: dict[SensorChannel, SensorAdapter] = {}
        for channel, channel_cfg in config.channels.items:
            module_path, class_name = channel_cfg.adapter_class.rsplit(".", 1)
            module = importlib.import_module(module_path)
            adapter_cls = getattr(module, class_name)
            instance = di_container.resolve(adapter_cls)
            adapters[channel] = instance
            logger.info(
                "sensor_adapter_loaded",
                channel=channel.value,
                adapter_class=channel_cfg.adapter_class,
                sampling_rate=channel_cfg.sampling_rate_hz,
                data_format=channel_cfg.data_format.value,
            )
        return adapters
```

### 3.8 YAML 配置示例：`forgemind/config/sensors.yaml`

```yaml
# FlowForge 物理传感器配置（D029）
# 8 通道 + 4 类 Adapter + Tier 0 不可逆操作清单。

channels:
  # 视觉通道（30Hz，特征提取）
  camera:
    adapter_class: forgemind.sensors.camera.OpenCvCameraAdapter
    sampling_rate_hz: 30.0
    data_format: feature
    device_config:
      device_index: 0
      resolution: [1280, 720]
      feature_extractors: [face_detection, object_detection, pose_estimation]

  # 听觉通道（16000Hz，特征提取）
  microphone:
    adapter_class: forgemind.sensors.microphone.PyaudioMicrophoneAdapter
    sampling_rate_hz: 16000.0
    data_format: feature
    device_config:
      sample_rate: 16000
      channels: 1
      feature_extractors: [asr, speaker_id]

  # 温度（0.1Hz，原始数据直存）
  temperature:
    adapter_class: forgemind.sensors.iot.MqttTemperatureAdapter
    sampling_rate_hz: 0.1
    data_format: raw
    device_config:
      mqtt_broker: tcp://localhost:1883
      topic: sensors/temperature/#

  # 位置/GPS（0.2Hz，原始数据直存）
  location:
    adapter_class: forgemind.sensors.iot.MqttLocationAdapter
    sampling_rate_hz: 0.2
    data_format: raw
    device_config:
      mqtt_broker: tcp://localhost:1883
      topic: sensors/location/#

  # 加速度/IMU（100Hz，特征提取）
  imu:
    adapter_class: forgemind.sensors.iot.MqttImuAdapter
    sampling_rate_hz: 100.0
    data_format: feature
    device_config:
      mqtt_broker: tcp://localhost:1883
      topic: sensors/imu/#
      feature_extractors: [activity_recognition, fall_detection]

  # 压力（1Hz，事件触发）
  pressure:
    adapter_class: forgemind.sensors.iot.MqttPressureAdapter
    sampling_rate_hz: 1.0
    data_format: event
    device_config:
      mqtt_broker: tcp://localhost:1883
      topic: sensors/pressure/#
      threshold: 5.0  # kg

  # 光照（0.5Hz，原始数据直存）
  light:
    adapter_class: forgemind.sensors.iot.MqttLightAdapter
    sampling_rate_hz: 0.5
    data_format: raw
    device_config:
      mqtt_broker: tcp://localhost:1883
      topic: sensors/light/#

  # 深度（30Hz，特征提取）
  depth:
    adapter_class: forgemind.sensors.camera.RealSenseDepthAdapter
    sampling_rate_hz: 30.0
    data_format: feature
    device_config:
      device_index: 1
      feature_extractors: [distance_measurement, obstacle_detection]

# Tier 0 不可逆操作清单（必须 operator 二次确认）
tier0_actions:
  - robotic_arm_move
  - door_lock
  - door_unlock
  - valve_open
  - valve_close
  - power_cutoff
```

### 3.9 算法伪代码

#### 3.9.1 `SensorRegistry.bind(binding)` 形态门控流程

```
function bind(binding):
    # 1. 形态门控校验
    species_registry.assert_sensor_allowed(binding.species, binding.channel)
        # 内部逻辑（F027）：
        # if species == VIRTUAL:
        #     raise SpeciesSensorForbiddenError("VIRTUAL cannot bind physical sensor")
        # if channel in [CAMERA, MICROPHONE] and species not in [BIO, HYBRID]:
        #     raise SpeciesSensorForbiddenError("...")

    # 2. 校验 adapter 存在
    if binding.channel not in adapters:
        raise ValueError("no adapter for channel")

    # 3. 连接物理设备
    adapter = adapters[binding.channel]
    connection_id = adapter.connect(binding.device_id)

    # 4. 持久化绑定
    binding_repo.save(binding)

    return binding.binding_id
```

#### 3.9.2 `PhysicalEventIngestor.ingest(event)` 采样率适配流程

```
function ingest(event):
    # 1. 根据 data_format 转换内容
    data_format = event.payload.get("data_format", "raw")

    if data_format == "feature":
        # 高采样率：特征提取
        feature = extract_feature(event)
        content = {
            "event_id": event.event_id,
            "channel": event.channel.value,
            "data_format": "feature",
            "feature": feature,
        }
    elif data_format == "event":
        # 事件触发：附加事件元数据
        content = {
            "event_id": event.event_id,
            "channel": event.channel.value,
            "data_format": "event",
            "trigger": event.payload.get("trigger"),
            "value": event.payload.get("value"),
        }
    else:
        # 低采样率：原始数据直存
        content = {
            "event_id": event.event_id,
            "channel": event.channel.value,
            "data_format": "raw",
            "payload": event.payload,
        }

    # 2. 写入 F014 EchoStore
    echo_entry_id = echo_repo.append(
        forgekin_id=lookup_forgekin_id(event.binding_id),
        collection="sensor_event",
        content=content,
        tags=["sensor", event.channel.value, data_format],
    )

    # 3. 更新快照缓存
    snapshot_cache.update(event.binding_id, {
        "last_event": content,
        "timestamp": event.timestamp.isoformat,
    })

    return echo_entry_id
```

#### 3.9.3 `ForgekinBase.observe` 故障降级流程

```
function observe_with_sensors(forgekin_id):
    bindings = sensor_registry.list_bindings(forgekin_id)
    snapshot = {}

    for binding in bindings:
        adapter = sensor_registry.get_adapter(binding.channel)

        # 1. 健康检查
        if not adapter.health_check:
            # 设备离线 -> liveness degraded
            liveness_service.mark_degraded(
                forgekin_id,
                reason=f"sensor_offline: {binding.channel.value}"
            )
            # 返回缓存快照（不阻塞决策回路）
            cached = snapshot_cache.get(binding.binding_id)
            if cached:
                snapshot[binding.channel.value] = cached
            continue

        # 2. 读取当前快照
        current = adapter.read_snapshot(binding.binding_id)
        snapshot[binding.channel.value] = current

        # 3. 更新缓存
        snapshot_cache.update(binding.binding_id, current)

    # 4. 如果所有传感器离线 -> liveness critical
    if not snapshot:
        liveness_service.mark_critical(
            forgekin_id,
            reason="all_sensors_offline"
        )

    return Observation(sensor_snapshot=snapshot)
```

#### 3.9.4 `Tier0Guard.request_irreversible_action` 不可逆操作流程

```
function request_irreversible_action(binding_id, action, params):
    # 1. 校验 action 在 tier0_actions 清单中
    if action not in config.tier0_actions:
        raise ValueError(f"action {action} not in tier0 list")

    # 2. 创建 PENDING 请求
    request = IrreversibleActionRequest(
        request_id=generate_id,
        binding_id=binding_id,
        action=action,
        params=params,
        status="PENDING",
    )
    request_repo.save(request)

    # 3. 通知 operator
    operator_notifier.notify(
        title=f"Tier 0 不可逆操作待确认: {action}",
        body=f"binding={binding_id} params={params}",
        severity="critical",
    )

    # 4. 等待 operator 确认（永不自动恢复，无超时）
    return request.request_id


function confirm_irreversible_action(request_id, operator_id):
    request = request_repo.get(request_id)

    if request.status != "PENDING":
        raise RuntimeError("request already resolved")

    request.status = "CONFIRMED"
    request.confirmed_at = now
    request.confirmed_by = operator_id
    request_repo.save(request)

    # 调用方现在可以执行物理操作
```

### 3.10 时序图：传感器绑定 + 事件摄入

```
operator          SensorRegistry        SpeciesRegistry      SensorAdapter       PhysicalEventIngestor   F014 EchoStore
   |                    |                      |                    |                    |                      |
   | bind(binding)      |                      |                    |                    |                      |
   |------------------->|                      |                    |                    |                      |
   |                    | assert_sensor_allowed|                    |                    |                      |
   |                    |---------------------->|                    |                    |                      |
   |                    |                      | (VIRTUAL? reject)  |                    |                      |
   |                    |<----------------------|                    |                    |                      |
   |                    | connect(device_id)   |                    |                    |                      |
   |                    |----------------------------------------->|                    |                      |
   |                    | connection_id        |                    |                    |                      |
   |                    |<-----------------------------------------|                    |                      |
   |                    | save binding         |                    |                    |                      |
   |                    | (持久化到 F008)      |                    |                    |                      |
   | binding_id         |                      |                    |                    |                      |
   |<-------------------|                      |                    |                    |                      |
   |                    |                      |                    |                    |                      |
   | (物理设备产生事件) |                      |                    |                    |                      |
   |                    | subscribe(callback)  |                    |                    |                      |
   |                    |----------------------------------------->|                    |                      |
   |                    |                      |                    | (持续采样)         |                      |
   |                    |                      |                    | (特征提取 if 高采样)|                      |
   |                    |                      |                    | SensorEvent       |                      |
   |                    |<-----------------------------------------|                    |                      |
   |                    | ingest(event)        |                    |                    |                      |
   |                    |-------------------------------------------------->|                      |
   |                    |                      |                    |                    | transform (按 fmt)   |
   |                    |                      |                    |                    | append to EchoStore  |
   |                    |                      |                    |                    |---------------------->|
   |                    |                      |                    |                    | echo_entry_id        |
   |                    |                      |                    |                    |<----------------------|
   |                    |                      |                    |                    | update snapshot_cache|
   |                    | echo_entry_id        |                    |                    |                      |
   |                    |<--------------------------------------------------|                      |
   |                    |                      |                    |                    |                      |
   | (observe 调用)     |                      |                    |                    |                      |
   | read_snapshot    |                      |                    |                    |                      |
   |------------------->|                      |                    |                    |                      |
   |                    | health_check       |                    |                    |                      |
   |                    |----------------------------------------->|                    |                      |
   |                    | true/false           |                    |                    |                      |
   |                    |<-----------------------------------------|                    |                      |
   |                    |                      |                    |                    |                      |
   |                    | if false: liveness degraded, return cached snapshot           |                      |
   |                    | if true: read_snapshot, update cache                          |                      |
   | observation        |                      |                    |                    |                      |
   |<-------------------|                      |                    |                    |                      |
```

### 3.11 错误处理矩阵

| 错误场景 | 检测点 | 处理动作 | 用户反馈 |
|---------|--------|---------|---------|
| VIRTUAL 形态绑定物理传感器 | `SpeciesRegistry.assert_sensor_allowed` | 抛 `SpeciesSensorForbiddenError` | "VIRTUAL species cannot bind physical sensor" |
| 通道无 adapter | `SensorRegistry.bind` | 抛 `ValueError` | "no adapter registered for channel X" |
| 设备连接失败 | `SensorAdapter.connect` | 抛 `DeviceConnectionError` | "cannot connect to device X" |
| 高采样率使用 RAW 格式 | `SensorBinding._assert_high_sampling_uses_feature` | Pydantic 校验失败 | "sampling_rate >= 1.0 must use FEATURE format" |
| 设备离线 | `SensorAdapter.health_check=false` | 触发 `LivenessService.mark_degraded` | "sensor_offline: channel X" |
| 全部传感器离线 | `observe_with_sensors` | 触发 `LivenessService.mark_critical` | "all_sensors_offline" |
| Tier 0 操作未确认 | `Tier0Guard` | 阻塞执行，等待 operator 确认 | "Tier 0 action PENDING confirmation" |
| Tier 0 操作被拒绝 | `reject_irreversible_action` | `status=REJECTED`，不执行操作 | "action rejected: reason" |
| EchoStore 写入失败 | `EchoStoreRepository.append` | 抛 `IOError` | "echo store write failed" |
| 不可逆操作清单未含 action | `request_irreversible_action` | 抛 `ValueError` | "action X not in tier0 list" |
| adapter 类未找到 | `importlib.import_module` | 抛 `ImportError` | "module not found" |
| DI 依赖缺失 | `di_container.resolve` | 抛 `DIResolutionError` | "cannot resolve dependency" |

### 3.12 性能优化指标

| 指标 | 目标值 | 测量点 |
|------|--------|--------|
| `bind` 延迟 | < 500ms | 形态校验 + connect + save |
| `ingest` 单事件延迟 | < 50ms（RAW）/ < 200ms（FEATURE） | transform + echo_repo.append |
| `batch_ingest` 1000 事件延迟 | < 30s | 单事件 × 1000 |
| `read_snapshot` 延迟 | < 100ms | adapter.read_snapshot |
| `health_check` 延迟 | < 50ms | adapter.health_check |
| Tier 0 请求创建延迟 | < 100ms | request_repo.save + notifier.notify |
| 快照缓存命中率 | > 95%（设备离线时） | snapshot_cache.get |
| 8 通道并发订阅 | 支持 8 并发 | adapter.subscribe |
| 高采样率特征提取延迟 | < 33ms（30Hz 帧间隔） | camera/microphone 特征提取 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖实现

#### 4.1.1 依赖 F026 forgemind 应用层

`SensorRegistry` / `PhysicalEventIngestor` / `Tier0Guard` 由 `ForgeMindPlugin.register_forge_skills` 注册到 DI 容器：

```python
# forgemind/plugin.py（节选）
class ForgeMindPlugin:
    def register_forge_skills(self, di_container):
        config_loader = SensorsConfigLoader(
            Path(__file__).parent / "config" / "sensors.yaml"
        )
        config = config_loader.load
        adapters = config_loader.load_adapter_instances(config, di_container)
        # 注册 SensorRegistry
        sensor_registry = HarnessSensorRegistry(
            species_registry=di_container.resolve(SpeciesRegistry),
            adapters=adapters,
            binding_repo=di_container.resolve(SensorBindingRepository),
        )
        di_container.register_singleton(SensorRegistry, sensor_registry)
        # 注册 PhysicalEventIngestor
        ingestor = HarnessPhysicalEventIngestor(
            echo_store_repo=di_container.resolve(EchoStoreRepository),
            snapshot_cache=SnapshotCache,
        )
        di_container.register_singleton(PhysicalEventIngestor, ingestor)
        # 注册 Tier0Guard
        tier0_guard = HarnessTier0Guard(
            request_repo=di_container.resolve(IrreversibleActionRepository),
            operator_notifier=di_container.resolve(OperatorNotifier),
        )
        di_container.register_singleton(Tier0Guard, tier0_guard)
```

#### 4.1.2 依赖 F027 形态分类

`SensorRegistry.bind` 调用 `SpeciesRegistry.assert_sensor_allowed(species, channel)`：

```python
# forgemind/species/species_registry_impl.py（节选，由 F027 实现）
class HarnessSpeciesRegistry(SpeciesRegistry):
    async def assert_sensor_allowed(
        self, species: str, channel: SensorChannel
    ) -> None:
        profile = await self.get(species)
        if not profile.sensor_allowed:
            raise SpeciesSensorForbiddenError(
                f"species {species} cannot bind physical sensor"
            )
        # 形态特定通道限制（如 VIRTUAL 永远不允许）
        if profile.species_id == "virtual":
            raise SpeciesSensorForbiddenError(
                "VIRTUAL species cannot bind physical sensor"
            )
```

#### 4.1.3 依赖 F014 多域记忆

`PhysicalEventIngestor.ingest` 调用 `EchoStoreRepository.append` 写入 `collection="sensor_event"` 集合。

#### 4.1.4 依赖 F023 liveness 规范读模型

`SensorAdapter.health_check=false` 时调用 `LivenessService.mark_degraded`：

```python
# forgemind/sensors/liveness_bridge.py
class SensorLivenessBridge:
    async def on_sensor_offline(
        self, forgekin_id: str, channel: SensorChannel
    ) -> None:
        await self._liveness_service.mark_degraded(
            forgekin_id=forgekin_id,
            reason=f"sensor_offline: {channel.value}",
            source="sensor_subsystem",
        )
```

#### 4.1.5 依赖 F022 Tier 1-4 恢复分级

- 传感器故障按 Tier 1（自动重试 `connect`）/ Tier 2（换设备）分级恢复。
- 物理不可逆操作按 Tier 0（永不自动恢复）保护，与 Tier 1-4 联动。

### 4.2 下游影响实现

#### 4.2.1 影响 ForgekinBase.observe

`observe` 通过 `SensorAdapter.read_snapshot` 读取物理世界状态：

```python
# forgemind/base.py（节选，ForgekinBase.observe 实现）
async def observe(self) -> Observation:
    bindings = await self._sensor_registry.list_bindings(self.forgekin_id)
    sensor_snapshot: dict[str, dict] = {}
    for binding in bindings:
        adapter = self._sensor_registry.get_adapter(binding.channel)
        if adapter and await adapter.health_check:
            snap = await adapter.read_snapshot(binding.binding_id)
            sensor_snapshot[binding.channel.value] = snap
        else:
            # 设备离线 -> 返回缓存快照
            cached = self._snapshot_cache.get(binding.binding_id)
            if cached:
                sensor_snapshot[binding.channel.value] = cached
    return Observation(sensor_snapshot=sensor_snapshot)
```

#### 4.2.2 影响 F030 虚拟世界设定层

HYBRID 形态Forgekin同时接入物理传感器（F029）与虚拟世界设定（F030），二者通过 ForgekinBase 决策回路融合。

#### 4.2.3 影响 F038 进化谱系

传感器绑定记录可作为形态进化证据：

```python
# 当 BIO -> HYBRID 进化（加装传感器）时
await self._lineage_repo.append_evolution_evidence(
    forgekin_id=forgekin_id,
    evidence_type="sensor_binding_added",
    evidence_data={"channel": "camera", "device_id": "..."},
)
```

### 4.3 跨模块不变量校验

| 不变量 | 校验点 | 校验实现 |
|--------|--------|---------|
| 8 通道枚举固定 | `SensorChannel` | Enum 类，运行时不可新增 |
| VIRTUAL 形态门控 | `SensorRegistry.bind` | `SpeciesRegistry.assert_sensor_allowed` |
| 高采样率特征提取 | `SensorBinding._assert_high_sampling_uses_feature` | Pydantic `model_validator` |
| 传感器事件写入 EchoStore | `PhysicalEventIngestor.ingest` | 通过 `EchoStoreRepository.append` |
| 设备故障降级 | `observe_with_sensors` | `health_check=false` -> `LivenessService.mark_degraded` |
| Tier 0 永不自动恢复 | `Tier0Guard` | 无超时自动批准逻辑，必须 operator 显式确认 |
| DI 注入 | `SensorsConfigLoader.load_adapter_instances` | `di_container.resolve(adapter_cls)` |
| YAML 配置驱动 | `SensorsConfigLoader.load` | 8 通道配置全部从 `sensors.yaml` 加载 |

---

## 5. 详细设计验收

### 5.1 功能验收

- [ ] AC-F-01: `SensorChannel` 枚举含 8 个值（CAMERA/MICROPHONE/TEMPERATURE/LOCATION/ACCELEROMETER/PRESSURE/LIGHT/DEPTH），运行时无法新增。
- [ ] AC-F-02: `SensorRegistry.bind(binding)` 调用 `SpeciesRegistry.assert_sensor_allowed`，VIRTUAL 形态绑定被拒绝。
- [ ] AC-F-03: `SensorBinding._assert_high_sampling_uses_feature` 校验 `sampling_rate_hz >= 1.0` 时 `data_format` 必须为 FEATURE。
- [ ] AC-F-04: `PhysicalEventIngestor.ingest(event)` 根据 `data_format` 转换内容后写入 EchoStore `sensor_event` 集合。
- [ ] AC-F-05: 高采样率（>= 1Hz）传感器事件 payload 含 `feature` 字段，无原始数据。
- [ ] AC-F-06: 低采样率（< 1Hz）传感器事件 payload 含 `payload` 字段（原始数据）。
- [ ] AC-F-07: 事件触发格式 payload 含 `trigger` + `value` 字段。
- [ ] AC-F-08: `SnapshotCache` 缓存最近一次有效快照，`update` / `get` / `invalidate` 三方法可用。
- [ ] AC-F-09: `SensorAdapter.health_check=false` 时，`observe_with_sensors` 返回缓存快照，不阻塞。
- [ ] AC-F-10: 全部传感器离线时，`LivenessService.mark_critical` 被调用。
- [ ] AC-F-11: `Tier0Guard.request_irreversible_action` 创建 PENDING 请求并通知 operator。
- [ ] AC-F-12: `Tier0Guard.confirm_irreversible_action` 后 `status=CONFIRMED`，含 `confirmed_by` 字段。
- [ ] AC-F-13: `Tier0Guard.reject_irreversible_action` 后 `status=REJECTED`，含 `rejection_reason`。
- [ ] AC-F-14: Tier 0 请求永不自动批准（无超时逻辑）。
- [ ] AC-F-15: `SensorsConfigLoader.load` 加载 `sensors.yaml`，8 通道配置齐全。
- [ ] AC-F-16: `load_adapter_instances` 通过 `importlib` 动态加载 adapter 类，依赖通过 DI 容器解析。
- [ ] AC-F-17: 4 类 Adapter 抽象基类（CameraAdapter / MicrophoneAdapter / IotAdapter / WearableAdapter）均继承 `SensorAdapter`。

### 5.2 性能验收

- [ ] AC-P-01: `bind` 延迟 < 500ms。
- [ ] AC-P-02: `ingest` 单事件延迟 < 50ms（RAW）/ < 200ms（FEATURE）。
- [ ] AC-P-03: `batch_ingest` 1000 事件延迟 < 30s。
- [ ] AC-P-04: `read_snapshot` 延迟 < 100ms。
- [ ] AC-P-05: `health_check` 延迟 < 50ms。
- [ ] AC-P-06: Tier 0 请求创建延迟 < 100ms。
- [ ] AC-P-07: 快照缓存命中率 > 95%（设备离线时）。
- [ ] AC-P-08: 8 通道并发订阅支持 8 并发。
- [ ] AC-P-09: 高采样率特征提取延迟 < 33ms（30Hz 帧间隔）。

### 5.3 安全验收

- [ ] AC-S-01: VIRTUAL 形态Forgekin绑定物理传感器被拒绝，错误信息含形态名 + 通道名。
- [ ] AC-S-02: 高采样率传感器使用 RAW 格式时，Pydantic 校验失败。
- [ ] AC-S-03: Tier 0 操作未经 operator 确认时，物理动作不执行。
- [ ] AC-S-04: Tier 0 请求含 `confirmed_by` 字段，所有不可逆操作可追溯到 operator。
- [ ] AC-S-05: Tier 0 请求永不自动批准，无超时逻辑。
- [ ] AC-S-06: `SensorRegistry` 不直接操作数据库，所有写入通过 Repository 层。
- [ ] AC-S-07: `SensorsConfigLoader` 不硬编码 adapter 类名，全部从 YAML 读取。
- [ ] AC-S-08: 传感器离线时Forgekin进入 liveness degraded 状态，不阻塞决策回路。
- [ ] AC-S-09: 不可逆操作清单（`tier0_actions`）YAML 外置，禁止运行时修改。
- [ ] AC-S-10: `IrreversibleActionRequest` 含 `requested_at` / `confirmed_at` 时间戳，便于审计。

### 5.4 Eval 验收

- [ ] AC-E-01: 传感器事件写入 EchoStore 后，可通过 `EchoStoreRepository.query` 查询。
- [ ] AC-E-02: 事件 payload 含 `event_id` / `binding_id` / `channel` / `timestamp` / `data_format` 五字段。
- [ ] AC-E-03: 特征提取后 payload 含 `feature` 字段，特征结构按通道类型差异化（camera: faces/objects/pose；microphone: transcript/speaker_id）。
- [ ] AC-E-04: 快照缓存更新后，`SnapshotCache.get` 返回最近一次有效快照。
- [ ] AC-E-05: liveness degraded 状态可被 `LivenessService.get_status` 查询。
- [ ] AC-E-06: Tier 0 请求状态变更（PENDING -> CONFIRMED/REJECTED）写入审计日志。

### 5.5 集成测试点

| 测试 ID | 测试场景 | 期望结果 |
|---------|---------|---------|
| IT-D029-001 | VIRTUAL 形态Forgekin绑定 camera 通道 | 抛 `SpeciesSensorForbiddenError` |
| IT-D029-002 | BIO 形态Forgekin绑定 camera 通道 | 绑定成功，返回 binding_id |
| IT-D029-003 | `SensorBinding` 高采样率 + RAW 格式 | Pydantic 校验失败 |
| IT-D029-004 | `SensorBinding` 高采样率 + FEATURE 格式 | 校验通过 |
| IT-D029-005 | `ingest` 高采样率事件 | payload 含 `feature` 字段，无原始数据 |
| IT-D029-006 | `ingest` 低采样率事件 | payload 含 `payload` 字段（原始数据） |
| IT-D029-007 | `ingest` 事件触发格式 | payload 含 `trigger` + `value` 字段 |
| IT-D029-008 | `health_check=false` 时 `observe` | 返回缓存快照，不阻塞 |
| IT-D029-009 | 全部传感器离线 | `LivenessService.mark_critical` 被调用 |
| IT-D029-010 | Tier 0 操作未确认 | 物理动作不执行，请求 PENDING |
| IT-D029-011 | Tier 0 操作 operator 确认 | `status=CONFIRMED`，物理动作可执行 |
| IT-D029-012 | Tier 0 操作 operator 拒绝 | `status=REJECTED`，物理动作不执行 |
| IT-D029-013 | Tier 0 请求 24h 后状态 | 仍为 PENDING（永不自动批准） |
| IT-D029-014 | `SensorsConfigLoader.load` 8 通道齐全 | `SensorsConfig` 实例化成功 |
| IT-D029-015 | `sensors.yaml` 缺失 camera 通道 | 不报错（可选通道） |
| IT-D029-016 | `sensors.yaml` 含未知 adapter 类名 | `importlib.import_module` 抛 `ImportError` |
| IT-D029-017 | `batch_ingest` 1000 事件 | 全部写入 EchoStore，延迟 < 30s |
| IT-D029-018 | `SnapshotCache.update` 后 `get` | 返回最近一次快照 |
| IT-D029-019 | `SnapshotCache.invalidate` 后 `get` | 返回 None |
| IT-D029-020 | 4 类 Adapter 全部通过 DI 注入 | 无 `OpenCvCameraAdapter` 直接实例化 |

---

## 6. 引用

- [doc:../spec.md#§3.11]（FR-CORE-011）
- [doc:../arch.md#§3.11]（物理 AI 传感器接入，Embodied AI 路径）
- [doc:../architecture/A029-physical-ai-sensors.md]（同号架构设计）
- [doc:../features/F029-physical-ai-sensors.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F030-virtual-world-setting.md]
- [doc:../features/F038-forgemind-lineage.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/D026-forgemind-app-layer.md]（ForgeMindPlugin DI 注册）
- [doc:../design/D027-all-things-spirit-species.md]（SpeciesRegistry.assert_sensor_allowed）
- [doc:../design/D014-memory-collection.md]（EchoStoreRepository.append 契约）
- [doc:../design/naming-contract.md]（EchoStore + Forgekin Species 智能体形态学）
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md]（六层 Guardrails）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（8 通道 + 4 类 Adapter 实现 + 形态门控 + 采样率适配 + Tier 0 不可逆保护 + 故障降级详细设计） | 架构师 Forgekin（猫头鹰·鲁班） |

# A029: 物理 AI 传感器接入架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.11]（FR-CORE-011）
> **对应 arch.md**: [doc:../arch.md#§3.11]
> **对应 design.md**: [doc:../design.md#§3.11]（待创建）
> **对应 Feature**: [doc:../features/F029-physical-ai-sensors.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D029-physical-ai-sensors.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

forgemind 应用层需要为 BIO/ORG/OBJ/HYBRID 形态Forgekin提供物理世界感知通道，对标业界 Embodied AI（具身智能）工程实现路径。但 v7.0 仅有数字工具（web_search/file_rw/git 等），无物理传感器适配层。本架构在 forgemind 内部建立物理 AI 传感器接入层，解决以下架构层问题：

1. **物理感知通道缺失**：摄像头/麦克风/IoT 传感器/可穿戴设备四类物理感知设备无统一适配抽象。
2. **形态门控未编码**：仅 BIO/OBJ/HYBRID 形态Forgekin可绑定物理传感器，VIRTUAL 形态应被拒绝，但 v7.0 无门控机制。
3. **传感器事件未对接EchoStore**：传感器采集的事件无统一写入 EchoStore（EchoStore）的入口，物理感知无法成为Forgekin经验记忆。
4. **采样率适配缺失**：高采样率（摄像头 30Hz）与低采样率（温度 0.1Hz）传感器无差异化的入EchoStore策略。
5. **设备故障降级缺失**：传感器离线时Forgekin无降级机制，可能阻塞决策回路。
6. **物理世界不可逆操作未受 Tier 0 保护**：物理执行器（如机械臂）操作不可逆，需 Tier 0 永不自动恢复保护。

### 1.2 架构约束

- **单向依赖约束**：SensorAdapter 必须单向依赖 F014 EchoStore Repository + F023 liveness 读模型，禁止反向依赖 *Forge。
- **DI 容器约束**：SensorAdapter 实例必须通过 DI 容器注入，禁止 `OpenCvCameraAdapter` 直接实例化。
- **Repository 层约束**：SensorEvent 写入 EchoStore 必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：传感器 driver 类名 + config_schema + sampling_rate_hz + data_format + on_event_action 必须 YAML 外置到 `forgemind/config/sensors.yaml`，禁止 .py 硬编码设备路径（架构红线第 5 条）。
- **形态门控约束**：SensorRegistry.bind 必须调用 SpeciesRegistry.assert_sensor_allowed 校验形态合法性，VIRTUAL 形态绑定被拒绝。
- **Tier 0 不可逆约束**：物理执行器（如机械臂、门锁）等不可逆操作必须经 operator 二次确认，永不自动恢复。

### 1.3 架构影响

- **对 F027 形态分类的影响**：SensorRegistry 调用 SpeciesRegistry 校验形态门控，强化"形态决定接入层"约束。
- **对 F014 多域记忆的影响**：SensorEvent 写入 EchoStore 情景记忆，成为Forgekin经验记忆一部分。
- **对 F023 liveness 规范读模型的影响**：传感器离线时Forgekin进入 liveness degraded 状态，不阻塞决策回路。
- **对 F022 Tier 1-4 恢复分级的影响**：传感器故障按 Tier 1（自动重试）/Tier 2（换设备）分级恢复；物理不可逆操作按 Tier 0（永不自动恢复）保护。
- **对 ForgekinBase.observe 的影响**：observe 通过 SensorAdapter 读取物理世界状态作为 Observation。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |             forgemind/sensors/                  |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | SensorChannel     |  8 通道枚举（camera/mic/ |
                    |  | (Enum)            |  temp/location/imu/      |
                    |  +---------+---------+  pressure/light/depth）  |
                    |            |                                    |
                    |            v                                    |
                    |  +-------------------+   +-------------------+ |
                    |  | SensorBinding     |<->| SensorRegistry    | |
                    |  | (Forgekin <-> 设备)  |   | (YAML 配置驱动)   | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |            v                       v           |
                    |  +-------------------+   +-------------------+ |
                    |  | SensorAdapter     |   | SpeciesRegistry   | |
                    |  | (abstract)        |   | (F027 形态门控)    | |
                    |  +---------+---------+   +-------------------+ |
                    |            |                                    |
                    |  +---------+---------+                          |
                    |  | PhysicalEvent     |                          |
                    |  | Ingestor          |                          |
                    |  | (event -> EchoSt) |                          |
                    |  +---------+---------+                          |
                    +-------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                         |                         |
                v                         v                         v
    +-----------------------+   +-----------------------+   +-----------------------+
    | 4 类 Adapter           |   | F014 EchoStore       |   | F023 liveness        |
    | (camera.py / mic.py /  |   | Repository           |   | (degraded 状态)      |
    |  iot.py / wearable.py) |   | (情景记忆写入)        |   +-----------------------+
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

### 2.2 关键架构决策

- **决策 1：8 传感器通道枚举固定 + 4 类 Adapter**
  SensorChannel 固定为 camera/microphone/temperature/location/accelerometer/pressure/light/depth 八种通道，覆盖业界 Embodied AI 主流感知模态。Adapter 按 4 类组织（视觉/听觉/IoT/可穿戴），每类一个 adapter 文件。新增通道必须经 ADR 决策。

- **决策 2：形态门控由 SpeciesRegistry 集中校验**
  SensorRegistry.bind 调用 SpeciesRegistry.assert_sensor_allowed(species, channel) 校验形态合法性。VIRTUAL 形态Forgekin绑定物理传感器被拒绝。这避免形态门控逻辑分散，保证与 F027 一致。

- **决策 3：传感器事件统一写入 F014 EchoStore 情景记忆**
  PhysicalEventIngestor.ingest(event) 将 SensorEvent 转换为 EchoStore 条目，成为Forgekin经验记忆一部分。Forgekin通过 ForgekinBase.observe 读取 EchoStore 中的近期传感器事件作为 Observation。

- **决策 4：采样率差异化适配（特征提取 vs 直存）**
  高采样率传感器（如摄像头 30Hz）做特征提取后入EchoStore（避免EchoStore爆炸）；低采样率传感器（如温度 0.1Hz）直接入EchoStore。采样率适配策略 YAML 外置，避免 .py 硬编码。

- **决策 5：设备故障触发 F023 liveness degraded 状态**
  传感器离线时Forgekin进入 liveness degraded 状态，observe 返回最近一次有效快照，不阻塞决策回路。这避免单点传感器故障导致Forgekin完全停摆。

- **决策 6：物理不可逆操作受 Tier 0 保护**
  物理执行器（如机械臂、门锁、阀门）等不可逆操作必须经 operator 二次确认，永不自动恢复。这与 F022 Tier 1-4 恢复分级联动，Tier 0 为最高保护级别。

### 2.3 架构不变量

- SensorChannel 枚举必须固定 8 通道，禁止运行时动态新增通道。
- SensorRegistry.bind 必须调用 SpeciesRegistry.assert_sensor_allowed 校验形态合法性，VIRTUAL 形态绑定被拒绝。
- SensorEvent 必须通过 PhysicalEventIngestor 写入 F014 EchoStore，禁止直接操作数据库。
- 高采样率传感器必须做特征提取后入EchoStore，禁止原始数据直接写入 EchoStore（避免EchoStore爆炸）。
- 传感器离线时Forgekin必须进入 F023 liveness degraded 状态，禁止阻塞决策回路。
- 物理不可逆操作必须经 operator 二次确认，禁止自动执行（Tier 0 保护）。
- SensorAdapter 必须通过 DI 容器注入，禁止直接实例化。
- 传感器配置必须 YAML 外置到 `forgemind/config/sensors.yaml`，禁止 .py 硬编码设备路径。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| SensorChannel | `forgemind/sensors/base.py` | 8 通道枚举（不可扩展） |
| SensorBinding | `forgemind/sensors/base.py` | 传感器绑定数据模型（Forgekin <-> 物理设备） |
| SensorEvent | `forgemind/sensors/base.py` | 传感器事件数据模型（写入 F014 EchoStore） |
| SensorAdapter | `forgemind/sensors/base.py` | 传感器适配器抽象（每设备一个 adapter） |
| SensorRegistry | `forgemind/sensors/registry.py` | 传感器注册表（YAML 配置驱动） |
| PhysicalEventIngestor | `forgemind/sensors/ingestor.py` | 物理事件摄入器（event -> EchoStore） |
| CameraAdapter | `forgemind/sensors/camera.py` | 摄像头适配器（OpenCV） |
| MicrophoneAdapter | `forgemind/sensors/microphone.py` | 麦克风适配器 |
| IotAdapter | `forgemind/sensors/iot.py` | IoT 协议适配器（温度/位置/IMU/压力/光照/深度） |
| WearableAdapter | `forgemind/sensors/wearable.py` | 可穿戴设备适配器 |
| SensorsConfig | `forgemind/config/sensors.yaml` | 传感器 YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Callable
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class SensorChannel(str, Enum):
    """传感器通道（按形态配置）"""
    CAMERA = "camera"                # 摄像头（视觉）
    MICROPHONE = "microphone"        # 麦克风（听觉）
    TEMPERATURE = "temperature"      # 温度
    LOCATION = "location"            # 位置/GPS
    ACCELEROMETER = "imu"            # 加速度/IMU
    PRESSURE = "pressure"            # 压力（被坐/被按）
    LIGHT = "light"                  # 光照（被开/被关）
    DEPTH = "depth"                  # 深度（距离感知）


class SensorDataFormat(str, Enum):
    """传感器数据格式"""
    RAW = "raw"            # 原始数据（低采样率直存）
    FEATURE = "feature"    # 特征提取（高采样率）
    EVENT = "event"        # 事件触发（如压力垫触发）


class SensorBinding(BaseModel):
    """传感器绑定（Forgekin <-> 物理设备）"""
    binding_id: str
    forgekin_id: str
    species: str                          # 来自 F027，必须是 BIO/OBJ/HYBRID
    device_id: str                        # 物理 IoT 设备 ID
    channel: SensorChannel
    sampling_rate_hz: float
    data_format: SensorDataFormat
    on_event_action: str                  # 事件触发动作


class SensorEvent(BaseModel):
    """传感器事件（写入 F014 EchoStore）"""
    event_id: str
    binding_id: str
    channel: SensorChannel
    timestamp: datetime
    payload: dict                         # 事件载荷
    echo_store_ref: str                   # 写入 F014 EchoStore集合 ID
    forgekin_reaction: Optional[str]      # Forgekin反应 trace ID


class SensorAdapter(ABC):
    """传感器适配器抽象（每种设备一个 adapter，DI 注入）"""

    @abstractmethod
    async def connect(self, device_id: str) -> str:
        """连接物理设备"""
        ...

    @abstractmethod
    async def subscribe(
        self, binding_id: str, callback: Callable[[SensorEvent], None]
    ) -> None:
        """订阅传感器事件"""
        ...

    @abstractmethod
    async def read_snapshot(self, binding_id: str) -> dict:
        """读取当前快照（用于 observe）"""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """设备健康检查"""
        ...


class SensorRegistry(ABC):
    """传感器注册表（YAML 配置驱动）"""

    @abstractmethod
    async def bind(self, binding: SensorBinding) -> str:
        """绑定传感器（含形态门控校验）"""
        ...

    @abstractmethod
    async def list_bindings(self, forgekin_id: str) -> list[SensorBinding]:
        """列出Forgekin的所有传感器绑定"""
        ...

    @abstractmethod
    async def unbind(self, binding_id: str) -> None:
        """解绑传感器"""
        ...


class PhysicalEventIngestor(ABC):
    """物理事件摄入器（事件 -> EchoStore）"""

    @abstractmethod
    async def ingest(self, event: SensorEvent) -> str:
        """摄入单个事件到 EchoStore"""
        ...

    @abstractmethod
    async def batch_ingest(self, events: list[SensorEvent]) -> list[str]:
        """批量摄入事件"""
        ...


class Tier0Guard(ABC):
    """Tier 0 不可逆操作守卫（物理执行器专用）"""

    @abstractmethod
    async def request_irreversible_action(
        self, binding_id: str, action: str, params: dict
    ) -> str:
        """发起不可逆操作请求（需 operator 二次确认）"""
        ...

    @abstractmethod
    async def confirm_irreversible_action(
        self, request_id: str, operator_id: str
    ) -> None:
        """operator 确认不可逆操作"""
        ...
```

### 3.3 数据流

```
[绑定阶段]
    operator/SOP 提交 SensorBinding（YAML）
        |
        v
    SensorRegistry.bind(binding)
        |
        v
    SpeciesRegistry.assert_sensor_allowed(species, channel)
        |
        +--> VIRTUAL 形态: 拒绝
        `--> BIO/OBJ/HYBRID 形态: 允许
        |
        v
    SensorAdapter.connect(device_id)
        |
        v
    绑定就绪

[采集阶段（高采样率：camera/imu/depth）]
    SensorAdapter.subscribe(binding_id, callback)
        |
        v
    物理设备持续采样（30Hz）
        |
        v
    特征提取（如人脸检测/姿态识别）
        |
        v
    PhysicalEventIngestor.ingest(event) [feature 格式]
        |
        v
    EchoStoreRepository.append(echo_entry) [F014]

[采集阶段（低采样率：temperature/light/pressure）]
    SensorAdapter.subscribe(binding_id, callback)
        |
        v
    物理设备事件触发（0.1Hz 或阈值触发）
        |
        v
    PhysicalEventIngestor.ingest(event) [raw/event 格式]
        |
        v
    EchoStoreRepository.append(echo_entry) [F014]

[observe 阶段（ForgekinBase.observe 调用）]
    ForgekinBase.observe
        |
        v
    SensorAdapter.read_snapshot(binding_id)
        |
        v
    合并多个 SensorBinding 的快照
        |
        v
    返回 Observation（含近期 SensorEvent 摘要）

[故障阶段]
    SensorAdapter.health_check -> false
        |
        v
    F023 liveness 规范读模型: forgekin 状态 -> degraded
        |
        v
    ForgekinBase.observe 返回最近一次有效快照
        `--> 不阻塞决策回路

[物理不可逆操作阶段（如机械臂）]
    Tier0Guard.request_irreversible_action(binding_id, action)
        |
        v
    operator 二次确认 confirm_irreversible_action(request_id, operator_id)
        |
        v
    SensorAdapter 执行物理操作
        `--> Tier 0 永不自动恢复（与 F022 联动）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F026 forgemind 应用层**：sensors/ 目录宿主由 forgemind 提供。
- **依赖 F027 形态分类**：SensorRegistry 调用 SpeciesRegistry.assert_sensor_allowed 校验形态门控。
- **依赖 F014 Memory Collection**：SensorEvent 写入 EchoStore 情景记忆。
- **依赖 F023 liveness 规范读模型**：传感器故障时Forgekin进入 degraded 状态。
- **依赖 F022 Tier 1-4 恢复分级**：传感器故障按 Tier 1/2 恢复；物理不可逆操作按 Tier 0 保护。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 ForgekinBase.observe**：observe 通过 SensorAdapter 读取物理世界状态作为 Observation。
- **影响 F030 虚拟世界设定层**：HYBRID 形态Forgekin同时接入物理传感器（F029）与虚拟世界设定（F030），二者通过Forgekin决策回路融合。
- **影响 F038 进化谱系**：传感器绑定记录可作为形态进化证据（如 BIO -> HYBRID 加装传感器）。

### 4.3 跨模块不变量

- SensorChannel 枚举必须固定 8 通道，禁止运行时新增通道。
- SensorRegistry.bind 必须调用 SpeciesRegistry.assert_sensor_allowed 校验形态门控。
- SensorEvent 必须通过 PhysicalEventIngestor 写入 F014 EchoStore，禁止直接操作数据库。
- 高采样率传感器（>= 1Hz）必须做特征提取后入EchoStore，禁止原始数据直存。
- 传感器离线时Forgekin必须进入 F023 liveness degraded 状态，禁止阻塞决策回路。
- 物理不可逆操作必须经 operator 二次确认，Tier 0 永不自动恢复。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— SensorAdapter 仅依赖 F014/F023/F027，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— SensorAdapter 通过 DI 容器注入到 SensorRegistry。
- [ ] AC-3: Repository 层通过 —— SensorEvent 通过 PhysicalEventIngestor + EchoStoreRepository 写入，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— 传感器 driver / config_schema / sampling_rate / data_format YAML 外置到 `forgemind/config/sensors.yaml`。
- [ ] AC-5: 形态门控通过 —— VIRTUAL 形态Forgekin绑定物理传感器被拒绝。

### 5.2 架构不变量验收

- [ ] AC-6: 8 通道枚举不变量通过 —— SensorChannel 仅含 8 通道，运行时无法新增。
- [ ] AC-7: 采样率适配不变量通过 —— 摄像头（30Hz）数据经特征提取后入EchoStore，温度（0.1Hz）数据直存。
- [ ] AC-8: 故障降级不变量通过 —— 传感器离线后Forgekin进入 liveness degraded 状态，observe 返回最近有效快照。
- [ ] AC-9: Tier 0 保护不变量通过 —— 物理不可逆操作未经 operator 确认时被拒绝执行。
- [ ] AC-10: SensorAdapter DI 不变量通过 —— 无 `OpenCvCameraAdapter` 直接实例化，全部通过 DI 容器注入。

---

## 6. 引用

- [doc:../spec.md#§3.11]（FR-CORE-011）
- [doc:../arch.md#§3.11]（物理 AI 传感器接入，Embodied AI 路径）
- [doc:../features/F029-physical-ai-sensors.md]（同号 Feature 级 SRS）
- [doc:../features/F026-forgemind-app-layer.md]
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../design/naming-contract.md]（EchoStore + Forgekin Species 智能体形态学）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（8 通道 + 4 类 Adapter + 形态门控 + Tier 0 保护架构） | 架构师 Forgekin（猫头鹰·鲁班） |

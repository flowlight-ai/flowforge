# Feature F029: 物理 AI 传感器接入层

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#FM-009] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/013-all-things-spirit-mind-vision.md]
> **类型**: forgemind
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

物理 AI 传感器接入层是 forgemind 应用层对物理世界的感知通道：为 BioForgekin / ObjForgekin / HybridForgekin 三种物理形态灵智体（Forgekin）提供摄像头/麦克风/温度/位置/加速度等传感器适配。本 Feature 实现传感器声明、数据采集、信号→灵忆（EchoStore）写入、与 F027 形态分类联动，让"桌椅灵智体知道被坐了、灯具灵智体知道被打开了"。

这是 Build to Persist 基础设施——编码"灵智体感知物理世界"的工程规则，是物理 AI 复现的底座。

## 2. 动机（Motivation）

`[doc:review/review.md#FM-009]` 指出：v7.0 仅有数字工具（web_search/file_rw/git 等），无物理传感器适配层，导致灵智体无法感知物理世界。operator 愿景"达成物理 AI 的真实复现"要求物理形态灵智体具备传感器接入能力——这是与 clowder-ai 养猫愿景的关键差异，clowder-ai 的猫是纯虚拟，FlowForge 要养万物包括物理实体。

不做这个 Feature，F027 形态分类的 BIO/OBJ/HYBRID 形态无物理感知通道，物理世界状态无法进入灵智体决策回路。这是物理 AI 复现路径的感知底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class SensorChannel(str, Enum):
    """传感器通道（按形态配置）"""
    CAMERA = "camera"            # 摄像头（视觉）
    MICROPHONE = "microphone"    # 麦克风（听觉）
    TEMPERATURE = "temperature"  # 温度
    LOCATION = "location"        # 位置/GPS
    ACCELEROMETER = "imu"        # 加速度/IMU
    PRESSURE = "pressure"        # 压力（被坐/被按）
    LIGHT = "light"              # 光照（被开/被关）
    DEPTH = "depth"              # 深度（距离感知）

class SensorBinding(BaseModel):
    """传感器绑定（灵智体 ↔ 物理设备）"""
    binding_id: str
    forgekin_id: str
    species: ForgekinSpecies                    # 来自 F027，必须是 BIO/OBJ/HYBRID
    device_id: str                              # 物理 IoT 设备 ID
    channel: SensorChannel
    sampling_rate_hz: float
    data_format: Literal["raw", "feature", "event"]
    on_event_action: str                        # 事件触发动作（写入灵忆/通知灵智体）

class SensorEvent(BaseModel):
    """传感器事件（写入灵忆）"""
    event_id: str
    binding_id: str
    channel: SensorChannel
    timestamp: datetime
    payload: dict                               # 事件载荷
    echo_store_ref: str                         # 写入 F014 灵忆集合 ID
    forgekin_reaction: Optional[str]            # 灵智体反应 trace ID
```

### 3.2 核心接口

```python
class SensorAdapter(ABC):
    """传感器适配器（每种设备一个 adapter，声明式配置）"""
    @abstractmethod
    async def connect(self, device_id: str) -> str: ...
    @abstractmethod
    async def subscribe(self, binding_id: str, callback: Callable) -> None: ...
    @abstractmethod
    async def read_snapshot(self, binding_id: str) -> dict: ...

class SensorRegistry(ABC):
    """传感器注册表"""
    @abstractmethod
    async def bind(self, binding: SensorBinding) -> str: ...
    @abstractmethod
    async def list_bindings(self, forgekin_id: str) -> list[SensorBinding]: ...
    @abstractmethod
    async def unbind(self, binding_id: str) -> None: ...

class PhysicalEventIngestor:
    """物理事件摄入器（事件→灵忆）"""
    async def ingest(self, event: SensorEvent) -> str: ...
    async def batch_ingest(self, events: list[SensorEvent]) -> list[str]: ...
```

### 3.3 关键算法

- **形态门控**：仅 BIO/OBJ/HYBRID 形态可绑定传感器，VIRTUAL 形态绑定被拒绝（与 F027 联动）。
- **事件驱动写入灵忆**：传感器事件按 on_event_action 写入 F014 灵忆集合，成为灵智体经验记忆的一部分。
- **采样率适配**：高采样率（如摄像头 30Hz）做特征提取后入灵忆，低采样率（如温度 0.1Hz）直接入灵忆。
- **设备故障降级**：传感器离线时灵智体进入 F023 liveness degraded 状态，不阻塞决策回路。

### 3.4 配置外置（YAML 示例）

```yaml
physical_sensors:
  adapters:
    camera:
      driver: OpenCvCameraAdapter
      config_schema: camera_config
    pressure:
      driver: PressureMatAdapter
      config_schema: pressure_config
  bindings_example:
    - forgekin_id: forgekin_chair_001
      species: obj
      device_id: pressure_mat_living_room
      channel: pressure
      sampling_rate_hz: 1.0
      data_format: event
      on_event_action: write_echo_store
  on_device_failure: mark_liveness_degraded
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 传感器绑定受形态门控（仅 BIO/OBJ/HYBRID）
- [ ] AC-2: 传感器事件写入 F014 灵忆集合
- [ ] AC-3: 设备故障触发 F023 liveness degraded 状态
- [ ] AC-4: 采样率适配（高采样率特征提取，低采样率直存）
- [ ] AC-5: 传感器适配器通过 YAML 配置驱动（禁止硬编码设备路径）

## 5. 测试策略

### 5.1 单元测试

- 形态门控、事件写入灵忆、采样率适配、设备故障降级逻辑。

### 5.2 集成测试

- 接入 F027 形态分类、F014 灵忆集合、F023 liveness 读模型。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实物理 IoT 设备（如压力垫）绑定到 ObjForgekin（椅子灵智体），人坐上去触发事件，验证事件写入灵忆、灵智体通过真实 LLM 作出反应。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（含真实传感器）。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/FM-009]
- [doc:decisions/013-all-things-spirit-mind-vision.md]
- [doc:design/naming-contract.md#2.3]（灵族 Forgekin Species）
- [doc:design/naming-contract.md#2.5]（灵忆 EchoStore）
- [doc:features/F027-all-things-spirit-species.md]
- [doc:features/F014-memory-collection.md]
- [doc:features/F023-liveness-canonical-read.md]
- [doc:project_rules.md#T1-T8]

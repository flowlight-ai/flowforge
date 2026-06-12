# 代码去重计划 (Code Deduplication Plan)

> 创建日期: 2026-06-12
> 状态: 规划中
> 影响范围: FlowForge、ContentForge、DevForge、NovelForge、MallForge

---

## 1. 问题概述

5个项目（ContentForge、DevForge、NovelForge、MallForge、DemoForge）基于FlowForge底座构建，但存在大量重复代码和配置。核心问题：

1. **重复的 Agent 基类**：每个项目都有自己的 `flowforge_bridge.py`（ContentForge）或类似桥接层，功能高度重复
2. **重复的 ModelService 子类**：ContentForge 有自己的 `ModelService`，其他项目未来也会需要
3. **重复的 app/main.py 模式**：认证、限流中间件配置在每个项目中重复
4. **重复的 DI 容器设置**：每个项目都需要手动注册 agents 和基础设施
5. **重复的配置加载逻辑**：`ConfigLoader` + `system.yaml` 在每个项目中重复

---

## 2. 重复代码区域详细清单

### 2.1 Agent 桥接层 (Priority: HIGH)

| 文件 | 项目 | 行数 | 重复度 |
|------|------|------|--------|
| `contentforge/core/flowforge_bridge.py` | ContentForge | ~60 | 基准 |
| 未来 `devforge/core/bridge.py` | DevForge | 预计类似 | ~90% |
| 未来 `novelforge/core/bridge.py` | NovelForge | 预计类似 | ~90% |
| 未来 `mallforge/core/bridge.py` | MallForge | 预计类似 | ~90% |

**问题**: `ContentForgeAgent` 基类（`_call_tool`、`_call_llm` 快捷方法）是通用需求，不应仅存在于 ContentForge。

**方案**: 将 `ContentForgeAgent` 提升到 `flowforge.core.base_agent.DomainAgent`，提供 `_call_tool` 和 `_call_llm` 快捷方法，所有上层项目继承 `DomainAgent`。

### 2.2 ModelService 子类 (Priority: MEDIUM)

| 文件 | 项目 | 重复度 |
|------|------|--------|
| `contentforge/tools/llm/model_service.py` | ContentForge | 基准 |
| `flowforge/tools/llm/model_service.py` | FlowForge | 基类 |

**问题**: ContentForge 的 `ModelService` 添加了 `PERSONAS`、`AGENTS`、`auto_fix_persona` 等方法，这些是领域特定的，但 `HealthChecker` 是通用需求。

**方案**: 将 `HealthChecker` 提升到 FlowForge 的 `model_service.py`，ContentForge 只保留 persona 相关逻辑。

### 2.3 DI 容器设置 (Priority: MEDIUM)

| 文件 | 项目 | 重复度 |
|------|------|--------|
| `contentforge/core/di_setup.py` | ContentForge | 基准 |

**问题**: 每个项目都需要手动编写 `setup_di_container()`，注册 agents、LLMClient、ToolRegistry 等。

**方案**: 在 FlowForge SDK 中添加 `sdk.setup_di(agents_package, infrastructure={})` 方法，自动扫描并注册 agents 和基础设施组件。

### 2.4 App 启动模式 (Priority: MEDIUM)

| 文件 | 项目 | 重复度 |
|------|------|--------|
| `contentforge/app/main.py` | ContentForge | 认证+限流+DI |
| `devforge/app/main.py` | DevForge | 仅 SDK |
| `novelforge/app/main.py` | NovelForge | 仅 SDK |
| `mallforge/app/main.py` | MallForge | 仅 SDK |

**问题**: ContentForge 手动配置认证和限流中间件，其他项目缺少这些配置。

**方案**: 在 `FlowForgeSDK.__init__` 中添加 `auth_config` 和 `rate_limit_config` 参数，SDK 自动注入中间件。

### 2.5 事件系统 (Priority: LOW)

| 文件 | 项目 | 重复度 |
|------|------|--------|
| `flowforge/events/event_bus.py` | FlowForge | 基准 |
| `flowforge/core/event_bridge.py` | FlowForge | 新增桥接 |

**问题**: 各项目可能各自实现事件系统，缺少统一桥接。

**方案**: 已通过 `EventBusBridge` 解决，各项目统一使用 FlowForge EventBus。

---

## 3. 整合计划

### Phase 1: 提升 DomainAgent (第1周)

1. 在 `flowforge/core/base_agent.py` 中添加 `DomainAgent` 类
2. 将 `ContentForgeAgent._call_tool` 和 `_call_llm` 移入 `DomainAgent`
3. ContentForge 的 `ContentForgeAgent` 改为继承 `DomainAgent`
4. 其他项目直接继承 `DomainAgent`

### Phase 2: SDK 增强 (第2周)

1. `FlowForgeSDK` 添加 `setup_di()` 方法
2. `FlowForgeSDK.__init__` 支持 `auth_config` 和 `rate_limit_config`
3. `FlowForgeSDK` 添加 `health_checker` 属性，自动创建和管理
4. 各项目 `app/main.py` 简化为 SDK 配置

### Phase 3: HealthChecker 提升 (第2周)

1. 将 `HealthChecker` 从 ContentForge 移入 `flowforge/tools/llm/model_service.py`
2. ContentForge 的 `HealthChecker` 改为导入 FlowForge 版本
3. SDK 自动启动 HealthChecker（可配置间隔）

### Phase 4: 配置统一 (第3周)

1. 各项目的 `config/system.yaml` 结构统一
2. FlowForge SDK 提供配置验证和默认值
3. 消除各项目中重复的 `ConfigLoader` 使用

---

## 4. 预期收益

| 指标 | 当前 | 目标 |
|------|------|------|
| 每个项目 app/main.py 行数 | 30-40 | 5-10 |
| Agent 基类代码重复 | 4份 | 0份 |
| DI 设置代码重复 | 每项目1份 | SDK自动 |
| 认证/限流配置重复 | 手动 | SDK自动 |
| HealthChecker 代码 | 仅ContentForge | 全项目可用 |

---

## 5. 风险与约束

1. **向后兼容**: 提升代码时必须保持现有接口不变
2. **渐进迁移**: 不能一次性重构所有项目，需逐个迁移
3. **测试覆盖**: 每次迁移后必须运行全量回归测试
4. **弱耦合原则**: FlowForge 修改不影响上层项目（除非契约变化）

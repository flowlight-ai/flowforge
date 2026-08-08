# D046: F135 OOTB 关闭教训（CL-035）

> **章节编号**: D046
> **关联 CL**: CL-035
> **关联 Feature**: F135 OOTB（Out-of-the-Box）开关
> **创建日期**: 2026-07-21
> **负责人**: 鲁班（架构师可进化智能体）
> **状态**: accepted

---

## 1. 问题陈述

CL-035 指出：F135 OOTB（Out-of-the-Box）功能在 v6.0 默认开启，导致以下问题：

1. **新用户首次启动即被功能淹没**：OOTB 默认开启所有特性，新用户面对 20+ 配置项和 5+ 自动启动的服务无所适从
2. **生产环境误开实验特性**：OOTB 默认开启含 `experimental` 标签的特性，生产环境无意中运行未稳定特性
3. **配置驱动率虚高**：OOTB 默认值掩盖了真实配置缺失，配置驱动率统计失真
4. **故障定位困难**：OOTB 默认开启的副作用导致故障定位时难以区分"用户配置"vs"默认行为"
5. **性能基线漂移**：OOTB 默认开启的实验特性导致性能基线不稳定，SLO 难以制定

## 2. 教训提炼

### 2.1 核心教训

**OOTB 默认开启是"假友好"**：

- 表面：新用户开箱即用，无需配置
- 实际：新用户被淹没，生产环境被污染，故障定位被干扰

**正确做法**：OOTB 默认关闭，提供 `flowforge init` 命令引导用户按需开启。

### 2.2 五条衍生教训

| # | 教训 | 反模式 | 正模式 |
|---|------|--------|--------|
| 1 | 实验特性默认关闭 | `experimental: true` 默认开启 | `experimental: true` 必须显式 `enable_experimental: true` 才生效 |
| 2 | 生产特性按场景开启 | 所有特性默认开启 | 按部署环境（dev/staging/prod）提供不同默认配置 |
| 3 | 配置项有"显式开启"标志 | `enabled: true` 默认 | `enabled: false` 默认，需 `flowforge enable <feature>` |
| 4 | OOTB 配置可审计 | 默认配置隐藏在代码中 | OOTB 配置生成后写入 `config/generated.yaml` 供审计 |
| 5 | 关闭优于开启 | 倾向"功能可用" | 倾向"系统最小化"，按需开启降低故障面 |

## 3. 决策

### 3.1 OOTB 默认关闭策略

所有 Feature 默认 `enabled: false`，用户必须显式开启：

```yaml
# config/system.yaml
features:
  f008_durable_state_surfaces:
    enabled: false  # 默认关闭
    required: true  # 标记为必需（CI 校验）
  f012_entropy_control:
    enabled: false
    required: false
  f135_ootb:
    enabled: false  # OOTB 自身也默认关闭
    required: false
```

### 3.2 flowforge init 引导命令

提供 `flowforge init` 命令引导用户按需开启特性：

```bash
# 交互式初始化
flowforge init --interactive

# 按场景初始化
flowforge init --profile=minimal    # 最小化（仅核心）
flowforge init --profile=standard   # 标准（核心 + 常用）
flowforge init --profile=full       # 全开（仅 dev 环境）
```

### 3.3 实验特性开关

`experimental` 特性需要双重确认：

```yaml
# 必须在 system.yaml 显式声明
enable_experimental: true  # 全局开关
features:
  fxxx_experimental_feature:
    enabled: true
    experimental: true  # 标记为实验性
```

### 3.4 配置审计

OOTB 生成的配置必须写入 `config/generated.yaml` 供审计：

```yaml
# config/generated.yaml（自动生成，禁止手动编辑）
generated_at: 2026-07-21T12:00:00Z
generated_by: flowforge init --profile=standard
features_enabled:
  - f008_durable_state_surfaces
  - f009_evidence_sensors
  # ...
features_disabled:
  - f135_ootb
  - fxxx_experimental_feature
```

### 3.5 CI 校验

CI 在 PR 合入前校验：

1. 新增 Feature 必须显式声明 `enabled: false` 默认值
2. `experimental: true` 的 Feature 必须在 `enable_experimental: true` 下才生效
3. `config/generated.yaml` 不被提交到 GitHub（加入 .gitignore）

## 4. 与其他机制联动

### 4.1 与 Harness Entropy Control 联动

- OOTB 默认关闭的 Feature 不进入 Entropy Control 的"注意力预算"统计
- 用户开启 Feature 后，Entropy Control 开始跟踪其使用频率
- 长期未使用的 Feature 触发退役信号（参见 F012）

### 4.2 与 Eval Contract 联动

- Eval Contract 五问中的"服务谁"通过 OOTB 开启情况判断
- 未被任何用户开启的 Feature 触发"无人使用"退役信号

### 4.3 与 SelfDevFrameworkLoop 联动

- SelfDevFrameworkLoop 的 Discover 阶段扫描"长期关闭的 Feature"
- 自动生成"是否应该删除该 Feature"的 ADR 提案

## 5. 实施计划

| 阶段 | 任务 | 负责方 |
|------|------|--------|
| Phase 1 | 所有 Feature 默认 `enabled: false` | 鲁班 |
| Phase 2 | 实现 `flowforge init` 命令 | 鲁班 |
| Phase 3 | 实现 `config/generated.yaml` 审计机制 | 鲁班 |
| Phase 4 | CI 集成 OOTB 校验 | operator |

## 6. 引用

- [doc:review/review.md#CL-035] F135 OOTB 关闭教训
- [doc:features/F012-entropy-control.md] Harness Entropy Control
- [doc:features/F018-eval-contract.md] Eval Contract 五问
- [doc:features/F046-selfdev-triple-loop.md] SelfDev 三闭环

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|------|------|--------|
| 2026-07-21 | v1.0 | 初版：提炼 F135 OOTB 关闭教训 + 默认关闭策略 | 鲁班 |

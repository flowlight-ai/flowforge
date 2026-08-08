# T017: Harness + Skill + MCP 模块测试

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 单元测试 + 集成测试（Harness/Skill/MCP 三模块）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-03, FR-EXT-01）
> **关联 arch.md**: [doc:../arch.md]（§5.2, §9.2, §11.1）
> **关联 design.md**: [doc:../design.md]（§3.3, §10.1）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. Harness 驾驭层测试（UT-HARNESS + IT-HARNESS）

> **Harness 七层架构**：Durable State Surfaces / Evidence & Sensors / Governance / Magic Words / Entropy Control / Harnessability / DI 容器。详见 [doc:design/D008-D013]。

### 1.1 单元测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| UT-HARNESS-01 | HarnessOrchestrator pre_execute/post_execute 钩子 | 创建任务，执行 Workflow | pre_execute 和 post_execute 钩子被调用 | 检查 hook 调用日志 |
| UT-HARNESS-02 | FeedbackLoop evaluation_mode 三档 | 分别设置 evaluation_mode=full/lightweight/skip | full=四维评分+闸门判定, lightweight=仅评分, skip=跳过 | 检查评分结果和闸门判定 |
| UT-HARNESS-03 | PermissionPipeline deny→ask→allow 三层 | 分别触发 deny/ask/allow 规则 | deny=阻止, ask=暂停等人工确认, allow=放行 | 检查动作类型 |
| UT-HARNESS-04 | SessionManager 92% 压缩阈值 | 会话上下文超过 92% 容量 | 触发压缩，保留关键信息 | 检查压缩后上下文长度 < 92% 阈值 |
| UT-HARNESS-05 | ContextEngine AGENTS.md 注入 | 项目目录含 AGENTS.md 文件 | AGENTS.md 内容被注入到 Agent 上下文中 | 检查 Agent 收到的 system prompt 包含 AGENTS.md 内容 |
| UT-HARNESS-06 | ArchitectureConstraintEngine 分层依赖检测 | 下层模块导入上层模块 | 检测到违规并报告 | 检查违规报告 |

### 1.2 集成测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| IT-HARNESS-01 | Harness 集成到 Workflow 执行流程 | 执行 deep_article Workflow | pre_execute→Workflow 执行→post_execute 完整调用 | 检查 hook 调用顺序和参数 |
| IT-HARNESS-02 | FeedbackLoop 闸门判定阻断低质量输出 | Agent 输出质量低于闸门阈值 | FeedbackLoop 判定为 Fail，阻断输出 | 检查输出被阻断 |

### 1.3 UT-HARNESS-02 三档验证代码

```python
import pytest
from flowforge.harness.feedback_loop import FeedbackLoop, EvaluationMode

@pytest.mark.asyncio
async def test_ut_harness_02_evaluation_modes():
    """UT-HARNESS-02: FeedbackLoop evaluation_mode 三档"""
    for mode in [EvaluationMode.FULL, EvaluationMode.LIGHTWEIGHT, EvaluationMode.SKIP]:
        loop = FeedbackLoop(evaluation_mode=mode)
        result = await loop.evaluate(
            content="测试内容",
            criteria={"design_quality": 0.8, "originality": 0.7}
        )

        if mode == EvaluationMode.FULL:
            assert result.score is not None
            assert result.verdict in ("pass", "conditional", "fail")
            assert result.gate_decision is not None
        elif mode == EvaluationMode.LIGHTWEIGHT:
            assert result.score is not None
            assert result.gate_decision is None
        else:  # SKIP
            assert result.score is None
            assert result.verdict is None
```

---

## 2. Skill 系统测试（UT-SKILL + IT-SKILL）

> **Skill 系统**：可进化的智能体技能库，支持 4 种格式（YAML/JSON/Python/TOML）+ 双层加载（内置 + 用户）+ Combo Skills 管道编排。

### 2.1 单元测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| UT-SKILL-01 | SkillRegistry 注册和匹配 | 注册多个 Skill，查询匹配 | 按置信度匹配最佳 Skill | 匹配结果排序正确 |
| UT-SKILL-02 | 4 种格式适配（YAML/JSON/Python/TOML） | 4 种格式的 Skill 定义文件 | 全部正确解析为 Skill 对象 | Skill 属性完整 |
| UT-SKILL-03 | Combo Skills 管道编排 | 定义 Combo Skill（A→B→C 管道） | 按顺序执行，前一步输出作为后一步输入 | 管道执行顺序和输出传递 |
| UT-SKILL-04 | 双层加载（内置+用户） | 内置 Skill 和用户自定义 Skill | 用户 Skill 覆盖同名内置 Skill | 最终使用的是用户 Skill |

### 2.2 集成测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| IT-SKILL-01 | Skill 集成到 Agent 执行 | Agent 调用 Skill | Skill 正确执行并返回结果 | Agent 输出包含 Skill 执行结果 |
| IT-SKILL-02 | Skill 置信度匹配降级 | 无高置信度匹配的 Skill 请求 | 降级到默认处理或返回无匹配 | 降级行为正确 |

### 2.3 UT-SKILL-02 四种格式测试代码

```python
import pytest
from pathlib import Path
from flowforge.skills.registry import SkillRegistry

@pytest.mark.asyncio
async def test_ut_skill_02_four_formats(tmp_path: Path):
    """UT-SKILL-02: 4 种格式适配"""
    # YAML
    yaml_file = tmp_path / "skill.yaml"
    yaml_file.write_text("""
name: yaml_skill
description: YAML format skill
pattern: "test.*"
action: echo
""")
    # JSON
    json_file = tmp_path / "skill.json"
    json_file.write_text('{"name": "json_skill", "description": "JSON format", "pattern": "test.*", "action": "echo"}')
    # Python
    py_file = tmp_path / "skill.py"
    py_file.write_text("""
SKILL = {
    "name": "py_skill",
    "description": "Python format",
    "pattern": "test.*",
    "action": "echo"
}
""")
    # TOML
    toml_file = tmp_path / "skill.toml"
    toml_file.write_text("""
name = "toml_skill"
description = "TOML format"
pattern = "test.*"
action = "echo"
""")

    registry = SkillRegistry()
    registry.load_from_dir(tmp_path)

    assert "yaml_skill" in registry.skills
    assert "json_skill" in registry.skills
    assert "py_skill" in registry.skills
    assert "toml_skill" in registry.skills
```

---

## 3. MCP 模块测试（UT-MCP + IT-MCP）

> **MCP（Model Context Protocol）**：通过 MCPBroker 索引路由 + 熔断机制管理多个 MCP Server，提供流式传输能力。

### 3.1 单元测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| UT-MCP-01 | MCPBroker 熔断机制 | 连续调用失败超过阈值 | 触发熔断，后续请求快速失败 | 熔断后响应时间 < 100ms |
| UT-MCP-02 | MCPBroker 索引路由 | 请求路由到指定 MCP Server | 正确路由到目标 Server | 请求到达正确的 Server |
| UT-MCP-03 | MCP Client 连接管理 | 建立/断开/重连 MCP 连接 | 连接状态正确管理 | 重连后功能正常 |
| UT-MCP-04 | MCP Gateway 流式传输 | 请求流式响应 | 正确转发流式数据 | 数据完整且顺序正确 |

### 3.2 集成测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| IT-MCP-01 | MCP 端到端集成 | 通过 MCP 调用外部工具 | 请求→路由→执行→响应完整流程 | 返回正确结果 |

### 3.3 UT-MCP-01 熔断机制测试代码

```python
import pytest
import time
from flowforge.mcp.broker import MCPBroker
from flowforge.mcp.exceptions import CircuitBreakerOpenError

@pytest.mark.asyncio
async def test_ut_mcp_01_circuit_breaker():
    """UT-MCP-01: MCPBroker 熔断机制"""
    broker = MCPBroker(failure_threshold=5, recovery_timeout=30)

    # 配置必定失败的 MCP server
    broker.register_server("failing_server", MCPMockAlwaysFailing())

    # 前 5 次失败
    for i in range(5):
        with pytest.raises(ConnectionError):
            await broker.call("failing_server", "tool", {})

    # 第 6 次应快速失败（熔断）
    start = time.time()
    with pytest.raises(CircuitBreakerOpenError):
        await broker.call("failing_server", "tool", {})
    elapsed = time.time() - start

    assert elapsed < 0.1, f"熔断后响应时间 {elapsed:.3f}s 应 < 100ms"
```

---

## 4. 三模块协作验证

### 4.1 Harness + Skill 协作

- Harness 在 pre_execute 阶段查询 SkillRegistry，匹配适用的 Skill
- 匹配的 Skill 注入到 Agent 的工具集
- Agent 执行时调用 Skill，结果通过 Harness post_execute 验证

### 4.2 Harness + MCP 协作

- Harness 通过 MCPBroker 调用外部工具
- MCPBroker 的熔断状态反馈给 Harness Governance 层
- Governance 层根据熔断状态调整后续策略

### 4.3 Skill + MCP 协作

- 某些 Skill 的 action 通过 MCP 调用外部工具
- Skill 置信度匹配失败时降级到 MCP 默认工具

---

## 5. 引用

- [doc:../spec.md]（FR-ENG-03, FR-EXT-01）
- [doc:../arch.md]（§5.2, §9.2, §11.1）
- [doc:../design.md]（§3.3, §10.1）
- [doc:design/D008-durable-state-surfaces.md]
- [doc:design/D009-evidence-sensors.md]
- [doc:design/D010-governance-boundary.md]
- [doc:design/D011-magic-words.md]
- [doc:design/D012-entropy-control.md]
- [doc:design/D013-harnessability.md]
- [doc:rules.md#T1-T8]
- [doc:design/naming-contract.md]
- [doc:TEMPLATE.md]

---

## 6. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 32-34 章拆分，覆盖 Harness + Skill + MCP 三模块测试 | 测试员可进化智能体（蜜獾·平头哥） |

# T018: 任务状态机 + Episode 轨迹记录测试

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 单元测试 + 集成测试（状态机 + Episode）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-06 Episode 记录）
> **关联 arch.md**: [doc:../arch.md]（§8.3 Checkpoint, §10.5 状态机）
> **关联 design.md**: [doc:../design.md]（§6.3 Checkpoint）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 任务状态机测试（UT-STATE-01~10）

> **任务生命周期状态转换**：pending → running → (paused/resumed) → completed/error/rejected/cancelled

### 1.1 状态转换矩阵

| 测试 ID | 初始状态 | 操作 | 预期状态 | 预期行为 |
|--------|---------|------|---------|---------|
| UT-STATE-01 | pending | start | running | 正常启动 |
| UT-STATE-02 | running | pause | paused | 暂停成功 |
| UT-STATE-03 | paused | resume | running | 恢复执行 |
| UT-STATE-04 | running | complete | completed | 正常完成 |
| UT-STATE-05 | running | error | error | 错误终止 |
| UT-STATE-06 | paused | approve+resume | running | 审核通过后恢复 |
| UT-STATE-07 | paused | reject | rejected | 审核驳回 |
| UT-STATE-08 | error | resume | error | 错误状态不可恢复 |
| UT-STATE-09 | completed | pause | error/completed | 已完成不可暂停 |
| UT-STATE-10 | cancelled | review | error/cancelled | 已取消不可审核 |

### 1.2 状态机图

```
                    ┌──────────────┐
                    │   pending    │
                    └──────┬───────┘
                           │ start
                           ↓
                    ┌──────────────┐
              ┌─────│   running    │─────┐
              │     └──────────────┘     │
              │ pause                    │ complete / error
              ↓                          ↓
       ┌──────────────┐           ┌──────────────┐
       │   paused     │           │  completed   │
       └──────┬───────┘           │    error     │
              │                   │  rejected    │
              │ resume            │  cancelled   │
              ↓                   └──────────────┘
       ┌──────────────┐
       │   running    │
       └──────────────┘
              │
              │ reject (审核驳回)
              ↓
       ┌──────────────┐
       │  rejected    │
       └──────────────┘
```

### 1.3 测试代码示例

```python
import pytest
from flowforge.executor.state_manager import StateManager, TaskState

@pytest.mark.asyncio
async def test_ut_state_01_pending_to_running():
    """UT-STATE-01: pending → running"""
    sm = StateManager()
    await sm.transition("task_1", TaskState.PENDING, TaskState.RUNNING)
    assert sm.get_state("task_1") == TaskState.RUNNING


@pytest.mark.asyncio
async def test_ut_state_08_error_no_resume():
    """UT-STATE-08: error 状态不可恢复"""
    sm = StateManager()
    await sm.transition("task_1", TaskState.RUNNING, TaskState.ERROR)

    with pytest.raises(InvalidTransitionError):
        await sm.transition("task_1", TaskState.ERROR, TaskState.RUNNING)


@pytest.mark.asyncio
async def test_ut_state_09_completed_no_pause():
    """UT-STATE-09: 已完成不可暂停"""
    sm = StateManager()
    await sm.transition("task_1", TaskState.RUNNING, TaskState.COMPLETED)

    with pytest.raises(InvalidTransitionError):
        await sm.transition("task_1", TaskState.COMPLETED, TaskState.PAUSED)
```

---

## 2. Episode 轨迹记录测试（UT-EPISODE + IT-EPISODE）

> **Episode 记录**：FR-ENG-06 要求每次 Agent 执行产生完整的 Episode 记录，包含输入/输出/工具调用/耗时/质量判定。是 EchoStore（经验记忆存储）的原料。

### 2.1 单元测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| UT-EPISODE-01 | Episode 记录创建 | 执行一个完整的 Agent 任务 | 创建 Episode 记录，包含输入/输出/工具调用/耗时 | Episode 字段完整 |
| UT-EPISODE-02 | Episode 质量判定 | 不同质量的 Agent 输出 | 高质量=pass, 低质量=fail, 中等=conditional | 判定结果正确 |

### 2.2 集成测试

| 测试 ID | 场景 | 输入 | 预期 | 验证 |
|---------|------|------|------|------|
| IT-EPISODE-01 | Episode 记录在 Workflow 中的完整性 | 执行 deep_article Workflow | 每个 Agent 步骤都有对应的 Episode 记录 | Episode 数量 = Agent 数量 |

### 2.3 Episode 数据结构

```python
from pydantic import BaseModel
from typing import Any, List, Optional
from datetime import datetime
from enum import Enum


class EpisodeQuality(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    CONDITIONAL = "conditional"


class Episode(BaseModel):
    """Episode 轨迹记录 — EchoStore 经验记忆的原料"""
    episode_id: str
    agent_name: str
    task_id: str

    # 输入输出
    input_data: dict[str, Any]
    output_data: dict[str, Any]

    # 工具调用链
    tool_calls: List[dict[str, Any]] = []

    # 耗时
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[float] = None

    # 质量判定
    quality: EpisodeQuality
    quality_score: Optional[float] = None  # 0-1
    quality_issues: List[str] = []

    # 反思（如果触发 Reflexion）
    reflections: List[str] = []

    # 上下文快照（用于 EchoStore 蒸馏）
    context_snapshot: Optional[dict[str, Any]] = None
```

### 2.4 UT-EPISODE-01 测试代码

```python
import pytest
from datetime import datetime
from flowforge.memory.episode_store import EpisodeStore
from flowforge.memory.models import Episode, EpisodeQuality

@pytest.mark.asyncio
async def test_ut_episode_01_creation():
    """UT-EPISODE-01: Episode 记录创建"""
    store = EpisodeStore()

    episode = Episode(
        episode_id="ep_001",
        agent_name="topic_research",
        task_id="task_001",
        input_data={"topic": "AI Agent"},
        output_data={"topics": ["AI Agent framework", "Multi-agent system"]},
        tool_calls=[
            {"tool": "web_search", "input": {"query": "AI Agent"}, "output": {"results": []}}
        ],
        start_time=datetime.now(),
        end_time=datetime.now(),
        duration_seconds=1.5,
        quality=EpisodeQuality.PASS,
        quality_score=0.92,
    )

    await store.save(episode)
    loaded = await store.load("ep_001")

    assert loaded.episode_id == "ep_001"
    assert loaded.agent_name == "topic_research"
    assert len(loaded.tool_calls) == 1
    assert loaded.quality == EpisodeQuality.PASS
    assert loaded.quality_score == 0.92
```

### 2.5 IT-EPISODE-01 Workflow 完整性测试

```python
import pytest
from flowforge.memory.episode_store import EpisodeStore

@pytest.mark.asyncio
async def test_it_episode_01_workflow_completeness():
    """IT-EPISODE-01: Episode 记录在 Workflow 中的完整性"""
    # 执行 deep_article Workflow（8 个 Agent 步骤）
    task_id = await execute_workflow(
        workflow="deep_article",
        task="写一篇关于 AI 的文章",
        persona="tech_blog"
    )

    # 查询 Episode 记录
    store = EpisodeStore()
    episodes = await store.list_by_task(task_id)

    # 每个 Agent 步骤都有对应的 Episode
    expected_agents = {
        "topic_research",
        "material_collection",
        "article_writing",
        "seo_optimization",
        "fact_check",
        "content_audit",
        "publishing"
    }
    actual_agents = {ep.agent_name for ep in episodes}

    assert expected_agents.issubset(actual_agents), \
        f"缺失 Episode: {expected_agents - actual_agents}"

    # 每个 Episode 必须有完整字段
    for ep in episodes:
        assert ep.input_data
        assert ep.output_data
        assert ep.start_time
        assert ep.end_time
        assert ep.duration_seconds is not None
        assert ep.quality in (EpisodeQuality.PASS, EpisodeQuality.FAIL, EpisodeQuality.CONDITIONAL)
```

---

## 3. 质量判定标准

### 3.1 三档质量判定

| 质量档位 | 触发条件 | 用途 |
|---------|---------|------|
| **pass** | quality_score ≥ 0.85 且无 critical issues | 直接进入 EchoStore 作为成功经验 |
| **conditional** | 0.6 ≤ quality_score < 0.85 或有 warning issues | 标记后进入 EchoStore，蒸馏时优先级降低 |
| **fail** | quality_score < 0.6 或有 critical issues | 进入 EchoStore 作为反模式（anti-pattern） |

### 3.2 质量判定流程

```
Agent 执行完成
    ↓
┌──────────────────────────┐
│ 1. 结构化验证（schema）   │ → 失败 → fail
└──────────────────────────┘
    ↓ 通过
┌──────────────────────────┐
│ 2. Evaluator LLM 评分     │ → < 0.6 → fail
└──────────────────────────┘
    ↓ ≥ 0.6
┌──────────────────────────┐
│ 3. 关键 issue 检测         │ → 有 critical → fail
└──────────────────────────┘
    ↓ 无 critical
┌──────────────────────────┐
│ 4. score ≥ 0.85?          │ → 是 → pass
└──────────────────────────┘
    ↓ 否
  conditional
```

---

## 4. Checkpoint 与 Episode 关系

| 维度 | Checkpoint | Episode |
|------|-----------|---------|
| **目的** | 任务恢复（resume from crash） | 经验蒸馏（SpiritForge 原料） |
| **触发** | 每个步骤入口/出口 | 每个 Agent 执行完成 |
| **存储** | 检查点存储（可清理） | EchoStore（持久化） |
| **内容** | 完整 TaskContext 快照 | Agent 输入输出 + 质量判定 |
| **生命周期** | 任务完成后可清理 | 永久保留（蒸馏后归档） |

---

## 5. 引用

- [doc:../spec.md]（FR-ENG-06 Episode 记录）
- [doc:../arch.md]（§8.3 Checkpoint, §10.5 状态机）
- [doc:../design.md]（§6.3 Checkpoint）
- [doc:features/F014-memory-collection.md]（EchoStore 经验记忆）
- [doc:architecture/A014-memory-collection.md]
- [doc:design/D014-memory-collection.md]
- [doc:design/naming-contract.md]（§3.5 EchoStore 情景记忆存储）
- [doc:rules.md#T1-T8]
- [doc:TEMPLATE.md]

---

## 6. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 35-36 章拆分，覆盖任务状态机 UT-STATE-01~10 + Episode UT/IT-EPISODE | 测试员可进化智能体（蜜獾·平头哥） |

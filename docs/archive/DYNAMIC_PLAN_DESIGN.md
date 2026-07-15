# FlowForge 动态计划更新机制设计

> 版本: v1.0 | 日期: 2026-06-10
> 参考: Claude Code Plan 模式、Trae CN Solo 模式

---

## 1. 背景与动机

### 1.1 现状分析

当前 FlowForge 的计划系统存在以下局限：

| 问题 | 现状 | 影响 |
|------|------|------|
| **计划一次性生成** | `POST /api/v1/tasks/{id}/plan` 仅在 `/plan` 命令时触发，生成后不再变更 | 用户追加需求时计划不会更新 |
| **步骤无独立状态** | 步骤状态通过 `current_step` 索引推断（`< current_step` = completed） | 无法表达跳过/失败/并行等状态 |
| **无增量更新** | 每次修改需整体替换 `steps_json` | 无法追踪步骤变更历史 |
| **前端被动渲染** | `PlanPanel` 仅在 WebSocket 收到 `_plan` 事件时更新 | 用户发消息后计划不会自动演进 |
| **无对话上下文关联** | 计划生成不考虑后续对话内容 | 计划与实际执行脱节 |

### 1.2 目标

借鉴 Claude Code 和 Trae CN Solo 模式的设计理念：

1. **Master Plan**: 每个任务拥有一个贯穿全生命周期的主计划
2. **动态演进**: 新消息到达时，系统自动分析并更新计划
3. **步骤生命周期**: 每个步骤独立管理状态（pending → running → completed/failed/skipped）
4. **实时反馈**: PlanPanel 实时展示步骤状态变化和新增步骤

---

## 2. 整体架构

```
用户消息 ──→ ChatInput ──→ handleChatSubmit
                               │
                ┌──────────────┤
                ▼              ▼
         WebSocket 发送    Plan Update API
         (执行任务)        (更新计划)
                │              │
                ▼              ▼
         后端执行引擎    PlanGenerator
                │         (LLM 增量更新)
                │              │
                ▼              ▼
         WebSocket 事件    HelmDB 写入
                │         (plan_version+1)
                │              │
                └──────┬───────┘
                       ▼
              前端 PlanPanel 实时刷新
```

---

## 3. 后端设计

### 3.1 PlanGenerator 类

新增 `flowforge/brain/plan_generator.py`，负责计划的生成与增量更新。

```python
"""PlanGenerator — 基于 LLM 的动态计划生成与增量更新引擎"""

from __future__ import annotations

import json
from typing import Any, Optional
from pydantic import BaseModel

from flowforge.core.tracing import get_logger
from flowforge.tools.llm_client import LLMClient

logger = get_logger("flowforge.plan_generator")


# ── 数据模型 ──

class PlanStep(BaseModel):
    """单个步骤"""
    name: str
    task: str
    agent: str = "executor"
    tool: Optional[str] = None
    mode: Optional[str] = None
    status: str = "pending"          # pending | running | completed | failed | skipped
    result_summary: Optional[str] = None
    dependencies: list[int] = []     # 依赖步骤的索引


class PlanDelta(BaseModel):
    """计划增量更新结果"""
    steps_added: list[PlanStep] = []
    steps_modified: dict[int, PlanStep] = {}   # index → updated step
    steps_completed: list[int] = []            # 标记为完成的步骤索引
    steps_removed: list[int] = []              # 移除的步骤索引
    title_updated: Optional[str] = None
    description_updated: Optional[str] = None
    reasoning: str = ""                        # LLM 的更新推理说明


class PlanGenerator:
    """计划生成器：初始化生成 + 增量更新"""

    def __init__(self, llm_client: LLMClient) -> None:
        self._llm = llm_client

    # ── 初始计划生成 ──

    async def generate(
        self,
        intent: str,
        persona: str = "default",
        mode: str = "pipeline",
        conversation_context: list[dict[str, str]] | None = None,
    ) -> list[PlanStep]:
        """根据用户意图生成初始计划。

        Args:
            intent: 用户意图描述
            persona: 人设名称
            mode: 执行模式 (pipeline/react/plan_execute)
            conversation_context: 对话上下文（可选）
        """
        context_block = ""
        if conversation_context:
            context_lines = []
            for msg in conversation_context[-10:]:  # 最近10条
                role = msg.get("role", "user")
                content = msg.get("content", "")
                context_lines.append(f"  [{role}] {content[:200]}")
            context_block = f"\n对话上下文:\n" + "\n".join(context_lines)

        prompt = f"""你是一个任务规划专家。请为以下用户意图制定一个详细的执行计划。

用户意图: {intent}
执行模式: {mode}
人设: {persona}{context_block}

要求:
1. 将任务分解为 3-8 个可执行的步骤
2. 每个步骤必须包含: name(步骤名)、task(具体任务描述)、agent(执行者)
3. 步骤之间应有逻辑顺序，后续步骤可依赖前序步骤的结果
4. 如果涉及搜索/检索，使用 researcher 或 web_search_agent
5. 如果涉及写作/创作，使用 drafter 或 generator
6. 如果涉及审核/校验，使用 reviewer 或 validator
7. 如果涉及发布，使用 deliverer 或 publisher

输出 JSON 数组，格式:
[
  {{
    "name": "步骤名称",
    "task": "具体任务描述",
    "agent": "执行者名称",
    "tool": "使用的工具(可选)",
    "mode": "执行模式(可选)",
    "dependencies": []
  }}
]

仅输出 JSON，不要输出其他内容。"""

        result = await self._llm.chat(
            messages=[{"role": "user", "content": prompt}],
            persona=persona,
            task_id="plan_generator",
        )

        return self._parse_steps(result)

    # ── 增量更新 ──

    async def update(
        self,
        existing_plan: list[dict[str, Any]],
        new_message: str,
        completed_steps: list[int],
        conversation_context: list[dict[str, str]],
        persona: str = "default",
    ) -> PlanDelta:
        """根据新消息和对话上下文，增量更新现有计划。

        Args:
            existing_plan: 当前计划的步骤列表
            new_message: 用户新消息
            completed_steps: 已完成步骤的索引列表
            conversation_context: 对话上下文
            persona: 人设名称

        Returns:
            PlanDelta: 增量更新描述
        """
        # 构建当前计划摘要
        steps_summary = []
        for i, step in enumerate(existing_plan):
            status = "completed" if i in completed_steps else step.get("status", "pending")
            steps_summary.append(
                f"  [{i}] {step.get('name', '?')} — {step.get('task', '?')} [{status}]"
            )

        context_lines = []
        for msg in conversation_context[-8:]:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            context_lines.append(f"  [{role}] {content[:200]}")

        prompt = f"""你是一个任务规划专家。现在需要根据用户的新消息，对现有执行计划进行增量更新。

当前计划:
{chr(10).join(steps_summary)}

已完成步骤索引: {completed_steps}

对话上下文:
{chr(10).join(context_lines)}

用户新消息: {new_message}

请分析新消息对现有计划的影响，输出增量更新:

{{
  "reasoning": "分析新消息如何影响计划的推理过程",
  "steps_added": [
    {{
      "name": "新步骤名称",
      "task": "新步骤的具体任务描述",
      "agent": "执行者",
      "tool": "工具(可选)",
      "mode": "模式(可选)",
      "dependencies": [依赖步骤索引]
    }}
  ],
  "steps_modified": {{
    "索引号": {{
      "name": "修改后的名称(可选)",
      "task": "修改后的任务描述(可选)"
    }}
  }},
  "steps_completed": [应标记为完成的步骤索引],
  "steps_removed": [应移除的步骤索引],
  "title_updated": "更新后的计划标题(如无需更新则为null)",
  "description_updated": "更新后的计划描述(如无需更新则为null)"
}}

规则:
1. 如果新消息是追加需求，添加新步骤到 steps_added
2. 如果新消息改变了某个步骤的目标，修改 steps_modified
3. 如果新消息使某些步骤不再需要，放入 steps_removed
4. 如果新消息确认了某些步骤已完成，放入 steps_completed
5. 如果新消息与计划无关（如闲聊），所有数组留空
6. 新步骤的 dependencies 应引用现有步骤的索引
7. 仅输出 JSON，不要输出其他内容"""

        result = await self._llm.chat(
            messages=[{"role": "user", "content": prompt}],
            persona=persona,
            task_id="plan_generator_update",
        )

        return self._parse_delta(result)

    # ── 解析辅助 ──

    def _parse_steps(self, llm_output: str) -> list[PlanStep]:
        """从 LLM 输出解析步骤列表"""
        data = self._extract_json(llm_output)
        if not isinstance(data, list):
            data = [data] if isinstance(data, dict) else []

        steps = []
        for item in data[:10]:  # 最多10步
            if isinstance(item, dict):
                steps.append(PlanStep(
                    name=item.get("name", "未命名步骤"),
                    task=item.get("task", item.get("description", "")),
                    agent=item.get("agent", "executor"),
                    tool=item.get("tool"),
                    mode=item.get("mode"),
                    dependencies=item.get("dependencies", []),
                ))
        return steps

    def _parse_delta(self, llm_output: str) -> PlanDelta:
        """从 LLM 输出解析增量更新"""
        data = self._extract_json(llm_output)
        if not isinstance(data, dict):
            return PlanDelta(reasoning="LLM 输出无法解析，跳过更新")

        steps_added = []
        for item in data.get("steps_added", []):
            if isinstance(item, dict):
                steps_added.append(PlanStep(
                    name=item.get("name", "新步骤"),
                    task=item.get("task", ""),
                    agent=item.get("agent", "executor"),
                    tool=item.get("tool"),
                    mode=item.get("mode"),
                    dependencies=item.get("dependencies", []),
                ))

        steps_modified = {}
        for idx_str, mod in data.get("steps_modified", {}).items():
            try:
                idx = int(idx_str)
                if isinstance(mod, dict):
                    steps_modified[idx] = PlanStep(
                        name=mod.get("name", ""),
                        task=mod.get("task", ""),
                        agent=mod.get("agent", "executor"),
                    )
            except (ValueError, TypeError):
                continue

        return PlanDelta(
            steps_added=steps_added,
            steps_modified=steps_modified,
            steps_completed=data.get("steps_completed", []),
            steps_removed=data.get("steps_removed", []),
            title_updated=data.get("title_updated"),
            description_updated=data.get("description_updated"),
            reasoning=data.get("reasoning", ""),
        )

    @staticmethod
    def _extract_json(text: str) -> Any:
        """从文本中提取 JSON"""
        # 尝试直接解析
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 块
        import re
        match = re.search(r'\{.*\}|\[.*\]', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        return {}
```

### 3.2 HelmDatabase Schema 变更

在现有 `plans` 表基础上增加以下字段：

```sql
-- 新增字段（通过 _migrate 增量添加）

ALTER TABLE plans ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN step_results TEXT;            -- JSON: {step_index: result_summary}
ALTER TABLE plans ADD COLUMN conversation_context TEXT;    -- JSON: 最近N条对话摘要
ALTER TABLE plans ADD COLUMN steps_status TEXT;            -- JSON: {step_index: "pending"|"running"|"completed"|"failed"|"skipped"}
ALTER TABLE plans ADD COLUMN last_updated_at TEXT;         -- 计划最后更新时间
ALTER TABLE plans ADD COLUMN update_reasoning TEXT;        -- 最近一次更新的推理说明
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `plan_version` | INTEGER | 乐观并发控制版本号，每次更新 +1 |
| `step_results` | TEXT (JSON) | 每个步骤的执行结果摘要 `{0: "搜索到5篇相关文章", 1: "草稿已生成"}` |
| `conversation_context` | TEXT (JSON) | 与计划相关的对话上下文片段，供增量更新使用 |
| `steps_status` | TEXT (JSON) | 每个步骤的独立状态，替代 `current_step` 推断 |
| `last_updated_at` | TEXT | 计划内容最后更新时间（区别于 `updated_at`） |
| `update_reasoning` | TEXT | 最近一次增量更新的推理说明 |

**迁移策略**：在 `_migrate()` 中使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 模式（SQLite 无原生 IF NOT EXISTS，需 try/except）。

### 3.3 HelmDatabase 新增方法

```python
class HelmDatabase:
    # ... 现有方法 ...

    def update_plan_incremental(
        self,
        plan_id: int,
        delta: "PlanDelta",
        expected_version: int,
    ) -> Optional[dict[str, Any]]:
        """增量更新计划，使用乐观并发控制。

        Args:
            plan_id: 计划 ID
            delta: 增量更新数据
            expected_version: 期望的当前版本号

        Returns:
            更新后的计划字典，版本冲突返回 None
        """
        plan = self.get_plan(plan_id)
        if plan is None:
            return None
        if plan.get("plan_version", 1) != expected_version:
            logger.warning(f"Plan version conflict: expected={expected_version}, actual={plan.get('plan_version', 1)}")
            return None

        steps: list[dict] = plan["steps_json"]
        steps_status: dict[str, str] = json.loads(plan.get("steps_status") or "{}")

        # 1. 标记完成
        for idx in delta.steps_completed:
            if 0 <= idx < len(steps):
                steps_status[str(idx)] = "completed"

        # 2. 修改现有步骤
        for idx, mod_step in delta.steps_modified.items():
            if 0 <= idx < len(steps):
                if mod_step.name:
                    steps[idx]["name"] = mod_step.name
                if mod_step.task:
                    steps[idx]["task"] = mod_step.task
                if mod_step.agent and mod_step.agent != "executor":
                    steps[idx]["agent"] = mod_step.agent

        # 3. 移除步骤（从后往前删，避免索引偏移）
        for idx in sorted(delta.steps_removed, reverse=True):
            if 0 <= idx < len(steps):
                steps.pop(idx)
                # 重建 steps_status
                new_status = {}
                for k, v in steps_status.items():
                    ki = int(k)
                    if ki < idx:
                        new_status[str(ki)] = v
                    elif ki > idx:
                        new_status[str(ki - 1)] = v
                steps_status = new_status

        # 4. 添加新步骤
        for new_step in delta.steps_added:
            step_dict = new_step.model_dump(exclude_none=True)
            step_dict.pop("status", None)  # status 由 steps_status 管理
            step_dict.pop("result_summary", None)
            new_idx = len(steps)
            steps.append(step_dict)
            steps_status[str(new_idx)] = "pending"

        # 5. 更新标题/描述
        title = delta.title_updated or plan["title"]
        description = delta.description_updated or plan.get("description", "")

        now = datetime.now(timezone.utc).isoformat()
        new_version = expected_version + 1

        self.conn.execute(
            """UPDATE plans SET
                steps_json = ?, steps_status = ?, total_steps = ?,
                title = ?, description = ?,
                plan_version = ?, last_updated_at = ?, update_reasoning = ?
            WHERE id = ? AND plan_version = ?""",
            (
                json.dumps(steps, ensure_ascii=False),
                json.dumps(steps_status, ensure_ascii=False),
                len(steps),
                title, description,
                new_version, now, delta.reasoning,
                plan_id, expected_version,
            ),
        )
        self.conn.commit()

        return self.get_plan(plan_id)

    def update_step_status(
        self,
        plan_id: int,
        step_index: int,
        status: str,
        result_summary: str | None = None,
    ) -> bool:
        """更新单个步骤的状态。"""
        plan = self.get_plan(plan_id)
        if plan is None:
            return False

        steps_status: dict[str, str] = json.loads(plan.get("steps_status") or "{}")
        steps_status[str(step_index)] = status

        sets = ["steps_status = ?"]
        params: list[Any] = [json.dumps(steps_status, ensure_ascii=False)]

        if result_summary is not None:
            step_results: dict[str, str] = json.loads(plan.get("step_results") or "{}")
            step_results[str(step_index)] = result_summary
            sets.append("step_results = ?")
            params.append(json.dumps(step_results, ensure_ascii=False))

        # 如果步骤正在运行，更新计划状态为 executing
        if status == "running" and plan["status"] == "confirmed":
            sets.append("status = ?")
            params.append(self.PLAN_EXECUTING)
            sets.append("started_at = ?")
            params.append(datetime.now(timezone.utc).isoformat())

        # 检查是否所有步骤都已完成
        if status in ("completed", "failed", "skipped"):
            all_done = all(
                steps_status.get(str(i), "pending") in ("completed", "failed", "skipped")
                for i in range(plan["total_steps"])
            )
            if all_done:
                sets.append("status = ?")
                params.append(self.PLAN_COMPLETED)
                sets.append("completed_at = ?")
                params.append(datetime.now(timezone.utc).isoformat())

        params.append(plan_id)
        self.conn.execute(
            f"UPDATE plans SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        self.conn.commit()
        return True

    def append_conversation_context(
        self,
        plan_id: int,
        role: str,
        content: str,
        max_entries: int = 20,
    ) -> None:
        """追加对话上下文到计划记录中。"""
        plan = self.get_plan(plan_id)
        if plan is None:
            return

        ctx: list[dict] = json.loads(plan.get("conversation_context") or "[]")
        ctx.append({"role": role, "content": content[:500]})
        # 保留最近 max_entries 条
        ctx = ctx[-max_entries:]

        self.conn.execute(
            "UPDATE plans SET conversation_context = ? WHERE id = ?",
            (json.dumps(ctx, ensure_ascii=False), plan_id),
        )
        self.conn.commit()
```

### 3.4 新增 API 端点

在 `flowforge/app/api/endpoints/plans.py` 中新增：

#### 3.4.1 `POST /api/v1/tasks/{task_id}/plan/generate`

生成初始计划（替代现有的 `POST /{task_id}/plan`，增加 LLM 真实生成）。

```python
class GeneratePlanRequest(BaseModel):
    intent: str
    persona: Optional[str] = None
    mode: Optional[str] = None
    conversation_context: Optional[list[dict[str, str]]] = None


@router.post("/{task_id}/plan/generate")
async def generate_plan_v2(task_id: str, body: GeneratePlanRequest):
    """使用 LLM 生成初始计划（V2：真实 LLM 生成，非占位步骤）。"""
    db = get_helm_db()

    # 检查是否已有计划
    existing = db.get_plan_by_task(task_id)
    if existing and existing["status"] not in ("rejected", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail=_make_error("PLAN_ALREADY_EXISTS", f"任务 {task_id} 已有活跃计划"),
        )

    # 调用 PlanGenerator
    from flowforge.brain.plan_generator import PlanGenerator
    from flowforge.tools.llm_client import LLMClient

    llm = LLMClient()
    generator = PlanGenerator(llm)

    try:
        steps = await generator.generate(
            intent=body.intent,
            persona=body.persona or "default",
            mode=body.mode or "pipeline",
            conversation_context=body.conversation_context,
        )
    except Exception as e:
        logger.error(f"Plan generation failed: {e}")
        # 降级：使用占位步骤
        steps = [PlanStep(name="执行意图", task=body.intent, agent="executor")]

    steps_dicts = [s.model_dump(exclude_none=True) for s in steps]
    # 移除 status 字段（由 steps_status 管理）
    for s in steps_dicts:
        s.pop("status", None)
        s.pop("result_summary", None)

    steps_status = {str(i): "pending" for i in range(len(steps_dicts))}

    plan_id = db.create_plan(
        task_id=task_id,
        title=body.intent,
        steps=steps_dicts,
        description=f"基于意图「{body.intent}」生成的计划",
        persona=body.persona,
        mode=body.mode,
    )

    # 写入 steps_status
    db.conn.execute(
        "UPDATE plans SET steps_status = ?, plan_version = 1 WHERE id = ?",
        (json.dumps(steps_status, ensure_ascii=False), plan_id),
    )
    db.conn.commit()

    plan = db.get_plan(plan_id)
    logger.info("计划已生成: task_id=%s, plan_id=%s, steps=%d", task_id, plan_id, len(steps))

    return _make_response(plan)
```

#### 3.4.2 `POST /api/v1/tasks/{task_id}/plan/update`

根据新消息增量更新计划。

```python
class UpdatePlanRequest(BaseModel):
    new_message: str
    persona: Optional[str] = None


@router.post("/{task_id}/plan/update")
async def update_plan(task_id: str, body: UpdatePlanRequest):
    """根据新消息增量更新计划。"""
    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"任务 {task_id} 暂无计划"),
        )

    if plan["status"] not in ("pending", "confirmed", "executing"):
        raise HTTPException(
            status_code=400,
            detail=_make_error("PLAN_NOT_UPDATABLE", f"计划状态 {plan['status']} 不允许更新"),
        )

    # 获取已完成步骤
    steps_status: dict = json.loads(plan.get("steps_status") or "{}")
    completed_indices = [
        int(k) for k, v in steps_status.items() if v == "completed"
    ]

    # 获取对话上下文
    conversation_context: list[dict] = json.loads(
        plan.get("conversation_context") or "[]"
    )
    # 追加新消息到上下文
    conversation_context.append({"role": "user", "content": body.new_message})

    # 调用 PlanGenerator.update
    from flowforge.brain.plan_generator import PlanGenerator
    from flowforge.tools.llm_client import LLMClient

    llm = LLMClient()
    generator = PlanGenerator(llm)

    try:
        delta = await generator.update(
            existing_plan=plan["steps_json"],
            new_message=body.new_message,
            completed_steps=completed_indices,
            conversation_context=conversation_context,
            persona=body.persona or plan.get("persona", "default"),
        )
    except Exception as e:
        logger.error(f"Plan update failed: {e}")
        delta = PlanDelta(reasoning=f"更新失败: {e}")

    # 增量写入
    current_version = plan.get("plan_version", 1)
    updated_plan = db.update_plan_incremental(
        plan_id=plan["id"],
        delta=delta,
        expected_version=current_version,
    )

    if updated_plan is None:
        raise HTTPException(
            status_code=409,
            detail=_make_error("VERSION_CONFLICT", "计划版本冲突，请重试"),
        )

    # 追加对话上下文
    db.append_conversation_context(plan["id"], "user", body.new_message)

    return _make_response({
        "plan": updated_plan,
        "delta": delta.model_dump(),
    })
```

#### 3.4.3 `PATCH /api/v1/tasks/{task_id}/plan/steps/{step_index}/status`

更新单个步骤的状态。

```python
class UpdateStepStatusRequest(BaseModel):
    status: str  # pending | running | completed | failed | skipped
    result_summary: Optional[str] = None


@router.patch("/{task_id}/plan/steps/{step_index}/status")
async def update_step_status(task_id: str, step_index: int, body: UpdateStepStatusRequest):
    """更新步骤状态。"""
    if body.status not in ("pending", "running", "completed", "failed", "skipped"):
        raise HTTPException(
            status_code=400,
            detail=_make_error("INVALID_STATUS", f"无效状态: {body.status}"),
        )

    db = get_helm_db()
    plan = db.get_plan_by_task(task_id)

    if plan is None:
        raise HTTPException(
            status_code=404,
            detail=_make_error("PLAN_NOT_FOUND", f"任务 {task_id} 暂无计划"),
        )

    if step_index < 0 or step_index >= plan["total_steps"]:
        raise HTTPException(
            status_code=400,
            detail=_make_error("STEP_INDEX_OUT_OF_RANGE", f"步骤索引 {step_index} 超出范围"),
        )

    success = db.update_step_status(
        plan_id=plan["id"],
        step_index=step_index,
        status=body.status,
        result_summary=body.result_summary,
    )

    if not success:
        raise HTTPException(
            status_code=500,
            detail=_make_error("UPDATE_FAILED", "步骤状态更新失败"),
        )

    plan = db.get_plan(plan["id"])
    return _make_response(plan)
```

### 3.5 执行引擎集成

在 `PlanExecuteExecutor` 和 `HelmAdapter` 中，步骤开始/完成时自动更新步骤状态：

```python
# 在 PlanExecuteExecutor._execute_core 中
# 步骤开始时:
db.update_step_status(plan_id, step_index, "running")

# 步骤完成时:
db.update_step_status(plan_id, step_index, "completed", result_summary=result_preview)

# 步骤失败时:
db.update_step_status(plan_id, step_index, "failed", result_summary=error_message)
```

通过 EventBus 广播步骤状态变更事件：

```python
# 新增事件类型
PLAN_STEP_STATUS_CHANGED = "plan.step.status_changed"
PLAN_UPDATED = "plan.updated"
```

---

## 4. 前端设计

### 4.1 自动计划更新流程

在 `HelmLayout.tsx` 的 `handleChatSubmit` 中集成自动计划更新：

```typescript
const handleChatSubmit = useCallback(
  async (text: string, persona?: string, model?: string) => {
    // ... 现有消息发送逻辑 ...

    // 自动触发计划更新（如果存在活跃计划）
    if (currentPlan && currentPlan.status !== "rejected" && currentPlan.status !== "cancelled") {
      triggerPlanUpdate(text, persona);
    }
  },
  [helm, currentPlan, selectedModel]
);

const triggerPlanUpdate = useCallback(
  async (newMessage: string, persona?: string) => {
    if (!helm.taskId) return;
    setPlanLoading(true);

    try {
      const r = await fetch(`/api/v1/tasks/${helm.taskId}/plan/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_message: newMessage, persona }),
      });

      if (r.ok) {
        const data = await r.json();
        if (data?.data?.plan) {
          setCurrentPlan(data.data.plan);
          // 如果有增量变更，显示更新提示
          if (data.data.delta) {
            showPlanUpdateNotification(data.data.delta);
          }
        }
      }
    } catch (err) {
      console.error("Plan update failed:", err);
    } finally {
      setPlanLoading(false);
    }
  },
  [helm.taskId]
);
```

### 4.2 WebSocket 事件监听

在 `useHelmWebSocket` hook 中监听计划相关事件：

```typescript
// 在 WebSocket 消息处理中新增
if (entry.type === "system" && entry.data?.plan_step_status) {
  // 步骤状态变更
  const { step_index, status, result_summary } = entry.data.plan_step_status;
  setCurrentPlan((prev) => {
    if (!prev) return prev;
    const newStepsStatus = { ...prev.stepsStatus, [step_index]: status };
    const newStepResults = result_summary
      ? { ...prev.stepResults, [step_index]: result_summary }
      : prev.stepResults;
    return { ...prev, stepsStatus: newStepsStatus, stepResults: newStepResults };
  });
}

if (entry.type === "system" && entry.data?._plan) {
  // 整体计划更新
  setCurrentPlan(entry.data._plan);
  setPlanLoading(false);
}
```

### 4.3 Plan 类型扩展

更新 `PlanPanel.tsx` 中的类型定义：

```typescript
export interface PlanStep {
  name: string;
  task: string;
  agent: string;
  tool?: string;
  mode?: string;
  editable: boolean;
  dependencies?: number[];
}

export interface Plan {
  id: string;
  task_id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: "pending" | "confirmed" | "executing" | "completed" | "rejected" | "cancelled";
  current_step: number;
  total_steps: number;
  edited_steps: string[];
  results: Record<string, any>;
  // ── 新增字段 ──
  plan_version: number;
  stepsStatus: Record<string, "pending" | "running" | "completed" | "failed" | "skipped">;
  stepResults: Record<string, string>;
  lastUpdatedAt?: string;
  updateReasoning?: string;
}

// ── 新增：增量更新通知 ──
export interface PlanDelta {
  steps_added: PlanStep[];
  steps_modified: Record<number, Partial<PlanStep>>;
  steps_completed: number[];
  steps_removed: number[];
  title_updated: string | null;
  description_updated: string | null;
  reasoning: string;
}
```

### 4.4 PlanPanel 增强

#### 4.4.1 步骤状态基于 `stepsStatus` 字段

替换现有的 `getStepStatus` 推断逻辑：

```typescript
// 旧逻辑（基于 current_step 推断）
function getStepStatus(plan: Plan, stepIndex: number): StepStatus {
  if (plan.status === "completed") return "completed";
  if (stepIndex < plan.current_step) return "completed";
  if (stepIndex === plan.current_step && plan.status === "executing") return "running";
  return "pending";
}

// 新逻辑（基于 stepsStatus 字段）
function getStepStatus(plan: Plan, stepIndex: number): StepStatus {
  const status = plan.stepsStatus?.[String(stepIndex)];
  if (status) return status as StepStatus;
  // 降级：兼容旧数据
  if (plan.status === "completed") return "completed";
  if (stepIndex < plan.current_step) return "completed";
  if (stepIndex === plan.current_step && plan.status === "executing") return "running";
  return "pending";
}
```

#### 4.4.2 新增步骤高亮动画

```typescript
// 新增 keyframes
@keyframes plan-highlight-new {
  0% { background: rgba(137, 180, 250, 0.2); transform: scale(1.02); }
  100% { background: transparent; transform: scale(1); }
}

// 在 StepCard 中添加 isNew 属性
function StepCard({ step, stepIndex, status, isEditable, isNew, onEdit, onDelete }) {
  return (
    <div style={{
      // ... 现有样式 ...
      animation: isNew ? "plan-highlight-new 1.5s ease-out" : "plan-fadeIn 0.2s ease-out",
    }}>
      {/* ... 现有内容 ... */}
      {isNew && (
        <span style={{
          position: "absolute", top: -6, right: -6,
          padding: "1px 6px", borderRadius: 999,
          fontSize: 10, fontWeight: 700,
          background: "var(--accent, #89b4fa)",
          color: "#1e1e2e",
        }}>
          NEW
        </span>
      )}
    </div>
  );
}
```

#### 4.4.3 步骤执行结果展示

```typescript
// 在 StepCard 中展示步骤结果
function StepResultBadge({ result, status }: { result?: string; status: StepStatus }) {
  if (!result || status === "pending") return null;
  return (
    <div style={{
      marginTop: 6, padding: "4px 8px",
      borderRadius: 4, fontSize: 11,
      background: status === "completed" ? "rgba(166,227,161,0.08)" : "rgba(243,139,168,0.08)",
      color: status === "completed" ? "#a6e3a1" : "#f38ba8",
      lineHeight: 1.4,
    }}>
      {result}
    </div>
  );
}
```

#### 4.4.4 计划更新通知

```typescript
function PlanUpdateNotification({ delta, onDismiss }: { delta: PlanDelta; onDismiss: () => void }) {
  const hasChanges = delta.steps_added.length > 0
    || Object.keys(delta.steps_modified).length > 0
    || delta.steps_completed.length > 0
    || delta.steps_removed.length > 0;

  if (!hasChanges) return null;

  return (
    <div style={{
      padding: "8px 12px", marginBottom: 8,
      borderRadius: 8, border: "1px solid var(--accent, #89b4fa)",
      background: "rgba(137,180,250,0.08)",
      animation: "plan-fadeIn 0.3s ease-out",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--accent, #89b4fa)", fontWeight: 600 }}>
          计划已更新
        </span>
        <button onClick={onDismiss} style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
          ✕
        </button>
      </div>
      {delta.reasoning && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
          {delta.reasoning}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        {delta.steps_added.length > 0 && (
          <span style={{ fontSize: 11, color: "#a6e3a1" }}>
            +{delta.steps_added.length} 新步骤
          </span>
        )}
        {delta.steps_completed.length > 0 && (
          <span style={{ fontSize: 11, color: "#89b4fa" }}>
            {delta.steps_completed.length} 步骤完成
          </span>
        )}
        {delta.steps_removed.length > 0 && (
          <span style={{ fontSize: 11, color: "#f38ba8" }}>
            -{delta.steps_removed.length} 步骤移除
          </span>
        )}
      </div>
    </div>
  );
}
```

### 4.5 滚动位置保持

在 PlanPanel 更新时保持用户滚动位置：

```typescript
// 在 PlanPanel 中
const scrollRef = useRef<HTMLDivElement>(null);
const [scrollTop, setScrollTop] = useState(0);

// 更新前保存滚动位置
useEffect(() => {
  const el = scrollRef.current;
  if (el) {
    setScrollTop(el.scrollTop);
  }
}, [plan?.plan_version]);  // plan_version 变化时触发

// 更新后恢复滚动位置
useEffect(() => {
  const el = scrollRef.current;
  if (el && scrollTop > 0) {
    el.scrollTop = scrollTop;
  }
}, [plan, scrollTop]);
```

---

## 5. 数据流时序图

### 5.1 初始计划生成

```
用户输入意图 → ChatInput.onSubmit
                    │
                    ▼
         handleChatSubmit(text)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  helm.createTask  POST /plan/generate  (并行)
        │           │
        ▼           ▼
  WebSocket 连接   PlanGenerator.generate()
        │           │
        │           ▼
        │      LLM 生成步骤
        │           │
        │           ▼
        │      HelmDB.create_plan
        │           │
        │           ▼
        │      EventBus: plan.updated
        │           │
        └─────┬─────┘
              ▼
     setCurrentPlan(plan)
              │
              ▼
     PlanPanel 渲染 (pending 状态)
              │
              ▼
     用户确认 → POST /plan/confirm
              │
              ▼
     开始执行 → 步骤状态依次变为 running → completed
```

### 5.2 增量计划更新

```
用户追加消息 → ChatInput.onSubmit
                    │
                    ▼
         handleChatSubmit(text)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  WebSocket 发送   POST /plan/update  (并行)
  (继续对话)       │
        │          ▼
        │     PlanGenerator.update()
        │          │
        │          ▼
        │     LLM 分析增量
        │          │
        │          ▼
        │     HelmDB.update_plan_incremental
        │     (plan_version + 1)
        │          │
        │          ▼
        │     EventBus: plan.updated
        │          │
        └────┬─────┘
             ▼
    setCurrentPlan(updatedPlan)
             │
             ▼
    PlanPanel 渲染 (新增步骤高亮)
```

---

## 6. 配置与开关

在 `config/default.yaml` 中新增动态计划配置：

```yaml
plan:
  # 是否启用自动计划更新
  auto_update: true

  # 触发更新的最小消息间隔（秒），防止频繁调用 LLM
  update_debounce_seconds: 3

  # 最大步骤数
  max_steps: 10

  # 对话上下文保留条数
  context_window: 20

  # 增量更新使用的模型（可使用更轻量的模型节省成本）
  update_model: "auto"

  # 是否在计划更新时显示通知
  show_update_notification: true

  # 新步骤高亮持续时间（毫秒）
  highlight_duration_ms: 1500
```

---

## 7. 兼容性策略

### 7.1 数据库向后兼容

- 新增字段均有默认值，旧数据自动迁移
- `steps_status` 为空时，降级使用 `current_step` 推断
- `plan_version` 默认为 1，旧计划自动获得

### 7.2 API 向后兼容

- 现有 `POST /{task_id}/plan` 保持不变（生成占位步骤）
- 新增 `POST /{task_id}/plan/generate` 使用 LLM 真实生成
- 前端逐步迁移到新 API

### 7.3 前端渐进增强

- `PlanPanel` 优先使用 `stepsStatus` 字段
- 如果 `stepsStatus` 不存在，降级到 `current_step` 推断
- 新增功能（高亮、通知）通过配置开关控制

---

## 8. 性能考量

| 关注点 | 策略 |
|--------|------|
| LLM 调用延迟 | 计划更新与任务执行并行，不阻塞主流程 |
| 频繁更新 | 前端 debounce 3秒，后端乐观并发控制 |
| 大计划渲染 | 超过 10 步时折叠已完成步骤 |
| WebSocket 压力 | 步骤状态变更合并为单次推送 |

---

## 9. 实施路线

| 阶段 | 内容 | 预计工期 |
|------|------|----------|
| Phase 1 | HelmDB schema 迁移 + PlanGenerator 基础实现 | 2 天 |
| Phase 2 | API 端点实现 + 单元测试 | 2 天 |
| Phase 3 | 前端 PlanPanel 增强 + 自动更新流程 | 3 天 |
| Phase 4 | 执行引擎集成 + E2E 测试 | 2 天 |
| Phase 5 | 配置开关 + 性能优化 + 文档 | 1 天 |

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| LLM 生成格式不稳定 | 中 | 高 | 多层 JSON 解析 + 降级策略 |
| 增量更新导致计划膨胀 | 低 | 中 | max_steps 限制 + 自动合并 |
| 版本冲突频繁 | 低 | 低 | 前端自动重试 + 用户提示 |
| 计划更新延迟影响体验 | 中 | 中 | 异步更新 + loading 状态提示 |

"""PlanGenerator — 基于 LLM 的动态计划生成与增量更新引擎"""

from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel

from flowforge.core.base_tool import ToolInput
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

        result_text = await self._call_llm(prompt, persona, "plan_generator")
        return self._parse_steps(result_text)

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

        result_text = await self._call_llm(prompt, persona, "plan_generator_update")
        return self._parse_delta(result_text)

    # ── LLM 调用封装 ──

    async def _call_llm(self, prompt: str, persona: str, task_id: str) -> str:
        """调用 LLMClient 并返回文本结果。"""
        tool_input = ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "persona": persona,
            "task_id": task_id,
        })
        output = await self._llm.execute(tool_input)
        if output.error:
            logger.warning(f"LLM call failed: {output.error}")
            return ""
        content = output.result.get("content", "")
        if isinstance(content, str):
            return content
        return str(content)

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

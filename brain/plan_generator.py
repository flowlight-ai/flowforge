"""PlanGenerator — 基于 LLM 的动态计划生成与增量更新引擎"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel

from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger
from flowforge.tools.llm_client import LLMClient

logger = get_logger("flowforge.plan_generator")


# ── 数据模型 ──

class PlanStep(BaseModel):
    """单个步骤"""
    name: str
    task: str
    agent: str = "executor"
    tool: str | None = None
    mode: str | None = None
    status: str = "pending"          # pending | running | completed | failed | skipped
    result_summary: str | None = None
    dependencies: list[int] = []     # 依赖步骤的索引


class PlanDelta(BaseModel):
    """计划增量更新结果"""
    steps_added: list[PlanStep] = []
    steps_modified: dict[int, PlanStep] = {}   # index → updated step
    steps_completed: list[int] = []            # 标记为完成的步骤索引
    steps_removed: list[int] = []              # 移除的步骤索引
    title_updated: str | None = None
    description_updated: str | None = None
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
            context_block = "\n对话上下文:\n" + "\n".join(context_lines)

        prompt = get_prompt("brain.plan_generator.initial_plan",
                            intent=intent, mode=mode, persona=persona,
                            context_block=context_block)

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

        prompt = get_prompt("brain.plan_generator.incremental_update",
                            steps_summary="\n".join(steps_summary),
                            completed_steps=str(completed_steps),
                            context_lines="\n".join(context_lines),
                            new_message=new_message)

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

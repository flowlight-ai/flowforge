# 自主任务产出审阅

- **task_id**: swarm-881c72ab7ad6
- **title**: 修复代码 TODO: flowforge\core\external_agent\adapters\codex.py
- **agent**: forgemind:sherlock
- **model**: Doubao-Seed2.0
- **generated_at**: 2026-07-31T21:05:38.195690+00:00
- **source_file**: flowforge\core\external_agent\adapters\codex.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\core\external_agent\adapters\codex.py 中发现 2 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

EX-001/EX-002/EX-003 - [doc:decisions/006-external-agent-integration.md] §4 首批接入 铁律遵守： - 铁律 5：禁止硬编码密钥（OPENAI_API_KEY 通过 HostInjector 注入） - 所有 I/O 操作使用 async/await License: MIT """ from future import annotations from typing import Any, AsyncIterator, Optional from flowforge.core.external_agent.adapter import (ExternalAgentAdapter, ExternalAgentResult,) from flowforge.core.external_agent.host_injection import SandboxConfig from flowforge.core.external_agent.manifest import AgentProviderManifest from flowforge.core.tracing import get_logger logger = get_logger ("external_agent.adapter.codex") class CodexAdapter (ExternalAgentAdapter): """Codex Adapter（API + function calling 协议）。 能力画像（EX-002）： - 擅长：推理、数学、逻辑分析、结构化输出 - 盲点：工具调用弱、长上下文处理一般 详见 [doc:review/review.md# 第九章 §9.2] EX-001~EX-010""" CAPABILITY_PROFILE: dict [str, Any] = { "provider_name": "openai.codex", "display_name": "Codex", "capabilities": [ "reasoning", "math_computation", "logic_analysis", "structured_output", "code_generation", ], "blind_spots": [ "工具调用弱", "长上下文处理一般", "对中文场景适配较弱", ], "strengths": [ "数学推理和形式化证明", "结构化输出（JSON / 表格）", "逻辑分析与决策树构建", ], "best_practices": [ "推理任务：作为 claude code 的跨厂商 reviewer", "结构化输出：用于生成 schema 严格的数据", ], "anti_patterns": [ "依赖工具调用的复杂任务（应优先用 claude code）", "超长上下文场景（易丢失关键信息）", ], } async def invoke ( self, task: str, context: dict [str, Any], sandbox: Optional [SandboxConfig] = None, ) -> ExternalAgentResult: """调用 Codex 完成任务。 实现要点（厂商参考）： 1. 通过 self.prepare_credentials () 获取 OPENAI_API_KEY 2. 通过 HTTP POST 调用 OpenAI API 3. 使用 function calling 增强工具调用能力""" logger.info("codex.invoke task_len=% d sandbox=% s", len (task), sandbox is not None, ) try: env_vars = self.prepare_credentials () except ValueError as e: return ExternalAgentResult ( provider_name=self.provider_name, success=False, error=str (e), ) # TODO: 厂商实现 —— 调用真实 OpenAI API logger.warning ( "codex.invoke NOT_IMPLEMENTED provider=% s 厂商需替换为真实 API 调用", self.provider_name, ) return ExternalAgentResult ( provider_name=self.provider_name, success=False, output=None, error=( "CodexAdapter.invoke 尚未实现真实 API 调用 ——" "厂商应参照 reference_runtime.py 实现" ), cost={"total_tokens": 0, "total_calls": 0, "total_cost": 0.0}, capability_contribution=self.get_capability_profile (), ) async def stream ( self, task: str, context: dict [str, Any], sandbox: Optional [SandboxConfig] = None, ) -> AsyncIterator [str]: """流式调用 Codex（EX-009 流式语义）。""" logger.info("codex.stream task_len=% d sandbox=% s", len (task), sandbox is not None, ) # TODO: 厂商实现 —— 通过 SSE 流式读取 OpenAI API 响应 logger.warning ( "codex.stream NOT_IMPLEMENTED provider=% s", self.provider_name ) yield "[codex] stream 尚未实现 —— 厂商应替换为真实 API 流式调用 \n" def get_capability_profile (self) -> dict [str, Any]: """返回 Codex 能力画像（EX-002）。""" return { "provider_name": self.manifest.provider_name, "display_name": self.manifest.display_name, "capabilities": list (self.manifest.capabilities) or list (self.CAPABILITY_PROFILE ["capabilities"]), "blind_spots": list (self.manifest.blind_spots) or list (self.CAPABILITY_PROFILE ["blind_spots"]), "strengths": list (self.CAPABILITY_PROFILE ["strengths"]), "best_practices": list (self.CAPABILITY_PROFILE ["best_practices"]), "anti_patterns": list (self.CAPABILITY_PROFILE ["anti_patterns"]), } --- 文件结束 --- 请在上述真实代码基础上，修复其中的 TODO/FIXME/NotImplementedError，输出完整的修改后文件内容。禁止生成假设性或示例性代码。 【重要】以上是项目真实文件内容，请基于实际代码和项目结构生成具体的、可执行的成果。禁止生成假设性代码或示例代码 —— 必须针对真实文件进行修改或补充。产出格式： - 文档任务：直接输出 Markdown 文档内容 - 代码任务：输出完整的修改后代码（带文件路径标注） - 测试任务：输出完整的测试代码（带文件路径标注）
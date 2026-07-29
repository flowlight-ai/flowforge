"""FlowForge — self-evolving agent harness with universal forgekin application layer.

FlowForge 是一个通用 Agent Harness 框架，提供：
- 自进化引擎（三模式：Scope Guard / Process Evolution / Knowledge Evolution）
- Loop 执行层（Discover → Assign → Act → Verify → Persist 五步闭环）
- LLM 客户端（错误分类 + 指数退避 + 跨厂商 fallback）
- forgemind 应用层（Forgekin + 第三方 Agent 接入）

边界铁律：flowforge 不感知 *forge / content / opensieve / openroute 的存在，
通过 Plugin V3 协议接受上层注册。
"""

from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["__version__"]

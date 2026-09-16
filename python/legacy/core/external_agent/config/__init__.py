"""External Agent 配置目录。

按铁律 5（配置驱动）所有配置外置到 YAML：
    - manifests/*.yaml: 四个三方 Agent 的声明式 Manifest
    - adapters.yaml: Adapter 注册映射
    - prompts.yaml: 提示词外置（铁律 5+P16）
    - fallback.yaml: fallback 链配置
    - tool_allowlist.yaml: 工具白名单配置

详见:
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层
    - 铁律 5：禁止硬编码
    - P16：提示词外置验证
"""

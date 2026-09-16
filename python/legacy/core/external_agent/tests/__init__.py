"""External Agent tests — 测试包。

测试铁律遵守（project_rules.md T1-T8）：
    - T1: 禁止使用 Mock LLM —— 测试中真实调用三方 Agent（如可访问）
    - T2: 禁止使用假数据 —— 测试输入必须是真实场景数据
    - T3: 禁止跳过验证 —— 必须有具体断言
    - T7: LLM 内容必须经 LLM 审核

注意：test_bridge.py 当前为骨架，包含结构化测试用例，
但实际三方 Agent 调用需配置真实 API key 后才能运行（铁律 T1）。

License: MIT
"""

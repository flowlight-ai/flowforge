"""forgemind 应用层测试包。

包含:
    - ``test_base.py`` — ForgekinBase 单元测试骨架

测试铁律（详见 [doc:project_rules.md#测试铁律 T1-T8]）:
    - T1: 禁止使用 Mock LLM
    - T2: 禁止使用假数据
    - T3: 禁止跳过验证
    - T4: 禁止 Mock 工具
    - T5: 未实现即 Bug
    - T6: 必须采集指标
    - T7: LLM 内容必须经 LLM 审核
    - T8: Web 功能必须操控浏览器验证 DOM

注: 本测试包为骨架，仅覆盖 :class:`ForgekinBase` 及其依赖的纯逻辑层
（枚举 / SoulImprint哈希 / 能力判定）。涉及真实 LLM / EchoStore / Eval 的
E2E 测试在 Phase 1+ 接入真实实现后补全（遵守 T1/T4 铁律，禁止 Mock）。
"""

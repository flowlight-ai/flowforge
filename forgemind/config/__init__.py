"""forgemind 配置包 — Forge Nurturing锻造流水线的 YAML 配置加载入口。

配置驱动 > 代码实现（铁律5+P16）：所有提示词、流水线参数、价值锚点
默认清单均外置到此包下的 YAML 文件，禁止在 .py 文件中硬编码。

包含文件:
    - ``forging.yaml`` — Forge Nurturing锻造流水线配置（6 阶段参数 + ForgekinSpecies工厂映射）
    - ``prompts.yaml`` — 锻造提示词外置（6 阶段提示词模板）

详见:
    - [doc:design/naming-contract.md#2.4] Forge Nurturing定义
    - [doc:review/review.md#第九章] FM-006 锻造流水线
    - [doc:project_rules.md#红线11] 禁止硬编码
"""

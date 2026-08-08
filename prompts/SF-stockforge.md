# StockForge 模板（SF1-SF5）

> **本文件内容**：StockForge（AI 股票分析工厂）专用提示词模板
> **适用项目**：StockForge（基于 FlowForge 的 AI 股票基金自动化分析与投资决策辅助系统）
> **端口**：后端 8005 / 前端 5179
> **关键目录**：stockforge/

---

## SF1 全周期预测分析验证

```
请验证StockForge的全周期预测分析流程：
1. 输入股票列表（如601127|赛力斯、000998|隆平高科），验证是否按工作流调用多个agent
2. 验证数据采集→指标计算→趋势预测→买卖信号→报告生成的完整流程
3. 验证报告是否包含6大章节：大盘环境分析/个股操作分析/ETF操作分析/操作总策略/综合对比表/技术指标信号表
4. 验证技术指标是否真实计算（KDJ/RSI/WR/MACD/均线/成交量/K线形态/筹码分布/神奇九转）
5. 验证买卖信号是否用❌/✅标记
6. 验证是否包含止损位、风险等级、仓位建议
7. 验证数据来源是否三源容错（Tushare→AkShare→BaoStock）
8. 验证是否禁止虚构数据（查不到数据显示"暂无"）
```

---

## SF2 数据采集与更新验证

```
请验证StockForge的数据采集能力：
1. 验证A股历史数据爬取（20年时间可配）
2. 验证基金数据爬取
3. 验证每日收盘后自动数据更新（16:00触发）
4. 验证三源容错降级机制（Tushare失败→AkShare→BaoStock）
5. 验证增量更新vs全量更新策略
6. 验证数据缓存（SQLite元数据+Parquet文件存储，pyarrow未安装时回退CSV）
7. 验证三源容错降级机制是否通过OpenSieve DataSource协议统一管理（所有数据检索走OpenSieve）
```

---

## SF3 选股与预测验证

```
请验证StockForge的选股和预测能力：
1. 验证多因子选股策略（技术+基本面+AI信号）
2. 验证多空辩论机制（Bull vs Bear vs 裁判）
3. 验证预测周期（明日/下周/下月）
4. 验证LLM综合判断（技术指标+LLM预测，非LSTM/XGBoost）
5. 验证预测置信度评估
6. 验证风险评估（仓位建议/止损位/风险等级）
7. 验证质量分阈值是否为0.85
8. 验证5个WebChat评委是否并行评审
```

---

## SF4 OpenSieve专业数据扩展验证

```
请验证OpenSieve是否正确支持专业数据爬取：
1. 验证股票数据适配器是否独立于通用内容检索
2. 验证电商数据适配器扩展点
3. 验证专业数据与通用数据的目录结构区分
4. 验证数据源配置是否通过YAML管理
5. 验证向前兼容（原有检索接口不受影响）
```

---

## SF5 审核修订v2.0合规验证

```
请验证StockForge是否已按审核修订v2.0更新：
1. 产品定位是否为"分析与投资决策辅助系统"（禁止"量化交易"四字）
2. Agent数量是否统一为6个核心Agent（technical_indicator/prediction/screening/bull_bear_debate/risk/report）
3. 是否删除了独立repositories/database.py/data_sync.py
4. 是否删除了LSTM/XGBoost/Transformer空实现，改为技术指标+LLM预测
5. Loop worker.mode是否统一为loop（禁止workflow/reflexion）
6. 变量引用是否统一双大括号${{state.xxx}}
7. Plugin钩子是否正确：Loop配置通过register_loops注册，Workflow配置通过register_workflows注册（StockForge应使用register_loops，禁止register_workflows误用）
8. Loop超时是否为180s（3分钟）
9. 是否有flowforge.build()调用（禁止）
10. 是否有test.md（T1-T9自检表）
11. 报告生成是否有LLM二次审核（FeedbackLoop.evaluate）
12. 是否有MetricsCollector集成
13. 所有数据检索是否走OpenSieve（结构化数据通过DataSource协议，非结构化检索通过SearchSource协议）
14. 质量分阈值是否为0.85
15. 是否有实盘交易隔离技术保障（CI静态检查+ArchConstraintEngine）
```

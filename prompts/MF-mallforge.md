# MallForge 模板（MF1-MF8）

> **本文件内容**：MallForge（AI 电商运营工厂）专用提示词模板
> **适用项目**：MallForge
> **端口**：8004/5178
> **关键目录**：mallforge/

---

## 6.1 六大核心Agent

### MF1 电商场景验证

```
请验证MallForge的电商全链路：智能客服→商品文案→竞品分析→供应链管理→收入归集。
确保电商场景的智能化流程正常工作。
```

### MF2 选品Agent验证

```
请验证MallForge的ProductScoutAgent：
1. 监控TikTok/Amazon/Shopee热榜
2. 搜索1688同款批发价
3. 计算利润率（汇率/佣金/物流/包装）
4. Harness约束过滤：重量<2kg、体积<0.05m3、毛利率>=30%、货源评分>=4.5
5. 排除侵权/季节性/危险品
6. 验证rewoo模式执行流程
```

### MF3 上架Agent验证

```
请验证MallForge的ListingGeneratorAgent：
1. 生成多语言SEO标题（>=3个关键词）
2. 五点描述
3. A+内容
4. 图片要求规范（白底>=1000px）
5. 支持10+语言翻译
6. 市场差异化适配
7. 禁止绝对化用语
8. 验证plan_execute模式执行流程
```

### MF4 广告Agent验证

```
请验证MallForge的AdOptimizerAgent：
1. 小预算测品（$10/天/品）
2. 数据监控与自动调整
3. 死品管理：7天无出单暂停、ACOS>30%降出价、CTR<0.5%换主图
4. Reflexion反馈循环
5. 验证3种action（start_test/daily_optimization/check_results）
```

### MF5 供应链与客服Agent验证

```
请验证MallForge的SupplyChainAgent和SupportAgent：
供应链Agent：
1. 订单-采购-发货自动化
2. 库存管理：安全库存10件
3. 价格监控：涨价>5%暂停下单
4. 大额采购>5000元人工审批
客服Agent：
1. 自动翻译回复
2. 物流查询
3. 退款处理：退款>30%人工审核
4. 差评告警：差评关键词自动拦截
5. 意图分类：logistics/refund/review_alert/general
```

---

## 6.2 三条Workflow

### MF6 三条自动化Workflow验证

```
请验证MallForge的三条自动化Workflow：
1. 新品孵化(product_incubation) — 每周一8:00：product_scout→profit_filter→listing_generator→ad_optimizer→人工审核
2. 核心品维护(core_maintenance) — 每天6:00：supply_chain→replenish→ad_optimizer→report_generator→人工审核
3. 客服响应(customer_service) — Webhook即时触发：support_agent→自动回复或人工升级→条件触发人工审核
每条Workflow用真实业务场景端到端验证。
```

---

## 6.3 工具降级与MCP

### MF7 工具三级降级验证

```
请验证MallForge的工具三级降级策略：
1. 优先使用web_search获取真实数据
2. 降级使用LLM生成合理数据
3. 最终降级返回空结果并标注data_source
对platform_scraper、wholesale_search、logistics_tracker三个工具逐一验证降级链路。
```

### MF8 MCP集成规划验证

```
请验证MallForge的MCP集成规划，检查10个MCP Server的设计：
P0：tiktok-scraper、amazon-scraper、1688-mcp
P1：shopee-scraper、translator-mcp、ad-platform-mcp、logistics-mcp、platform-messaging-mcp
P2：image-editor-mcp、google-sheets-mcp
对已实现的MCP Server用真实API验证，对未实现的给出实施优先级和方案。
```

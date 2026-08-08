# OpenRoute 模板（OR1-OR9，OR3 缺失）

> **本文件内容**：OpenRoute（多模型 API 网关）专用提示词模板
> **适用项目**：OpenRoute
> **端口**：13001
> **关键目录**：hiclaw/tool/openroute/
> **说明**：原 prompts.md 中 OR3 编号缺失（保留此空缺以与原文档一致）

---

## 7.1 服务启动与验证

### OR1 服务启动与验证

```
帮我启动openroute服务，并运行一次多LLM交叉和并发的实际调用测试，验证是否有问题。
检查logs目录下刚才的交叉和并发调用日志，确认是否有模型回退或限流的记录。
```

### OR2 API健康检查

```
openroute模块强制更新和自动更新模型做了优化，目前openroute模块暴露的模型只有第一层模型，请帮忙验证和检查hiclaw/tool/openroute/config/model_routes.yaml和api_providers.yaml中的model配置是否已同步更新。
针对openroute的认证和端口问题，帮我补充一个针对LLMClient的健康检查集成测试用例。
验证openroute free、auto和其他专门的模型都能调用通过。
```

---

## 7.2 场景路由与降级

### OR4 三层场景路由验证

```
请验证OpenRoute的三层场景路由：
1. 场景1（Proxy组合Prompt+后处理）— OpenRouteCombinePipeline
2. 场景2（业务方组合Prompt+后处理）— CallerCombinePipeline
3. 场景3（API透传）— PassthroughPipeline
4. 验证SceneRouter.decide()正确识别场景
5. 验证PipelineFactory.create()正确创建Pipeline
6. 验证路由与执行完全解耦
```

### OR5 智能降级链验证

```
请验证OpenRoute的智能降级链：
1. API通道 → WebChat通道 → 抽取API → 三方API兜底
2. 验证熔断器三态转换：closed → open → half_open
3. 验证连续3次失败自动熔断
4. 验证健康检查：启动时并发检查 + 每30分钟定时检查
5. 验证降级后的自动恢复机制
```

---

## 7.3 浏览器自动化

### OR6 七平台WebChat验证

```
请验证OpenRoute的7个网页版平台WebChat通道：
1. 豆包 — 验证DOM选择器和消息提取
2. Kimi — 验证DOM选择器和消息提取
3. DeepSeek — 验证DOM选择器和消息提取
4. 通义千问 — 验证DOM选择器和消息提取
5. 腾讯元宝 — 验证DOM选择器和消息提取
6. 智谱GLM — 验证DOM选择器和消息提取
7. MiniMax — 验证DOM选择器和消息提取
每个平台用真实浏览器会话验证，确保消息发送和回复提取正常。
```

### OR7 流式输出验证

```
请验证OpenRoute的流式输出能力：
1. API Forward真流式SSE透传
2. WebChat近似流式三级降级：DOM MutationObserver → 轮询 → 完整回复模拟
3. 验证ToolParser从LLM纯文本回复中解析tool_calls
4. 验证JSON提取、格式修复、Schema校验、arguments修复
```

---

## 7.4 安全与配置

### OR8 敏感词脱敏验证

```
请验证OpenRoute的敏感词脱敏功能：
1. 检查sanitization_rules.yaml配置是否完整
2. 验证发送含敏感词的消息时自动替换
3. 验证替换后网页版审核不拦截
4. 验证回复中敏感词还原
```

### OR9 用户认证与用量统计

```
请验证OpenRoute的用户认证与用量统计：
1. Bearer Token + API Key（or-开头）双认证
2. 按后端模型统计call_count/tokens/error_count
3. 验证未认证请求返回401
4. 验证用量统计数据的准确性
```

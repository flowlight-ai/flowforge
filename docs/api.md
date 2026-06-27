# FlowForge API 参考文档 v1.0

> **对应架构文档**：FlowForge v4.0  
> **基础路径**：`/api/v1`  
> **协议**：HTTP/1.1 + WebSocket  
> **格式**：JSON  
> **编码**：UTF-8

---

## 第一章：概述

### 1.1 基础信息

| 项目 | 值 |
|------|-----|
| 协议 | HTTP/1.1 + WebSocket |
| 格式 | JSON |
| 编码 | UTF-8 |
| 认证 | Bearer Token (JWT) |
| 基础路径 | `/api/v1` |

### 1.2 通用响应格式

**成功响应**：
```json
{
  "status": "success",
  "data": { },
  "meta": {
    "trace_id": "uuid-string",
    "timestamp": "2026-05-12T12:00:00Z"
  }
}
```

**错误响应**：
```json
{
  "status": "error",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  },
  "meta": {
    "trace_id": "uuid-string",
    "timestamp": "2026-05-12T12:00:00Z"
  }
}
```

### 1.3 HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 已创建 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 404 | 资源不存在 |
| 409 | 冲突（Persona 锁冲突） |
| 422 | 参数校验失败 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
| 503 | 依赖服务不可用 |

---

## 第二章：任务管理 API

### 2.1 创建任务

**创建新任务，系统将根据 mode 参数选择执行模式并开始执行。**

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks` |

**请求体**：
```json
{
  "task_id": "optional-custom-id",
  "persona": "education",
  "input_data": {
    "topic": "写一篇武汉中考政策深度分析",
    "keywords": ["中考", "分配生"]
  },
  "mode": "reflexion",
  "interaction_mode": "standard",
  "platforms": ["toutiao"],
  "publish_mode": "draft",
  "metadata": {
    "sop_name": "deep_article"
  }
}
```

**请求体字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 否 | 自定义任务 ID，不传则自动生成 UUID |
| `persona` | string | 是 | 专栏/业务标识 |
| `input_data` | object | 是 | 任务输入数据 |
| `mode` | string | 否 | 执行模式：`react`/`reflexion`/`workflow`/`plan_execute`/`multi_agent`/`rewoo`/`graph_of_thoughts`/`self_discover`/`agent_judge`。不传则由引擎自动选择 |
| `interaction_mode` | string | 否 | 交互模式：`standard`(默认) 或 `helm` |
| `platforms` | array | 否 | 发布平台列表，默认 `["toutiao"]` |
| `publish_mode` | string | 否 | `draft` 或 `publish`，默认 `draft` |
| `metadata` | object | 否 | 扩展元数据，如 `sop_name` 指定 workflow |

**响应 (201)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "persona": "education",
    "mode": "reflexion",
    "interaction_mode": "standard",
    "status": "running",
    "created_at": "2026-05-12T12:00:00Z"
  },
  "meta": {
    "trace_id": "uuid-string",
    "timestamp": "2026-05-12T12:00:00Z"
  }
}
```

**错误码**：

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `TASK_CONFLICT` | 409 | 同一 persona 已有任务在运行 |
| `MODE_NOT_FOUND` | 404 | 指定的执行模式不存在 |
| `WORKFLOW_RECURSION` | 400 | Workflow 嵌套深度超限 |

---

### 2.2 获取任务列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/tasks` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `persona` | string | 否 | 按 persona 筛选 |
| `status` | string | 否 | 按状态筛选：`pending`/`running`/`waiting_review`/`completed`/`published`/`failed`/`rejected`/`cancelled` |
| `mode` | string | 否 | 按执行模式筛选 |
| `interaction_mode` | string | 否 | 按交互模式筛选：`standard`/`helm` |
| `limit` | integer | 否 | 每页数量，默认 20 |
| `offset` | integer | 否 | 偏移量，默认 0 |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "task_id": "uuid-string",
        "persona": "education",
        "mode": "reflexion",
        "interaction_mode": "helm",
        "status": "waiting_review",
        "created_at": "2026-05-12T12:00:00Z",
        "updated_at": "2026-05-12T12:03:00Z"
      }
    ],
    "total": 42
  },
  "meta": {}
}
```

---

### 2.3 获取任务详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/tasks/{task_id}` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "persona": "education",
    "mode": "reflexion",
    "interaction_mode": "helm",
    "status": "waiting_review",
    "trace_id": "uuid-string",
    "input_data": { "topic": "..." },
    "state": {
      "draft": "## 武汉中考...",
      "audit_score": 0.92
    },
    "helm_events": [],
    "published_urls": {
      "toutiao": "https://..."
    },
    "created_at": "2026-05-12T12:00:00Z",
    "completed_at": null
  },
  "meta": {}
}
```

---

### 2.4 取消任务

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks/{task_id}/cancel` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": { "task_id": "uuid-string", "status": "cancelled" },
  "meta": {}
}
```

---

### 2.5 暂停任务

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks/{task_id}/pause` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": { "task_id": "uuid-string", "status": "paused", "message": "任务已暂停" }
}
```

---

### 2.6 恢复任务

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks/{task_id}/resume` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": { "task_id": "uuid-string", "status": "running", "message": "任务已恢复" }
}
```

---

### 2.7 跳过当前节点

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks/{task_id}/skip` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": { "task_id": "uuid-string", "status": "running", "skipped_stage": "writer", "message": "已跳过 writer 阶段" }
}
```

---

## 第三章：审核中心 API

### 3.1 获取待审核列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/review/queue` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `persona` | string | 否 | 按专栏筛选 |
| `limit` | integer | 否 | 每页数量，默认 20 |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "task_id": "uuid-string",
        "persona": "education",
        "title": "武汉中考巨变...",
        "draft_content": "完整草稿内容",
        "seo_title": "武汉中考巨变：分配生门槛涨到450分",
        "audit_score": 0.92,
        "created_at": "2026-05-12T12:00:00Z"
      }
    ],
    "total": 5
  }
}
```

---

### 3.2 获取审核详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/review/{task_id}` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "persona": "education",
    "title": "## 武汉中考政策...",
    "draft_content": "完整 Markdown 草稿",
    "seo_title": "武汉中考巨变...",
    "seo_keywords": ["武汉中考", "分配生"],
    "audit_score": 0.92,
    "audit_issues": [],
    "created_at": "2026-05-12T12:00:00Z"
  }
}
```

---

### 3.3 提交审核结果

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/tasks/{task_id}/review` |

**请求体**：
```json
{
  "verdict": "pass",
  "feedback": "标题可以再优化",
  "edited_content": ""
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `verdict` | string | 是 | `pass`/`reject`/`edit` |
| `feedback` | string | 否 | 审核意见 |
| `edited_content` | string | 否 | verdict=edit 时提供修改后的完整内容 |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "status": "published"
  }
}
```

---

## 第四章：模型管理 API

### 4.1 获取模型健康报告

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/admin/models/health` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "models": [
      {
        "model_key": "openrouter/tencent/hy3-preview:free",
        "provider": "openrouter",
        "model_id": "tencent/hy3-preview:free",
        "status": "healthy",
        "last_check": "2026-05-12T12:00:00Z",
        "error_count": 0
      }
    ],
    "summary": {
      "total": 18,
      "healthy": 15,
      "unhealthy": 2,
      "degraded": 1
    }
  }
}
```

---

### 4.2 更新模型分配

| 项目 | 值 |
|------|-----|
| 方法 | `PUT` |
| 路径 | `/api/v1/admin/models/assign` |

**请求体**：
```json
{
  "persona": "education",
  "agent_name": "writer",
  "primary_model": "openrouter/baidu/cobuddy:free",
  "fallback_models": ["openrouter/tencent/hy3-preview:free"]
}
```

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "persona": "education",
    "agent": "writer",
    "primary": "openrouter/baidu/cobuddy:free",
    "fallbacks": ["openrouter/tencent/hy3-preview:free"]
  }
}
```

---

### 4.3 触发模型自动修复

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/admin/models/autofix` |

**请求体**：
```json
{
  "persona": "education",
  "cascade": true
}
```

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "fixed_models": ["openrouter/tencent/hy3-preview:free"],
    "replaced_models": [],
    "cascade_suggestions": [{ "persona": "life", "agent": "writer", "shared_model": "..." }]
  }
}
```

---

### 4.4 获取当前模型分配

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/admin/models/assignments` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "education": { "writer": { "primary": "...", "fallbacks": [...] } }
  }
}
```

---

### 4.5 强制刷新模型健康状态

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/admin/models/health/force` |

---

### 4.6 检查指定模型

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/admin/models/health/check` |

**请求体**：
```json
{
  "model_key": "openrouter/tencent/hy3-preview:free"
}
```

---

## 第五章：模式与 Agent 管理 API

### 5.1 获取可用模式列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/modes` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "modes": [
      { "name": "react", "capabilities": ["reasoning", "retrieval", "acting"], "status": "available" },
      { "name": "reflexion", "capabilities": ["generation", "evaluation", "refinement"], "status": "available" },
      { "name": "graph_of_thoughts", "capabilities": ["complex_reasoning"], "status": "experimental" }
    ]
  }
}
```

---

### 5.2 获取已注册 Agent 列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/agents` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "agents": [
      { "name": "topic_research", "description": "多级检索策略", "default_mode": "rewoo", "status": "verified" },
      { "name": "article_writing", "description": "三层生成管道", "default_mode": "reflexion", "status": "verified" }
    ]
  }
}
```

---

### 5.3 获取已注册 Workflow 列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/workflows` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "workflows": [
      { "name": "deep_article", "steps": 8, "status": "verified" },
      { "name": "novel_full_process", "steps": 6, "status": "planned" }
    ]
  }
}
```

---

## 第六章：仪表盘与系统运维 API

### 6.1 仪表盘 - 关键操作区

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/dashboard/actions` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "pending_review_count": 3,
    "latest_review_task": { "task_id": "...", "persona": "education", "title": "...", "created_at": "..." }
  }
}
```

---

### 6.2 仪表盘 - 实时状态区

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/dashboard/status` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "running_tasks": [{ "task_id": "...", "persona": "education", "mode": "reflexion", "current_step": "writer" }],
    "error_tasks": [],
    "model_health": { "healthy": 15, "degraded": 1, "unhealthy": 2 }
  }
}
```

---

### 6.3 仪表盘 - 统计报表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/dashboard/stats` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "today_articles": 5,
    "month_articles": 42,
    "model_cost": { "total_tokens": 12500000, "estimated_cost_usd": 1.25 },
    "today_published": 3,
    "today_success_rate": 0.95
  }
}
```

---

### 6.4 系统健康检查

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/health` |

**响应 (200)**：
```json
{
  "status": "healthy",
  "components": {
    "database": { "status": "healthy", "latency_ms": 2 },
    "llm_proxy": { "status": "degraded", "message": "1/4 providers unhealthy" },
    "helixrag": { "status": "healthy", "latency_ms": 45 },
    "mode_registry": { "status": "healthy", "modes": 9 }
  }
}
```

---

### 6.5 Prometheus 指标

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/metrics` |

**关键指标**：

| 指标名 | 类型 | 描述 |
|--------|------|------|
| `flowforge_tasks_total{mode, status}` | counter | 任务创建总数 |
| `flowforge_execution_duration_seconds` | histogram | 任务执行耗时 |
| `flowforge_token_usage_total{model, provider}` | counter | Token 消耗 |
| `flowforge_tool_calls_total{tool_name, status}` | counter | 工具调用次数 |
| `flowforge_llm_errors_total{provider, error_type}` | counter | LLM 错误次数 |
| `flowforge_persona_running{persona}` | gauge | 当前各专栏运行任务数 |

---

### 6.6 审计日志查询

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/logs` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 否 | 按任务 ID 过滤 |
| `level` | string | 否 | 按级别过滤：`INFO`/`WARNING`/`ERROR` |
| `mode` | string | 否 | 按执行模式过滤 |
| `limit` | integer | 否 | 每页数量，默认 50 |
| `offset` | integer | 否 | 偏移量，默认 0 |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "timestamp": "2026-05-12T12:00:00Z",
        "level": "INFO",
        "task_id": "uuid-string",
        "mode": "reflexion",
        "step_name": "writer",
        "agent_name": "writer",
        "action": "execute",
        "detail": {"tokens": 1500, "model": "openrouter/baidu/cobuddy:free"},
        "trace_id": "uuid-string"
      }
    ],
    "total": 150
  }
}
```

---

## 第七章：插件管理 API

### 7.1 获取已加载插件列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/plugins` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "plugins": [
      {
        "name": "flowforge-plugin-langchain",
        "version": "0.1.0",
        "type": "tools",
        "entries": ["langchain_llm", "langchain_chain"]
      }
    ]
  }
}
```

---

### 7.2 手动加载插件配置

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/plugins/reload` |

---

## 第八章：WebSocket 实时推送

### 8.1 通用事件通道

| 项目 | 值 |
|------|-----|
| 协议 | WebSocket |
| 路径 | `/ws/events` |

**服务端 → 客户端事件**：

| 事件 | payload | 触发时机 |
|------|---------|---------|
| `task.start` | `{task_id, mode, persona}` | 任务开始 |
| `task.completed` | `{task_id, published_urls}` | 任务完成 |
| `task.failed` | `{task_id, error}` | 任务失败 |
| `task.paused` | `{task_id, reason}` | 任务暂停 |
| `task.resumed` | `{task_id}` | 任务恢复 |
| `mode.enter` | `{task_id, mode}` | 进入模式 |
| `agent.start` | `{task_id, agent_name}` | Agent 调用开始 |
| `agent.end` | `{task_id, agent_name, result}` | Agent 调用完成 |
| `review.ready` | `{task_id, persona, title}` | 审核节点就绪 |
| `model.health_changed` | `{model_key, status}` | 模型健康状态变更 |

---

### 8.2 Helm 模式专用通道

| 项目 | 值 |
|------|-----|
| 协议 | WebSocket |
| 路径 | `/ws/helm/{task_id}` |

**完整事件映射**：

| Helm 事件类型 | 说明 |
|-------------|------|
| `helm.stage.enter` | `{stage, order, total, label}` SOP 阶段开始 |
| `helm.tool.start` | `{tool_name, params, timestamp}` 工具调用开始 |
| `helm.tool.end` | `{tool_name, result, duration_ms, error?}` 工具调用完成 |
| `helm.llm.start` | `{agent_name, model, messages_preview?}` LLM 调用开始 |
| `helm.llm.reasoning` | `{agent_name, delta_text}` LLM 推理内容 (流式) |
| `helm.llm.stream` | `{agent_name, delta_text}` LLM 输出文本 (流式) |
| `helm.llm.end` | `{agent_name, full_response, tokens}` LLM 调用完成 |
| `helm.draft.update` | `{content, is_partial}` 草稿内容更新 |
| `helm.step.intermediate` | `{step_name, data}` 中间产出展示 |
| `helm.review.ready` | `{task_id, draft_summary}` 审核节点就绪 |
| `helm.review.submitted` | `{verdict, feedback}` 审核已提交 |
| `helm.task.paused` | `{reason}` 任务暂停 |
| `helm.task.resumed` | `{}` 任务恢复 |
| `helm.task.completed` | `{published_urls?}` 任务完成 |
| `helm.task.error` | `{step_name, error_message}` 任务出错 |
| `helm.token.stats` | `{total_tokens, estimated_cost}` Token 统计更新 |

**客户端 → 服务端消息**：

| type | 参数 | 说明 |
|------|------|------|
| `ping` | - | 心跳检测 |
| `replay` | `from_seq: int` | 请求回放指定序号之后的事件 (断线重连) |

---

## 第九章：数据模型参考

### 9.1 任务状态流转

```
pending → running → waiting_review → completed/published
                   ↘ failed
                   ↘ rejected
                   ↘ cancelled
```

### 9.2 任务状态值

| 状态 | 含义 | 终端？ |
|------|------|--------|
| `pending` | 已创建，等待执行 | 否 |
| `running` | 执行中 | 否 |
| `waiting_review` | 暂停在审核节点 | 否 |
| `completed` | 任务正常结束 | 是 |
| `published` | 已发布 | 是 |
| `failed` | 执行出错终止 | 是 |
| `rejected` | 审核拒绝 | 是 |
| `cancelled` | 手动取消 | 是 |

### 9.3 执行模式枚举

| 模式 | 说明 |
|------|------|
| `react` | 思考→行动→观察 循环 |
| `plan_execute` | 先规划，再执行 |
| `reflexion` | Actor→Evaluator→Reflector 迭代 |
| `multi_agent` | 多 Agent 协作 |
| `workflow` | 预定义 DAG 流程 |
| `graph_of_thoughts` | 图式推理 |
| `rewoo` | 一次性规划，批量执行 |
| `self_discover` | 自动发现推理框架 |
| `agent_judge` | Agent 作为评判者 |

---

## 第十章：错误码完整列表

### 10.1 任务相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `TASK_CONFLICT` | 409 | 同一 persona 已有任务在运行 |
| `TASK_INVALID_STATE` | 400 | 任务不在预期状态 |

### 10.2 模式相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `MODE_NOT_FOUND` | 404 | 执行模式未注册 |
| `WORKFLOW_RECURSION` | 400 | Workflow 嵌套深度超限 |
| `MODE_NOT_APPLICABLE` | 400 | 模式不适用于当前任务 |

### 10.3 模型相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `MODEL_NOT_FOUND` | 404 | 模型配置不存在 |
| `MODEL_HEALTH_FAILED` | 503 | 模型不可用 |
| `MODEL_LIMIT_EXCEEDED` | 429 | 模型配额耗尽 |
| `MODEL_FIX_FAILED` | 503 | 无可用备选模型 |

### 10.4 审核相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `REVIEW_NOT_AVAILABLE` | 400 | 任务不在审核状态 |
| `REVIEW_VERDICT_INVALID` | 400 | 审核意见无效 |

### 10.5 沙箱相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `SANDBOX_TIMEOUT` | 400 | 代码执行超时 |
| `SANDBOX_MEMORY_EXCEEDED` | 400 | 代码执行内存超限 |
| `SANDBOX_FORBIDDEN` | 403 | 代码包含禁止操作 |

### 10.6 系统相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `INTERNAL_ERROR` | 500 | 内部服务异常 |
| `SERVICE_UNAVAILABLE` | 503 | 依赖服务不可用 |
| `VALIDATION_ERROR` | 422 | 参数校验失败 |
| `CONFIGURATION_ERROR` | 400 | 配置错误 |

---

**以上为 FlowForge API 参考文档 v1.0 完整内容。** 覆盖了架构设计中所有功能点的 API 定义，包括 9 种执行模式、Helm/Standard 双交互模式、16 种 Helm 实时事件、模型治理、插件管理、沙箱安全等。


# FlowForge API 参考文档 v1.1 (增量补充)

> 本增量文档基于 v1.0，补充认证机制、配置端点、插件端点、Cross-platform 部署注意事项。

---

## 补充 1：认证机制

### JWT 认证

FlowForge 支持可选的 JWT Bearer Token 认证。生产环境建议启用。

**启用方式**：在 `config/system.yaml` 中配置：

```yaml
security:
  auth_enabled: true
  secret_key: "${SECRET_KEY}"
  token_expire_minutes: 1440  # 24小时
```

**获取 Token**：

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/auth/token` |

**请求体**：
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "access_token": "eyJhbGciOi...",
    "token_type": "bearer",
    "expires_in": 86400
  }
}
```

**使用方式**：在请求头中携带 `Authorization: Bearer <token>`。

**刷新 Token**：

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/auth/refresh` |

---

## 补充 2：配置管理 API

### 获取系统配置

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/admin/config` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "modes": ["react", "reflexion", "workflow", "..."],
    "agents": ["topic_research", "article_writing", "..."],
    "tools": ["llm", "helixrag", "tavily_search", "..."],
    "mcp_servers": [],
    "memory": {"working": "dict", "short_term": "sqlite", "long_term": "sqlite"},
    "security": {"auth_enabled": false},
    "cross_platform": {"os": "linux", "sandbox_mode": "process"}
  }
}
```

### 重载配置（热更新）

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/admin/config/reload` |

---

## 补充 3：Cross-platform 部署端点

### 获取平台兼容性状态

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/system/platform` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "os": "linux",
    "python_version": "3.11.2",
    "sandbox_available": true,
    "sandbox_type": "process",
    "memory_limit_supported": true,
    "plugins_loaded": 3,
    "warnings": []
  }
}
```

**Windows 环境下的沙箱降级说明**：
- `sandbox_type` 为 `"process"`（Linux）或 `"process_win"`（Windows）
- Windows 下 `resource` 模块不可用，自动降级为 `psutil` 内存限制
- 若 `psutil` 未安装，沙箱内存限制功能不可用（工具仍可执行，但无内存硬限制）

---

## 补充 4：插件管理补充端点

### 安装插件（从 PyPI）

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/plugins/install` |

**请求体**：
```json
{
  "package_name": "flowforge-plugin-langchain"
}
```

### 卸载插件

| 项目 | 值 |
|------|-----|
| 方法 | `DELETE` |
| 路径 | `/api/v1/plugins/{plugin_name}` |

---

## 补充 5：完整错误码补充

### 认证相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTHENTICATION_FAILED` | 401 | 认证失败 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `INSUFFICIENT_PERMISSIONS` | 403 | 权限不足 |

### 插件相关

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `PLUGIN_NOT_FOUND` | 404 | 插件未找到 |
| `PLUGIN_INSTALL_FAILED` | 500 | 插件安装失败 |
| `PLUGIN_LOAD_FAILED` | 500 | 插件加载失败 |

### 沙箱相关（Cross-platform）

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `SANDBOX_TIMEOUT` | 400 | 代码执行超时 |
| `SANDBOX_MEMORY_EXCEEDED` | 400 | 代码执行内存超限 |
| `SANDBOX_FORBIDDEN` | 403 | 代码包含禁止操作 |
| `SANDBOX_NOT_AVAILABLE` | 503 | 当前平台沙箱不可用 |
| `SANDBOX_PLATFORM_LIMITED` | 400 | 当前平台沙箱功能受限（如 Windows 无内存限制） |

---

# 附录: 2026-06-25 API 端点补全

> 来源：第十一轮文档与代码一致性深度审查（task.md 中 FW-CONSIST-005）
> 目的：将 api.md 与 `app/api/endpoints/` 实际 24 个端点文件对齐，补全缺失的端点文档

## API.1 实际端点文件清单（24 个）

flowforge/app/api/endpoints/ 目录下共有 24 个端点文件（不含 `__init__.py` 和 `admin_models.py`）：

| # | 文件 | 已文档化 | 缺失 |
|---|------|---------|------|
| 1 | admin.py | ✅ 第四章（部分） | 缺 /api/v1/admin/config 等端点 |
| 2 | agents.py | ✅ 第五章 5.2 | — |
| 3 | auth.py | ✅ 补充 1 | — |
| 4 | dashboard.py | ✅ 第六章 | — |
| 5 | domain_plugins.py | ❌ | **缺失（API.2 补全）** |
| 6 | graph.py | ❌ | **缺失（API.3 补全）** |
| 7 | logs.py | ✅ 第六章 6.6 | — |
| 8 | loops.py | ❌ | **缺失（API.4 补全）** |
| 9 | memory.py | ❌ | **缺失（API.5 补全）** |
| 10 | metrics.py | ✅ 第六章 6.5 | — |
| 11 | modes.py | ✅ 第五章 5.1 | — |
| 12 | openroute.py | ❌ | **缺失（API.6 补全）** |
| 13 | plans.py | ❌ | **缺失（API.7 补全）** |
| 14 | plugins.py | ✅ 第七章 | — |
| 15 | prompts.py | ❌ | **缺失（API.8 补全）** |
| 16 | review.py | ✅ 第三章 | — |
| 17 | schedules.py | ❌ | **缺失（API.9 补全）** |
| 18 | settings.py | ❌ | **缺失（API.10 补全）** |
| 19 | system.py | ✅ 补充 3 | — |
| 20 | tasks.py | ✅ 第二章 | — |
| 21 | uploads.py | ❌ | **缺失（API.11 补全）** |
| 22 | websocket.py | ✅ 第八章 | — |
| 23 | workflows.py | ✅ 第五章 5.3 | — |
| 24 | workspace.py | ❌ | **缺失（API.12 补全）** |

**统计**：已文档化 13 个，缺失 11 个（FW-CONSIST-005 记录的"20+ 端点缺失"实际为 11 个）。

## API.2 domain_plugins 端点（缺失补全）

### 获取已注册的领域插件列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/domain-plugins` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "plugins": [
      {
        "name": "contentforge",
        "version": "1.0.0",
        "state": "ready",
        "agents": ["topic", "research", "writer"],
        "tools": ["helixrag", "publish_toutiao"]
      }
    ]
  }
}
```

### 获取领域插件详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/domain-plugins/{plugin_name}` |

### 重新加载领域插件

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/domain-plugins/{plugin_name}/reload` |

## API.3 graph 端点（缺失补全）

### 获取任务执行图

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/graph/{task_id}` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "nodes": [
      { "id": "step-1", "type": "agent", "agent_name": "writer", "status": "completed" }
    ],
    "edges": [
      { "from": "step-1", "to": "step-2" }
    ]
  }
}
```

### 获取任务执行轨迹

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/graph/{task_id}/trace` |

## API.4 loops 端点（缺失补全）

### 获取 Loop 列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/loops` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "loops": [
      { "loop_id": "article-refine", "template": "default_loop", "max_iterations": 3, "quality_threshold": 0.9 }
    ]
  }
}
```

### 获取 Loop 详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/loops/{loop_id}` |

### 创建 Loop

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/loops` |

### 获取 Loop 执行历史

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/loops/{loop_id}/history` |

## API.5 memory 端点（缺失补全）

### 获取任务记忆

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/memory/{task_id}` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "working_memory": {},
    "short_term": [],
    "long_term": [],
    "episodic": []
  }
}
```

### 检索记忆

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/memory/search` |

**请求体**：
```json
{
  "query": "武汉中考政策",
  "types": ["semantic", "long_term", "episodic"],
  "limit": 10
}
```

### 清除任务记忆

| 项目 | 值 |
|------|-----|
| 方法 | `DELETE` |
| 路径 | `/api/v1/memory/{task_id}` |

## API.6 openroute 端点（缺失补全）

### 获取 OpenRoute 模型列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/openroute/models` |

### 测试 OpenRoute 连接

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/openroute/test` |

### 获取 OpenRoute 路由配置

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/openroute/routes` |

## API.7 plans 端点（缺失补全）

### 获取任务执行计划

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/plans/{task_id}` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "task_id": "uuid-string",
    "plan": {
      "title": "武汉中考深度分析",
      "steps": [
        { "name": "topic_research", "agent": "topic", "mode": "rewoo" }
      ],
      "status": "confirmed"
    }
  }
}
```

### 创建执行计划

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/plans` |

### 确认执行计划

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/plans/{task_id}/confirm` |

### 修改执行计划

| 项目 | 值 |
|------|-----|
| 方法 | `PUT` |
| 路径 | `/api/v1/plans/{task_id}` |

## API.8 prompts 端点（缺失补全）

### 获取 Prompt 模板列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/prompts` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tag` | string | 否 | 按标签筛选 |
| `agent` | string | 否 | 按关联 Agent 筛选 |

### 获取 Prompt 模板详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/prompts/{prompt_key}` |

### 创建/更新 Prompt 模板

| 项目 | 值 |
|------|-----|
| 方法 | `PUT` |
| 路径 | `/api/v1/prompts/{prompt_key}` |

### 测试 Prompt 模板渲染

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/prompts/{prompt_key}/render` |

**请求体**：
```json
{
  "variables": { "domain": "education", "hot_topics": ["中考", "分配生"] }
}
```

## API.9 schedules 端点（缺失补全）

### 获取定时任务列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/schedules` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "schedules": [
      {
        "job_id": "daily-topic-education",
        "cron": "0 9 * * *",
        "persona": "education",
        "workflow": "deep_article",
        "next_run": "2026-06-26T09:00:00+08:00",
        "status": "active"
      }
    ]
  }
}
```

### 创建定时任务

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/schedules` |

### 暂停/恢复定时任务

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/schedules/{job_id}/pause` |

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/schedules/{job_id}/resume` |

### 删除定时任务

| 项目 | 值 |
|------|-----|
| 方法 | `DELETE` |
| 路径 | `/api/v1/schedules/{job_id}` |

## API.10 settings 端点（缺失补全）

### 获取系统设置

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/settings` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "quality_threshold": 0.9,
    "loop_timeout_seconds": 180,
    "compaction_threshold": 0.92,
    "default_mode": "loop",
    "features": {
      "use_workflow_compiler": true,
      "use_turn_transition_v2": false,
      "use_llm_router": true
    }
  }
}
```

### 更新系统设置

| 项目 | 值 |
|------|-----|
| 方法 | `PUT` |
| 路径 | `/api/v1/settings` |

### 重置设置为默认值

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/settings/reset` |

## API.11 uploads 端点（缺失补全）

### 上传文件

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/uploads` |
| Content-Type | `multipart/form-data` |

**请求体**：
```
file: <binary>
task_id: uuid-string (optional)
```

**响应 (201)**：
```json
{
  "status": "success",
  "data": {
    "file_id": "uuid-string",
    "original_name": "screenshot.png",
    "mime_type": "image/png",
    "size": 102400,
    "storage_path": "uploads/2026/06/uuid.png"
  }
}
```

### 获取上传文件列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/uploads` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 否 | 按任务筛选 |
| `limit` | integer | 否 | 每页数量，默认 20 |

### 下载/预览上传文件

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/uploads/{file_id}` |

### 删除上传文件

| 项目 | 值 |
|------|-----|
| 方法 | `DELETE` |
| 路径 | `/api/v1/uploads/{file_id}` |

## API.12 workspace 端点（缺失补全）

### 获取工作区列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/workspace` |

**响应 (200)**：
```json
{
  "status": "success",
  "data": {
    "workspaces": [
      { "id": "dev", "name": "DevForge 工作区", "project": "devforge" },
      { "id": "content", "name": "ContentForge 工作区", "project": "contentforge" }
    ]
  }
}
```

### 获取工作区详情

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/workspace/{workspace_id}` |

### 获取工作区任务列表

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| 路径 | `/api/v1/workspace/{workspace_id}/tasks` |

### 切换当前工作区

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/api/v1/workspace/{workspace_id}/activate` |

## API.13 端点补全总结

| 端点模块 | 补全端点数 | 主要功能 |
|---------|----------|---------|
| domain_plugins | 3 | 领域插件列表/详情/重载 |
| graph | 2 | 任务执行图/轨迹 |
| loops | 4 | Loop 列表/详情/创建/历史 |
| memory | 3 | 任务记忆/检索/清除 |
| openroute | 3 | OpenRoute 模型/测试/路由 |
| plans | 4 | 执行计划 CRUD |
| prompts | 4 | Prompt 模板 CRUD + 渲染测试 |
| schedules | 4 | 定时任务 CRUD |
| settings | 3 | 系统设置 GET/PUT/RESET |
| uploads | 4 | 文件上传/列表/下载/删除 |
| workspace | 4 | 工作区列表/详情/任务/切换 |
| **合计** | **38** | **11 个模块共补全 38 个端点** |

> 本附录为 API 端点补全快照，所有端点的实际路由前缀以 `app/api/router.py` 中的注册为准。具体请求/响应字段可能因实现细节略有差异，建议结合 OpenAPI 自动文档（`/docs`）使用。

---
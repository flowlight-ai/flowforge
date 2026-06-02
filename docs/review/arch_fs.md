# FlowForge 全栈架构设计

> **基于**：fullstack_review.md + spec_fs.md 的评审发现
> **目标**：定义 FlowForge 从前端到后端的完整生产级架构，涵盖部署演进、前后端 API 契约、WebSocket 架构、多产品集成、模板市场设计
> **版本**：v1.0 — 2026-05-26

---

## 第一章：可扩展部署架构

### 1.1 当前问题回顾

Phase7 计划使用 **单台 4C8G 服务器 + Docker Compose** 部署三个产品（FlowForge + OpenRoute + OpenSieve）+ Nginx + Prometheus + Grafana。经过资源分析，4C8G 仅能跑 FlowForge 单体（不含 OpenSieve 的 SearXNG/Milvus）。

### 1.2 部署架构演进路线图

```
Phase A（MVP — 第 1-4 周）          Phase B（商用 — 第 5-8 周）
┌──────────────────────┐            ┌─────────────┐  ┌─────────────┐
│  1× 8C16G 服务器      │            │ 8C16G 主机   │  │ 4C8G 从机    │
│                      │            │             │  │             │
│  ┌────────────────┐  │            │ FlowForge   │  │ OpenSieve   │
│  │ FlowForge      │  │            │ + OpenRoute │  │ + SearXNG   │
│  │ + OpenRoute    │  │            │ + Nginx     │  │ + Milvus    │
│  │ + SQLite       │  │            │ + Grafana   │  │ + PG        │
│  └────────────────┘  │            └─────────────┘  └─────────────┘
│  (OpenSieve 暂不部署) │                  │                │
│                      │            ┌──────┴──────┐  ┌──────┴──────┐
│  Nginx + Prometheus  │            │ Prometheus  │  │ Node Exporter│
│  + Grafana           │            │ (独立容器)  │  │              │
└──────────────────────┘            └─────────────┘  └─────────────┘

Phase C（规模 — 用户 > 100）          Phase D（企业 — 用户 > 1000）
┌──────────┐ ┌──────────┐ ┌──────────┐     K3s 轻量集群
│ 4C8G x3  │ │ 4C8G     │ │ 2C4G     │     ┌─────────────────────────┐
│ FlowForge│ │ OpenRoute│ │ OpenSieve│     │ 3× Worker Node (4C8G)   │
│ (多副本)  │ │ (多副本) │ │ (SearXNG) │     │ 1× 托管 PostgreSQL      │
└──────────┘ └──────────┘ └──────────┘     │ RDS/云数据库             │
      │            │            │            │ 1× 负载均衡 (ALB/NLB)    │
      └────────────┴────────────┘            └─────────────────────────┘
                   │
          ┌────────┴────────┐
          │ Nginx LB + SSL  │
          │ (2C4G 独立)     │
          └─────────────────┘
```

### 1.3 Docker Compose v2 生产配置（Phase B 推荐）

```yaml
# docker-compose.prod.yml — 双服务器部署方案
# 主机 (8C16G): FlowForge + OpenRoute + Nginx + Grafana
# 从机 (4C8G): OpenSieve + SearXNG + PostgreSQL

# ===== 主机 docker-compose.yml =====
version: "3.9"

x-logging: &default-logging
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "5"

x-healthcheck: &api-healthcheck
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s

services:
  # ---- 反向代理 ----
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot
    depends_on:
      flowforge-api:
        condition: service_healthy
      openroute-api:
        condition: service_healthy
    restart: always
    logging: *default-logging
    mem_limit: 128m
    memswap_limit: 256m

  # ---- certbot 自动续期 ----
  certbot:
    image: certbot/certbot:latest
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"
    restart: always

  # ---- FlowForge API + Next.js ----
  flowforge-api:
    build:
      context: ./flowforge
      dockerfile: Dockerfile.prod   # ★ 多阶段构建
    image: ghcr.io/flowforge/flowforge:${TAG:-latest}
    expose:
      - "8000"
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - DB_URL=sqlite:///data/flowforge.db
      - OPENROUTER_BASE_URL=http://openroute-api:8000/v1
      - OPENSIEVE_BASE_URL=http://${OPENSIEVE_HOST}:8001
      - PROMETHEUS_MULTIPROC_DIR=/tmp
    volumes:
      - flowforge_data:/app/data
      - flowforge_config:/app/config
      - flowforge_logs:/app/logs
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /tmp:size=100M
    restart: always
    logging: *default-logging
    mem_limit: 2g
    memswap_limit: 3g
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      <<: *api-healthcheck

  # ---- OpenRoute API ----
  openroute-api:
    build:
      context: ./openroute
      dockerfile: Dockerfile.prod
    image: ghcr.io/flowforge/openroute:${TAG:-latest}
    expose:
      - "8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /tmp:size=100M
    restart: always
    logging: *default-logging
    mem_limit: 1.5g
    memswap_limit: 2g
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      <<: *api-healthcheck

  # ---- Prometheus ----
  prometheus:
    image: prom/prometheus:v3.0
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    restart: always
    logging: *default-logging
    mem_limit: 512m

  # ---- Grafana ----
  grafana:
    image: grafana/grafana:11.0
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./grafana/datasources:/etc/grafana/provisioning/datasources:ro
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_SERVER_ROOT_URL=https://monitor.flowforge.ai
    restart: always
    logging: *default-logging
    mem_limit: 256m

volumes:
  flowforge_data:
  flowforge_config:
  flowforge_logs:
  prometheus_data:
  grafana_data:
```

### 1.4 多阶段 Dockerfile.prod

```dockerfile
# flowforge/Dockerfile.prod — 多阶段生产构建
# Stage 1: 前端构建
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --production=false
COPY web/ ./
RUN npm run build

# Stage 2: Python 依赖
FROM python:3.10.14-slim-bookworm AS python-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 3: 运行时
FROM python:3.10.14-slim-bookworm
WORKDIR /app

# 创建非 root 用户
RUN groupadd -r flowforge -g 1000 && \
    useradd -r -g flowforge -u 1000 -m -s /bin/bash flowforge

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libsqlite3-0 && \
    rm -rf /var/lib/apt/lists/*

# 复制 Python 依赖
COPY --from=python-deps /root/.local /home/flowforge/.local
ENV PATH=/home/flowforge/.local/bin:$PATH

# 复制应用代码（排除 .dockerignore 中的内容）
COPY --chown=flowforge:flowforge . .

# 复制前端构建产物
COPY --from=frontend-builder --chown=flowforge:flowforge /app/web/.next /app/web/.next

RUN mkdir -p /app/data /app/logs && chown -R flowforge:flowforge /app

USER flowforge
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--graceful-timeout", "30"]
```

配套 `.dockerignore`：
```
.git
.gitignore
__pycache__
*.pyc
.venv
venv
node_modules
tests
test_reports
data
logs
*.db
*.db-shm
*.db-wal
.env
.env.*
docs
README.md
```

### 1.5 K3s 迁移触发条件

当满足以下任一条件时，从 Docker Compose 迁移到 K3s：

| 触发条件 | 阈值 |
|---------|------|
| 用户数 | > 100 活跃用户 |
| 日任务执行量 | > 500 次 |
| 需要多副本高可用 | 任何组件需要 > 1 副本 |
| 服务器数量 | > 2 台 |
| 需要滚动更新零停机 | 商业 SLA 要求 |

---

## 第二章：前后端 API 契约设计

### 2.1 API 设计原则

1. **RESTful 语义**：资源导向 URL，HTTP 方法表达动作
2. **统一响应格式**：所有响应遵循 `ApiResponse<T>` 结构
3. **版本化**：`/api/v1/` 前缀，破坏性变更走 v2
4. **分页标准**：所有列表端点支持 `?page=&limit=&sort=&order=`
5. **OpenAPI 3.1 文档**：FastAPI 自动生成 Swagger UI

### 2.2 统一响应格式

```typescript
// 前端类型定义 — lib/types/api.ts

// 成功响应
interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// 错误响应
interface ApiError {
  success: false;
  error: {
    code: string;           // e.g. "TASK_NOT_FOUND", "VALIDATION_ERROR"
    message: string;        // 用户可读的中文错误信息
    details?: Record<string, string[]>;  // 字段级错误
    trace_id?: string;      // 用于排查
  };
}

// 统一类型
type ApiResult<T> = ApiResponse<T> | ApiError;
```

```python
# 后端 Pydantic 模型 — app/api/schemas.py

from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Optional

T = TypeVar("T")

class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T
    meta: Optional[dict] = None

class ApiError(BaseModel):
    success: bool = False
    error: dict  # { code, message, details, trace_id }
```

### 2.3 前端 API 客户端设计

```typescript
// lib/api/client.ts — 基于 @tanstack/react-query 的统一 API 客户端

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiResult } from "@/lib/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

class ApiClient {
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestInit
  ): Promise<ApiResult<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",  // Cookie-based JWT
      ...options,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new ApiClientError(data.error, res.status);
    }

    return data;
  }

  get<T>(path: string) { return this.request<T>("GET", path); }
  post<T>(path: string, body?: unknown) { return this.request<T>("POST", path, body); }
  put<T>(path: string, body?: unknown) { return this.request<T>("PUT", path, body); }
  delete<T>(path: string) { return this.request<T>("DELETE", path); }
}

export const api = new ApiClient();

// ---- React Query Hooks ----

// 查询模板列表
export function useTemplates(params: TemplateQuery) {
  return useQuery({
    queryKey: ["templates", params],
    queryFn: () => api.get<TemplateListResponse>(
      `/templates?${new URLSearchParams(params as any)}`
    ),
  });
}

// 安装模板（mutation）
export function useInstallTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      api.post(`/templates/${templateId}/install`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-templates"] });
      qc.invalidateQueries({ queryKey: ["installed-scenarios"] });
    },
  });
}
```

### 2.4 核心 API 端点清单

```
# === 认证 ===
POST   /api/v1/auth/login          → { email, password } → { access_token, user }
POST   /api/v1/auth/register       → { email, password, name }
POST   /api/v1/auth/refresh        → { refresh_token } → { access_token }
GET    /api/v1/auth/me             → User

# === 工作空间 ===
GET    /api/v1/workspaces
POST   /api/v1/workspaces          → { name, description }
GET    /api/v1/workspaces/{id}
PUT    /api/v1/workspaces/{id}/settings

# === 任务 ===
GET    /api/v1/tasks?workspace=&status=&page=&limit=
POST   /api/v1/tasks               → { workflow, mode, input, persona }
GET    /api/v1/tasks/{id}
POST   /api/v1/tasks/{id}/cancel
POST   /api/v1/tasks/{id}/retry

# === 审核 ===
GET    /api/v1/review?workspace=&status=
POST   /api/v1/tasks/{id}/review   → { verdict, feedback, edited_draft }

# === 模板 ===
GET    /api/v1/templates?category=&industry=&complexity=&page=&limit=
GET    /api/v1/templates/{id}
POST   /api/v1/templates/{id}/install
POST   /api/v1/templates/{id}/configure  → { params: {...} }
GET    /api/v1/my/templates
DELETE /api/v1/my/templates/{id}
POST   /api/v1/templates/{id}/reviews    → { rating, comment }

# === Workflow ===
GET    /api/v1/workflows
POST   /api/v1/workflows           → { yaml_content }
GET    /api/v1/workflows/{id}
PUT    /api/v1/workflows/{id}      → { yaml_content }
POST   /api/v1/workflows/validate  → { yaml_content } → { valid, errors }

# === Skill ===
GET    /api/v1/skills?installed=&category=
GET    /api/v1/skills/{name}
POST   /api/v1/skills/{name}/install
DELETE /api/v1/skills/{name}
PUT    /api/v1/skills/{name}/toggle → { enabled: true/false }

# === 定时任务 ===
GET    /api/v1/schedules
POST   /api/v1/schedules           → { cron, workflow_id, input }
GET    /api/v1/schedules/{id}
PUT    /api/v1/schedules/{id}
DELETE /api/v1/schedules/{id}
GET    /api/v1/schedules/{id}/history

# === 分析 ===
GET    /api/v1/dashboard/status
GET    /api/v1/dashboard/usage?workspace=&from=&to=
GET    /api/v1/dashboard/token-cost?workspace=&from=&to=&group_by=model|day

# === 平台 ===
GET    /api/v1/platforms            # 已绑定平台列表
POST   /api/v1/platforms            → { platform, credentials }
GET    /api/v1/publish/history?workspace=&page=&limit=

# === 系统 ===
GET    /api/v1/system/health
GET    /api/v1/system/info
GET    /api/v1/logs?level=&since=&limit=
```

---

## 第三章：WebSocket 架构

### 3.1 整体架构

```
┌───────────────────────────────────────────────────────────┐
│                      Nginx (反向代理)                      │
│  /ws/solo/{task_id}      → flowforge-api:8000             │
│  /ws/events              → flowforge-api:8000             │
│  /ws/deploy/{session_id} → flowforge-api:8000             │
│  (Upgrade + Connection 头已配置)                           │
└───────────────────────┬───────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────┐
│              FlowForge API (FastAPI + uvicorn)             │
│                                                           │
│  ┌──────────────────────────────────────────────────┐     │
│  │              ConnectionManager                     │     │
│  │  - 按 task_id 分组连接                             │     │
│  │  - 事件缓冲（断线重放）                            │     │
│  │  - 单调递增序列号                                  │     │
│  └──────────────┬───────────────────────────────────┘     │
│                 │                                          │
│  ┌──────────────▼───────────────────────────────────┐     │
│  │              EventBus (事件总线)                    │     │
│  │  - 17 种 FlowForge 事件                           │     │
│  │  - 异步发布/订阅                                   │     │
│  │  - Solo Adapter (16 种 Solo 事件映射)             │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

### 3.2 Nginx WebSocket 配置（关键）

```nginx
# nginx/conf.d/flowforge.conf

# WebSocket 升级映射
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name flowforge.ai;

    # SSL 配置
    ssl_certificate     /etc/letsencrypt/live/flowforge.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flowforge.ai/privkey.pem;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # API 路由
    location /api/ {
        proxy_pass http://flowforge-api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket — Solo 执行流
    location /ws/solo/ {
        proxy_pass http://flowforge-api:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;     # 24h 长连接
        proxy_send_timeout 86400s;
    }

    # WebSocket — 全局事件流
    location /ws/events {
        proxy_pass http://flowforge-api:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # WebSocket — 部署进度
    location /ws/deploy/ {
        proxy_pass http://flowforge-api:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 600s;       # 10 分钟部署超时
    }

    # 前端静态资源 + SSR
    location / {
        proxy_pass http://flowforge-api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 3.3 WebSocket 消息协议

```typescript
// lib/types/ws.ts — WebSocket 消息协议

// 客户端 → 服务端
type ClientMessage =
  | { type: "subscribe"; channel: string; taskId?: string }
  | { type: "unsubscribe"; channel: string }
  | { type: "ping" }
  | { type: "solo.command"; taskId: string; command: "pause" | "resume" | "skip" | "cancel" }
  | { type: "solo.review"; taskId: string; verdict: "approve" | "reject"; feedback?: string; editedDraft?: string };

// 服务端 → 客户端
type ServerMessage =
  | { type: "connected"; sessionId: string }
  | { type: "pong" }
  | { type: "event"; seq: number; event: FlowForgeEvent; timestamp: string }
  | { type: "replay"; seq: number; events: FlowForgeEvent[] }    // 断线重放
  | { type: "error"; code: string; message: string };

// FlowForge 事件类型（扩展为 20 种）
type FlowForgeEvent =
  | { type: "task.start"; taskId: string; mode: string; input: unknown }
  | { type: "task.complete"; taskId: string; duration: number; output: unknown }
  | { type: "task.error"; taskId: string; error: string; traceId: string }
  | { type: "task.paused"; taskId: string; reason: string }
  | { type: "task.resumed"; taskId: string }
  | { type: "mode.enter"; taskId: string; mode: string }
  | { type: "mode.exit"; taskId: string; mode: string; duration: number }
  | { type: "agent.start"; taskId: string; agent: string; step: number }
  | { type: "agent.thinking"; taskId: string; agent: string; thought: string }
  | { type: "agent.end"; taskId: string; agent: string; duration: number }
  | { type: "tool.start"; taskId: string; tool: string; params: unknown }
  | { type: "tool.end"; taskId: string; tool: string; result: unknown; duration: number }
  | { type: "llm.start"; taskId: string; model: string; promptTokens: number }
  | { type: "llm.stream"; taskId: string; content: string }    // 流式 chunk
  | { type: "llm.end"; taskId: string; totalTokens: number }
  | { type: "draft.update"; taskId: string; content: string; version: number }
  | { type: "step.intermediate"; taskId: string; step: string; output: unknown }
  | { type: "review.ready"; taskId: string; draft: unknown }
  | { type: "review.submitted"; taskId: string; verdict: string }
  | { type: "token.stats"; taskId: string; used: number; remaining: number; cost: number }
  // ★ 新增
  | { type: "deploy.progress"; sessionId: string; step: number; totalSteps: number; message: string }
  | { type: "deploy.complete"; sessionId: string; scenarioId: string };
```

### 3.4 前端 WebSocket 管理架构

```typescript
// hooks/useFlowForgeWS.ts — 通用 WebSocket 管理

import { useEffect, useRef, useCallback } from "react";

interface UseFlowForgeWSOptions {
  channel: string;
  taskId?: string;
  onEvent: (event: FlowForgeEvent, seq: number) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
  reconnect?: boolean;
  maxReconnect?: number;
}

export function useFlowForgeWS({
  channel,
  taskId,
  onEvent,
  onConnected,
  onDisconnected,
  onError,
  reconnect = true,
  maxReconnect = 10,
}: UseFlowForgeWSOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const lastSeq = useRef(0);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/${channel}${taskId ? `/${taskId}` : ""}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCount.current = 0;
      onConnected?.();
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      switch (msg.type) {
        case "event":
          lastSeq.current = msg.seq;
          onEvent(msg.event, msg.seq);
          break;
        case "replay":
          msg.events.forEach((e, i) => onEvent(e, msg.seq + i));
          break;
        case "error":
          onError?.(msg.message);
          break;
      }
    };

    ws.onclose = () => {
      onDisconnected?.();
      if (reconnect && reconnectCount.current < maxReconnect) {
        const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), 30000);
        reconnectCount.current++;
        setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      onError?.("WebSocket 连接错误");
    };
  }, [channel, taskId]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  return { send, disconnect, isConnected: wsRef.current?.readyState === WebSocket.OPEN };
}
```

---

## 第四章：三产品集成架构

### 4.1 服务拓扑

```
                          ┌──────────────────────┐
                          │     用户浏览器         │
                          │  Next.js App (SSR)    │
                          └──────────┬───────────┘
                                     │ HTTPS
                          ┌──────────▼───────────┐
                          │   Nginx (反向代理)     │
                          │   flowforge.ai:443    │
                          └──────────┬───────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼─────────┐  ┌────────▼────────┐  ┌─────────▼─────────┐
    │  FlowForge API    │  │  OpenRoute API  │  │  OpenSieve API    │
    │  Port 8000        │  │  Port 8000      │  │  Port 8001        │
    │                   │  │  (另一容器)      │  │  (另一服务器)      │
    │  ┌─────────────┐  │  │                 │  │                   │
    │  │ LangGraph    │  │  │ /v1/chat/      │  │  /api/search      │
    │  │ StateGraph   │──┼──▶│   completions  │  │  /api/index       │
    │  └─────────────┘  │  │                 │  │  /api/scrape      │
    │                   │  │ /v1/models      │  │                   │
    │  ┌─────────────┐  │  │                 │  │  ┌─────────────┐  │
    │  │ HybridExec  │──┼──┼─────────────────┼──▶│ SearXNG      │  │
    │  └─────────────┘  │  │                 │  │  └─────────────┘  │
    │                   │  │ 外部 LLM 厂商    │  │                   │
    │  ┌─────────────┐  │  │ (OpenAI/Claude/ │  │  ┌─────────────┐  │
    │  │ OpenSieve   │──┼──┼─ DeepSeek/Kimi) │  │  │ Milvus/     │  │
    │  │ Client      │  │  │                 │  │  │ Qdrant      │  │
    │  └─────────────┘  │  │                 │  │  └─────────────┘  │
    └───────────────────┘  └─────────────────┘  └───────────────────┘
```

### 4.2 集成代码（Python 端）

```python
# flowforge/services/openroute_service.py — OpenRoute 集成客户端

import httpx
from flowforge.core.config import settings
from flowforge.core.circuit_breaker import CircuitBreaker

class OpenRouteClient:
    """FlowForge → OpenRoute 的内部客户端，含熔断和重试"""

    def __init__(self):
        self.base_url = settings.OPENROUTER_BASE_URL  # http://openroute-api:8000/v1
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
        self.circuit_breaker = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=30,
        )

    async def chat_completion(self, model: str, messages: list, **kwargs) -> dict:
        """OpenAI 兼容格式的 chat completion"""
        if not self.circuit_breaker.allow_request():
            raise OpenRouteUnavailableError("OpenRoute 服务熔断中")

        try:
            resp = await self.client.post(
                f"{self.base_url}/chat/completions",
                json={"model": model, "messages": messages, **kwargs},
                headers={"X-API-Key": settings.OPENROUTE_API_KEY},
            )
            resp.raise_for_status()
            self.circuit_breaker.record_success()
            return resp.json()
        except httpx.HTTPStatusError as e:
            self.circuit_breaker.record_failure()
            if e.response.status_code == 429:
                retry_after = int(e.response.headers.get("Retry-After", 5))
                raise OpenRouteRateLimitError(retry_after)
            raise
```

```python
# flowforge/tools/opensieve_client.py — OpenSieve 集成客户端

class OpenSieveClient:
    """FlowForge → OpenSieve 的内部客户端"""

    def __init__(self):
        self.base_url = settings.OPENSIEVE_BASE_URL  # http://{host}:8001
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search(self, query: str, top_k: int = 5) -> list[dict]:
        """语义搜索"""
        resp = await self.client.post(
            f"{self.base_url}/api/search",
            json={"query": query, "top_k": top_k},
        )
        return resp.json()["results"]

    async def index(self, documents: list[dict]) -> dict:
        """批量索引文档"""
        resp = await self.client.post(
            f"{self.base_url}/api/index",
            json={"documents": documents},
        )
        return resp.json()

    async def health(self) -> bool:
        """健康检查"""
        try:
            resp = await self.client.get(f"{self.base_url}/health")
            return resp.status_code == 200
        except Exception:
            return False
```

### 4.3 集成失败降级策略

| 产品 | 降级策略 |
|------|---------|
| OpenRoute 不可用 | 回退到 FlowForge 本地 LLM 客户端直接调用（绕开路由），记录降级事件 |
| OpenSieve 不可用 | 回退到 Tavily/Bing Web Search API，标注结果为"降级搜索 - 精度降低" |
| 外部平台 API 不可用 | 发布失败记录到队列，定时重试（指数退避，最多 3 次），推送通知用户 |

---

## 第五章：模板市场架构

### 5.1 总体设计

```
┌──────────────────────────────────────────────────────────┐
│                   模板市场系统                             │
│                                                          │
│  ┌────────────────┐    ┌────────────────┐                │
│  │  模板市场前端    │    │  模板市场后端   │                │
│  │                │    │                │                │
│  │ 浏览/搜索/筛选  │◄──►│ REST API       │                │
│  │ 模板详情       │    │                │                │
│  │ 安装/配置向导  │    │ 模板 CRUD      │                │
│  │ 我的模板       │    │ 安装/卸载      │                │
│  │                │    │ 参数配置引擎   │                │
│  └────────────────┘    └───────┬────────┘                │
│                                │                         │
│              ┌─────────────────▼──────────────┐          │
│              │         模板存储层               │          │
│              │                                │          │
│              │  ┌──────────────────────────┐  │          │
│              │  │ 内置模板 (12 个)           │  │          │
│              │  │ config/templates/*.yaml   │  │          │
│              │  └──────────────────────────┘  │          │
│              │  ┌──────────────────────────┐  │          │
│              │  │ 社区模板 (SQLite)          │  │          │
│              │  │ 用户上传/分享             │  │          │
│              │  └──────────────────────────┘  │          │
│              └────────────────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

### 5.2 后端数据模型

```python
# memory/models/template.py

from sqlalchemy import Column, String, Integer, Float, Boolean, Text, DateTime, JSON
from sqlalchemy.orm import declarative_base
import datetime

Base = declarative_base()

class Template(Base):
    __tablename__ = "templates"

    id = Column(String(36), primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    version = Column(String(20), nullable=False, default="1.0.0")
    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(50), nullable=False, index=True)    # customer_service|content|data|...
    industry = Column(String(50), nullable=False, default="通用")
    complexity = Column(String(20), nullable=False)               # simple|medium|complex
    pricing_type = Column(String(20), nullable=False, default="free")
    pricing_amount = Column(Float, default=0.0)

    # 模板内容
    yaml_content = Column(Text, nullable=False)                   # 原始 YAML
    config_schema = Column(JSON, nullable=False)                  # 可配置参数的 JSON Schema

    # 元数据
    author = Column(String(100), default="FlowForge")
    source = Column(String(20), default="builtin")                # builtin|community
    installs = Column(Integer, default=0)
    rating = Column(Float, default=0.0)
    rating_count = Column(Integer, default=0)
    icon = Column(String(50), default="template")
    estimated_setup_time = Column(String(20), default="1天")

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class InstalledTemplate(Base):
    __tablename__ = "installed_templates"

    id = Column(String(36), primary_key=True)
    template_id = Column(String(36), nullable=False, index=True)
    workspace_id = Column(String(36), nullable=False, index=True)
    configured_params = Column(JSON, default={})                  # 用户配置的参数
    status = Column(String(20), default="active")                 # active|paused|error
    installed_at = Column(DateTime, default=datetime.datetime.utcnow)


class TemplateReview(Base):
    __tablename__ = "template_reviews"

    id = Column(String(36), primary_key=True)
    template_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(36), nullable=False)
    rating = Column(Integer, nullable=False)                      # 1-5
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
```

### 5.3 模板 YAML 标准格式

```yaml
# config/templates/customer_service.yaml
name: "customer_service"
version: "1.0.0"
display_name: "AI 智能客服"
description: "7×24 小时 AI 客服，支持多渠道接入、知识库检索、智能转人工"
category: "customer_service"
industry: "通用"
complexity: "medium"
pricing_type: "free"
icon: "headset"
estimated_setup_time: "1天"

# ★ JSON Schema 格式的可配置参数（用于 Web UI 自动生成表单）
config_schema:
  type: object
  properties:
    industry:
      type: string
      title: "行业"
      description: "选择你的行业，影响知识库模板和回复策略"
      enum: ["电商", "教育", "餐饮", "医疗", "金融", "通用"]
      default: "通用"
    language:
      type: string
      title: "语言"
      enum: ["中文", "英文", "日语", "中英双语"]
      default: "中文"
    channels:
      type: array
      title: "接入渠道"
      description: "选择客服系统接入的渠道（可多选）"
      items:
        type: string
        enum: ["微信", "企业微信", "网页", "飞书", "钉钉"]
      default: ["微信"]
    auto_reply_threshold:
      type: number
      title: "自动回复置信度阈值"
      description: "AI 回答的置信度高于此值时自动发送，低于时转人工"
      minimum: 0.5
      maximum: 0.95
      default: 0.8
    business_hours_only:
      type: boolean
      title: "仅工作时间转人工"
      description: "非工作时间全部 AI 自动处理"
      default: true

# 执行定义
steps:
  - name: "intent_classifier"
    tool: llm_client
    params:
      prompt: "分类客户意图为: sales/support/complaint/tech"
  - name: "knowledge_retrieval"
    tool: helixrag_search
    condition: "intent != 'complaint'"
    params:
      query: "{{user_message}}"
      top_k: 3
  - name: "auto_reply"
    condition: "confidence > {{auto_reply_threshold}}"
    tool: message_channel
    params:
      reply: "{{knowledge_answer}}"
  - name: "human_escalation"
    condition: "confidence <= {{auto_reply_threshold}}"
    tool: webhook
    params:
      url: "{{admin_webhook}}"
      message: "需要人工介入: {{user_message}}"
```

### 5.4 配置引擎（YAML → 表单）

```python
# app/api/endpoints/templates.py — 配置引擎核心

import jsonschema
from typing import Any

class TemplateConfigEngine:
    """根据模板的 config_schema 渲染配置表单并验证用户输入"""

    def generate_form_fields(self, schema: dict) -> list[dict]:
        """
        将 JSON Schema 转为前端表单字段数组。

        返回格式（前端直接渲染为 react-hook-form 表单）：
        [
          {
            "name": "industry",
            "type": "select",
            "label": "行业",
            "description": "选择你的行业...",
            "required": true,
            "options": [
              {"value": "电商", "label": "电商"},
              {"value": "教育", "label": "教育"},
              ...
            ],
            "default": "通用"
          },
          {
            "name": "auto_reply_threshold",
            "type": "slider",
            "label": "自动回复置信度阈值",
            "min": 0.5,
            "max": 0.95,
            "step": 0.05,
            "default": 0.8
          },
          ...
        ]
        """
        fields = []
        for prop_name, prop_schema in schema.get("properties", {}).items():
            field = self._prop_to_field(prop_name, prop_schema, schema)
            fields.append(field)
        return fields

    def _prop_to_field(self, name: str, schema: dict, parent: dict) -> dict:
        prop_type = schema.get("type", "string")
        type_map = {
            "string": "select" if "enum" in schema else "text",
            "number": "slider" if "minimum" in schema and "maximum" in schema else "number",
            "integer": "slider" if "minimum" in schema and "maximum" in schema else "number",
            "boolean": "switch",
            "array": "multiselect" if "items" in schema else "text",
        }
        return {
            "name": name,
            "type": type_map.get(prop_type, "text"),
            "label": schema.get("title", name),
            "description": schema.get("description", ""),
            "required": name in parent.get("required", []),
            "default": schema.get("default"),
            **({"options": [{"value": o, "label": o} for o in schema["enum"]]}
               if "enum" in schema else {}),
            **({"min": schema["minimum"], "max": schema["maximum"]}
               if "minimum" in schema else {}),
        }

    def validate_params(self, schema: dict, params: dict) -> list[str]:
        """验证用户输入的参数是否合法，返回错误列表"""
        errors = []
        try:
            jsonschema.validate(params, schema)
        except jsonschema.ValidationError as e:
            errors.append(e.message)
        return errors

    def render_yaml(self, template_yaml: str, params: dict) -> str:
        """将用户参数注入模板 YAML 的 {{placeholder}} 中"""
        from jinja2 import Template
        tpl = Template(template_yaml)
        return tpl.render(**params)
```

### 5.5 一键安装流程

```python
# 后端安装流程伪代码

async def install_template(template_id: str, workspace_id: str, user_params: dict, ws_session_id: str):
    """
    模板安装完整流程（通过 WebSocket 推送进度）

    步骤：
    1. 解析模板 YAML → 提取 Skill/Workflow/Agent/Tool 依赖
    2. 检查依赖是否已安装
    3. 验证用户参数
    4. 渲染 YAML（参数注入）
    5. 安装 Skill（如需要）
    6. 注册 Workflow
    7. 配置定时任务（如模板包含 schedule）
    8. 记录安装状态
    9. 推送完成事件
    """
    event_bus = get_event_bus()

    # Step 1: 解析
    await emit_deploy_progress(ws_session_id, 1, 9, "正在解析模板...")
    template = await template_repo.get(template_id)

    # Step 2: 检查依赖
    await emit_deploy_progress(ws_session_id, 2, 9, "检查依赖...")
    deps = extract_dependencies(template.yaml_content)

    # Step 3: 验证参数
    await emit_deploy_progress(ws_session_id, 3, 9, "验证配置参数...")
    config_engine = TemplateConfigEngine()
    errors = config_engine.validate_params(template.config_schema, user_params)
    if errors:
        raise TemplateConfigError(errors)

    # Step 4: 渲染
    await emit_deploy_progress(ws_session_id, 4, 9, "生成配置...")
    rendered_yaml = config_engine.render_yaml(template.yaml_content, user_params)

    # Step 5-8: 安装各组件
    await emit_deploy_progress(ws_session_id, 5, 9, "安装 Skill...")
    for skill in deps["skills"]:
        await skill_registry.install(skill)

    await emit_deploy_progress(ws_session_id, 6, 9, "注册 Workflow...")
    workflow = await workflow_registry.register_from_yaml(rendered_yaml, workspace_id)

    if deps.get("schedule"):
        await emit_deploy_progress(ws_session_id, 7, 9, "配置定时任务...")
        await scheduler.add_cron(deps["schedule"], workflow.id, user_params)

    await emit_deploy_progress(ws_session_id, 8, 9, "保存安装记录...")
    await installed_repo.save(template_id, workspace_id, user_params)

    # Step 9: 完成
    await emit_deploy_progress(ws_session_id, 9, 9, "部署完成！")
    await event_bus.emit(ws_session_id, "deploy.complete", {
        "sessionId": ws_session_id,
        "scenarioId": workflow.id,
    })
```

---

## 第六章：数据库策略

### 6.1 SQLite 多库分离设计

为避免单 SQLite 文件膨胀和写锁竞争，采用**按职责分库**策略：

| 数据库文件 | 用途 | 访问模式 | 预估大小 |
|-----------|------|---------|---------|
| `flowforge.db` | 任务、Workflow、模板、配置 | 读写混合 | 50-200 MB |
| `checkpoints.db` | LangGraph 状态检查点 | 大量写入 | 100 MB - 1 GB |
| `mailbox.db` | Agent 间通信信箱 | 高频读写 | 10-50 MB |
| `task_board.db` | Multi-Agent 任务认领 | 高频读写 | 10-30 MB |
| `scheduler.db` | APScheduler 任务存储 | 低频读写 | 1-5 MB |
| `audit.db` | 审计日志 | 追加写入 | 100 MB - 1 GB |
| `secrets.db` | 加密密钥存储 | 低频读写 | 1-5 MB |

**写锁隔离原理**：SQLite 的 WAL 模式允许多读单写，但不同数据库文件的写操作完全独立，不会互相阻塞。

### 6.2 备份策略

```bash
#!/bin/bash
# scripts/backup.sh — SQLite 安全备份脚本

BACKUP_DIR="/data/backups/$(date +%Y%m%d_%H%M)"
mkdir -p "$BACKUP_DIR"

DBS=(
    "flowforge.db"
    "checkpoints.db"
    "mailbox.db"
    "task_board.db"
    "scheduler.db"
    "audit.db"
    "secrets.db"
)

for db in "${DBS[@]}"; do
    db_path="/data/$db"
    if [ -f "$db_path" ]; then
        # 使用 .backup 命令而非 cp（WAL 安全）
        sqlite3 "$db_path" ".backup '$BACKUP_DIR/$db'"

        # 完整性验证
        integrity=$(sqlite3 "$BACKUP_DIR/$db" "PRAGMA integrity_check;")
        if [ "$integrity" != "ok" ]; then
            echo "❌ $db 备份完整性检查失败: $integrity"
            # 发送告警
            curl -X POST "$ALERT_WEBHOOK" \
                -H "Content-Type: application/json" \
                -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"备份失败: $db\"}}"
        else
            echo "✅ $db 备份成功 ($(stat -c%s "$BACKUP_DIR/$db") bytes)"
        fi
    fi
done

# 压缩
tar -czf "$BACKUP_DIR.tar.gz" -C "$(dirname "$BACKUP_DIR")" "$(basename "$BACKUP_DIR")"
rm -rf "$BACKUP_DIR"

# 上传到 OSS（可选）
# ossutil cp "$BACKUP_DIR.tar.gz" "oss://flowforge-backups/"

# 清理 7 天前的备份
find /data/backups -name "*.tar.gz" -mtime +7 -delete

echo "备份完成: $BACKUP_DIR.tar.gz"
```

### 6.3 Checkpoint 清理 Cron

```bash
# crontab — 每周日清理 7 天前的 checkpoint
0 3 * * 0 sqlite3 /data/checkpoints.db "DELETE FROM checkpoint_writes WHERE checkpoint_id IN (SELECT checkpoint_id FROM checkpoints WHERE created_at < datetime('now', '-7 days')); DELETE FROM checkpoints WHERE created_at < datetime('now', '-7 days'); VACUUM;"
```

---

## 第七章：安全架构

### 7.1 认证流程

```
用户浏览器                          FlowForge API
    │                                    │
    │  POST /api/v1/auth/login           │
    │  { email, password }               │
    │ ──────────────────────────────────▶│
    │                                    │ 验证密码 (bcrypt)
    │                                    │ 生成 JWT (RS256, 24h)
    │                                    │ 设置 HttpOnly Cookie
    │  ◀─────────────────────────────────│
    │  Set-Cookie: ff_token=xxx          │
    │                                    │
    │  GET /api/v1/tasks (with Cookie)   │
    │ ──────────────────────────────────▶│
    │                                    │ 验证 JWT → 提取 user_id
    │                                    │ 检查 workspace 权限
    │  ◀─────────────────────────────────│
```

### 7.2 JWT 实现

```python
# app/api/auth.py — JWT 认证

import jwt
from datetime import datetime, timedelta

class AuthService:
    ALGORITHM = "RS256"          # 非对称签名（比 HS256 更安全）
    ACCESS_EXPIRE = timedelta(hours=24)
    REFRESH_EXPIRE = timedelta(days=30)

    def __init__(self, private_key: str, public_key: str):
        self.private_key = private_key
        self.public_key = public_key

    def create_access_token(self, user_id: str, workspace_id: str) -> str:
        payload = {
            "sub": user_id,
            "ws": workspace_id,
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + self.ACCESS_EXPIRE,
            "type": "access",
        }
        return jwt.encode(payload, self.private_key, algorithm=self.ALGORITHM)

    def verify_token(self, token: str) -> dict:
        return jwt.decode(token, self.public_key, algorithms=[self.ALGORITHM])
```

### 7.3 API Key 管理

```python
# core/secret_store.py — 密钥加密存储

import os
from cryptography.fernet import Fernet

class SecretStore:
    """
    密钥存储的优先级链：
    1. 数据库 (secrets.db) — 加密存储，通过 Web UI 管理
    2. 环境变量 — Docker 注入
    3. .env 文件 — 开发环境
    4. 默认值 — 仅用于非敏感配置
    """

    def __init__(self, master_key: str = None):
        self.master_key = master_key or os.getenv("FF_MASTER_KEY")
        self.cipher = Fernet(self.master_key) if self.master_key else None

    async def resolve(self, key: str, default=None) -> str:
        """优先级链解析密钥"""
        # 1. 数据库
        if self.cipher:
            encrypted = await self._db_get(key)
            if encrypted:
                return self.cipher.decrypt(encrypted).decode()

        # 2. 环境变量
        env_val = os.getenv(key)
        if env_val:
            return env_val

        # 3. .env 文件
        dotenv_val = self._dotenv_get(key)
        if dotenv_val:
            return dotenv_val

        # 4. 默认值
        return default

    async def store(self, key: str, value: str):
        """加密存入数据库"""
        encrypted = self.cipher.encrypt(value.encode())
        await self._db_set(key, encrypted)
```

---

## 第八章：监控与告警架构

### 8.1 Prometheus 指标采集

```yaml
# prometheus/prometheus.yml

global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: "flowforge"
    static_configs:
      - targets: ["flowforge-api:8000"]
    metrics_path: "/metrics"

  - job_name: "openroute"
    static_configs:
      - targets: ["openroute-api:8000"]
    metrics_path: "/metrics"

  - job_name: "opensieve"
    static_configs:
      - targets: ["opensieve-host:8001"]
    metrics_path: "/metrics"

  - job_name: "nginx"
    static_configs:
      - targets: ["nginx-exporter:9113"]

  - job_name: "node"
    static_configs:
      - targets: ["node-exporter:9100"]
```

### 8.2 告警规则

```yaml
# prometheus/alerts.yml

groups:
  - name: flowforge_critical
    rules:
      - alert: ServiceDown
        expr: up{job="flowforge"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "FlowForge 服务宕机"
          description: "服务已不可达超过 1 分钟"

      - alert: HighErrorRate
        expr: rate(flowforge_tasks_total{status="failed"}[5m]) / rate(flowforge_tasks_total[5m]) > 0.2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "任务失败率过高"
          description: "过去 5 分钟失败率 {{ $value | humanizePercentage }}"

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes{mountpoint="/data"} / node_filesystem_size_bytes{mountpoint="/data"}) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足 10%"

      - alert: SQLiteLockContention
        expr: rate(flowforge_sqlite_busy_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "SQLite 锁竞争升高"

      - alert: LLM429RateLimit
        expr: rate(flowforge_tool_calls_total{tool_name="llm_client", status="429"}[5m]) > 5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "LLM API 429 速率限制频繁触发"

      - alert: WebSocketDisconnectRate
        expr: rate(flowforge_ws_disconnects_total[5m]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "WebSocket 断连率升高"
```

### 8.3 自定义 Prometheus 指标（后端）

```python
# core/metrics.py — FlowForge 自定义 Prometheus 指标

from prometheus_client import Counter, Histogram, Gauge, Info

# 任务指标
tasks_total = Counter(
    "flowforge_tasks_total",
    "Total tasks created",
    ["mode", "status", "workspace"],
)

execution_duration = Histogram(
    "flowforge_execution_duration_seconds",
    "Task execution duration",
    ["mode"],
    buckets=[1, 5, 10, 30, 60, 120, 300, 600, 1800],
)

# Token 指标
token_usage = Counter(
    "flowforge_token_usage_total",
    "Total tokens used",
    ["model", "provider"],
)

token_cost = Counter(
    "flowforge_token_cost_hourly",
    "Hourly token cost in CNY",
    ["model"],
)

# 工具指标
tool_calls = Counter(
    "flowforge_tool_calls_total",
    "Total tool calls",
    ["tool_name", "status"],  # status: success, error, 429, timeout
)

# WebSocket 指标
ws_connections = Gauge(
    "flowforge_ws_connections",
    "Active WebSocket connections",
    ["channel"],
)

ws_disconnects = Counter(
    "flowforge_ws_disconnects_total",
    "Total WebSocket disconnections",
    ["channel"],
)

# SQLite 指标
sqlite_busy = Counter(
    "flowforge_sqlite_busy_total",
    "SQLite busy events (lock contention)",
    ["db_name"],
)

# Persona 锁指标
persona_running = Gauge(
    "flowforge_persona_running",
    "Currently running tasks per persona",
    ["persona"],
)
```

---

## 第九章：总结与行动建议

### 架构决策记录（ADR）

| # | 决策 | 理由 |
|---|------|------|
| ADR-1 | Phase A 使用单台 8C16G 而非 4C8G | 4C8G 无法同时运行 FlowForge + OpenRoute，更无法运行 OpenSieve 的向量数据库 |
| ADR-2 | Phase B 双服务器：OpenSieve 独立 | SearXNG + Milvus/PostgreSQL 需要独立计算资源，避免影响 FlowForge 核心服务 |
| ADR-3 | Docker Compose v2 而非 K8s | 1-2 人团队 K8s 运维成本远超收益，100 活跃用户后再迁移 |
| ADR-4 | SQLite 多库分离而非 PostgreSQL | SQLite 零运维，多库分离可规避写锁竞争；PostgreSQL 迁移到 Phase C |
| ADR-5 | 模板市场走全局内置 + 社区贡献模式 | 初期 12 个内置免费模板 + 社区上传（审核制），避免依赖外部服务 |
| ADR-6 | WebSocket 三通道隔离（Solo / Events / Deploy） | 不同场景的长连接需求不同，隔离可避免互相影响 |
| ADR-7 | JSON Schema 驱动的配置表单 | 一套引擎自动渲染 40 场景的配置 UI，避免为每个场景手写表单 |

### 立即行动项

1. **修正 Dockerfile**：实施多阶段构建（前端构建 + Python 依赖 + 运行时）
2. **拆分 docker-compose**：创建 `docker-compose.prod.yml`，mem_limit 匹配实际需求
3. **实现模板市场 API**：7 个 REST 端点（CRUD + 安装 + 配置 + 评价）
4. **实现配置引擎**：`TemplateConfigEngine`（JSON Schema → 表单字段 + 参数渲染）
5. **数据库分库**：将当前单 `flowforge.db` 拆分为 7 个职责分离的数据库文件
6. **完善告警规则**：增加 LLM 429、SQLite 锁竞争、WebSocket 断连三项告警

---

> **文档状态**：本文档与 `fullstack_review.md`（全栈评审）和 `spec_fs.md`（前端规格）形成三位一体——评审发现问题 → 规格定义需求 → 架构提供方案。三个文档共同构成 FlowForge 从 MVP 到生产就绪的完整工程路线图。
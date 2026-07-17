# FlowForge 部署配置

> **文档编号**: setup/README.md（v1.0）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构
> **参考**: `[doc:clowder-ai/docs/setup/]` 目录结构

---

## 1. 用途

本目录存放 FlowForge 部署相关文档与配置示例。

---

## 2. 文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 部署配置导航（本文件） | ✅ v1.0 |
| [setup-forgemind.png](setup-forgemind.png) | forgemind 部署图 | ⏳ Phase 2 |
| [setup-external-agents.png](setup-external-agents.png) | 三方 Agent 配置图 | ⏳ Phase 3 |

---

## 3. 部署架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                  operator / 用户终端                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌──────────────────┐                ┌──────────────────┐
│  forgemind 应用层 │                │   *Forge 垂直层   │
│  (万物灵智体实践) │                │ (Content/Dev/...) │
└────────┬─────────┘                └────────┬─────────┘
         │                                    │
         └──────────────┬─────────────────────┘
                        │ Plugin V3 协议
                        ▼
        ┌──────────────────────────────────┐
        │      FlowForge 核心框架层          │
        │  ┌────────────────────────────┐  │
        │  │ 第 7 层 自进化层             │  │
        │  │ 第 6 层 协作层 TeamAct       │  │
        │  │ 第 5 层 能力画像层           │  │
        │  │ 第 4 层 Harness 七层         │  │
        │  │ 第 3 层 记忆联邦层           │  │
        │  │ 第 2 层 Eval 自代谢层        │  │
        │  │ 第 1 层 可靠性层             │  │
        │  └────────────────────────────┘  │
        └────┬─────────────────────────┬───┘
             │                         │
             ▼                         ▼
   ┌──────────────────┐     ┌──────────────────┐
   │  OpenRoute 网关   │     │  OpenSieve 中台   │
   │  (多模型 API)     │     │  (检索增强)       │
   └──────────────────┘     └──────────────────┘
             │
             ▼
   ┌──────────────────────────────────────┐
   │  外部 LLM 厂商（DeepSeek/Qwen/GLM/...）│
   └──────────────────────────────────────┘
```

---

## 4. 三方 Agent 接入配置

每个三方 Agent 通过 ExternalAgentAdapter 接入，配置示例：

```yaml
# config/external_agents/claude_code.yaml
agent_id: claude_code
vendor: anthropropic
adapter_type: cli
capabilities:
  - long_form_code_generation
  - agentic_coding
  - file_system_operations
fallback_priority: 1
cost_ceiling:
  tokens_per_hour: 1000000
  calls_per_hour: 100
worktree:
  isolated: true
  network: restricted
  permissions: [read, write_code, run_tests]
audit:
  log_to: harness-feedback/external-agent-traces/
```

---

## 5. 部署模式

### 5.1 单机开发模式

- FlowForge + OpenRoute + OpenSieve 同机部署
- 端口：8000（FlowForge）/ 6000（OpenRoute）/ 8100（OpenSieve）
- 三方 Agent 通过本地 CLI 调用

### 5.2 集群生产模式

- FlowForge 核心层多副本
- OpenRoute 独立集群
- OpenSieve PostgreSQL 集群
- 三方 Agent 通过 API 网关调用

### 5.3 物理接入模式（forgemind Phase 6+）

- IoT 传感器接入网关
- 物理执行器控制服务
- 边缘灵智体部署

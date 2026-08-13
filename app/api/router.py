"""FlowForge API 路由注册中心.

按架构层次/模块组织（2026-07-29 重组）:
    - core/       架构基础设施层（system/auth/metrics/logs/openroute）
    - agents/     智能体模块（agents/forgemind/modes/external_agents）
    - workflows/  工作流模块（workflows/plans/tasks/loops）
    - memory/     记忆模块（memory/graph）
    - plugins/    插件模块（plugins/domain_plugins）
    - admin/      后台管理模块（admin/admin_models/settings/review/schedules/prompts/env_vars）
    - workspace/  工作区模块（workspace/uploads）
    - endpoints/  独立组件（dashboard/websocket）

所有 API 统一注册到 /api/v1 前缀下。
"""
from fastapi import APIRouter

# ── 架构基础设施层 ──────────────────────────────────────────────
from flowforge.app.api.core import system, auth, metrics, logs, mcp, connectors, notify
from flowforge.app.api.core import routing, quotas, permissions, tool_usage, eval

# ── 智能体模块 ──────────────────────────────────────────────────
from flowforge.app.api.agents import agents, modes, forgemind, external_agents
from flowforge.app.api.agents import threads
from flowforge.app.api.agents import bootcamp
from flowforge.app.api.agents import skills, concierge, voice, capability
from flowforge.app.api.agents import signals
from flowforge.app.api.agents import approvals

# ── 工作流模块 ──────────────────────────────────────────────────
from flowforge.app.api.workflows import workflows, tasks, callbacks

# ── 记忆模块 ────────────────────────────────────────────────────
from flowforge.app.api.memory import memory, memory_v1
from flowforge.app.api.memory.graph import router as graph_router

# ── 插件模块 ────────────────────────────────────────────────────
from flowforge.app.api.plugins import plugins
from flowforge.app.api.plugins.domain_plugins import router as domain_plugins_router

# ── 后台管理模块 ────────────────────────────────────────────────
from flowforge.app.api.admin import admin, admin_models, settings, review, schedules, prompts, env_vars, ops
from flowforge.app.api.admin import leaderboard, env_files

# ── 独立组件 ────────────────────────────────────────────────────
from flowforge.app.api.endpoints import dashboard, websocket

# ── 根级 API 模块 ───────────────────────────────────────────────
from flowforge.app.api.plugin_management import router as plugin_management_router
from flowforge.app.api.marketplace_api import router as marketplace_router

router = APIRouter(prefix="/api/v1")

# ── 架构基础设施 ────────────────────────────────────────────────
router.include_router(system.router)
router.include_router(auth.router)
router.include_router(metrics.router)
router.include_router(logs.router)
router.include_router(mcp.router)
router.include_router(connectors.router)
router.include_router(notify.router)

# ── 智能体 ──────────────────────────────────────────────────────
router.include_router(agents.router)
router.include_router(modes.router)
# v7.0: ForgeMind Forgekin应用层 API（Trae CN 桥接 + webchat + IM MindCouncil + 自进化）
router.include_router(forgemind.router)
# 外部接入智能体状态检查（WEB-FUSION §6.3）
router.include_router(external_agents.router)
# 审批中心（ApprovalHub：待审批列表 + 审批/拒绝）— 参考 clowder-ai approvalHubStore
router.include_router(approvals.router)
# 会话管理（群聊会话 CRUD + 消息持久化）
router.include_router(threads.router)
# 灵智训练营（Bootcamp）— 用户引导 + 智能体成长训练（参考 clowder-ai F087）
router.include_router(bootcamp.router)
# 技能管理（Skill 注册、发现、安装）
router.include_router(skills.router)
# 管家配置（Concierge 形象、值班策略、主动性配置）
router.include_router(concierge.router)
# 语音管理（TTS/STT 服务、术语表、语音配置）
router.include_router(voice.router)
# 能力画像（CapabilityProfile 路由信号与来源追溯）
router.include_router(capability.router)
# 信号中心（SignalStore：真实 RSS 抓取 + 审计派生 + 已读/信号源开关）
router.include_router(signals.router)
# 路由策略（JSON 持久化 + llm_route.yaml 派生默认策略）
router.include_router(routing.router)
# 配额池（从 llm_route 派生模型池 + 用量记录）
router.include_router(quotas.router)
# 配额池旧路径 /quota/pools 兼容
router.include_router(quotas.legacy_router)
# 权限配置（按 connector 持久化，camelCase 前端契约）
router.include_router(permissions.router)
# 工具使用统计（真实指标 + 日志解析）
router.include_router(tool_usage.router)
# Eval 评估（checkpoints 真实任务 + 判决持久化）
router.include_router(eval.router)

# ── 工作流 ──────────────────────────────────────────────────────
router.include_router(workflows.router)
router.include_router(tasks.router)
# 回调鉴权（JSON 持久化 + 密钥脱敏）
router.include_router(callbacks.router)

# ── 记忆 ────────────────────────────────────────────────────────
# 注意：memory_v1 必须先注册，避免 /memory/{memory_id} 动态路径抢占
# /memory/collections /memory/recall /memory/health 静态路径
router.include_router(memory_v1.router)
router.include_router(memory.router)
router.include_router(graph_router)

# ── 插件 ────────────────────────────────────────────────────────
router.include_router(plugins.router)
router.include_router(domain_plugins_router)
router.include_router(plugin_management_router)
router.include_router(marketplace_router)

# ── 后台管理 ────────────────────────────────────────────────────
router.include_router(admin.router)
router.include_router(admin_models.router)
router.include_router(settings.router)
router.include_router(review.router)
router.include_router(schedules.router)
router.include_router(prompts.router)
router.include_router(env_vars.router)
router.include_router(ops.router)
# Forgekin 排行榜（swarm_trace 真实统计）
router.include_router(leaderboard.router)
# 环境文件管理（真实读写 + 脱敏）
router.include_router(env_files.router)

# ── 独立组件 ────────────────────────────────────────────────────
router.include_router(dashboard.router)

# WebSocket 端点（/ws/helm/{task_id} /ws/events /ws/logs）— P-119
# 注册到独立的无前缀 router：若并入 /api/v1 前缀 router，路径会被改写为
# /api/v1/ws/...，而前端连接的是无前缀 /ws/...（见 web/src/hooks/useHelmWebSocket.ts）。
ws_router = APIRouter()
ws_router.include_router(websocket.router)

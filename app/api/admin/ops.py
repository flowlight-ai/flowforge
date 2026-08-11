"""Ops API — 运维服务（运行态健康检查）.

对应前端 OpsSection 组件契约：
    GET /api/v1/ops/services  — 运维服务列表（包含实时健康状态）
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter

from flowforge.core.tracing import get_logger

logger = get_logger("api.ops")

router = APIRouter(prefix="/ops", tags=["ops"])


def _get_config_path() -> Path:
    """获取 config 目录路径（铁律 5 禁止硬编码路径）。"""
    return Path(__file__).resolve().parents[3] / "config"


def _check_port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """检查端口是否打开（轻量健康检查）。"""
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def _check_service_health() -> list[dict[str, Any]]:
    """检查所有服务运行状态."""
    services: list[dict[str, Any]] = []
    config_dir = _get_config_path()

    # 1. 后端 API 服务
    api_port = 8000
    api_healthy = _check_port_open("127.0.0.1", api_port)
    services.append({
        "id": "svc:api",
        "name": "FlowForge API",
        "status": "healthy" if api_healthy else "down",
        "message": f"端口 {api_port}" if api_healthy else f"端口 {api_port} 未响应",
        "latency_ms": None,
    })

    # 2. 前端 Web 服务
    web_port = 5174
    web_healthy = _check_port_open("127.0.0.1", web_port)
    services.append({
        "id": "svc:web",
        "name": "FlowForge Web",
        "status": "healthy" if web_healthy else "down",
        "message": f"端口 {web_port}" if web_healthy else f"端口 {web_port} 未响应",
        "latency_ms": None,
    })

    # 3. 数据库
    db_healthy = False
    db_path = Path.cwd() / "data" / "flowforge.db"
    if db_path.exists():
        db_size = db_path.stat().st_size
        db_healthy = db_size > 0
        services.append({
            "id": "svc:db",
            "name": "SQLite 数据库",
            "status": "healthy" if db_healthy else "degraded",
            "message": f"{db_size / 1024:.1f} KB" if db_healthy else "数据库为空",
            "latency_ms": None,
        })
    else:
        services.append({
            "id": "svc:db",
            "name": "SQLite 数据库",
            "status": "degraded",
            "message": "数据库文件未初始化",
            "latency_ms": None,
        })

    # 4. .env 配置文件
    env_path = Path.cwd() / ".env"
    if env_path.exists():
        env_size = env_path.stat().st_size
        services.append({
            "id": "svc:env",
            "name": "环境配置 (.env)",
            "status": "healthy" if env_size > 0 else "degraded",
            "message": f"{env_size} bytes" if env_size > 0 else "配置文件为空",
            "latency_ms": None,
        })
    else:
        services.append({
            "id": "svc:env",
            "name": "环境配置 (.env)",
            "status": "degraded",
            "message": ".env 文件不存在",
            "latency_ms": None,
        })

    # 5. 虚拟环境
    venv_path = Path.cwd() / ".venv"
    if venv_path.exists():
        services.append({
            "id": "svc:venv",
            "name": "Python 虚拟环境",
            "status": "healthy",
            "message": f"Python {sys.version_info.major}.{sys.version_info.minor}",
            "latency_ms": None,
        })
    else:
        services.append({
            "id": "svc:venv",
            "name": "Python 虚拟环境",
            "status": "degraded",
            "message": "未创建 .venv",
            "latency_ms": None,
        })

    # 6. 前端依赖
    node_modules = Path.cwd() / "web" / "node_modules"
    if node_modules.exists():
        services.append({
            "id": "svc:node",
            "name": "前端依赖 (node_modules)",
            "status": "healthy",
            "message": "已安装",
            "latency_ms": None,
        })
    else:
        services.append({
            "id": "svc:node",
            "name": "前端依赖 (node_modules)",
            "status": "degraded",
            "message": "未安装，请运行 npm install",
            "latency_ms": None,
        })

    # 7. 从 config/default.yaml 读取插件配置
    default_file = config_dir / "default.yaml"
    if default_file.exists():
        try:
            with open(default_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            features = data.get("features", {})
            enabled_count = sum(1 for v in features.values() if isinstance(v, dict) and v.get("enabled"))
            total_count = len(features) if isinstance(features, dict) else 0
            services.append({
                "id": "svc:features",
                "name": "Feature Flags",
                "status": "healthy",
                "message": f"{enabled_count}/{total_count} 启用",
                "latency_ms": None,
            })
        except Exception:
            pass

    return services


@router.get("/services")
async def list_ops_services() -> dict[str, Any]:
    """列出运维服务（运行态健康检查）。"""
    services = _check_service_health()
    return {
        "items": services,
        "total": len(services),
        "status": "healthy" if all(s["status"] == "healthy" for s in services) else "degraded",
    }
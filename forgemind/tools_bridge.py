"""Forgemind 工具桥接层 — 实现 ReAct 工具调用，让智能体能"做"而不只是"说".

核心问题（用户反馈）:
    群聊中用户问"查询系统信息，cpu和内存配置"，智能体只回复"我会检查"
    但无法实际执行——因为 ``chat()`` 只调用 LLM 生成文本，没有工具执行层。
    这导致"端到端未打通"，违反铁律 T2（禁止假数据/假逻辑）。

解决方案:
    本模块在 council 端点和 chat 方法之间插入工具桥接层:
    1. 意图检测：从用户消息识别动作意图（查系统信息/读文件/git状态等）
    2. 真实工具执行：调用真实工具获取真实数据（psutil/subprocess/open）
    3. 上下文注入：把真实数据作为"系统观察"注入 LLM 上下文
    4. LLM 基于真实数据生成有据可依的响应

设计原则:
    - 铁律 T2：禁止假数据，所有工具返回真实执行结果
    - 铁律 T4：禁止 Mock 工具，所有工具真实调用
    - 红线 5：不硬编码路径（项目根从环境变量或代码位置推断）
    - 简单确定性意图检测（关键词匹配），不依赖 LLM 路由（避免额外延迟）
"""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("forgemind.tools_bridge")

# 项目根目录（本文件位于 flowforge/forgemind/tools_bridge.py，向上两级）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class ToolObservation:
    """工具执行观察结果 — 注入 LLM 上下文的真实数据."""

    intent: str  # 匹配到的意图名
    tool_name: str  # 执行的工具名
    success: bool  # 是否执行成功
    data: str  # 真实数据文本（注入 LLM 上下文）
    error: str = ""  # 失败时的错误信息


# ── 意图关键词（确定性匹配，不依赖 LLM）──────────────────────────

_INTENT_KEYWORDS: dict[str, list[str]] = {
    "system_info": [
        "系统信息", "系统配置", "cpu", "内存", "磁盘", "内存配置",
        "system info", "硬件", "处理器", "memory", "disk", "配置给我看看",
        "cpu和内存", "系统状态", "机器配置",
    ],
    "project_status": [
        "项目现状", "项目状态", "git状态", "git status", "当前进度",
        "最近提交", "git log", "项目进度", "代码状态", "工作区状态",
    ],
    "list_files": [
        "列出文件", "目录结构", "有哪些文件", "list files", "目录内容",
        "看下目录", "项目结构", "文件列表",
    ],
    "read_file": [
        "读取文件", "读文件", "看下文件", "cat ", "文件内容",
        "打开文件", "查看文件",
    ],
}


def _match_intent(message: str) -> str | None:
    """从用户消息匹配动作意图.

    Args:
        message: 用户原始消息（小写化匹配）.

    Returns:
        匹配到的意图名，无匹配返回 None.
    """
    msg_lower = message.lower()
    for intent, keywords in _INTENT_KEYWORDS.items():
        for kw in keywords:
            if kw in msg_lower:
                return intent
    return None


# ── 真实工具实现 ────────────────────────────────────────────────

def _get_system_info() -> str:
    """获取真实系统信息（CPU/内存/磁盘/平台）.

    使用 psutil（如可用）获取详细指标，否则回退到标准库。
    """
    lines: list[str] = []
    lines.append(f"操作系统: {platform.system()} {platform.release()} ({platform.machine()})")
    lines.append(f"主机名: {platform.node()}")
    lines.append(f"Python: {platform.python_version()}")
    lines.append(f"处理器型号: {platform.processor() or '未知'}")
    lines.append(f"CPU 逻辑核心数: {os.cpu_count() or '未知'}")

    try:
        import psutil  # type: ignore[import-untyped]

        vm = psutil.virtual_memory()
        lines.append(f"内存总量: {vm.total / (1024**3):.2f} GB")
        lines.append(f"内存可用: {vm.available / (1024**3):.2f} GB")
        lines.append(f"内存使用率: {vm.percent}%")

        # 磁盘
        disk = psutil.disk_usage("/")
        lines.append(f"磁盘总量: {disk.total / (1024**3):.2f} GB")
        lines.append(f"磁盘已用: {disk.used / (1024**3):.2f} GB")
        lines.append(f"磁盘使用率: {disk.percent}%")

        # CPU 使用率（快速采样，间隔 0.1s）
        cpu_percent = psutil.cpu_percent(interval=0.1)
        lines.append(f"CPU 使用率: {cpu_percent}%")

        # 负载均值（仅类 Unix）
        try:
            load_avg = os.getloadavg()
            lines.append(f"系统负载(1/5/15min): {load_avg[0]:.2f}/{load_avg[1]:.2f}/{load_avg[2]:.2f}")
        except (OSError, AttributeError):
            pass  # Windows 无 getloadavg

    except ImportError:
        lines.append("(psutil 未安装，仅显示基础信息)")

    return "\n".join(lines)


def _get_project_status() -> str:
    """获取真实项目 git 状态和最近提交."""
    lines: list[str] = []
    git_bin = shutil.which("git")
    if not git_bin:
        return "git 命令不可用"

    repo_dir = str(_PROJECT_ROOT)

    def _run_git(args: list[str]) -> str:
        try:
            r = subprocess.run(
                [git_bin] + args,
                cwd=repo_dir,
                capture_output=True,
                text=True,
                timeout=10,
            )
            return r.stdout.strip() if r.returncode == 0 else f"[git error] {r.stderr.strip()}"
        except (subprocess.TimeoutExpired, OSError) as exc:
            return f"[git error] {exc}"

    # 当前分支
    branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    lines.append(f"当前分支: {branch}")

    # 状态摘要
    status = _run_git(["status", "--short"])
    if status:
        changed = status.count("\n") + 1
        lines.append(f"工作区变更: {changed} 个文件")
        # 显示前 10 个变更文件
        for line in status.split("\n")[:10]:
            lines.append(f"  {line}")
    else:
        lines.append("工作区变更: 无（干净）")

    # 最近 5 条提交
    log = _run_git(["log", "--oneline", "-5"])
    lines.append("\n最近提交:")
    for line in log.split("\n"):
        lines.append(f"  {line}")

    return "\n".join(lines)


def _list_files(target_dir: str | None = None) -> str:
    """列出真实目录内容."""
    base = Path(target_dir) if target_dir else _PROJECT_ROOT
    if not base.exists():
        return f"目录不存在: {base}"
    if not base.is_dir():
        return f"不是目录: {base}"

    lines: list[str] = [f"目录: {base}"]
    try:
        entries = sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        for entry in entries[:50]:  # 最多 50 项
            prefix = "[DIR] " if entry.is_dir() else "      "
            lines.append(f"{prefix}{entry.name}")
        total = len(list(base.iterdir()))
        if total > 50:
            lines.append(f"... 共 {total} 项（仅显示前 50）")
    except (PermissionError, OSError) as exc:
        return f"读取目录失败: {exc}"

    return "\n".join(lines)


def _extract_file_path(message: str) -> str | None:
    """从用户消息中提取文件路径.

    支持格式:
        - "读取文件 flowforge/forgemind/base.py"
        - "看下文件 d:\\\\software\\\\openclaw\\\\README.md"
        - "cat config.yaml"
    """
    import re
    # 匹配常见文件路径模式（含扩展名）
    patterns = [
        r"[\w:\\/.\-]+\.\w{1,10}",  # 含扩展名的路径
    ]
    for pattern in patterns:
        matches = re.findall(pattern, message)
        for match in matches:
            # 排除明显非文件路径的匹配（如 "cpu.1" 中的数字）
            if "." in match and not match.replace(".", "").replace("/", "").replace("\\", "").isdigit():
                return match
    return None


def _read_file_content(message: str) -> str:
    """读取真实文件内容（从消息中提取文件路径）."""
    file_path = _extract_file_path(message)
    if file_path is None:
        return '未能从消息中识别文件路径，请明确指定文件路径（如"读取文件 config.yaml"）'

    p = Path(file_path)
    if not p.is_absolute():
        p = _PROJECT_ROOT / p
    if not p.exists():
        return f"文件不存在: {p}"
    if not p.is_file():
        return f"不是文件: {p}"
    try:
        content = p.read_text(encoding="utf-8", errors="replace")
        # 限制返回长度，避免撑爆 LLM 上下文
        if len(content) > 4000:
            return content[:4000] + f"\n\n... (已截断，共 {len(content)} 字符)"
        return content
    except (PermissionError, OSError) as exc:
        return f"读取文件失败: {exc}"


# ── 工具桥接主入口 ──────────────────────────────────────────────

async def detect_and_execute(user_message: str) -> ToolObservation | None:
    """检测用户消息中的动作意图，执行真实工具，返回观察结果.

    这是端到端打通的核心：用户问"查询系统信息"→本函数执行真实系统查询
    →返回真实 CPU/内存数据→注入 LLM 上下文→LLM 基于真实数据回答.

    Args:
        user_message: 用户原始消息.

    Returns:
        ToolObservation（含真实数据），无匹配意图返回 None.
    """
    intent = _match_intent(user_message)
    if intent is None:
        return None

    logger.info("tools_bridge 意图匹配: intent=%s message=%r", intent, user_message[:80])

    try:
        if intent == "system_info":
            data = await asyncio.to_thread(_get_system_info)
            return ToolObservation(
                intent=intent, tool_name="get_system_info",
                success=True, data=data,
            )

        if intent == "project_status":
            data = await asyncio.to_thread(_get_project_status)
            return ToolObservation(
                intent=intent, tool_name="get_project_status",
                success=True, data=data,
            )

        if intent == "list_files":
            data = await asyncio.to_thread(_list_files, None)
            return ToolObservation(
                intent=intent, tool_name="list_files",
                success=True, data=data,
            )

        if intent == "read_file":
            # 尝试从消息中提取文件路径
            data = await asyncio.to_thread(_read_file_content, user_message)
            return ToolObservation(
                intent=intent, tool_name="read_file",
                success=True, data=data,
            )

    except Exception as exc:  # noqa: BLE001 — 工具执行失败不应阻断群聊
        logger.exception("tools_bridge 工具执行失败: intent=%s", intent)
        return ToolObservation(
            intent=intent, tool_name="unknown",
            success=False, data="", error=str(exc),
        )

    return None


def build_observation_context(observation: ToolObservation) -> str:
    """把工具观察结果格式化为 LLM 上下文文本.

    Args:
        observation: 工具执行观察结果.

    Returns:
        注入 LLM 上下文的文本（作为"系统观察"前置信息）.
    """
    if not observation.success:
        return f"[系统观察] 工具执行失败（{observation.tool_name}）: {observation.error}"

    return (
        f"[系统观察 — 真实工具执行结果（工具: {observation.tool_name}）]\n"
        f"以下是基于用户请求实际查询到的真实数据，请基于这些数据回答用户，"
        f'不要说"我会检查"，直接给出真实数据:\n\n'
        f"{observation.data}"
    )

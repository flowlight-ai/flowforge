"""verify_cl14_compliance.py — 第十四章 11 项关键 CL 代码层验证脚本。

验证 FlowForge v7.1 review.md 第十四章（CL-022~CL-041）中 11 项关键 CL
是否在代码层面可正确解析。

11 项关键 CL 清单（P0+P1 完全未同步）：
    CL-022 Plugin V3 manifest 完整契约
    CL-023 Schedule Factory Whitelist
    CL-024 Plugin 启停 transactional
    CL-025 F177 Close Gate 结构化判据
    CL-027 TeamAct Queue Steer
    CL-028 Restart Recovery sweep
    CL-029 Event Memory
    CL-033 Approval Hub 统一审批中心
    CL-034 QC Loop 7-Step
    CL-037 MCP 1→3 server 拆分
    CL-038 CLI stderr + NDJSON

运行方式:
    python flowforge/scripts/verify_cl14_compliance.py

退出码:
    0 — 全部 PASS 或 PARTIAL（无 FAIL）
    1 — 有 FAIL 项

详见:
    - [doc:review/review.md#第十四章] CL-022~CL-041
    - [doc:spec.md#v7.1-§9.3] P0 未同步清单
    - [doc:design.md#v7.1-§D9] 同步矩阵

License: MIT
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import os
import sys
from pathlib import Path
from typing import Any, Optional

# ── 确保 flowforge 包可被导入 ──────────────────────────────────
# 脚本位于 flowforge/scripts/ 下，需将仓库根目录（flowforge 的父目录）
# 加入 sys.path，以便 `from flowforge.core import xxx` 可解析。
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent.parent  # d:\software\openclaw
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# 避免 Windows GBK 编码问题（运行前也可由调用方设置 PYTHONIOENCODING=utf-8）
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# 强制 stdout/stderr 使用 UTF-8 编码（Windows 控制台默认 GBK 会丢失中文/特殊字符）
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    # 某些环境下 stdout 可能不支持 reconfigure（如重定向到文件时）
    pass


# ──────────────────────────────────────────────────────────────────────────────
# 辅助函数
# ──────────────────────────────────────────────────────────────────────────────


def _module_exists(module_name: str) -> bool:
    """检查模块是否可被 importlib 定位（不实际导入）。"""
    try:
        spec = importlib.util.find_spec(module_name)
        return spec is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def _file_exists(rel_path: str) -> bool:
    """检查 flowforge 包内某相对路径文件是否存在。"""
    target = _SCRIPT_DIR.parent / rel_path
    return target.exists()


def _has_method(cls: type, method_name: str) -> bool:
    """检查类是否定义了某方法（含继承，但排除 object 内置方法）。"""
    method = getattr(cls, method_name, None)
    if method is None:
        return False
    if method_name in {"__init__", "__str__", "__repr__"}:
        return False
    return callable(method)


def _has_field(obj: Any, field_name: str) -> bool:
    """检查对象/类是否拥有某字段（属性或 Pydantic 字段）。"""
    # 检查实例属性
    if hasattr(obj, field_name):
        return True
    # 检查 Pydantic model_fields（类层级）
    model_fields = getattr(type(obj), "model_fields", None)
    if model_fields and field_name in model_fields:
        return True
    return False


def _is_async_gen(func: Any) -> bool:
    """判断函数是否为异步生成器。"""
    return inspect.isasyncgenfunction(func)


# ──────────────────────────────────────────────────────────────────────────────
# CL 验证函数
# ──────────────────────────────────────────────────────────────────────────────


def verify_cl022() -> tuple[str, str]:
    """CL-022 Plugin V3 manifest 完整契约."""
    try:
        from flowforge.core.plugin_protocol import (
            FlowForgePlugin,
            PluginManifest,
        )

        # 实例化 PluginManifest
        manifest = PluginManifest(
            name="verify_cl022_test",
            version="1.0.0",
            description="CL-022 验证用 manifest",
            author="verifier",
        )

        # 基础字段
        basic_fields = ["name", "version", "description", "author"]
        missing_basic = [f for f in basic_fields if not hasattr(manifest, f)]
        if missing_basic:
            return (
                "FAIL",
                f"PluginManifest 缺少基础字段: {missing_basic}",
            )

        # V7.0 育灵字段
        v70_fields = [
            "forgekins_dir",
            "codex_dir",
            "council_dir",
            "auto_forge_dir",
        ]
        missing_v70 = [f for f in v70_fields if not hasattr(manifest, f)]
        if missing_v70:
            return (
                "PARTIAL",
                f"PluginManifest 缺少 V7.0 育灵字段: {missing_v70}",
            )

        # FlowForgePlugin 可被继承实例化（验证 ABC 可用）
        class _TestPlugin(FlowForgePlugin):
            pass

        plugin = _TestPlugin()
        if not hasattr(plugin, "manifest"):
            return "FAIL", "FlowForgePlugin 实例缺少 manifest 属性"

        return (
            "PASS",
            "PluginManifest 实例化成功，含 forgekins_dir/codex_dir/"
            "council_dir/auto_forge_dir 4 个 V7.0 育灵字段",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl023() -> tuple[str, str]:
    """CL-023 Schedule Factory Whitelist."""
    try:
        from flowforge.core import ScheduleFactoryRegistry

        registry = ScheduleFactoryRegistry()

        # 验证 6 个核心方法
        required_methods = [
            "register",
            "unregister",
            "allocate_task_id",
            "list_factories",
            "validate_at_startup",
        ]
        missing = [m for m in required_methods if not _has_method(registry, m)]
        if missing:
            return (
                "PARTIAL",
                f"ScheduleFactoryRegistry 实例化成功，但缺少方法: {missing}",
            )

        # 验证 get_factory（额外查询方法）
        has_get_factory = _has_method(registry, "get_factory")

        method_count = len(required_methods) + (1 if has_get_factory else 0)
        extra_note = "（含 get_factory 查询接口）" if has_get_factory else ""

        return (
            "PASS",
            f"ScheduleFactoryRegistry 实例化成功，含 {method_count} 个方法"
            f"{extra_note}",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl024() -> tuple[str, str]:
    """CL-024 Plugin 启停 transactional."""
    try:
        from flowforge.core.plugin_protocol import FlowForgePlugin

        # 验证 on_activate / on_disable 钩子存在性
        has_activate = _has_method(FlowForgePlugin, "on_activate")
        has_disable = _has_method(FlowForgePlugin, "on_disable")

        if has_activate and has_disable:
            return (
                "PASS",
                "FlowForgePlugin 含 on_activate/on_disable 事务性启停钩子",
            )

        # 检查是否具备等价的生命周期钩子（on_startup/on_shutdown）
        has_startup = _has_method(FlowForgePlugin, "on_startup")
        has_shutdown = _has_method(FlowForgePlugin, "on_shutdown")

        missing = []
        if not has_activate:
            missing.append("on_activate")
        if not has_disable:
            missing.append("on_disable")

        if has_startup and has_shutdown:
            return (
                "PARTIAL",
                f"缺少 {missing} 钩子，但存在 on_startup/on_shutdown "
                f"等价生命周期钩子（未实现 transactional 启停）",
            )

        return (
            "FAIL",
            f"缺少 on_activate/on_disable 钩子（也无等价生命周期钩子）: {missing}",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl025() -> tuple[str, str]:
    """CL-025 F177 Close Gate 结构化判据."""
    try:
        # 检查 close_gate.py 是否存在
        if not _file_exists("evolution/close_gate.py"):
            # 检查是否在任何其他位置实现
            if _module_exists("flowforge.evolution.close_gate"):
                pass  # 模块存在但路径不同
            else:
                return (
                    "FAIL",
                    "flowforge/evolution/close_gate.py 不存在，"
                    "CloseGateValidator 未实现",
                )

        # 尝试导入 CloseGateValidator
        try:
            from flowforge.evolution.close_gate import CloseGateValidator
        except ImportError as e:
            return (
                "FAIL",
                f"close_gate 模块存在但 CloseGateValidator 导入失败: {e}",
            )

        # 实例化
        try:
            validator = CloseGateValidator()
        except Exception as e:
            return (
                "PARTIAL",
                f"CloseGateValidator 类存在但实例化失败: "
                f"{type(e).__name__}: {e}",
            )

        # 检查 AC→evidence 矩阵方法（启发式：查找含 ac/evidence/matrix 的方法名）
        ac_methods = [
            m for m in dir(validator)
            if callable(getattr(validator, m, None))
            and not m.startswith("_")
            and any(kw in m.lower() for kw in ["ac", "evidence", "matrix", "validate", "gate"])
        ]

        if not ac_methods:
            return (
                "PARTIAL",
                "CloseGateValidator 实例化成功，但未发现 AC→evidence 矩阵方法",
            )

        return (
            "PASS",
            f"CloseGateValidator 实例化成功，含 AC→evidence 相关方法: "
            f"{ac_methods[:3]}",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl027() -> tuple[str, str]:
    """CL-027 TeamAct Queue Steer."""
    try:
        # 检查 teamact 目录或 teamact.py 模块
        teamact_dir = _SCRIPT_DIR.parent / "core" / "teamact"
        teamact_module = _module_exists("flowforge.core.teamact")

        if not teamact_dir.exists() and not teamact_module:
            return (
                "FAIL",
                "flowforge/core/teamact/ 目录或 teamact.py 模块不存在",
            )

        # teamact 目录存在 — 检查 SteerCommand 数据类
        # 在 teamact 子包内查找 SteerCommand
        steer_command_found = False
        steer_command_location = ""
        search_modules = [
            "flowforge.core.teamact.types",
            "flowforge.core.teamact.state_machine",
            "flowforge.core.teamact.handoff",
            "flowforge.core.teamact.circuit_breaker",
        ]
        for mod_name in search_modules:
            try:
                mod = importlib.import_module(mod_name)
                if hasattr(mod, "SteerCommand"):
                    steer_command_found = True
                    steer_command_location = mod_name
                    break
            except ImportError:
                continue

        if not steer_command_found:
            # teamact 目录存在但 SteerCommand 未实现
            # 列出已有的 teamact 类作为参考
            existing_classes = []
            for mod_name in search_modules:
                try:
                    mod = importlib.import_module(mod_name)
                    for attr_name in dir(mod):
                        obj = getattr(mod, attr_name, None)
                        if isinstance(obj, type) and not attr_name.startswith("_"):
                            existing_classes.append(f"{mod_name}.{attr_name}")
                except ImportError:
                    continue

            return (
                "PARTIAL",
                f"teamact/ 目录存在（含 {len(existing_classes)} 个类），"
                f"但 SteerCommand 数据类未实现（仅文档定义）",
            )

        # SteerCommand 存在 — 检查 priority_boost / interrupt / requeue 字段
        mod = importlib.import_module(steer_command_location)
        SteerCommand = getattr(mod, "SteerCommand")

        try:
            instance = SteerCommand()
        except Exception:
            # 可能是 dataclass 需要参数 — 尝试通过类层级检查字段
            instance = SteerCommand

        required_fields = ["priority_boost", "interrupt", "requeue"]
        missing_fields = [f for f in required_fields if not _has_field(instance, f)]

        if missing_fields:
            return (
                "PARTIAL",
                f"SteerCommand 存在（@ {steer_command_location}），"
                f"但缺少字段: {missing_fields}",
            )

        return (
            "PASS",
            f"SteerCommand 存在（@ {steer_command_location}），"
            f"含 priority_boost/interrupt/requeue 字段",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl028() -> tuple[str, str]:
    """CL-028 Restart Recovery sweep."""
    try:
        from flowforge.core import RestartRecoveryPipeline

        pipeline = RestartRecoveryPipeline()

        # 验证三阶段四方法
        required_methods = [
            "execute_phase_a_sweep",
            "execute_phase_a_plus_notify",
            "execute_phase_b_persist",
            "execute_phase_b_replay",
        ]
        missing = [m for m in required_methods if not _has_method(pipeline, m)]
        if missing:
            return (
                "PARTIAL",
                f"RestartRecoveryPipeline 实例化成功，但缺少方法: {missing}",
            )

        # 验证 run_full_pipeline 完整流水线方法
        has_full = _has_method(pipeline, "run_full_pipeline")

        return (
            "PASS",
            f"RestartRecoveryPipeline 实例化成功，含 4 个阶段方法"
            f"（Phase A/A+/B persist/B replay）"
            + ("+ run_full_pipeline 完整流水线" if has_full else ""),
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl029() -> tuple[str, str]:
    """CL-029 Event Memory."""
    try:
        from flowforge.core import EventMemoryStore, EventRecord

        store = EventMemoryStore()

        # 验证 6 个核心方法
        required_methods = [
            "record",
            "get",
            "teleport",
            "list_by_thread",
            "add_resolution_link",
            "analyze_trend",
        ]
        missing = [m for m in required_methods if not _has_method(store, m)]
        if missing:
            return (
                "PARTIAL",
                f"EventMemoryStore 实例化成功，但缺少方法: {missing}",
            )

        # 验证 EventRecord 字段
        # spec 字段 → 实际字段映射（含语义等价名）
        field_mapping = {
            "thread_id": "thread_id",       # 精确匹配
            "message_id": "message_id",     # 精确匹配
            "event_type": "type",           # 语义等价（type 即 event_type）
            "trigger": "trigger",           # 精确匹配
            "owner": "owner_user_id",       # 语义等价（owner_user_id 即 owner）
            "created_at": "timestamp",      # 语义等价（timestamp 即 created_at）
            "expires_at": None,             # 无对应字段（用 purge_expired 方法替代）
            "resolution_links": None,       # 无对应字段（独立 ResolutionLink 模型）
        }

        # 获取 EventRecord 的 Pydantic model_fields
        model_fields = getattr(EventRecord, "model_fields", {})
        existing_fields = set(model_fields.keys())

        matched = []
        missing_fields = []
        for spec_field, actual_field in field_mapping.items():
            if actual_field is None:
                missing_fields.append(spec_field)
            elif actual_field in existing_fields:
                matched.append(f"{spec_field}→{actual_field}")
            else:
                missing_fields.append(spec_field)

        # no-classifier 红线：检查模块是否导入 LLM 客户端
        import flowforge.core.event_memory as em_module
        source = inspect.getsource(em_module)
        llm_keywords = ["LLMClient", "llm_client", "from flowforge.llm", "openai", "anthropic"]
        has_llm_import = any(kw in source for kw in llm_keywords)
        if has_llm_import:
            return (
                "PARTIAL",
                "EventMemoryStore 方法齐全，但违反 no-classifier 红线"
                "（模块导入 LLM 客户端）",
            )

        if missing_fields:
            return (
                "PARTIAL",
                f"EventMemoryStore 6 方法齐全，no-classifier 红线合规，"
                f"但 EventRecord 缺少字段: {missing_fields}"
                f"（实现用 purge_expired 替代 expires_at，"
                f"ResolutionLink 独立模型替代 resolution_links）",
            )

        return (
            "PASS",
            f"EventMemoryStore 6 方法齐全，EventRecord 字段完整"
            f"（{len(matched)} 个字段匹配），no-classifier 红线合规",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl033() -> tuple[str, str]:
    """CL-033 Approval Hub 统一审批中心."""
    try:
        # 检查 approval_hub.py 或 approval/ 目录
        approval_hub_file = _SCRIPT_DIR.parent / "core" / "approval_hub.py"
        approval_dir = _SCRIPT_DIR.parent / "core" / "approval"

        if not approval_hub_file.exists() and not approval_dir.exists():
            # 检查是否有等价的 ApprovalHub 类
            if _module_exists("flowforge.core.approval_hub"):
                pass
            else:
                return (
                    "FAIL",
                    "flowforge/core/approval_hub.py 或 approval/ 目录不存在，"
                    "ApprovalHub 类未实现",
                )

        # 尝试导入 ApprovalHub
        try:
            from flowforge.core.approval_hub import ApprovalHub
        except ImportError as e:
            return (
                "FAIL",
                f"approval_hub 模块存在但 ApprovalHub 导入失败: {e}",
            )

        # 实例化
        try:
            hub = ApprovalHub()
        except Exception as e:
            return (
                "PARTIAL",
                f"ApprovalHub 类存在但实例化失败: {type(e).__name__}: {e}",
            )

        # 检查提交/批准/拒绝 方法（启发式）
        submit_methods = [m for m in dir(hub) if "submit" in m.lower() or "request" in m.lower()]
        approve_methods = [m for m in dir(hub) if "approve" in m.lower() or "accept" in m.lower()]
        reject_methods = [m for m in dir(hub) if "reject" in m.lower() or "deny" in m.lower() or "decline" in m.lower()]

        has_submit = len(submit_methods) > 0
        has_approve = len(approve_methods) > 0
        has_reject = len(reject_methods) > 0

        if has_submit and has_approve and has_reject:
            return (
                "PASS",
                f"ApprovalHub 实例化成功，含提交/批准/拒绝方法",
            )

        missing_actions = []
        if not has_submit:
            missing_actions.append("提交(submit)")
        if not has_approve:
            missing_actions.append("批准(approve)")
        if not has_reject:
            missing_actions.append("拒绝(reject)")

        return (
            "PARTIAL",
            f"ApprovalHub 实例化成功，但缺少审批动作: {missing_actions}",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl034() -> tuple[str, str]:
    """CL-034 QC Loop 7-Step."""
    try:
        # 检查 qc_loop.py 是否存在
        if not _file_exists("evolution/qc_loop.py"):
            if _module_exists("flowforge.evolution.qc_loop"):
                pass
            else:
                return (
                    "FAIL",
                    "flowforge/evolution/qc_loop.py 不存在，"
                    "QCLoop 类未实现",
                )

        # 尝试导入 QCLoop
        try:
            from flowforge.evolution.qc_loop import QCLoop
        except ImportError as e:
            return (
                "FAIL",
                f"qc_loop 模块存在但 QCLoop 导入失败: {e}",
            )

        # 实例化
        try:
            loop = QCLoop()
        except Exception as e:
            return (
                "PARTIAL",
                f"QCLoop 类存在但实例化失败: {type(e).__name__}: {e}",
            )

        # 验证 7 步方法
        required_methods = [
            "prepare",
            "scan",
            "analyze",
            "fix",
            "verify",
            "iterate",
            "close",
        ]
        missing = [m for m in required_methods if not _has_method(loop, m)]
        if missing:
            return (
                "PARTIAL",
                f"QCLoop 实例化成功，但缺少 7 步方法: {missing}",
            )

        return (
            "PASS",
            f"QCLoop 实例化成功，含 7 步方法"
            f"（prepare/scan/analyze/fix/verify/iterate/close）",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl037() -> tuple[str, str]:
    """CL-037 MCP 1→3 server 拆分."""
    try:
        # 检查 host_injection.py 是否存在
        if not _file_exists("core/external_agent/host_injection.py"):
            return (
                "FAIL",
                "flowforge/core/external_agent/host_injection.py 不存在",
            )

        from flowforge.core.external_agent.host_injection import HostInjector

        # 验证 inject_mcp_config 方法存在
        if not _has_method(HostInjector, "inject_mcp_config"):
            return (
                "FAIL",
                "HostInjector 类存在但缺少 inject_mcp_config 方法",
            )

        # 验证 MCP 配置支持按职能分离（collab/memory/signals）
        # 启发式：检查 inject_mcp_config 方法签名或源码中是否含分离关键字
        method = getattr(HostInjector, "inject_mcp_config", None)
        source = inspect.getsource(method) if method else ""

        split_keywords = ["collab", "memory", "signals"]
        found_keywords = [kw for kw in split_keywords if kw in source.lower()]

        # 也检查 SandboxConfig 是否有 mcp_servers 字段
        try:
            from flowforge.core.external_agent.host_injection import SandboxConfig
            has_mcp_servers = "mcp_servers" in getattr(SandboxConfig, "model_fields", {})
        except ImportError:
            has_mcp_servers = False

        if len(found_keywords) >= 3:
            return (
                "PASS",
                f"HostInjector.inject_mcp_config 存在，"
                f"MCP 配置支持 collab/memory/signals 3 职能分离",
            )

        if has_mcp_servers:
            return (
                "PARTIAL",
                f"HostInjector.inject_mcp_config 存在，"
                f"SandboxConfig 含 mcp_servers 字段，"
                f"但未实现 collab/memory/signals 1→3 server 拆分"
                f"（找到 {len(found_keywords)}/3 关键字: {found_keywords}）",
            )

        return (
            "PARTIAL",
            f"HostInjector.inject_mcp_config 存在，"
            f"但未实现 collab/memory/signals 1→3 server 拆分",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


def verify_cl038() -> tuple[str, str]:
    """CL-038 CLI stderr + NDJSON."""
    try:
        from flowforge.core.external_agent import (
            NDJSONParser,
            StderrCollector,
            CLIResult,
            parse_cli_invocation,
            stream_cli_invocation,
        )

        # ── NDJSONParser 方法验证 ──
        parser = NDJSONParser()
        ndjson_methods = [
            "feed",
            "feed_chunk",
            "get_parsed_count",
            "get_parse_failures",
        ]
        missing_ndjson = [m for m in ndjson_methods if not _has_method(parser, m)]
        if missing_ndjson:
            return (
                "PARTIAL",
                f"NDJSONParser 实例化成功，但缺少方法: {missing_ndjson}",
            )

        # 基本调用验证
        parser.feed('{"key": "value"}')
        if parser.get_parsed_count() != 1:
            return (
                "PARTIAL",
                f"NDJSONParser.feed 调用后 parsed_count 异常: "
                f"{parser.get_parsed_count()}",
            )

        # ── StderrCollector 方法验证 ──
        collector = StderrCollector()
        stderr_methods = [
            "feed",
            "get_lines",
            "has_fatal",
            "summary",
        ]
        missing_stderr = [m for m in stderr_methods if not _has_method(collector, m)]
        if missing_stderr:
            return (
                "PARTIAL",
                f"StderrCollector 实例化成功，但缺少方法: {missing_stderr}",
            )

        # 基本调用验证
        collector.feed("ERROR something failed")
        summary = collector.summary()
        if not isinstance(summary, dict) or "total" not in summary:
            return (
                "PARTIAL",
                "StderrCollector.summary() 返回结构异常",
            )

        # ── parse_cli_invocation 函数签名 ──
        if not callable(parse_cli_invocation):
            return "FAIL", "parse_cli_invocation 不可调用"

        sig = inspect.signature(parse_cli_invocation)
        expected_params = {"stdout", "stderr", "returncode"}
        actual_params = set(sig.parameters.keys())
        if not expected_params.issubset(actual_params):
            return (
                "PARTIAL",
                f"parse_cli_invocation 签名缺少参数: "
                f"期望 {expected_params}，实际 {actual_params}",
            )

        # 基本调用验证
        result = parse_cli_invocation(
            stdout='{"a": 1}\n{"b": 2}',
            stderr="WARNING deprecated\nERROR oops",
            returncode=0,
        )
        if not isinstance(result, CLIResult):
            return "PARTIAL", "parse_cli_invocation 返回类型非 CLIResult"
        if not result.success or result.returncode != 0:
            return "PARTIAL", "parse_cli_invocation returncode=0 时 success 应为 True"
        if len(result.ndjson_objects) != 2:
            return (
                "PARTIAL",
                f"parse_cli_invocation NDJSON 解析数量异常: "
                f"{len(result.ndjson_objects)} (期望 2)",
            )

        # ── stream_cli_invocation async 生成器 ──
        if not callable(stream_cli_invocation):
            return "FAIL", "stream_cli_invocation 不可调用"

        if not _is_async_gen(stream_cli_invocation):
            return (
                "PARTIAL",
                "stream_cli_invocation 不是 async 生成器",
            )

        # 验证签名接受 process 参数
        stream_sig = inspect.signature(stream_cli_invocation)
        if "process" not in stream_sig.parameters:
            return (
                "PARTIAL",
                f"stream_cli_invocation 签名缺少 process 参数: "
                f"{list(stream_sig.parameters.keys())}",
            )

        return (
            "PASS",
            "NDJSONParser/StderrCollector/CLIResult 全部可导入并实例化，"
            "parse_cli_invocation 签名含 stdout/stderr/returncode，"
            "stream_cli_invocation 为 async 生成器",
        )
    except ImportError as e:
        return "FAIL", f"导入失败: {e}"
    except Exception as e:
        return "FAIL", f"验证异常: {type(e).__name__}: {e}"


# ──────────────────────────────────────────────────────────────────────────────
# 主函数
# ──────────────────────────────────────────────────────────────────────────────


def main() -> int:
    """运行 11 项 CL 代码层验证，返回 exit code。"""
    results = []
    results.append(("CL-022", "Plugin V3 manifest 完整契约", *verify_cl022()))
    results.append(("CL-023", "Schedule Factory Whitelist", *verify_cl023()))
    results.append(("CL-024", "Plugin 启停 transactional", *verify_cl024()))
    results.append(("CL-025", "F177 Close Gate 结构化判据", *verify_cl025()))
    results.append(("CL-027", "TeamAct Queue Steer", *verify_cl027()))
    results.append(("CL-028", "Restart Recovery sweep", *verify_cl028()))
    results.append(("CL-029", "Event Memory", *verify_cl029()))
    results.append(("CL-033", "Approval Hub 统一审批中心", *verify_cl033()))
    results.append(("CL-034", "QC Loop 7-Step", *verify_cl034()))
    results.append(("CL-037", "MCP 1→3 server 拆分", *verify_cl037()))
    results.append(("CL-038", "CLI stderr + NDJSON", *verify_cl038()))

    # 输出每个 CL 结果
    for cl_id, topic, status, message in results:
        print(f"[{cl_id}] [{status}] {topic} — {message}")

    # 汇总
    pass_count = sum(1 for _, _, s, _ in results if s == "PASS")
    partial_count = sum(1 for _, _, s, _ in results if s == "PARTIAL")
    fail_count = sum(1 for _, _, s, _ in results if s == "FAIL")

    print("\n" + "=" * 40)
    print("CL 第十四章代码层验证汇总")
    print("=" * 40)
    print(f"PASS:    {pass_count} 项")
    print(f"PARTIAL: {partial_count} 项")
    print(f"FAIL:    {fail_count} 项")
    print(f"TOTAL:   {len(results)} 项")
    print("=" * 40)

    return 1 if fail_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())

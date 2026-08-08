import sys
import platform
import yaml
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from flowforge.core.tracing import get_trace_id, get_logger

logger = get_logger("api.system")

router = APIRouter(prefix="/system", tags=["system"])

_WORKFLOW_DIRS = [
    Path(__file__).parent.parent.parent.parent / "config" / "workflows",
    Path(__file__).parent.parent.parent.parent / "workflows",
]

_psutil_available = False
try:
    import psutil
    _psutil_available = True
except ImportError as e:
    logger.debug(f"Optional dependency not available: {e}")


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("/platform")
async def get_platform():
    platform_info = {
        "os": sys.platform,
        "os_name": platform.system(),
        "os_version": platform.version(),
        "os_release": platform.release(),
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
        "hostname": platform.node(),
        "sandbox_available": sys.platform != "win32",
        "sandbox_type": "subprocess",
        "memory_limit_supported": sys.platform != "win32",
        "psutil_available": _psutil_available,
    }
    if _psutil_available:
        platform_info.update({
            "cpu_count": psutil.cpu_count(),
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_total_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
            "memory_available_gb": round(psutil.virtual_memory().available / (1024 ** 3), 2),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_total_gb": round(psutil.disk_usage("/").total / (1024 ** 3), 2) if sys.platform != "win32" else round(psutil.disk_usage("C:\\").total / (1024 ** 3), 2),
            "disk_percent": psutil.disk_usage("/").percent if sys.platform != "win32" else psutil.disk_usage("C:\\").percent,
        })
    return _make_response(platform_info)


@router.get("/agents")
async def list_agents():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        agents = executor.agent_registry.list_agents()
        result = []
        for name in agents:
            agent = executor.agent_registry.get(name)
            result.append({
                "name": name,
                "description": getattr(agent, "description", "") or "",
                "enabled": True,
                "mode": getattr(agent, "default_mode", None),
            })
        return {"agents": result}
    except Exception as e:
        logger.warning(f"Failed to list agents: {e}")
        return {"agents": [], "error": "agent_registry not available"}


@router.get("/modes")
async def list_modes():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        modes = executor.mode_registry.list_modes()
        result = []
        for name in modes:
            mode = executor.mode_registry.get(name)
            result.append({
                "name": name,
                "description": getattr(mode, "description", "") or "",
                "enabled": True,
            })
        return {"modes": result}
    except Exception as e:
        logger.warning(f"Failed to list modes: {e}")
        return {"modes": [], "error": "mode_registry not available"}


@router.get("/tools")
async def list_tools():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        tools = executor.tool_registry.list_tools()
        result = []
        for name in tools:
            tool = executor.tool_registry.get_tool(name)
            result.append({
                "name": name,
                "description": getattr(tool, "description", "") or "",
                "enabled": True,
                "category": getattr(tool, "category", None),
            })
        return {"tools": result}
    except Exception as e:
        logger.warning(f"Failed to list tools: {e}")
        return {"tools": [], "error": "tool_registry not available"}


@router.get("/memory")
async def list_memory():
    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()
        stores = []
        if hasattr(executor, "memory_manager"):
            for name in executor.memory_manager.list_stores():
                stores.append({"name": name, "description": "Memory store", "enabled": True, "type": "sqlite"})
        return {"memory": stores}
    except Exception as e:
        logger.warning(f"Failed to list memory: {e}")
        return {"memory": [], "error": "memory_manager not available"}


def _load_workflow_steps_for_graph() -> list:
    seen_names: set = set()
    workflows = []
    for wf_dir in _WORKFLOW_DIRS:
        if not wf_dir.exists():
            continue
        for f in sorted(wf_dir.glob("*.yaml")):
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh) or {}
                name = data.get("name", f.stem)
                if name in seen_names:
                    continue
                seen_names.add(name)
                steps = []
                for s in data.get("steps", []):
                    if s.get("parallel_group"):
                        for item in s["parallel_group"]:
                            steps.append({
                                "name": item.get("name", item.get("id", "")),
                                "agent": item.get("agent", ""),
                                "mode": item.get("mode", ""),
                            })
                    else:
                        steps.append({
                            "name": s.get("name", s.get("id", "")),
                            "agent": s.get("agent", ""),
                            "mode": s.get("mode", ""),
                            "human": s.get("human", False),
                        })
                workflows.append({
                    "name": name,
                    "display_name": data.get("display_name", name),
                    "description": data.get("description", ""),
                    "icon": data.get("icon", ""),
                    "category": data.get("category", ""),
                    "steps": steps,
                })
            except Exception as e:
                logger.warning(f"Failed to load workflow {f.name}: {e}")
    return workflows


@router.get("/dependency-graph")
async def get_dependency_graph():
    nodes = []
    edges = []
    node_ids = set()

    def add_node(nid: str, ntype: str, label: str, data: dict):
        if nid not in node_ids:
            node_ids.add(nid)
            nodes.append({"id": nid, "type": ntype, "label": label, "data": data})

    def add_edge(source: str, target: str, label: str):
        edge_key = (source, target, label)
        if source in node_ids and target in node_ids and edge_key not in {(e["source"], e["target"], e["label"]) for e in edges}:
            edges.append({"source": source, "target": target, "label": label})

    try:
        from flowforge.app.deps import get_executor
        executor = await get_executor()

        for name in executor.agent_registry.list_agents():
            agent = executor.agent_registry.get(name)
            desc = getattr(agent, "description", "") or ""
            mode = getattr(agent, "default_mode", None)
            add_node(f"agent:{name}", "agent", name, {"description": desc, "default_mode": mode})
            if mode:
                add_node(f"mode:{mode}", "mode", mode, {"description": ""})
                add_edge(f"agent:{name}", f"mode:{mode}", "default_mode")

        for name in executor.mode_registry.list_modes():
            mode = executor.mode_registry.get(name)
            desc = getattr(mode, "description", "") or ""
            caps = getattr(mode, "capabilities", []) or []
            add_node(f"mode:{name}", "mode", name, {"description": desc, "capabilities": caps})

        for name in executor.tool_registry.list_tools():
            tool = executor.tool_registry.get_tool(name)
            desc = getattr(tool, "description", "") or ""
            cat = getattr(tool, "category", None)
            add_node(f"tool:{name}", "tool", name, {"description": desc, "category": cat})

        if hasattr(executor, "memory_manager") and executor.memory_manager:
            for name in executor.memory_manager.list_stores():
                add_node(f"memory:{name}", "memory", name, {"type": "sqlite"})

        for wf in _load_workflow_steps_for_graph():
            wf_name = wf["name"]
            add_node(f"workflow:{wf_name}", "workflow", wf["display_name"] or wf_name, {
                "description": wf["description"],
                "icon": wf["icon"],
                "category": wf["category"],
                "steps": [s["name"] for s in wf["steps"]],
            })
            for step in wf["steps"]:
                agent_name = step.get("agent", "")
                if agent_name:
                    add_edge(f"workflow:{wf_name}", f"agent:{agent_name}", "uses")
                mode_name = step.get("mode", "")
                if mode_name:
                    add_node(f"mode:{mode_name}", "mode", mode_name, {"description": ""})
                    add_edge(f"workflow:{wf_name}", f"mode:{mode_name}", "runs_in")

        for name in executor.agent_registry.list_agents():
            agent = executor.agent_registry.get(name)
            tool_names = getattr(agent, "tool_names", None)
            if tool_names:
                for tn in tool_names:
                    add_edge(f"agent:{name}", f"tool:{tn}", "calls")

        tool_memory_map = {
            "cache": "working",
            "opensieve_search": "semantic",
        }
        for tool_name, mem_name in tool_memory_map.items():
            if f"tool:{tool_name}" in node_ids and f"memory:{mem_name}" in node_ids:
                add_edge(f"tool:{tool_name}", f"memory:{mem_name}", "uses")

    except Exception as e:
        logger.warning(f"Failed to build dependency graph: {e}")

    return _make_response({"nodes": nodes, "edges": edges})


@router.post("/browse-directory")
async def browse_directory():
    """List local directories for the frontend directory browser."""
    try:
        import os
        # Return common root directories for the user to browse
        if sys.platform == "win32":
            # Windows: list drive letters
            drives = []
            for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                drive = f"{letter}:\\"
                if os.path.exists(drive):
                    drives.append({"name": drive, "path": drive, "is_dir": True})
            # Add user home directory
            home = os.path.expanduser("~")
            drives.insert(0, {"name": f"Home ({home})", "path": home, "is_dir": True})
            return {"roots": drives}
        else:
            # Linux/Mac: list root and home
            home = os.path.expanduser("~")
            return {"roots": [
                {"name": "Home", "path": home, "is_dir": True},
                {"name": "Root", "path": "/", "is_dir": True},
            ]}
    except Exception as e:
        return {"roots": [], "error": str(e)}


class ListDirRequest(BaseModel):
    path: str


@router.post("/list-directory")
async def list_directory(req: ListDirRequest):
    """List contents of a directory for the frontend directory browser."""
    import os
    try:
        target = req.path
        if not os.path.isdir(target):
            return {"items": [], "error": "Not a directory"}
        items = []
        for entry in os.scandir(target):
            try:
                is_dir = entry.is_dir()
                if not is_dir and not entry.is_file():
                    continue
                items.append({
                    "name": entry.name,
                    "path": entry.path,
                    "is_dir": is_dir,
                })
            except (PermissionError, OSError):
                continue
        # Sort: directories first, then by name
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return {"items": items[:200]}  # Limit to 200 items
    except PermissionError:
        return {"items": [], "error": "Permission denied"}
    except Exception as e:
        return {"items": [], "error": str(e)}


class ExecuteRequest(BaseModel):
    command: str
    timeout: int = 30


@router.post("/execute")
async def execute_command(req: ExecuteRequest):
    """Execute a shell command and return the output."""
    # 安全限制：禁止危险命令
    dangerous = ["rm -rf", "del /", "format", "shutdown", "rmdir /s"]
    cmd_lower = req.command.lower()
    for d in dangerous:
        if d in cmd_lower:
            raise HTTPException(status_code=403, detail=f"禁止执行危险命令: {d}")

    try:
        import sys
        import subprocess
        if sys.platform == "win32":
            # Windows: use cmd.exe /c to execute commands
            proc = subprocess.run(
                ["cmd.exe", "/c", req.command],
                capture_output=True,
                timeout=req.timeout,
                text=True,
                errors="replace",
            )
            output = proc.stdout or ""
            err_output = proc.stderr or ""
            if err_output:
                output = output + "\n" + err_output if output else err_output
            if not output and proc.returncode != 0:
                output = f"命令退出码: {proc.returncode}"
            return {"output": output, "returncode": proc.returncode}
        else:
            proc = await asyncio.create_subprocess_shell(
                req.command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=req.timeout)
            output = stdout.decode("utf-8", errors="replace")
            err_output = stderr.decode("utf-8", errors="replace") if stderr else ""
            if err_output:
                output = output + "\n" + err_output if output else err_output
            if not output and proc.returncode != 0:
                output = f"命令退出码: {proc.returncode}"
            return {"output": output, "returncode": proc.returncode}
    except subprocess.TimeoutExpired:
        return {"output": f"命令超时（{req.timeout}秒）", "error": True}
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {"output": f"命令超时（{req.timeout}秒）", "error": True}
    except Exception as e:
        return {"output": str(e), "error": True}

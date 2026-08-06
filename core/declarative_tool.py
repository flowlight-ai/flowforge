"""DeclarativeTool — 声明式Tool定义，无需编写Python代码

支持三种声明式Tool模板：
- HTTP Tool: 调用REST API
- Script Tool: 执行命令行
- Transform Tool: JSON变换

设计文档参考：spec.md v2.2, LP3.0-37
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("declarative_tool")


class HTTPAuthConfig(BaseModel):
    """HTTP认证配置"""
    type: str = "bearer"  # bearer / basic / api_key / none
    token_env: str = ""   # 环境变量名
    header_name: str = "Authorization"
    prefix: str = "Bearer"


class HTTPToolConfig(BaseModel):
    """HTTP Tool配置"""
    base_url: str
    method: str = "GET"
    path: str = ""
    auth: HTTPAuthConfig | None = None
    headers: dict[str, str] = {}
    timeout: float = 30.0
    response_mapping: dict[str, str] | None = None  # JMESPath表达式
    error_path: str | None = None  # 错误响应路径


class ScriptToolConfig(BaseModel):
    """Script Tool配置"""
    command: str  # 支持模板变量 {param_name}
    work_dir: str = ""
    timeout: float = 60.0
    output_format: str = "text"  # text / json
    env: dict[str, str] = {}


class TransformToolConfig(BaseModel):
    """Transform Tool配置"""
    expression: str  # JMESPath/JSONata表达式
    default: Any = None
    input_schema: dict[str, Any] | None = None


class DeclarativeToolConfig(BaseModel):
    """声明式Tool配置"""
    model_config = {"extra": "allow"}

    name: str = Field(..., description="Tool名称")
    description: str = Field(default="", description="Tool描述")
    type: str = Field(default="http", description="Tool类型: http | script | transform")
    parameters_schema: dict[str, Any] = Field(default_factory=dict, description="参数JSON Schema")
    safety_level: str = Field(default="read", description="安全级别: read | suggest | prepare | execute")

    # 类型特定配置
    http: HTTPToolConfig | None = None
    script: ScriptToolConfig | None = None
    transform: TransformToolConfig | None = None


class HTTPTool(BaseTool):
    """HTTP Tool — 调用REST API"""

    def __init__(self, config: DeclarativeToolConfig):
        self._config = config
        self._http_config = config.http or HTTPToolConfig(base_url="")
        self.name = config.name
        self.description = config.description
        self.parameters_schema = config.parameters_schema
        self.safety_level = config.safety_level
        self.is_concurrency_safe = True

    async def execute(self, input: ToolInput) -> ToolOutput:
        import httpx

        params = dict(input.params)

        # 构建URL
        url = self._http_config.base_url.rstrip("/")
        if self._http_config.path:
            path = self._http_config.path
            for key, value in params.items():
                path = path.replace(f"{{{key}}}", str(value))
            url = url + "/" + path.lstrip("/")

        # 构建headers
        headers = dict(self._http_config.headers)
        if self._http_config.auth and self._http_config.auth.type != "none":
            auth = self._http_config.auth
            if auth.type == "bearer":
                token = os.environ.get(auth.token_env, "")
                headers[auth.header_name] = f"{auth.prefix} {token}".strip()
            elif auth.type == "api_key":
                api_key = os.environ.get(auth.token_env, "")
                headers[auth.header_name] = api_key
            elif auth.type == "basic":
                import base64
                credentials = os.environ.get(auth.token_env, "")
                encoded = base64.b64encode(credentials.encode()).decode()
                headers[auth.header_name] = f"Basic {encoded}"

        # 发送请求
        try:
            async with httpx.AsyncClient(timeout=self._http_config.timeout) as client:
                method = self._http_config.method.upper()
                if method == "GET":
                    # GET请求参数放query string
                    query_params = {k: v for k, v in params.items() if f"{{{k}}}" not in self._http_config.path}
                    response = await client.get(url, params=query_params, headers=headers)
                elif method == "POST":
                    response = await client.post(url, json=params, headers=headers)
                elif method == "PUT":
                    response = await client.put(url, json=params, headers=headers)
                elif method == "DELETE":
                    response = await client.delete(url, headers=headers)
                else:
                    response = await client.request(method, url, json=params, headers=headers)

            # 解析响应
            try:
                response_data = response.json()
            except Exception:
                response_data = {"content": response.text}

            # 错误检查
            if response.status_code >= 400:
                error_msg = str(response_data) if isinstance(response_data, dict) else response.text
                return ToolOutput(result={"error": f"HTTP {response.status_code}: {error_msg}"}, error=f"HTTP {response.status_code}")

            # 应用response_mapping
            if self._http_config.response_mapping:
                mapped = self._apply_mapping(response_data, self._http_config.response_mapping)
                return ToolOutput(result=mapped)

            return ToolOutput(result=response_data)

        except Exception as e:
            return ToolOutput(result={"error": str(e)}, error=str(e))

    def _apply_mapping(self, data: Any, mapping: dict[str, str]) -> dict[str, Any]:
        """应用JMESPath风格的映射"""
        result = {}
        for target_key, source_path in mapping.items():
            value = self._resolve_path(data, source_path)
            result[target_key] = value
        return result

    @staticmethod
    def _resolve_path(data: Any, path: str) -> Any:
        """简单的路径解析（支持点号和数组索引）"""
        if not path or data is None:
            logger.debug(f"_resolve_path: path={path!r}, data_type={type(data).__name__}, returning None (empty path or null data)")
            return None
        # 处理JMESPath风格的 [*].field
        path = path.strip()
        if path.startswith("[*]."):
            field = path[4:]
            if isinstance(data, list):
                result = [{field: item.get(field)} for item in data if isinstance(item, dict) and field in item]
                logger.debug(f"_resolve_path: JMESPath [*].{field} on list(len={len(data)}), matched {len(result)} items")
                return result
            logger.debug(f"_resolve_path: JMESPath [*].{field} failed — data is {type(data).__name__}, not list")
            return None

        # 点号分隔路径
        parts = re.split(r'\.(?![^\[]*\])', path)
        logger.debug(f"_resolve_path: resolving path={path!r}, parts={parts}, data_type={type(data).__name__}")
        current = data
        for i, part in enumerate(parts):
            if current is None:
                logger.debug(f"_resolve_path: part[{i}]={part!r} — current is None, returning None")
                return None
            # 数组索引
            match = re.match(r'(\w+)\[(\d+)\]', part)
            if match:
                key, index = match.group(1), int(match.group(2))
                if isinstance(current, dict) and key in current:
                    current = current[key]
                    if isinstance(current, list) and 0 <= index < len(current):
                        logger.debug(f"_resolve_path: part[{i}]={part!r} — dict key={key!r}, list index={index}, resolved to type={type(current[index]).__name__}")
                        current = current[index]
                    else:
                        logger.debug(f"_resolve_path: part[{i}]={part!r} — dict key={key!r} resolved but index {index} out of range (list len={len(current) if isinstance(current, list) else 'N/A'}), returning None")
                        return None
                else:
                    logger.debug(f"_resolve_path: part[{i}]={part!r} — key {key!r} not in dict keys={list(current.keys()) if isinstance(current, dict) else 'N/A'}, returning None")
                    return None
            elif isinstance(current, dict):
                if part in current:
                    logger.debug(f"_resolve_path: part[{i}]={part!r} — dict key found, moving to type={type(current[part]).__name__}")
                    current = current.get(part)
                else:
                    logger.debug(f"_resolve_path: part[{i}]={part!r} — key not in dict keys={list(current.keys())}, returning None")
                    return None
            else:
                logger.debug(f"_resolve_path: part[{i}]={part!r} — current is {type(current).__name__} (not dict), returning None")
                return None
        logger.debug(f"_resolve_path: path={path!r} resolved successfully, result_type={type(current).__name__}")
        return current


class ScriptTool(BaseTool):
    """Script Tool — 执行命令行"""

    def __init__(self, config: DeclarativeToolConfig):
        self._config = config
        self._script_config = config.script or ScriptToolConfig(command="")
        self.name = config.name
        self.description = config.description
        self.parameters_schema = config.parameters_schema
        self.safety_level = config.safety_level
        self.is_concurrency_safe = False  # 脚本执行默认非并发安全

    async def execute(self, input: ToolInput) -> ToolOutput:
        import time as _time
        params = dict(input.params)

        # 渲染命令模板
        command = self._script_config.command
        for key, value in params.items():
            command = command.replace(f"{{{key}}}", str(value))

        # 构建环境变量
        env = dict(os.environ)
        env.update(self._script_config.env)

        _t_start = _time.monotonic()
        logger.info(f"ScriptTool '{self.name}': executing command={command!r}, timeout={self._script_config.timeout}s, output_format={self._script_config.output_format}")

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._script_config.work_dir or None,
                env=env,
            )
            _t_proc_created = _time.monotonic()
            logger.debug(f"ScriptTool '{self.name}': subprocess created in {_t_proc_created - _t_start:.3f}s, pid={proc.pid}")

            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=self._script_config.timeout
            )

            _t_done = _time.monotonic()
            _t_exec = _t_done - _t_proc_created
            _t_total = _t_done - _t_start

            output_text = stdout.decode("utf-8", errors="replace").strip()
            error_text = stderr.decode("utf-8", errors="replace").strip()

            logger.info(f"ScriptTool '{self.name}': completed exit_code={proc.returncode}, exec_time={_t_exec:.3f}s, total_time={_t_total:.3f}s, stdout_len={len(output_text)}, stderr_len={len(error_text)}")
            if output_text:
                logger.debug(f"ScriptTool '{self.name}': stdout preview: {output_text[:200]!r}")

            if proc.returncode != 0:
                return ToolOutput(
                    result={"error": error_text or output_text, "exit_code": proc.returncode},
                    error=f"Command failed with exit code {proc.returncode}",
                )

            if self._script_config.output_format == "json":
                try:
                    result = json.loads(output_text)
                    logger.debug(f"ScriptTool '{self.name}': JSON parse success, result_type={type(result).__name__}")
                    return ToolOutput(result=result)
                except json.JSONDecodeError as e:
                    logger.warning(f"ScriptTool '{self.name}': JSON parse failed: {e}, raw_output={output_text[:200]!r}")
                    return ToolOutput(result={"content": output_text, "parse_error": True})

            return ToolOutput(result={"content": output_text})

        except TimeoutError:
            return ToolOutput(result={"error": f"Command timed out after {self._script_config.timeout}s"}, error="timeout")
        except Exception as e:
            return ToolOutput(result={"error": str(e)}, error=str(e))


class TransformTool(BaseTool):
    """Transform Tool — JSON变换"""

    def __init__(self, config: DeclarativeToolConfig):
        self._config = config
        self._transform_config = config.transform or TransformToolConfig(expression="")
        self.name = config.name
        self.description = config.description
        self.parameters_schema = config.parameters_schema
        self.safety_level = config.safety_level
        self.is_concurrency_safe = True

    async def execute(self, input: ToolInput) -> ToolOutput:
        params = dict(input.params)
        data = params.get("data", params)

        try:
            result = self._apply_expression(data, self._transform_config.expression)
            if result is None:
                result = self._transform_config.default
            return ToolOutput(result={"result": result} if not isinstance(result, dict) else result)
        except Exception as e:
            return ToolOutput(result={"error": str(e)}, error=str(e))

    def _apply_expression(self, data: Any, expression: str) -> Any:
        """应用变换表达式

        支持简单表达式：
        - key.subkey: 路径访问
        - keys(): 获取所有键
        - length(): 获取长度
        - distinct_by(array, &key): 去重
        """
        expression = expression.strip()

        # distinct_by 去重
        match = re.match(r'distinct_by\((\w+),\s*&(\w+)\)', expression)
        if match:
            array_key, dedup_key = match.group(1), match.group(2)
            array = data.get(array_key, []) if isinstance(data, dict) else data
            if isinstance(array, list):
                seen = set()
                result = []
                for item in array:
                    if isinstance(item, dict):
                        key_val = item.get(dedup_key)
                        if key_val not in seen:
                            seen.add(key_val)
                            result.append(item)
                return result
            return array

        # length()
        if expression == "length()":
            return len(data) if data is not None else 0

        # keys()
        if expression == "keys()":
            return list(data.keys()) if isinstance(data, dict) else []

        # 路径访问
        return HTTPTool._resolve_path(data, expression)


def create_declarative_tool(config: DeclarativeToolConfig) -> BaseTool:
    """根据配置创建声明式Tool实例"""
    tool_type = config.type.lower()

    if tool_type == "http":
        return HTTPTool(config)
    elif tool_type == "script":
        return ScriptTool(config)
    elif tool_type == "transform":
        return TransformTool(config)
    else:
        raise ValueError(f"Unknown declarative tool type: {tool_type}")


def load_declarative_tools_from_yaml(yaml_path: str | Path) -> list[BaseTool]:
    """从YAML文件加载声明式Tool列表"""
    path = Path(yaml_path)
    if not path.exists():
        return []

    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    tools = []
    tool_list = data.get("tools", [])
    if isinstance(data, list):
        tool_list = data
    # Support single-tool YAML format (no "tools:" wrapper)
    if not tool_list and isinstance(data, dict) and "type" in data:
        tool_list = [data]

    for tool_config in tool_list:
        if isinstance(tool_config, dict):
            try:
                config = DeclarativeToolConfig(**tool_config)
                tool = create_declarative_tool(config)
                tools.append(tool)
                logger.info(f"Loaded declarative tool: {config.name} (type={config.type})")
            except Exception as e:
                logger.warning(f"Failed to load declarative tool: {e}")

    return tools


def load_declarative_tools_from_dir(dir_path: str | Path) -> list[BaseTool]:
    """从目录加载所有YAML文件中的声明式Tool"""
    path = Path(dir_path)
    if not path.exists():
        return []

    tools = []
    for yaml_file in sorted(path.glob("*.yaml")):
        tools.extend(load_declarative_tools_from_yaml(yaml_file))
    for yaml_file in sorted(path.glob("*.yml")):
        tools.extend(load_declarative_tools_from_yaml(yaml_file))

    return tools

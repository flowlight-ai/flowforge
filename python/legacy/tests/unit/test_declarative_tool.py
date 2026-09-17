"""DeclarativeTool 单元测试 — 覆盖 HTTP/Script/Transform 三种声明式Tool模板"""
import asyncio
import json
import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from flowforge.core.declarative_tool import (
    DeclarativeToolConfig, HTTPToolConfig, ScriptToolConfig, TransformToolConfig,
    HTTPTool, ScriptTool, TransformTool,
    create_declarative_tool, load_declarative_tools_from_yaml, load_declarative_tools_from_dir,
)
from flowforge.core.base_tool import ToolInput


# ── HTTP Tool 测试 ──────────────────────────────────────────────

class TestHTTPTool:
    """HTTP Tool 测试"""
    
    @pytest.mark.asyncio
    async def test_get_request(self):
        """测试GET请求"""
        config = DeclarativeToolConfig(
            name="test_api",
            description="测试API",
            type="http",
            http=HTTPToolConfig(
                base_url="https://api.example.com",
                method="GET",
                path="/v1/search",
            ),
            parameters_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        )
        tool = HTTPTool(config)
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"results": ["item1", "item2"]}
        mock_response.text = '{"results": ["item1", "item2"]}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_response
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance
            
            result = await tool.execute(ToolInput(params={"query": "test"}))
        
        assert result.result is not None
        assert "results" in result.result
    
    @pytest.mark.asyncio
    async def test_bearer_auth(self):
        """测试Bearer认证"""
        config = DeclarativeToolConfig(
            name="auth_api",
            description="需要认证的API",
            type="http",
            http=HTTPToolConfig(
                base_url="https://api.example.com",
                method="GET",
                auth={"type": "bearer", "token_env": "TEST_API_KEY", "header_name": "Authorization", "prefix": "Bearer"},
            ),
        )
        tool = HTTPTool(config)
        
        with patch.dict(os.environ, {"TEST_API_KEY": "test-token-123"}):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"status": "ok"}
            mock_response.text = '{"status": "ok"}'
            
            with patch("httpx.AsyncClient") as mock_client:
                mock_instance = AsyncMock()
                mock_instance.get.return_value = mock_response
                mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
                mock_instance.__aexit__ = AsyncMock(return_value=None)
                mock_client.return_value = mock_instance
                
                result = await tool.execute(ToolInput(params={}))
        
        # 验证请求中包含Bearer token
        call_args = mock_instance.get.call_args
        headers = call_args.kwargs.get("headers", {})
        assert "Authorization" in headers
        assert "Bearer test-token-123" in headers["Authorization"]
    
    @pytest.mark.asyncio
    async def test_error_response(self):
        """测试错误响应处理"""
        config = DeclarativeToolConfig(
            name="error_api",
            description="可能返回错误的API",
            type="http",
            http=HTTPToolConfig(base_url="https://api.example.com", method="GET"),
        )
        tool = HTTPTool(config)
        
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.json.return_value = {"error": "Not found"}
        mock_response.text = '{"error": "Not found"}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_response
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance
            
            result = await tool.execute(ToolInput(params={}))
        
        assert result.error is not None
        assert "404" in result.error
    
    @pytest.mark.asyncio
    async def test_response_mapping(self):
        """测试响应映射"""
        config = DeclarativeToolConfig(
            name="mapped_api",
            description="带响应映射的API",
            type="http",
            http=HTTPToolConfig(
                base_url="https://api.example.com",
                method="GET",
                response_mapping={"items": "data.results", "total": "data.count"},
            ),
        )
        tool = HTTPTool(config)
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": {"results": ["a", "b"], "count": 2}}
        mock_response.text = '{}'
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get.return_value = mock_response
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance
            
            result = await tool.execute(ToolInput(params={}))
        
        assert result.result.get("items") == ["a", "b"]
        assert result.result.get("total") == 2
    
    def test_resolve_path(self):
        """测试路径解析"""
        data = {"a": {"b": {"c": 42}}, "items": [{"name": "x"}, {"name": "y"}]}
        
        assert HTTPTool._resolve_path(data, "a.b.c") == 42
        assert HTTPTool._resolve_path(data, "a.b") == {"c": 42}
        assert HTTPTool._resolve_path(data, "nonexistent") is None
        
        # 数组索引: items[0]
        assert HTTPTool._resolve_path(data, "items[0]") == {"name": "x"}
        assert HTTPTool._resolve_path(data, "items[1]") == {"name": "y"}
        
        # JMESPath风格 [*].field 只对list有效
        list_data = [{"name": "x"}, {"name": "y"}]
        result = HTTPTool._resolve_path(list_data, "[*].name")
        assert result == [{"name": "x"}, {"name": "y"}]


# ── Script Tool 测试 ──────────────────────────────────────────────

class TestScriptTool:
    """Script Tool 测试"""
    
    @pytest.mark.asyncio
    async def test_simple_command(self):
        """测试简单命令执行"""
        config = DeclarativeToolConfig(
            name="echo_tool",
            description="Echo命令",
            type="script",
            script=ScriptToolConfig(command="echo hello"),
        )
        tool = ScriptTool(config)
        
        result = await tool.execute(ToolInput(params={}))
        assert result.result.get("content") == "hello"
        assert result.error is None
    
    @pytest.mark.asyncio
    async def test_command_with_params(self):
        """测试带参数的命令"""
        config = DeclarativeToolConfig(
            name="param_tool",
            description="带参数命令",
            type="script",
            script=ScriptToolConfig(command="echo {message}"),
        )
        tool = ScriptTool(config)
        
        result = await tool.execute(ToolInput(params={"message": "world"}))
        assert "world" in result.result.get("content", "")
    
    @pytest.mark.asyncio
    async def test_json_output(self):
        """测试JSON输出格式"""
        config = DeclarativeToolConfig(
            name="json_tool",
            description="JSON输出命令",
            type="script",
            script=ScriptToolConfig(
                command=sys.executable + ' -c "import json; print(json.dumps({\\"key\\": \\"value\\"}))"',
                output_format="json",
            ),
        )
        tool = ScriptTool(config)
        
        result = await tool.execute(ToolInput(params={}))
        assert result.result.get("key") == "value"
    
    @pytest.mark.asyncio
    async def test_command_failure(self):
        """测试命令执行失败"""
        config = DeclarativeToolConfig(
            name="fail_tool",
            description="会失败的命令",
            type="script",
            script=ScriptToolConfig(command="exit 1"),
        )
        tool = ScriptTool(config)
        
        result = await tool.execute(ToolInput(params={}))
        assert result.error is not None


# ── Transform Tool 测试 ──────────────────────────────────────────

class TestTransformTool:
    """Transform Tool 测试"""
    
    @pytest.mark.asyncio
    async def test_path_access(self):
        """测试路径访问变换
        
        TransformTool.execute 先从params提取data: data = params.get("data", params)
        然后对data应用expression，所以expression是相对于data内容的路径
        """
        config = DeclarativeToolConfig(
            name="path_transform",
            description="路径访问",
            type="transform",
            transform=TransformToolConfig(expression="items"),
        )
        tool = TransformTool(config)
        
        result = await tool.execute(ToolInput(params={"data": {"items": [1, 2, 3]}}))
        assert result.result.get("result") == [1, 2, 3]
    
    @pytest.mark.asyncio
    async def test_length_expression(self):
        """测试length()表达式"""
        config = DeclarativeToolConfig(
            name="length_transform",
            description="计算长度",
            type="transform",
            transform=TransformToolConfig(expression="length()"),
        )
        tool = TransformTool(config)
        
        result = await tool.execute(ToolInput(params={"data": [1, 2, 3, 4]}))
        assert result.result.get("result") == 4
    
    @pytest.mark.asyncio
    async def test_keys_expression(self):
        """测试keys()表达式"""
        config = DeclarativeToolConfig(
            name="keys_transform",
            description="获取键列表",
            type="transform",
            transform=TransformToolConfig(expression="keys()"),
        )
        tool = TransformTool(config)
        
        result = await tool.execute(ToolInput(params={"a": 1, "b": 2}))
        assert set(result.result.get("result", [])) == {"a", "b"}
    
    @pytest.mark.asyncio
    async def test_distinct_by_expression(self):
        """测试distinct_by去重"""
        config = DeclarativeToolConfig(
            name="dedup_transform",
            description="去重",
            type="transform",
            transform=TransformToolConfig(expression="distinct_by(items, &id)"),
        )
        tool = TransformTool(config)
        
        data = {"items": [
            {"id": 1, "name": "a"},
            {"id": 2, "name": "b"},
            {"id": 1, "name": "c"},  # 重复id
        ]}
        result = await tool.execute(ToolInput(params=data))
        items = result.result.get("result", [])
        assert len(items) == 2  # 去重后只有2个
    
    @pytest.mark.asyncio
    async def test_default_value(self):
        """测试默认值"""
        config = DeclarativeToolConfig(
            name="default_transform",
            description="带默认值",
            type="transform",
            transform=TransformToolConfig(expression="nonexistent.path", default="fallback"),
        )
        tool = TransformTool(config)
        
        result = await tool.execute(ToolInput(params={"data": {}}))
        assert result.result.get("result") == "fallback"


# ── 工厂函数和YAML加载测试 ──────────────────────────────────────

class TestDeclarativeToolFactory:
    """工厂函数和YAML加载测试"""
    
    def test_create_http_tool(self):
        """测试创建HTTP Tool"""
        config = DeclarativeToolConfig(
            name="test", type="http",
            http=HTTPToolConfig(base_url="https://api.example.com"),
        )
        tool = create_declarative_tool(config)
        assert isinstance(tool, HTTPTool)
    
    def test_create_script_tool(self):
        """测试创建Script Tool"""
        config = DeclarativeToolConfig(
            name="test", type="script",
            script=ScriptToolConfig(command="echo hello"),
        )
        tool = create_declarative_tool(config)
        assert isinstance(tool, ScriptTool)
    
    def test_create_transform_tool(self):
        """测试创建Transform Tool"""
        config = DeclarativeToolConfig(
            name="test", type="transform",
            transform=TransformToolConfig(expression="data"),
        )
        tool = create_declarative_tool(config)
        assert isinstance(tool, TransformTool)
    
    def test_unknown_type_raises(self):
        """测试未知类型抛出异常"""
        config = DeclarativeToolConfig(name="test", type="unknown")
        with pytest.raises(ValueError, match="Unknown declarative tool type"):
            create_declarative_tool(config)
    
    def test_load_from_yaml(self):
        """测试从YAML文件加载"""
        yaml_content = {
            "tools": [
                {
                    "name": "pexels_search",
                    "description": "Pexels图库搜索",
                    "type": "http",
                    "http": {"base_url": "https://api.pexels.com/v1", "method": "GET", "path": "/search"},
                    "parameters_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
                }
            ]
        }
        
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False, encoding="utf-8") as f:
            yaml.dump(yaml_content, f)
            yaml_path = f.name
        
        try:
            tools = load_declarative_tools_from_yaml(yaml_path)
            assert len(tools) == 1
            assert tools[0].name == "pexels_search"
            assert isinstance(tools[0], HTTPTool)
        finally:
            os.unlink(yaml_path)
    
    def test_load_from_dir(self):
        """测试从目录加载"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建两个YAML文件
            for i, tool_type in enumerate(["http", "script"]):
                yaml_content = {
                    "tools": [{
                        "name": f"tool_{i}",
                        "type": tool_type,
                        "http": {"base_url": "https://example.com"} if tool_type == "http" else None,
                        "script": {"command": "echo test"} if tool_type == "script" else None,
                    }]
                }
                # 清理None值
                yaml_content["tools"][0] = {k: v for k, v in yaml_content["tools"][0].items() if v is not None}
                
                with open(os.path.join(tmpdir, f"tools_{i}.yaml"), "w", encoding="utf-8") as f:
                    yaml.dump(yaml_content, f)
            
            tools = load_declarative_tools_from_dir(tmpdir)
            assert len(tools) == 2
    
    def test_load_nonexistent_yaml(self):
        """测试加载不存在的YAML文件"""
        tools = load_declarative_tools_from_yaml("/nonexistent/path.yaml")
        assert tools == []
    
    def test_load_nonexistent_dir(self):
        """测试加载不存在的目录"""
        tools = load_declarative_tools_from_dir("/nonexistent/dir")
        assert tools == []
    
    def test_to_function_call(self):
        """测试转换为function calling格式"""
        config = DeclarativeToolConfig(
            name="test_tool",
            description="测试工具",
            type="http",
            parameters_schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
            http=HTTPToolConfig(base_url="https://api.example.com"),
        )
        tool = create_declarative_tool(config)
        
        fc = tool.to_function_call()
        assert fc["type"] == "function"
        assert fc["function"]["name"] == "test_tool"
        assert fc["function"]["parameters"]["type"] == "object"

"""架构原则违规专项回归测试

验证所有架构原则修复没有引入新Bug，覆盖12个测试维度：
1. 铁律1：禁止跨persona复制配置
2. 铁律2：禁止使用假数据/假逻辑
3. 铁律3：禁止绕过DI容器直接实例化
4. 铁律4：禁止直接操作数据库
5. 铁律5：禁止硬编码路径和密钥
6. 架构边界：FlowForge不含特定领域代码
7. 架构边界：*Forge重复代码标记废弃
8. FWK框架能力：6个新模块可导入
9. 安全：不暴露traceback
10. Agent模式循环逻辑
11. Loop引擎集成
12. PromptManager自动发现
"""

import ast
import os
import sys
import warnings
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FLOWFORGE_ROOT = PROJECT_ROOT / "flowforge"
CONTENTFORGE_ROOT = PROJECT_ROOT / "contentforge"
NOVELFORGE_ROOT = PROJECT_ROOT / "novelforge"
DEVFORGE_ROOT = PROJECT_ROOT / "devforge"


# ═══════════════════════════════════════════════════════════════════════
# 1. 铁律1：禁止跨persona复制配置
# ═══════════════════════════════════════════════════════════════════════

class TestNoPersonaConfigCopy:
    """验证各persona配置文件内容不同。"""

    def test_no_persona_config_copy(self):
        """验证contentforge/config/persona/下所有yaml文件内容不完全相同。"""
        persona_dir = CONTENTFORGE_ROOT / "config" / "persona"
        if not persona_dir.is_dir():
            pytest.skip("contentforge/config/persona/ 目录不存在")

        yaml_files = sorted(persona_dir.glob("*.yaml"))
        if len(yaml_files) < 2:
            pytest.skip("persona配置文件不足2个，无法比较")

        contents = {}
        for f in yaml_files:
            contents[f.name] = f.read_text(encoding="utf-8")

        # 检查没有两个文件内容完全相同
        names = list(contents.keys())
        duplicates = []
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                if contents[names[i]] == contents[names[j]]:
                    duplicates.append((names[i], names[j]))

        assert not duplicates, (
            f"以下persona配置文件内容完全相同（违反铁律1）：{duplicates}"
        )


# ═══════════════════════════════════════════════════════════════════════
# 2. 铁律2：禁止使用假数据/假逻辑
# ═══════════════════════════════════════════════════════════════════════

class TestNoStubImplementations:
    """验证核心工具不是stub实现。"""

    def _read_source(self, filepath: Path) -> str:
        if not filepath.exists():
            pytest.skip(f"{filepath} 不存在")
        return filepath.read_text(encoding="utf-8")

    def test_publish_not_stub(self):
        """验证contentforge/tools/publish.py不返回硬编码数据。"""
        src = self._read_source(CONTENTFORGE_ROOT / "tools" / "publish.py")
        # 不应包含硬编码的 {"status": "ok"} 或 {"success": True} 直接返回
        assert '{"status": "ok"}' not in src, "publish.py 包含硬编码 status:ok"
        # PublishTool 应该委托给平台特定的publisher
        assert "publisher" in src.lower(), "publish.py 应委托给平台特定publisher"

    def test_video_generate_not_stub(self):
        """验证contentforge/tools/video_generate.py不返回硬编码数据。"""
        filepath = CONTENTFORGE_ROOT / "tools" / "video_generate.py"
        if not filepath.exists():
            pytest.skip("video_generate.py 不存在")
        src = filepath.read_text(encoding="utf-8")
        assert '{"status": "ok"}' not in src, "video_generate.py 包含硬编码 status:ok"

    def test_mcp_integration_has_real_client(self):
        """验证mcp_integration.py有真实MCPClient引用。"""
        src = self._read_source(FLOWFORGE_ROOT / "core" / "mcp_integration.py")
        assert "MCPClient" in src, "mcp_integration.py 应引用 MCPClient"
        assert "from flowforge.mcp.client import MCPClient" in src, \
            "mcp_integration.py 应从 flowforge.mcp.client 导入 MCPClient"

    def test_novelforge_base_tool_not_stub(self):
        """验证novelforge/tools/base.py的execute方法有实际逻辑。"""
        src = self._read_source(NOVELFORGE_ROOT / "tools" / "base.py")
        # BaseWorldStateTool.execute 应该有实际逻辑（委托给 _do_search 或 _fallback_search）
        # _do_search 抛 NotImplementedError 是抽象方法模式，允许
        # 但 execute 本身不应直接抛 NotImplementedError
        lines = src.split("\n")
        in_execute = False
        execute_body_lines = []
        for line in lines:
            stripped = line.strip()
            if "async def execute" in stripped:
                in_execute = True
                continue
            elif in_execute and stripped.startswith("async def ") or stripped.startswith("def "):
                in_execute = False
            elif in_execute:
                execute_body_lines.append(stripped)

        # execute 方法应有实际逻辑（如 if/return/await），不是仅 raise NotImplementedError
        has_logic = any(
            kw in " ".join(execute_body_lines)
            for kw in ["if ", "return ", "await "]
        )
        assert has_logic, "BaseWorldStateTool.execute 应有实际逻辑（if/return/await）"


# ═══════════════════════════════════════════════════════════════════════
# 3. 铁律3：禁止绕过DI容器直接实例化
# ═══════════════════════════════════════════════════════════════════════

class TestDIContainerIntegration:
    """验证DI容器正确注册和解析。"""

    def test_flowforge_di_container_basic(self):
        """验证FlowForge DIContainer基本功能。"""
        from flowforge.core.di import DIContainer

        container = DIContainer()
        container.register_singleton("test_service", lambda: {"value": 42})
        result = container.resolve("test_service")
        assert result == {"value": 42}, "DIContainer resolve 应返回注册的实例"

    def test_flowforge_di_container_agent_registration(self):
        """验证DIContainer agent注册和resolve_all_agents。"""
        from flowforge.core.di import DIContainer

        container = DIContainer()
        container.register_agent("agent_a", lambda: "AgentA")
        container.register_agent("agent_b", lambda: "AgentB")
        agents = container.resolve_all_agents()
        assert "agent_a" in agents, "resolve_all_agents 应包含 agent_a"
        assert "agent_b" in agents, "resolve_all_agents 应包含 agent_b"

    def test_contentforge_di_setup_has_orchestrator(self):
        """验证ContentForge DI setup注册了orchestrator（P-11：已迁移到 flowforge，不存在则跳过）。"""
        filepath = CONTENTFORGE_ROOT / "core" / "di_setup.py"
        if not filepath.exists():
            pytest.skip("contentforge/core/di_setup.py 已迁移，不在同级仓库树中")
        src = filepath.read_text(encoding="utf-8")
        assert 'register_singleton("orchestrator"' in src, \
            "ContentForge DI 应注册 orchestrator"
        assert "get_container" in src, "ContentForge 应提供 get_container 函数"

    def test_novelforge_deps_uses_sdk(self):
        """验证NovelForge deps.py通过SDK自动注册（P-11：已迁移到 flowforge，不存在则跳过）。"""
        filepath = NOVELFORGE_ROOT / "app" / "deps.py"
        if not filepath.exists():
            pytest.skip("novelforge/app/deps.py 已迁移，不在同级仓库树中")
        src = filepath.read_text(encoding="utf-8")
        assert "FlowForgeSDK" in src, "NovelForge deps 应使用 FlowForgeSDK"
        assert 'project="novelforge"' in src, "NovelForge SDK 应指定 project=novelforge"


# ═══════════════════════════════════════════════════════════════════════
# 4. 铁律4：禁止直接操作数据库
# ═══════════════════════════════════════════════════════════════════════

class TestNoDirectSQL:
    """验证存储模块通过Repository层操作。"""

    def test_helm_db_uses_helm_repository(self):
        """验证helm_db.py使用HelmRepository。"""
        src = (FLOWFORGE_ROOT / "memory" / "helm_db.py").read_text(encoding="utf-8")
        assert "class HelmRepository" in src, "helm_db.py 应定义 HelmRepository"
        assert "class HelmDatabase" in src, "helm_db.py 应定义 HelmDatabase"
        # HelmDatabase 应通过 self._repo 操作
        assert "self._repo" in src, "HelmDatabase 应通过 self._repo 操作数据库"

    def test_secret_store_uses_secret_repository(self):
        """验证secret_store.py使用SecretRepository。"""
        src = (FLOWFORGE_ROOT / "core" / "secret_store.py").read_text(encoding="utf-8")
        assert "class SecretRepository" in src, "secret_store.py 应定义 SecretRepository"
        assert "class SecretStore" in src, "secret_store.py 应定义 SecretStore"
        assert "self._repo" in src, "SecretStore 应通过 self._repo 操作数据库"

    def test_mailbox_uses_mailbox_repository(self):
        """验证mailbox.py使用MailboxRepository。"""
        src = (FLOWFORGE_ROOT / "memory" / "mailbox.py").read_text(encoding="utf-8")
        assert "class MailboxRepository" in src, "mailbox.py 应定义 MailboxRepository"
        assert "class Mailbox" in src, "mailbox.py 应定义 Mailbox"
        assert "self._repo" in src, "Mailbox 应通过 self._repo 操作数据库"

    def test_helm_database_no_direct_sql_in_business_methods(self):
        """验证HelmDatabase的业务方法不直接编写SQL。"""
        src = (FLOWFORGE_ROOT / "memory" / "helm_db.py").read_text(encoding="utf-8")
        lines = src.split("\n")
        in_helm_db_class = False
        in_repo_class = False
        for i, line in enumerate(lines, 1):
            if "class HelmRepository" in line:
                in_repo_class = True
                in_helm_db_class = False
            elif "class HelmDatabase" in line:
                in_helm_db_class = True
                in_repo_class = False
            elif line.startswith("class "):
                in_helm_db_class = False
                in_repo_class = False

            # HelmDatabase中的方法不应包含 conn.execute
            if in_helm_db_class and not in_repo_class:
                if "self.conn.execute" in line:
                    pytest.fail(
                        f"helm_db.py 第{i行}: HelmDatabase 不应直接调用 conn.execute，"
                        f"应通过 self._repo 操作"
                    )


# ═══════════════════════════════════════════════════════════════════════
# 5. 铁律5：禁止硬编码路径和密钥
# ═══════════════════════════════════════════════════════════════════════

class TestNoHardcodedPaths:
    """验证关键路径从配置/环境变量读取。"""

    def test_secret_key_from_env(self):
        """验证secret_key从FLOWFORGE_SECRET_KEY读取。"""
        src = (FLOWFORGE_ROOT / "core" / "config.py").read_text(encoding="utf-8")
        assert "FLOWFORGE_SECRET_KEY" in src, \
            "secret_key 应从 FLOWFORGE_SECRET_KEY 环境变量读取"

    def test_db_path_configurable(self):
        """验证数据库路径从配置读取。"""
        src = (FLOWFORGE_ROOT / "core" / "config.py").read_text(encoding="utf-8")
        assert "db_url" in src, "SystemConfig 应包含 db_url 字段"

    def test_server_port_configurable(self):
        """验证端口号从配置读取。"""
        src = (FLOWFORGE_ROOT / "core" / "config.py").read_text(encoding="utf-8")
        assert "server_port" in src, "SystemConfig 应包含 server_port 字段"

    def test_no_hardcoded_home_paths(self):
        """验证核心模块不包含硬编码的绝对路径。"""
        dangerous_patterns = [
            '/home/hyg/',
            'C:\\Users\\',
            '/usr/local/',
        ]
        core_dir = FLOWFORGE_ROOT / "core"
        for py_file in core_dir.glob("*.py"):
            src = py_file.read_text(encoding="utf-8")
            for pattern in dangerous_patterns:
                assert pattern not in src, (
                    f"{py_file.name} 包含硬编码路径: {pattern}"
                )

    def test_no_hardcoded_api_keys(self):
        """验证核心模块不包含硬编码的API密钥。"""
        import re
        core_dir = FLOWFORGE_ROOT / "core"
        # 匹配 sk- 后跟至少20个字母数字字符（真实API密钥格式）
        api_key_pattern = re.compile(r'sk-[a-zA-Z0-9]{20,}')
        for py_file in core_dir.glob("*.py"):
            src = py_file.read_text(encoding="utf-8")
            lines = src.split("\n")
            for line_num, line in enumerate(lines, 1):
                # 跳过注释行
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                match = api_key_pattern.search(line)
                if match and 'os.environ' not in line and 'environ' not in line:
                    pytest.fail(
                        f"{py_file.name} 第{line_num}行 可能包含硬编码API密钥: {line.strip()[:80]}"
                    )


# ═══════════════════════════════════════════════════════════════════════
# 6. 架构边界：FlowForge不含特定领域代码
# ═══════════════════════════════════════════════════════════════════════

class TestFlowForgeNoDomainAgents:
    """验证FlowForge的领域Agent已迁移（不再re-export，直接raise ImportError）。

    P-11：部分迁移文件已从仓库树彻底移除（不存在即视为迁移完成，跳过），
    其余保留占位的文件仍校验 ImportError 提示。
    """

    def test_article_writing_raises_import_error(self):
        """验证flowforge/agents/article_writing.py已迁移，导入会raise ImportError。"""
        filepath = FLOWFORGE_ROOT / "agents" / "article_writing.py"
        if not filepath.exists():
            pytest.skip("flowforge/agents/article_writing.py 已彻底迁移（文件不存在）")
        src = filepath.read_text(encoding="utf-8")
        assert "ImportError" in src, \
            "article_writing.py 应包含 ImportError"
        assert "contentforge" in src, \
            "article_writing.py 应提示从 contentforge 导入"

    def test_code_writer_agent_raises_import_error(self):
        """验证flowforge/agents/code_writer_agent.py已迁移，导入会raise ImportError。"""
        filepath = FLOWFORGE_ROOT / "agents" / "code_writer_agent.py"
        if not filepath.exists():
            pytest.skip("flowforge/agents/code_writer_agent.py 已彻底迁移（文件不存在）")
        src = filepath.read_text(encoding="utf-8")
        assert "ImportError" in src, \
            "code_writer_agent.py 应包含 ImportError"
        assert "devforge" in src, \
            "code_writer_agent.py 应提示从 devforge 导入"

    def test_publish_tool_raises_import_error(self):
        """验证flowforge/tools/publish.py为真实实现（委托 publisher）或迁移占位（P-11 适配）。"""
        filepath = FLOWFORGE_ROOT / "tools" / "publish.py"
        if not filepath.exists():
            pytest.skip("flowforge/tools/publish.py 已彻底迁移（文件不存在）")
        src = filepath.read_text(encoding="utf-8")
        # 迁移占位形态：raise ImportError（提示从 contentforge 导入）；
        # 真实实现形态：定义 PublishTool 并委托平台特定 publisher
        if "raise ImportError" in src or "raise ImportError(" in src:
            # 迁移占位形态：应提示从 contentforge 导入
            assert "contentforge" in src, \
                "flowforge/tools/publish.py 应提示从 contentforge 导入"
        else:
            # 真实实现形态：应委托平台特定 publisher，不返回硬编码数据
            assert "class PublishTool" in src, "publish.py 应定义 PublishTool"
            assert "publisher" in src.lower(), "publish.py 应委托平台特定 publisher"

    def test_video_generate_raises_import_error(self):
        """验证flowforge/tools/video_generate.py为真实实现或迁移占位（P-11 适配）。"""
        filepath = FLOWFORGE_ROOT / "tools" / "video_generate.py"
        if not filepath.exists():
            pytest.skip("flowforge/tools/video_generate.py 已彻底迁移（文件不存在）")
        src = filepath.read_text(encoding="utf-8")
        # 迁移占位形态：raise ImportError；真实实现形态：定义工具类
        if "raise ImportError" in src or "raise ImportError(" in src:
            # 迁移占位形态：应提示从 contentforge 导入
            assert "contentforge" in src, \
                "flowforge/tools/video_generate.py 应提示从 contentforge 导入"
        else:
            # 真实实现形态：应定义工具类且不返回硬编码 status:ok
            assert "class VideoGenerateTool" in src, "video_generate.py 应定义 VideoGenerateTool"
            assert '{"status": "ok"}' not in src, "video_generate.py 不应返回硬编码 status:ok"


# ═══════════════════════════════════════════════════════════════════════
# 7. 架构边界：*Forge重复代码标记废弃
# ═══════════════════════════════════════════════════════════════════════

class TestForgeDeprecationWarnings:
    """验证*Forge重复代码有废弃警告。

    P-11：部分 *Forge 重复代码已彻底迁移/移除（文件不存在即跳过），
    仅对仍存在的重复文件校验 DeprecationWarning。
    """

    def test_contentforge_sqlite_store_deprecated(self):
        """验证contentforge/memory/stores/sqlite_store.py有DeprecationWarning。"""
        filepath = CONTENTFORGE_ROOT / "memory" / "stores" / "sqlite_store.py"
        if not filepath.exists():
            pytest.skip("contentforge/memory/stores/sqlite_store.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "DeprecationWarning" in src, \
            "contentforge/memory/stores/sqlite_store.py 应有 DeprecationWarning"
        assert "flowforge.memory" in src, \
            "sqlite_store.py 废弃提示应指向 flowforge.memory"

    def test_contentforge_task_store_deprecated(self):
        """验证contentforge/core/task_store.py有DeprecationWarning。"""
        filepath = CONTENTFORGE_ROOT / "core" / "task_store.py"
        if not filepath.exists():
            pytest.skip("contentforge/core/task_store.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "DeprecationWarning" in src, \
            "contentforge/core/task_store.py 应有 DeprecationWarning"
        assert "flowforge.memory" in src, \
            "task_store.py 废弃提示应指向 flowforge.memory"

    def test_novelforge_events_deprecated(self):
        """验证novelforge/core/events.py有DeprecationWarning。"""
        filepath = NOVELFORGE_ROOT / "core" / "events.py"
        if not filepath.exists():
            pytest.skip("novelforge/core/events.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "DeprecationWarning" in src, \
            "novelforge/core/events.py 应有 DeprecationWarning"
        assert "flowforge.events.event_bus" in src, \
            "events.py 废弃提示应指向 flowforge.events.event_bus"

    def test_novelforge_base_agent_deprecated(self):
        """验证novelforge/agents/base.py有DeprecationWarning。"""
        filepath = NOVELFORGE_ROOT / "agents" / "base.py"
        if not filepath.exists():
            pytest.skip("novelforge/agents/base.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "DeprecationWarning" in src, \
            "novelforge/agents/base.py 应有 DeprecationWarning"

    def test_devforge_config_inherits_system_config(self):
        """验证devforge/core/config.py继承SystemConfig。"""
        filepath = DEVFORGE_ROOT / "core" / "config.py"
        if not filepath.exists():
            pytest.skip("devforge/core/config.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "SystemConfig" in src, \
            "DevForgeConfig 应继承 SystemConfig"
        assert "class DevForgeConfig(SystemConfig)" in src, \
            "DevForgeConfig 应显式继承 SystemConfig"


# ═══════════════════════════════════════════════════════════════════════
# 8. FWK框架能力：6个新模块可导入
# ═══════════════════════════════════════════════════════════════════════

class TestFWKModulesImportable:
    """验证FWK框架能力模块可正常导入。"""

    def test_workflow_compiler_importable(self):
        """验证WorkflowCompiler可导入。"""
        from flowforge.core.workflow_compiler import WorkflowCompiler
        assert WorkflowCompiler is not None

    def test_conditional_router_importable(self):
        """验证ConditionalRouter可导入。"""
        from flowforge.core.conditional_router import ConditionalRouter
        assert ConditionalRouter is not None

    def test_fallback_chain_importable(self):
        """验证FallbackChain可导入。"""
        from flowforge.core.fallback_chain import FallbackChain
        assert FallbackChain is not None

    def test_state_mapper_importable(self):
        """验证StateMapper可导入。"""
        from flowforge.core.state_mapper import StateMapper
        assert StateMapper is not None

    def test_persona_injector_importable(self):
        """验证PersonaInjector可导入。"""
        from flowforge.core.persona_injector import PersonaInjector
        assert PersonaInjector is not None

    def test_declarative_agent_importable(self):
        """验证DeclarativeAgent可导入。"""
        from flowforge.core.declarative_agent import DeclarativeAgent
        assert DeclarativeAgent is not None


# ═══════════════════════════════════════════════════════════════════════
# 9. 安全：不暴露traceback
# ═══════════════════════════════════════════════════════════════════════

class TestNoTracebackExposure:
    """验证全局异常处理器不暴露traceback。"""

    def test_novelforge_global_exception_handler(self):
        """验证NovelForge main.py全局异常处理器返回通用错误。"""
        src = (NOVELFORGE_ROOT / "app" / "main.py").read_text(encoding="utf-8")
        assert "exception_handler" in src, "NovelForge 应有全局异常处理器"
        # 不应暴露 traceback 或 exc 信息
        lines = src.split("\n")
        in_handler = False
        for line in lines:
            if "exception_handler" in line or "global_exception" in line:
                in_handler = True
            elif in_handler and "def " in line and "exception" not in line:
                in_handler = False
            elif in_handler:
                # 返回内容不应包含 str(exc) 或 traceback
                if "str(exc)" in line and "content=" not in line:
                    # str(exc) 在日志中可以，但不应在响应中
                    pass
                if "traceback" in line.lower() and "content=" in line:
                    pytest.fail("全局异常处理器不应在响应中暴露 traceback")

        # 应返回通用错误消息
        assert "Internal server error" in src, \
            "全局异常处理器应返回通用错误消息 'Internal server error'"


# ═══════════════════════════════════════════════════════════════════════
# 10. Agent模式循环逻辑
# ═══════════════════════════════════════════════════════════════════════

class TestAgentModeImplementations:
    """验证NovelForge Agent实现了模式循环。

    P-11：novelforge/agents 已迁移/移除，文件不存在即跳过。
    """

    def test_novel_concept_agent_has_plan_execute(self):
        """验证NovelConceptAgent有Plan-Execute逻辑（v3.0修订：GoT降级为可选，默认plan_execute）。"""
        filepath = NOVELFORGE_ROOT / "agents" / "novel_concept_agent.py"
        if not filepath.exists():
            pytest.skip("novelforge/agents/novel_concept_agent.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "plan_execute" in src, "NovelConceptAgent 应使用 plan_execute 模式（v3.0修订）"
        # plan_execute 应有规划阶段
        assert "_plan_phase" in src or "plan" in src.lower(), "NovelConceptAgent 应有规划阶段"

    def test_style_calibrate_agent_has_reflexion(self):
        """验证StyleCalibrateAgent有Reflexion逻辑（循环）。"""
        filepath = NOVELFORGE_ROOT / "agents" / "style_calibrate_agent.py"
        if not filepath.exists():
            pytest.skip("novelforge/agents/style_calibrate_agent.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "reflexion" in src.lower(), "StyleCalibrateAgent 应使用 reflexion 模式"

    def test_continuity_checker_agent_has_react(self):
        """验证ContinuityCheckerAgent有ReAct逻辑（循环）。"""
        filepath = NOVELFORGE_ROOT / "agents" / "continuity_checker.py"
        if not filepath.exists():
            pytest.skip("novelforge/agents/continuity_checker.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "react" in src.lower(), "ContinuityCheckerAgent 应使用 react 模式"
        # ReAct 应有 Thought-Action-Observation 循环
        assert "thought" in src.lower(), "ReAct 循环应包含 thought 步骤"
        assert "action" in src.lower(), "ReAct 循环应包含 action 步骤"

    def test_full_review_agent_has_multi_agent(self):
        """验证FullReviewAgent有Multi-Agent逻辑（多角度）。"""
        filepath = NOVELFORGE_ROOT / "agents" / "full_review_agent.py"
        if not filepath.exists():
            pytest.skip("novelforge/agents/full_review_agent.py 已迁移/移除")
        src = filepath.read_text(encoding="utf-8")
        assert "multi_agent" in src.lower(), "FullReviewAgent 应使用 multi_agent 模式"


# ═══════════════════════════════════════════════════════════════════════
# 11. Loop引擎集成
# ═══════════════════════════════════════════════════════════════════════

class TestLoopEngineIntegration:
    """验证Loop引擎正确集成到FlowForge。"""

    def test_hybrid_executor_has_loop_executor(self):
        """验证HybridExecutor有loop_executor属性。"""
        src = (FLOWFORGE_ROOT / "executor" / "hybrid_executor.py").read_text(encoding="utf-8")
        assert "loop_executor" in src, "HybridExecutor 应有 loop_executor 属性"
        assert "set_loop_executor" in src, "HybridExecutor 应有 set_loop_executor 方法"

    def test_loop_executor_has_persona_lock(self):
        """验证LoopExecutor有persona_lock。"""
        src = (FLOWFORGE_ROOT / "loop" / "executor.py").read_text(encoding="utf-8")
        assert "persona_lock" in src, "LoopExecutor 应有 persona_lock 参数"
        assert "PersonaLock" in src, "LoopExecutor 应引用 PersonaLock"

    def test_loop_executor_has_memory_mapping(self):
        """验证LoopExecutor有memory mapping。"""
        src = (FLOWFORGE_ROOT / "loop" / "executor.py").read_text(encoding="utf-8")
        assert "memory_mapping" in src, "LoopExecutor 应支持 memory_mapping"
        assert "_write_memory" in src, "LoopExecutor 应有 _write_memory 方法"
        assert "_read_memory" in src, "LoopExecutor 应有 _read_memory 方法"

    def test_persona_lock_class_exists(self):
        """验证PersonaLock类存在且功能完整。"""
        from flowforge.core.persona_lock import PersonaLock
        lock = PersonaLock()
        assert hasattr(lock, "acquire"), "PersonaLock 应有 acquire 方法"
        assert hasattr(lock, "release"), "PersonaLock 应有 release 方法"
        assert hasattr(lock, "is_locked"), "PersonaLock 应有 is_locked 方法"
        assert hasattr(lock, "get_holder"), "PersonaLock 应有 get_holder 方法"


# ═══════════════════════════════════════════════════════════════════════
# 12. PromptManager自动发现
# ═══════════════════════════════════════════════════════════════════════

class TestPromptManagerDiscovery:
    """验证PromptManager能自动发现*Forge的prompts。"""

    def test_auto_discover_method_exists(self):
        """验证_auto_discover_project_prompts方法存在。"""
        src = (FLOWFORGE_ROOT / "core" / "prompt_manager.py").read_text(encoding="utf-8")
        assert "_auto_discover_project_prompts" in src, \
            "PromptManager 应有 _auto_discover_project_prompts 方法"

    def test_auto_discover_covers_all_projects(self):
        """验证_auto_discover_project_prompts覆盖所有*Forge项目。"""
        src = (FLOWFORGE_ROOT / "core" / "prompt_manager.py").read_text(encoding="utf-8")
        for project in ["contentforge", "novelforge", "devforge", "mallforge"]:
            assert project in src, \
                f"PromptManager 自动发现应覆盖 {project}"

    def test_no_default_prompts_hardcoded(self):
        """验证_DEFAULT_PROMPTS已删除（不再硬编码默认prompts）。"""
        src = (FLOWFORGE_ROOT / "core" / "prompt_manager.py").read_text(encoding="utf-8")
        assert "_DEFAULT_PROMPTS" not in src, \
            "PromptManager 不应有 _DEFAULT_PROMPTS 硬编码"

    def test_prompt_manager_initialization_calls_discover(self):
        """验证PromptManager初始化时调用自动发现。"""
        src = (FLOWFORGE_ROOT / "core" / "prompt_manager.py").read_text(encoding="utf-8")
        # __init__ 中应调用 _auto_discover_project_prompts
        assert "_auto_discover_project_prompts()" in src, \
            "PromptManager.__init__ 应调用 _auto_discover_project_prompts()"

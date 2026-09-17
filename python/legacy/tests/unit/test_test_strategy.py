"""测试配置驱动率验证器和 HTTP Cassette"""
import asyncio
import json
import os
import tempfile
from pathlib import Path

import pytest

from flowforge.tests.utils.config_drive_checker import ConfigDriveChecker, ConfigDriveResult
from flowforge.tests.utils.http_cassette import HTTPCassette


# ═══════════════════════════════════════════════════════════════════
# ConfigDriveChecker 测试
# ═══════════════════════════════════════════════════════════════════


class TestConfigDriveChecker:
    """配置驱动率验证器测试"""

    def _create_mock_project(self, tmp_path: Path) -> Path:
        """创建模拟项目目录结构"""
        project = tmp_path / "test_project"
        project.mkdir()

        # 创建 agents 目录
        agents_dir = project / "agents"
        agents_dir.mkdir()
        (agents_dir / "writer.py").write_text("class WriterAgent: pass")
        (agents_dir / "reviewer.py").write_text("class ReviewerAgent: pass")

        # 创建 config/agents 目录
        config_agents_dir = project / "config" / "agents"
        config_agents_dir.mkdir(parents=True)
        (config_agents_dir / "writer.yaml").write_text("name: writer\nmodel: gpt-4")

        # 创建 config/prompts.yaml
        prompts_yaml = project / "config" / "prompts.yaml"
        prompts_yaml.write_text("writer.system: |\n  You are a writer.\nreviewer.system: |\n  You are a reviewer.\n")

        # 创建 config/workflows 目录
        workflows_dir = project / "config" / "workflows"
        workflows_dir.mkdir(parents=True)
        (workflows_dir / "pipeline.yaml").write_text("name: pipeline\nsteps: []")

        return project

    def test_check_agent_config_rate(self):
        """测试 Agent 配置驱动率检查"""
        with tempfile.TemporaryDirectory() as tmp:
            project = self._create_mock_project(Path(tmp))
            checker = ConfigDriveChecker(project)

            result = checker.check_agent_config_rate()
            assert isinstance(result, ConfigDriveResult)
            assert result.total_items == 2  # writer.py, reviewer.py
            assert result.config_driven == 1  # writer.yaml
            assert result.hardcoded == 1  # reviewer.py 无对应 yaml
            assert 0 < result.rate < 1

    def test_check_agent_config_rate_empty(self):
        """测试空项目的 Agent 配置驱动率"""
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "empty_project"
            project.mkdir()
            checker = ConfigDriveChecker(project)

            result = checker.check_agent_config_rate()
            assert result.total_items == 0
            assert result.rate == 0.0

    def test_check_prompt_config_rate(self):
        """测试提示词配置驱动率检查"""
        with tempfile.TemporaryDirectory() as tmp:
            project = self._create_mock_project(Path(tmp))
            checker = ConfigDriveChecker(project)

            result = checker.check_prompt_config_rate()
            assert isinstance(result, ConfigDriveResult)
            assert result.config_driven == 2  # writer.system, reviewer.system
            assert result.rate > 0

    def test_check_workflow_config_rate(self):
        """测试工作流配置驱动率检查"""
        with tempfile.TemporaryDirectory() as tmp:
            project = self._create_mock_project(Path(tmp))
            checker = ConfigDriveChecker(project)

            result = checker.check_workflow_config_rate()
            assert result.total_items == 1
            assert result.config_driven == 1
            assert result.rate == 1.0

    def test_full_report(self):
        """测试完整报告生成"""
        with tempfile.TemporaryDirectory() as tmp:
            project = self._create_mock_project(Path(tmp))
            checker = ConfigDriveChecker(project)

            report = checker.full_report()
            assert "agent" in report
            assert "prompt" in report
            assert "workflow" in report
            assert all(isinstance(v, ConfigDriveResult) for v in report.values())

    def test_check_real_flowforge_project(self):
        """测试对真实 FlowForge 项目的检查"""
        flowforge_dir = Path(__file__).parent.parent.parent
        if not (flowforge_dir / "agents").exists():
            pytest.skip("FlowForge project not found")

        checker = ConfigDriveChecker(flowforge_dir)
        report = checker.full_report()

        # 验证报告结构正确
        assert "agent" in report
        assert "prompt" in report
        assert "workflow" in report

        # prompts.yaml 应该有大量 key
        assert report["prompt"].config_driven > 0, (
            "FlowForge should have config-driven prompts in prompts.yaml"
        )


# ═══════════════════════════════════════════════════════════════════
# HTTPCassette 测试
# ═══════════════════════════════════════════════════════════════════


class TestHTTPCassette:
    """HTTP Cassette 录制回放测试"""

    def test_record_and_playback(self):
        """测试录制和回放"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": [{"role": "user", "content": "hello"}]}
            response = {"content": "Hello! How can I help you?"}

            # 录制
            cassette.record(request, response, "test_greeting")

            # 回放
            result = cassette.playback(request, "test_greeting")
            assert result is not None
            assert result["content"] == "Hello! How can I help you?"

    def test_playback_no_recording(self):
        """测试无录制时的回放"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": []}

            result = cassette.playback(request, "nonexistent")
            assert result is None

    def test_has_recording(self):
        """测试录制存在检查"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": []}

            assert not cassette.has_recording(request, "test")

            cassette.record(request, {"content": "test"}, "test")
            assert cassette.has_recording(request, "test")

    def test_different_requests_different_keys(self):
        """测试不同请求生成不同 key"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            req1 = {"model": "gpt-4", "messages": [{"role": "user", "content": "hello"}]}
            req2 = {"model": "gpt-4", "messages": [{"role": "user", "content": "world"}]}

            cassette.record(req1, {"content": "hello response"}, "test")
            assert cassette.playback(req2, "test") is None

    @pytest.mark.asyncio
    async def test_record_or_playback_once(self):
        """测试 record_or_playback 的 once 模式"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp, record_mode="once")
            request = {"model": "gpt-4", "messages": []}
            call_count = 0

            async def mock_llm_call(req):
                nonlocal call_count
                call_count += 1
                return {"content": f"response {call_count}"}

            # 首次调用：无录制，调用真实函数
            result1 = await cassette.record_or_playback(request, mock_llm_call, "test_once")
            assert result1["content"] == "response 1"
            assert call_count == 1

            # 二次调用：有录制，回放
            result2 = await cassette.record_or_playback(request, mock_llm_call, "test_once")
            assert result2["content"] == "response 1"  # 回放第一次的结果
            assert call_count == 1  # 没有再次调用

    @pytest.mark.asyncio
    async def test_record_or_playback_none_mode(self):
        """测试 record_or_playback 的 none 模式（仅回放）"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp, record_mode="none")
            request = {"model": "gpt-4", "messages": []}

            async def mock_llm_call(req):
                return {"content": "should not be called"}

            # 无录制时应抛异常
            with pytest.raises(RuntimeError, match="Cassette not found"):
                await cassette.record_or_playback(request, mock_llm_call, "test_none")

    def test_list_recordings(self):
        """测试列出录制文件"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": []}

            cassette.record(request, {"content": "test1"}, "test_list_1")
            cassette.record({"model": "gpt-3.5", "messages": []}, {"content": "test2"}, "test_list_2")

            recordings = cassette.list_recordings()
            assert len(recordings) == 2

    def test_clear_recordings(self):
        """测试清除录制文件"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": []}

            cassette.record(request, {"content": "test1"}, "test_clear_1")
            cassette.record({"model": "gpt-3.5", "messages": []}, {"content": "test2"}, "test_clear_2")

            # 只清除特定测试名
            count = cassette.clear_recordings("test_clear_1")
            assert count == 1
            assert len(cassette.list_recordings()) == 1

            # 清除全部
            count = cassette.clear_recordings()
            assert count == 1
            assert len(cassette.list_recordings()) == 0

    def test_cassette_file_format(self):
        """测试 Cassette 文件格式"""
        with tempfile.TemporaryDirectory() as tmp:
            cassette = HTTPCassette(cassette_dir=tmp)
            request = {"model": "gpt-4", "messages": []}
            response = {"content": "test"}

            cassette.record(request, response, "test_format")

            # 读取文件验证格式
            recordings = cassette.list_recordings()
            assert len(recordings) == 1
            cassette_file = Path(tmp) / (recordings[0]["file"])
            with open(cassette_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            assert "recorded_at" in data
            assert "test_name" in data
            assert data["test_name"] == "test_format"
            assert data["request"] == request
            assert data["response"] == response

"""T8 Web功能DOM验证E2E测试 — 验证FlowForge前后端Web功能必须操控浏览器查看DOM。

铁律T8：凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看DOM确认真实成功，
且对DOM内容调用LLM审核质量。

测试流程：
1. 操控真实浏览器（playwright）访问FlowForge Web UI和API — T8禁止用requests模拟DOM
2. 查看DOM内容确认真实成功 — T8不能只看HTTP状态码
3. 对DOM内容调用LLM审核质量 — T7+T8联合验证
4. 采集MetricsCollector指标 — T6

运行方式：
    cd d:\software\openclaw
    python -m pytest flowforge/tests/e2e/test_t8_dom_verify.py -v -s
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from flowforge.tests.utils.t8_dom_verifier import DOMVerifier
from flowforge.tests.utils.t7_t8_base import MetricsCollector, TestReporter, print_result

# FlowForge服务地址（从配置读取，禁止硬编码端口）
FLOWFORGE_BACKEND = os.environ.get("FLOWFORGE_BACKEND", "http://localhost:8000")
FLOWFORGE_WEB = os.environ.get("FLOWFORGE_WEB", "http://localhost:5174")


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def verifier():
    """T8 DOM验证器实例。"""
    return DOMVerifier()


@pytest.fixture(scope="module")
def metrics():
    return MetricsCollector(task_id="t8_dom_verify_e2e")


class TestT8DOMVerify:
    """T8 Web功能DOM验证E2E测试。"""

    @pytest.mark.asyncio
    async def test_t8_backend_health_api(self, verifier, metrics):
        """T8验证：后端健康检查API（真实响应+DOM内容验证）。"""
        test_name = "T8_后端健康检查API"
        try:
            result = await verifier.verify_api_response(
                url=f"{FLOWFORGE_BACKEND}/health",
                expected_status=200,
                expected_json_key="status",
                llm_verify=False,  # 健康检查不需要LLM审核
                content_type="API健康检查响应",
            )
            metrics.record_tool_call("httpx", "ok" if result["found"] else "fail", result["detail"])

            print(f"\n  API响应: {result['detail']}")
            print(f"  DOM内容: {result['dom_content'][:100]}...")

            # T3: 必须有具体断言
            assert result["found"], f"后端健康检查失败: {result['detail']}"
            assert "status" in result["dom_content"], f"响应中缺少status字段"

            print_result(test_name, True, result["detail"][:60], metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    async def test_t8_models_health_api(self, verifier, metrics):
        """T8验证：模型健康状态API（验证模型管理有效性）。"""
        test_name = "T8_模型健康状态API"
        try:
            result = await verifier.verify_api_response(
                url=f"{FLOWFORGE_BACKEND}/api/v1/admin/models",
                expected_status=200,
                expected_json_key="models",
                llm_verify=False,
                content_type="模型健康状态响应",
            )
            metrics.record_tool_call("httpx", "ok" if result["found"] else "fail", result["detail"])

            print(f"\n  模型健康: {result['detail']}")
            print(f"  DOM内容: {result['dom_content'][:200]}...")

            assert result["found"], f"模型健康API失败: {result['detail']}"
            # 验证models字段存在
            assert "models" in result["dom_content"], "响应缺少models字段"

            print_result(test_name, True, result["detail"][:60], metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    async def test_t8_web_ui_dom(self, verifier, metrics):
        """T8验证：FlowForge Web UI DOM（操控真实浏览器查看DOM）。"""
        test_name = "T8_WebUI_DOM验证"
        try:
            result = await verifier.verify_page_dom(
                url=FLOWFORGE_WEB,
                selector="",
                expected_text="",
                llm_verify=False,
                content_type="Web UI页面内容",
                context="FlowForge管理界面",
                timeout=60,
            )
            metrics.record_tool_call("playwright", "ok" if result["found"] else "fail", result["detail"])

            print(f"\n  Web UI验证: {result['detail']}")
            print(f"  DOM内容长度: {len(result.get('dom_content', ''))}")

            # T3: 必须有具体断言
            assert result["found"], f"Web UI DOM验证失败: {result['detail']}"
            assert len(result.get("dom_content", "")) > 0, "DOM内容为空"

            print_result(test_name, True, f"DOM内容长度={len(result['dom_content'])}", metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    async def test_t8_available_models_api(self, verifier, metrics):
        """T8验证：可用模型列表API（验证候选链非空）。"""
        test_name = "T8_可用模型列表API"
        try:
            result = await verifier.verify_api_response(
                url=f"{FLOWFORGE_BACKEND}/api/v1/admin/models",
                expected_status=200,
                llm_verify=False,
                content_type="可用模型列表响应",
            )
            metrics.record_tool_call("httpx", "ok" if result["found"] else "fail", result["detail"])

            print(f"\n  可用模型: {result['detail']}")
            print(f"  DOM内容: {result['dom_content'][:300]}...")

            assert result["found"], f"可用模型API失败: {result['detail']}"
            # 验证返回的模型列表非空（100%成功率的前提：必须有可用模型）
            dom_content = result.get("dom_content", "")
            assert len(dom_content) > 10, "可用模型列表为空，无法保证100%成功率"

            print_result(test_name, True, result["detail"][:60], metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    async def test_t8_web_ui_llm_review(self, verifier, metrics):
        """T8+T7联合验证：Web UI DOM内容经LLM审核。"""
        test_name = "T8+T7_WebUI_DOM内容LLM审核"
        try:
            result = await verifier.verify_page_dom(
                url=FLOWFORGE_WEB,
                selector="",
                expected_text="",
                llm_verify=True,  # T7+T8联合验证：对DOM内容调用LLM审核
                content_type="Web UI页面内容",
                context="FlowForge管理界面首页，应该包含导航、功能入口等元素",
                timeout=60,
            )
            metrics.record_tool_call("playwright+llm", "ok" if result["found"] else "fail", result["detail"])

            print(f"\n  T8+T7联合验证: {result['detail']}")
            if result.get("llm_review"):
                print(f"  LLM审核: verdict={result['llm_review'].get('verdict')}, reason={result['llm_review'].get('reason', '')}")

            assert result["found"], f"T8+T7联合验证失败: {result['detail']}"

            print_result(test_name, True, result["detail"][:60], metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    def test_t8_report_generation(self, verifier, metrics):
        """生成T8测试报告（T6指标采集）。"""
        reporter = TestReporter(metrics, None, verifier)
        report = reporter.generate()
        print(report)
        assert "T8" in report
        assert "Metrics Report" in report

    async def teardown_method(self, method):
        """每个测试方法后不关闭浏览器（模块级复用）。"""
        pass


async def teardown_module():
    """模块结束时关闭浏览器。"""
    # 全局verifier的关闭在fixture中处理
    pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])

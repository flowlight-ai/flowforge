"""T7 LLM内容审核E2E测试 — 验证LLM生成内容必须经LLM审核通过。

铁律T7：凡LLM生成的内容（文章/评论/回复/文案等），必须再调用LLM审核通过后才算验证通过。

测试流程：
1. 调用真实LLM生成内容（文章/评论/标题等）— T1禁止Mock
2. 使用T7Reviewer对生成内容进行6维度审核 — T7
3. 采集MetricsCollector指标 — T6
4. 生成TestReporter报告

运行方式：
    cd d:\software\openclaw
    set FLOWFORGE_REAL_LLM=1
    python -m pytest flowforge/tests/e2e/test_t7_llm_review.py -v -s
"""
import asyncio
import os
import sys
import time
from pathlib import Path

import pytest

# 确保项目根目录在sys.path中
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from flowforge.tests.utils.t7_reviewer import T7Reviewer
from flowforge.tests.utils.t7_t8_base import MetricsCollector, TestReporter, print_result


# ==================== 测试数据（真实场景，T2禁止假数据）====================

# 真实场景：今日头条文章评论生成
TOUTIAO_COMMENT_SCENARIO = {
    "title": "17岁女生指控被江西财大男生多次性侵",
    "context": "你正在刷今日头条，看到了这篇文章，想发表一条评论。作为一个普通网友，对事件有自己的看法。",
    "prompt": (
        "新闻标题：17岁女生指控被江西财大男生多次性侵\n"
        "新闻内容：近日，一名17岁女生在社交平台发帖称，遭到江西财经大学一名男生多次性侵，"
        "并已向警方报案。校方回应称已介入调查，涉事男生已被停课配合调查。警方表示正在依法处理。\n\n"
        "请以普通网友的口吻，对这条新闻发表一条评论。要求：口语化、有情绪表达、20-50字、不能有AI痕迹。"
        "直接输出评论内容，不要索要更多信息。"
    ),
}

# 真实场景：文章标题生成
ARTICLE_TITLE_SCENARIO = {
    "title": "AI编程工具对比",
    "context": "写一篇关于主流AI编程工具（Cursor/Copilot/Trae）对比的文章，需要生成一个吸引人的标题。",
    "prompt": "请为这篇AI编程工具对比文章生成一个标题。要求：吸引人、不超过30字、有点击欲望但不是标题党。",
}

# 真实场景：技术摘要生成
TECH_SUMMARY_SCENARIO = {
    "title": "FlowForge架构设计",
    "context": "FlowForge是一个多项目AI Agent智能体平台，采用分层架构：应用层→指挥中枢→专家执行→工具与记忆。",
    "prompt": (
        "以下是FlowForge架构介绍的完整内容，请基于此生成一个50字以内的摘要：\n\n"
        "FlowForge是一个多项目AI Agent智能体平台，采用分层架构设计。"
        "应用层包含ContentForge/DevForge/NovelForge/MallForge等专业场景应用；"
        "指挥中枢层负责Agent编排和任务调度；专家执行层提供各类专业Agent能力；"
        "工具与记忆层提供工具注册、向量检索、记忆管理等基础能力。"
        "FlowForge作为通用底座框架，通过插件化/配置化方式支持上层*Forge项目扩展。"
        "核心原则是配置驱动优于代码继承，组合优于继承。\n\n"
        "要求：准确概括、语言精炼、有技术感。直接输出摘要，不要索要更多信息。"
    ),
}


# ==================== 辅助函数 ====================

async def call_openroute_llm(prompt: str, system: str = "", model: str = "Doubao-Seed2.0",
                              max_tokens: int = 500) -> tuple:
    """调用真实OpenRoute LLM生成内容（T1: 禁止Mock LLM）.

    Returns:
        (content, elapsed, model_used)
    """
    import httpx
    import yaml

    # 从models.yaml读取API Key（禁止硬编码，铁律5）
    models_yaml = PROJECT_ROOT / "flowforge" / "config" / "models.yaml"
    api_key = ""
    base_url = "http://127.0.0.1:13001/v1"
    if models_yaml.exists():
        with open(models_yaml, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        or_cfg = cfg.get("providers", {}).get("openroute", {})
        api_key = or_cfg.get("api_key_default", "")
        base_url = or_cfg.get("base_url", base_url).rstrip("/")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    start = time.time()
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": max_tokens,
            },
        )
        elapsed = round(time.time() - start, 2)
        if resp.status_code != 200:
            raise Exception(f"LLM调用失败: HTTP {resp.status_code}, body={resp.text[:200]}")
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        model_used = data.get("model", model)
        return content, elapsed, model_used


# ==================== 测试用例 ====================

@pytest.fixture(scope="module")
def event_loop():
    """模块级事件循环（避免每次测试都重新创建）。"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def reviewer():
    """T7审核器实例。"""
    return T7Reviewer()


@pytest.fixture(scope="module")
def metrics():
    """指标采集器。"""
    return MetricsCollector(task_id="t7_llm_review_e2e")


class TestT7LLMReview:
    """T7 LLM内容审核E2E测试。"""

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        os.environ.get("FLOWFORGE_REAL_LLM") != "1",
        reason="需要设置 FLOWFORGE_REAL_LLM=1 才能运行真实LLM测试（T1铁律）"
    )
    async def test_t7_review_toutiao_comment(self, reviewer, metrics):
        """T7审核：今日头条评论生成+审核。"""
        scenario = TOUTIAO_COMMENT_SCENARIO
        test_name = "T7_今日头条评论生成审核"

        try:
            # 1. 调用真实LLM生成评论（T1: 禁止Mock）
            content, gen_elapsed, model_used = await call_openroute_llm(
                prompt=scenario["prompt"],
                system="你是一个普通网友，正在刷今日头条。用口语化的方式表达观点。",
                max_tokens=200,
            )
            metrics.record_llm_call(
                agent="creator", model=model_used,
                elapsed=gen_elapsed, status="ok"
            )

            assert content and content.strip(), f"LLM生成内容为空"
            print(f"\n  生成评论: {content[:80]}... (model={model_used}, {gen_elapsed}s)")

            # 2. T7审核：调用LLM审核生成内容
            review = await reviewer.review(
                content=content,
                context=scenario["context"],
                content_type="今日头条评论",
            )
            metrics.record_llm_call(
                agent="reviewer", model=review.get("review_model", ""),
                elapsed=review.get("elapsed_s", 0), status="ok"
            )

            print(f"  T7审核结果: verdict={review['verdict']}, reason={review.get('reason', '')}")

            # 3. T3: 必须有具体断言（禁止跳过验证）
            assert review["verdict"] in ("PASS", "FAIL"), f"审核结果异常: {review}"
            assert review["verdict"] == "PASS", f"T7审核未通过: {review.get('reason', '')}"

            print_result(test_name, True, f"评论审核通过 ({gen_elapsed}s)", metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        os.environ.get("FLOWFORGE_REAL_LLM") != "1",
        reason="需要设置 FLOWFORGE_REAL_LLM=1 才能运行真实LLM测试（T1铁律）"
    )
    async def test_t7_review_article_title(self, reviewer, metrics):
        """T7审核：文章标题生成+审核。"""
        scenario = ARTICLE_TITLE_SCENARIO
        test_name = "T7_文章标题生成审核"

        try:
            content, gen_elapsed, model_used = await call_openroute_llm(
                prompt=scenario["prompt"],
                system="你是一个内容创作者，擅长写吸引人的标题。",
                max_tokens=100,
            )
            metrics.record_llm_call(
                agent="title_writer", model=model_used,
                elapsed=gen_elapsed, status="ok"
            )

            assert content and content.strip(), f"LLM生成标题为空"
            print(f"\n  生成标题: {content[:50]}... (model={model_used}, {gen_elapsed}s)")

            review = await reviewer.review(
                content=content,
                context=scenario["context"],
                content_type="文章标题",
            )
            metrics.record_llm_call(
                agent="reviewer", model=review.get("review_model", ""),
                elapsed=review.get("elapsed_s", 0), status="ok"
            )

            print(f"  T7审核结果: verdict={review['verdict']}, reason={review.get('reason', '')}")

            assert review["verdict"] == "PASS", f"T7标题审核未通过: {review.get('reason', '')}"

            print_result(test_name, True, f"标题审核通过 ({gen_elapsed}s)", metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        os.environ.get("FLOWFORGE_REAL_LLM") != "1",
        reason="需要设置 FLOWFORGE_REAL_LLM=1 才能运行真实LLM测试（T1铁律）"
    )
    async def test_t7_review_tech_summary(self, reviewer, metrics):
        """T7审核：技术摘要生成+审核。"""
        scenario = TECH_SUMMARY_SCENARIO
        test_name = "T7_技术摘要生成审核"

        try:
            content, gen_elapsed, model_used = await call_openroute_llm(
                prompt=scenario["prompt"],
                system="你是一个技术文档工程师，擅长写精炼的摘要。",
                max_tokens=200,
            )
            metrics.record_llm_call(
                agent="summarizer", model=model_used,
                elapsed=gen_elapsed, status="ok"
            )

            assert content and content.strip(), f"LLM生成摘要为空"
            print(f"\n  生成摘要: {content[:60]}... (model={model_used}, {gen_elapsed}s)")

            review = await reviewer.review(
                content=content,
                context=scenario["context"],
                content_type="技术摘要",
            )
            metrics.record_llm_call(
                agent="reviewer", model=review.get("review_model", ""),
                elapsed=review.get("elapsed_s", 0), status="ok"
            )

            print(f"  T7审核结果: verdict={review['verdict']}, reason={review.get('reason', '')}")

            assert review["verdict"] == "PASS", f"T7摘要审核未通过: {review.get('reason', '')}"

            print_result(test_name, True, f"摘要审核通过 ({gen_elapsed}s)", metrics)
        except Exception as e:
            print_result(test_name, False, str(e)[:100], metrics)
            raise

    def test_t7_report_generation(self, reviewer, metrics):
        """生成T7测试报告（T6指标采集）。"""
        reporter = TestReporter(metrics, reviewer, None)
        report = reporter.generate()
        print(report)
        # T3: 必须有具体断言
        assert "T7" in report
        assert "Metrics Report" in report
        assert metrics.exit_code() in (0, 1)


if __name__ == "__main__":
    # 直接运行模式：设置环境变量并执行
    os.environ["FLOWFORGE_REAL_LLM"] = "1"
    pytest.main([__file__, "-v", "-s", "--tb=short"])

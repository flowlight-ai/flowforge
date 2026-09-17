"""DualThresholdCompactor 单元测试 — 覆盖双阈值压缩、三档回退链、死循环防护"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from flowforge.harness.compaction import (
    DualThresholdCompactor, CompactionConfig, CompactionStrategy, CompactionResult,
)


def make_messages(count, tokens_per_msg=100):
    """生成测试消息列表"""
    messages = []
    for i in range(count):
        messages.append({
            "role": "user" if i % 2 == 0 else "assistant",
            "content": "x" * tokens_per_msg,
        })
    return messages


class TestShouldCompact:
    """测试 should_compact 阈值判断"""
    
    def test_below_threshold(self):
        """token使用率低于阈值，不需要压缩"""
        compactor = DualThresholdCompactor()
        assert compactor.should_compact(50000, 128000) is False
    
    def test_at_threshold(self):
        """token使用率等于阈值，需要压缩"""
        compactor = DualThresholdCompactor()
        assert compactor.should_compact(int(128000 * 0.92), 128000) is True
    
    def test_above_threshold(self):
        """token使用率超过阈值，需要压缩"""
        compactor = DualThresholdCompactor()
        assert compactor.should_compact(120000, 128000) is True
    
    def test_custom_threshold(self):
        """自定义阈值"""
        compactor = DualThresholdCompactor(CompactionConfig(token_threshold=0.80))
        assert compactor.should_compact(int(128000 * 0.79), 128000) is False
        assert compactor.should_compact(int(128000 * 0.80), 128000) is True
    
    def test_max_compaction_attempts_exceeded(self):
        """超过最大压缩次数仍然返回True（但会触发强制策略）"""
        compactor = DualThresholdCompactor(CompactionConfig(max_compaction_attempts=2))
        compactor._compaction_count["session1"] = 2
        # 超过次数仍返回True，但日志会警告
        assert compactor.should_compact(120000, 128000, "session1") is True


class TestCompact:
    """测试 compact 压缩执行"""
    
    @pytest.mark.asyncio
    async def test_no_messages_to_compact(self):
        """消息太少不需要压缩"""
        compactor = DualThresholdCompactor(CompactionConfig(preserved_rounds=5))
        messages = make_messages(4)  # 少于 preserved_rounds * 2
        
        result_msgs, result = await compactor.compact(messages, 120000, 128000)
        assert result.messages_compacted == 0
    
    @pytest.mark.asyncio
    async def test_extractive_compact(self):
        """测试抽取式摘要（第二档回退）"""
        compactor = DualThresholdCompactor(CompactionConfig(
            preserved_rounds=1, max_compaction_attempts=3,
        ))
        # 创建足够多的消息
        messages = [{"role": "system", "content": "系统提示"}]
        for i in range(10):
            messages.append({"role": "user", "content": f"用户消息{i} " + "x" * 200})
            messages.append({"role": "assistant", "content": f"助手回复{i} " + "x" * 200})
        
        result_msgs, result = await compactor.compact(messages, 120000, 128000)
        
        # 应该执行了压缩
        assert result.messages_compacted > 0
        assert result.compression_ratio <= 1.0
    
    @pytest.mark.asyncio
    async def test_drop_oldest_compact(self):
        """测试丢弃最旧消息（第三档回退）"""
        compactor = DualThresholdCompactor(CompactionConfig(
            preserved_rounds=1, max_compaction_attempts=3,
        ))
        # 设置压缩计数为2，触发第三档
        compactor._compaction_count["test_session"] = 2
        
        messages = [{"role": "system", "content": "系统提示"}]
        for i in range(10):
            messages.append({"role": "user", "content": f"消息{i}"})
            messages.append({"role": "assistant", "content": f"回复{i}"})
        
        result_msgs, result = await compactor.compact(
            messages, 120000, 128000, session_id="test_session"
        )
        
        # 第三档应该使用drop_oldest策略
        assert result.strategy_used in (CompactionStrategy.DROP_OLDEST, CompactionStrategy.TRUNCATE)
    
    @pytest.mark.asyncio
    async def test_llm_summary_compact(self):
        """测试LLM摘要压缩（第一档回退）"""
        mock_llm = AsyncMock()
        mock_response = MagicMock()
        # 摘要需要足够长以通过quality_threshold(0.7)检查
        # quality_score = min(1.0, summary_len / max(original_len * 0.1, 1))
        mock_response.content = (
            "这是对话摘要，包含关键决策和结论。"
            "主要讨论了用户提出的多个问题，助手给出了详细解答。"
            "核心要点包括：1) 项目架构设计确认；2) 技术选型决策；3) 开发计划安排。"
        )
        mock_llm.chat = AsyncMock(return_value=mock_response)
        
        compactor = DualThresholdCompactor(CompactionConfig(
            preserved_rounds=1, max_compaction_attempts=3,
        ))
        
        messages = []
        for i in range(10):
            messages.append({"role": "user", "content": f"用户消息{i}"})
            messages.append({"role": "assistant", "content": f"助手回复{i}"})
        
        result_msgs, result = await compactor.compact(
            messages, 120000, 128000, llm_client=mock_llm
        )
        
        # 应该调用了LLM摘要
        assert mock_llm.chat.called
        assert result.strategy_used == CompactionStrategy.LLM_SUMMARY
    
    @pytest.mark.asyncio
    async def test_force_truncate(self):
        """测试强制截断到安全阈值"""
        compactor = DualThresholdCompactor(CompactionConfig(
            preserved_rounds=0, safe_threshold=0.50,
        ))
        
        # 创建大量消息
        messages = []
        for i in range(100):
            messages.append({"role": "user", "content": "x" * 500})
            messages.append({"role": "assistant", "content": "y" * 500})
        
        result_msgs, result = await compactor.compact(messages, 100000, 128000)
        
        # 验证压缩后token数在安全范围内
        estimated_tokens = sum(len(m.get("content", "")) // 4 for m in result_msgs)
        safe_tokens = int(128000 * 0.50)
        # 允许一定误差
        assert estimated_tokens <= safe_tokens * 1.5


class TestCompactionResult:
    """测试 CompactionResult 数据模型"""
    
    def test_default_values(self):
        """测试默认值"""
        result = CompactionResult()
        assert result.original_tokens == 0
        assert result.compressed_tokens == 0
        assert result.compression_ratio == 1.0
        assert result.strategy_used == CompactionStrategy.TRUNCATE
    
    def test_with_values(self):
        """测试赋值"""
        result = CompactionResult(
            original_tokens=100000,
            compressed_tokens=60000,
            compression_ratio=0.6,
            strategy_used=CompactionStrategy.LLM_SUMMARY,
            messages_preserved=10,
            messages_compacted=20,
            quality_score=0.85,
        )
        assert result.compression_ratio == 0.6
        assert result.quality_score == 0.85


class TestSessionManagement:
    """测试会话管理"""
    
    def test_reset_session(self):
        """测试重置会话压缩计数"""
        compactor = DualThresholdCompactor()
        compactor._compaction_count["session1"] = 3
        compactor.reset_session("session1")
        assert compactor._compaction_count.get("session1", 0) == 0
    
    def test_different_sessions_independent(self):
        """测试不同会话的压缩计数独立"""
        compactor = DualThresholdCompactor()
        compactor._compaction_count["session1"] = 1
        compactor._compaction_count["session2"] = 2
        
        assert compactor._compaction_count["session1"] == 1
        assert compactor._compaction_count["session2"] == 2


class TestSplitMessages:
    """测试消息分割逻辑"""
    
    def test_preserve_recent_rounds(self):
        """测试保留最近N轮对话"""
        compactor = DualThresholdCompactor(CompactionConfig(preserved_rounds=2))
        
        messages = []
        for i in range(10):
            messages.append({"role": "user", "content": f"u{i}"})
            messages.append({"role": "assistant", "content": f"a{i}"})
        
        preserved, to_compact = compactor._split_messages(messages)
        
        # 保留最近2轮 = 4条消息
        assert len(preserved) == 4
        assert len(to_compact) == 16
    
    def test_too_few_messages(self):
        """测试消息太少时全部保留"""
        compactor = DualThresholdCompactor(CompactionConfig(preserved_rounds=5))
        messages = make_messages(4)
        
        preserved, to_compact = compactor._split_messages(messages)
        assert len(preserved) == 4  # 全部保留
        assert len(to_compact) == 0  # 无需压缩

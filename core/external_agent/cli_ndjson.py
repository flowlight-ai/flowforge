"""CLI NDJSON + stderr 解析器（CL-038）。

为 CLI Adapter 提供 NDJSON 流式解析 + stderr 收集能力：
    - StderrCollector: 按级别（warning/info/error/fatal/unknown）收集 stderr
    - NDJSONParser: 流式解析 Newline-Delimited JSON
    - CLIResult: CLI 调用结果封装（success 仅看 returncode==0）
    - parse_cli_invocation: 同步调用后的解析入口
    - stream_cli_invocation: 异步流式解析生成器

"stderr 也算活着"教训（CL-038）：
    CLI 子进程即使 stderr 有输出也算正常（不要因为 stderr 非空就判定失败）。
    stderr 中可能含有 warning / debug 信息，应解析并保留，但不能用作
    success/fail 判定——success 仅以 returncode==0 为准。

NDJSON（Newline-Delimited JSON）流式输出：
    每行一个 JSON 对象，便于流式解析（vs 一次性读完 stdout 再 JSON.parse）。
    适用于长任务场景（如 claude code 跑完整测试套件），边接收边处理。

设计依据：
    - [doc:review/review.md#14.4] CL-038 NDJSON + stderr 也算活着
    - [doc:decisions/006-external-agent-integration.md] §4 首批接入
    - [doc:design/naming-contract.md#2.2] 灵智体
    - FlowForge CLI NDJSON 解析器规范

铁律遵守：
    - 铁律 5：禁止硬编码密钥 / 路径（sandbox.cwd 由调用方传入）
    - 编程红线 9：组合优于继承（Parser / Collector 为独立工具类）
    - 编程红线 11：配置驱动（不硬编码路径）
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.cli_ndjson")


# ---------------------------------------------------------------------------
# StderrCollector
# ---------------------------------------------------------------------------


class StderrCollector:
    """子进程 stderr 收集器（CL-038 "stderr 也算活着"教训）。

    职责：收集子进程 stderr 输出，按行分类（warning / info / error / fatal）。

    "stderr 也算活着"教训：
        stderr 非空不等于失败——CLI 子进程即使 stderr 有输出也算正常。
        stderr 中可能含有 warning / debug 信息，应解析并保留，但不能用作
        success/fail 判定。本类仅做分类收集，不做判定；判定由调用方根据
        returncode 决定（CLIResult.success 仅看 returncode==0）。

    分类规则（启发式，简单匹配前缀，大小写不敏感）：
        - "WARNING" / "warn" → warning
        - "INFO" / "info" → info
        - "ERROR" → error
        - "FATAL" / "fatal" / "panic" / "traceback" → fatal
        - 其他 → unknown

    内部存储：``dict[level, list[str]]``，level ∈
        {"warning", "info", "error", "fatal", "unknown"}
    """

    # 分类级别常量
    LEVELS: tuple[str, ...] = (
        "warning",
        "info",
        "error",
        "fatal",
        "unknown",
    )

    # 前缀匹配规则（按优先级顺序，大小写不敏感）
    # 注意：fatal 必须在 error 之前匹配，因为某些 fatal 行可能也含 "error"
    _PREFIX_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("fatal", ("fatal", "panic", "traceback")),
        ("error", ("error",)),
        ("warning", ("warning", "warn")),
        ("info", ("info",)),
    )

    def __init__(self) -> None:
        self._lines: dict[str, list[str]] = {level: [] for level in self.LEVELS}
        self._first_line: Optional[str] = None
        self._last_line: Optional[str] = None

    @classmethod
    def _classify(cls, line: str) -> str:
        """启发式分类一行 stderr 文本。

        Args:
            line: stderr 单行文本（已去除换行符）。

        Returns:
            级别字符串（warning / info / error / fatal / unknown）。
        """
        if not line:
            return "unknown"
        # 去除前导空白后做大小写不敏感前缀匹配
        stripped = line.lstrip()
        lowered = stripped.lower()
        for level, prefixes in cls._PREFIX_RULES:
            for prefix in prefixes:
                if lowered.startswith(prefix):
                    return level
        return "unknown"

    def feed(self, line: str) -> None:
        """喂入一行 stderr 文本。

        Args:
            line: stderr 单行文本。可包含尾部换行符（自动去除），
                也可为 bytes（自动 decode）。
        """
        if isinstance(line, bytes):  # defensive: asyncio StreamReader 默认 yield bytes
            line = line.decode("utf-8", errors="replace")
        # 去除尾部换行符（保留行内其他空白）
        cleaned = line.rstrip("\r\n")
        # 空行不计入分类，但也不存储（避免噪声）
        if not cleaned:
            return
        level = self._classify(cleaned)
        self._lines[level].append(cleaned)
        if self._first_line is None:
            self._first_line = cleaned
        self._last_line = cleaned

    def get_lines(self, level: Optional[str] = None) -> list[str]:
        """按级别过滤返回 stderr 行。

        Args:
            level: 级别过滤（warning / info / error / fatal / unknown）。
                None 返回全部级别合并（按入库顺序无法保证，建议按级别分别取）。

        Returns:
            行列表（副本，修改不影响内部状态）。
        """
        if level is None:
            # 合并所有级别（按级别顺序）
            merged: list[str] = []
            for lvl in self.LEVELS:
                merged.extend(self._lines[lvl])
            return merged
        if level not in self._lines:
            logger.warning("stderr_collector.get_lines unknown_level=%s", level)
            return []
        return list(self._lines[level])

    def has_fatal(self) -> bool:
        """是否有 fatal 级别行。

        用于阻断判定参考——但默认不阻断（"stderr 也算活着"教训）。
        阻断与否由调用方根据业务需要决定。

        Returns:
            True 表示 stderr 中存在 fatal / panic / traceback 行。
        """
        return len(self._lines["fatal"]) > 0

    def summary(self) -> dict[str, Any]:
        """返回 stderr 收集摘要。

        Returns:
            摘要字典，结构::

                {
                    "total": int,           # 总行数（不含空行）
                    "warning": int,         # warning 行数
                    "info": int,            # info 行数
                    "error": int,           # error 行数
                    "fatal": int,           # fatal 行数
                    "unknown": int,         # 未知级别行数
                    "first_line": str|null, # 首行（不含换行）
                    "last_line": str|null,  # 末行（不含换行）
                }
        """
        counts = {level: len(self._lines[level]) for level in self.LEVELS}
        total = sum(counts.values())
        return {
            "total": total,
            "warning": counts["warning"],
            "info": counts["info"],
            "error": counts["error"],
            "fatal": counts["fatal"],
            "unknown": counts["unknown"],
            "first_line": self._first_line,
            "last_line": self._last_line,
        }


# ---------------------------------------------------------------------------
# NDJSONParser
# ---------------------------------------------------------------------------


class NDJSONParser:
    """NDJSON 流式解析器（CL-038）。

    职责：流式解析 NDJSON 输出（每行一个 JSON 对象）。

    NDJSON（Newline-Delimited JSON）：
        每行一个独立的 JSON 对象，以 ``\\n`` 分隔。适用于流式输出场景：
        边接收边解析，无需等待完整 stdout 再 JSON.parse。

    解析失败处理：
        单行 JSON 解析失败时记录到 ``_failures``，不抛异常（流式语义：
        单行失败不能阻断整体解析）。

    内部状态：
        - ``_buffer``: 不完整行的缓存（``feed_chunk`` 时最后一行若不完整则缓存）
        - ``_parsed``: 已解析成功的 JSON 对象列表
        - ``_failures``: 解析失败的 (line, error) 元组列表

    设计参考：FlowForge CLI NDJSON 解析器规范
    """

    def __init__(self) -> None:
        self._buffer: str = ""
        self._parsed: list[dict[str, Any]] = []
        self._failures: list[tuple[str, str]] = []

    def feed(self, line: str) -> list[dict[str, Any]]:
        """喂入一行，返回该行解析出的 JSON 对象列表。

        Args:
            line: 单行文本（可含尾部换行符，自动去除）。

        Returns:
            解析出的 JSON 对象列表。多数情况 0 个（空行）或 1 个；
            解析失败返回空列表并记 warning 到 ``_failures``。
        """
        if isinstance(line, bytes):  # defensive
            line = line.decode("utf-8", errors="replace")
        cleaned = line.rstrip("\r\n").strip()
        if not cleaned:
            return []
        try:
            obj = json.loads(cleaned)
        except json.JSONDecodeError as e:
            self._failures.append((cleaned, str(e)))
            logger.warning(
                "ndjson.parse_failed line_len=%d error=%s",
                len(cleaned),
                str(e),
            )
            return []
        # 规范化为 dict（NDJSON 通常每行一个对象；若解析出 list / scalar，
        # 仍然保留但包裹为 {"_value": obj} 以符合 list[dict] 返回类型）
        if isinstance(obj, dict):
            self._parsed.append(obj)
            return [obj]
        if isinstance(obj, list):
            # 批量行：每行可能是 JSON 数组——展开为多个 dict（仅取 dict 元素）
            results: list[dict[str, Any]] = []
            for item in obj:
                if isinstance(item, dict):
                    self._parsed.append(item)
                    results.append(item)
                else:
                    wrapped = {"_value": item}
                    self._parsed.append(wrapped)
                    results.append(wrapped)
            return results
        # scalar（str/int/float/bool/null）——包裹为 dict 保留
        wrapped_scalar = {"_value": obj}
        self._parsed.append(wrapped_scalar)
        return [wrapped_scalar]

    def feed_chunk(self, chunk: str) -> list[dict[str, Any]]:
        """喂入可能含多行的 chunk。

        按 ``\\n`` split 后逐行 feed，最后一行若不完整（chunk 不以 ``\\n`` 结尾）
        则缓存到 ``_buffer``，等下次 feed_chunk 拼接。

        Args:
            chunk: 可能含多行的文本块。

        Returns:
            本 chunk 解析出的所有 JSON 对象列表。
        """
        if isinstance(chunk, bytes):  # defensive
            chunk = chunk.decode("utf-8", errors="replace")
        # 拼接上次遗留的 buffer
        data = self._buffer + chunk
        if not data:
            return []
        # 按换行符切分；保留末尾不完整行
        if "\n" not in data:
            # 整个 chunk 没有换行——缓存起来
            self._buffer = data
            return []
        lines = data.split("\n")
        # 最后一个元素是不完整行（如果 chunk 不以 \n 结尾）或空串（如果以 \n 结尾）
        self._buffer = lines.pop()
        results: list[dict[str, Any]] = []
        for line in lines:
            results.extend(self.feed(line))
        return results

    def flush_buffer(self) -> list[dict[str, Any]]:
        """刷新缓冲区中剩余的不完整行。

        流结束时调用，尝试解析 buffer 中剩余内容（可能是一行没有换行符结尾的完整 JSON）。

        Returns:
            解析出的 JSON 对象列表。
        """
        if not self._buffer:
            return []
        remaining = self._buffer
        self._buffer = ""
        return self.feed(remaining)

    def get_parsed_count(self) -> int:
        """返回已解析成功的 JSON 对象数。"""
        return len(self._parsed)

    def get_parsed_objects(self) -> list[dict[str, Any]]:
        """返回已解析成功的 JSON 对象列表（副本）。

        Returns:
            JSON 对象列表（修改不影响内部状态）。
        """
        return list(self._parsed)

    def get_parse_failures(self) -> list[tuple[str, str]]:
        """返回解析失败列表。

        Returns:
            (line, error) 元组列表（副本）。
        """
        return list(self._failures)


# ---------------------------------------------------------------------------
# CLIResult
# ---------------------------------------------------------------------------


class CLIResult(BaseModel):
    """CLI 调用结果封装（CL-038）。

    封装子进程 stdout / stderr / returncode 及解析后的 NDJSON 对象，
    供 Adapter 转换为 ``ExternalAgentResult``。

    "stderr 也算活着"教训：
        ``success`` 仅看 ``returncode==0``，**不看 stderr 是否非空**。
        stderr 内容通过 ``stderr_summary`` 透传，由上层决定如何处理。

    Attributes:
        stdout: 原始 stdout 文本。
        stderr_summary: stderr 收集摘要（来自 StderrCollector.summary()）。
        ndjson_objects: 从 stdout 解析出的 NDJSON 对象列表（若 stdout 非
            NDJSON 格式则为空列表）。
        returncode: 子进程退出码。
        success: 是否成功（仅 returncode==0）。
        error: 失败时的错误信息（returncode!=0 时填充）。
    """

    stdout: str = Field(default="", description="原始 stdout 文本")
    stderr_summary: dict[str, Any] = Field(
        default_factory=dict, description="stderr 收集摘要"
    )
    ndjson_objects: list[dict[str, Any]] = Field(
        default_factory=list, description="解析出的 NDJSON 对象列表"
    )
    returncode: int = Field(default=0, description="子进程退出码")
    success: bool = Field(default=False, description="是否成功（仅看 returncode==0）")
    error: Optional[str] = Field(default=None, description="错误信息")


# ---------------------------------------------------------------------------
# 顶层函数
# ---------------------------------------------------------------------------


def parse_cli_invocation(
    stdout: str,
    stderr: str,
    returncode: int,
) -> CLIResult:
    """同步调用后的解析入口（CL-038）。

    用 NDJSONParser 解析 stdout（如果 stdout 是 NDJSON 格式则解析出对象，
    否则 ``ndjson_objects`` 为空列表，``stdout`` 字段仍保留原始文本）。
    用 StderrCollector 收集 stderr。

    "stderr 也算活着"教训：
        ``success`` 仅看 ``returncode==0``，**不看 stderr 是否非空**。

    Args:
        stdout: 子进程原始 stdout 文本。
        stderr: 子进程原始 stderr 文本。
        returncode: 子进程退出码。

    Returns:
        CLIResult 解析结果。
    """
    parser = NDJSONParser()
    # stdout 按 chunk 喂入（整个 stdout 作为一个 chunk）
    if stdout:
        parser.feed_chunk(stdout)
        parser.flush_buffer()

    stderr_collector = StderrCollector()
    if stderr:
        for line in stderr.split("\n"):
            stderr_collector.feed(line)

    success = returncode == 0
    error: Optional[str] = None
    if not success:
        error = f"CLI exited with returncode={returncode}"

    ndjson_objects = parser.get_parsed_objects()
    result = CLIResult(
        stdout=stdout,
        stderr_summary=stderr_collector.summary(),
        ndjson_objects=ndjson_objects,
        success=success,
        returncode=returncode,
        error=error,
    )
    logger.debug(
        "parse_cli_invocation returncode=%d success=%s "
        "ndjson_count=%d stderr_total=%d parse_failures=%d",
        returncode,
        success,
        parser.get_parsed_count(),
        stderr_collector.summary()["total"],
        len(parser.get_parse_failures()),
    )
    return result


async def stream_cli_invocation(
    process: asyncio.subprocess.Process,
) -> AsyncIterator[dict[str, Any]]:
    """异步流式解析生成器（CL-038）。

    从 ``process.stdout`` 流式读取每行，feed 到 NDJSONParser，yield 出
    每个解析出的 dict；同时从 ``process.stderr`` 流式读取，feed 到
    StderrCollector（不 yield stderr，仅收集）。

    流结束后 yield 一个 ``_final`` 标记帧，包含 stderr_summary 和 returncode::

        {
            "_type": "_final",
            "stderr_summary": {...},
            "returncode": int,
            "parsed_count": int,
            "parse_failures": [(line, error), ...],
        }

    设计参考：FlowForge CLI NDJSON 解析器规范

    Args:
        process: ``asyncio.subprocess.Process`` 实例（已启动的子进程）。

    Yields:
        NDJSON 对象字典，最后一个是 ``_final`` 标记帧。
    """
    parser = NDJSONParser()
    stderr_collector = StderrCollector()

    async def _drain_stderr() -> None:
        """后台收集 stderr（不阻塞 stdout 流式 yield）。"""
        if process.stderr is None:
            return
        async for raw_line in process.stderr:
            if isinstance(raw_line, bytes):
                line = raw_line.decode("utf-8", errors="replace")
            else:
                line = raw_line
            stderr_collector.feed(line)

    stderr_task = asyncio.create_task(_drain_stderr())

    try:
        if process.stdout is not None:
            async for raw_line in process.stdout:
                if isinstance(raw_line, bytes):
                    line = raw_line.decode("utf-8", errors="replace")
                else:
                    line = raw_line
                # 流式喂入单行（每行一个 NDJSON 对象）
                for obj in parser.feed(line):
                    yield obj
        # stdout 流结束——刷新 buffer 中可能残留的最后一行
        for obj in parser.flush_buffer():
            yield obj
    finally:
        # 确保 stderr 后台任务被等待（即使 stdout 异常退出）
        if not stderr_task.done():
            stderr_task.cancel()
            try:
                await stderr_task
            except asyncio.CancelledError:
                pass
        else:
            # 已完成——取出可能的异常（避免静默吞掉 stderr 读取错误）
            stderr_task.result()

    returncode = await process.wait()
    yield {
        "_type": "_final",
        "stderr_summary": stderr_collector.summary(),
        "returncode": returncode,
        "parsed_count": parser.get_parsed_count(),
        "parse_failures": parser.get_parse_failures(),
    }


# 别名：CLINDJSONParser（部分调用方使用此名称）
CLINDJSONParser = NDJSONParser

"""HTTP Cassette — 录制真实 LLM 响应用于回归测试

录制模式：首次运行时调用真实 LLM，将请求/响应保存到 Cassette 文件。
回放模式：后续运行时直接读取 Cassette 文件，无需再次调用 LLM。

使用方式：
    cassette = HTTPCassette(cassette_dir="tests/cassettes")

    # 录制模式
    if cassette.has_recording(request, "test_name"):
        response = cassette.playback(request, "test_name")
    else:
        response = await real_llm_call(request)
        cassette.record(request, response, "test_name")

    # 自动模式（推荐）
    response = await cassette.record_or_playback(request, real_call_fn, "test_name")
"""
import json
import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional


class HTTPCassette:
    """录制和回放 HTTP 请求/响应

    Cassette 文件以 JSON 格式存储在 cassette_dir 目录下，
    文件名由测试名和请求哈希组成，确保同一请求的录制唯一。
    """

    def __init__(
        self,
        cassette_dir: str | Path = "tests/cassettes",
        record_mode: str = "once",
    ):
        """
        Args:
            cassette_dir: Cassette 文件存储目录
            record_mode: 录制模式
                - "once": 首次录制，后续回放（默认）
                - "always": 始终重新录制
                - "none": 仅回放，无录制时抛异常
        """
        self.cassette_dir = Path(cassette_dir)
        self.record_mode = record_mode
        self.cassette_dir.mkdir(parents=True, exist_ok=True)

    def _make_key(self, request: dict) -> str:
        """生成请求的唯一 key（MD5 前12位）"""
        content = json.dumps(request, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(content.encode()).hexdigest()[:12]

    def _cassette_path(self, request: dict, test_name: str) -> Path:
        """获取 Cassette 文件路径"""
        key = self._make_key(request)
        safe_name = test_name.replace("/", "_").replace("\\", "_")
        return self.cassette_dir / f"{safe_name}_{key}.json"

    def record(self, request: dict, response: dict, test_name: str = "") -> None:
        """录制请求/响应到 Cassette 文件

        Args:
            request: 请求内容（将序列化为 JSON）
            response: 响应内容（将序列化为 JSON）
            test_name: 测试名称，用于文件命名
        """
        cassette_file = self._cassette_path(request, test_name)
        data = {
            "recorded_at": datetime.now().isoformat(),
            "test_name": test_name,
            "request": request,
            "response": response,
        }
        with open(cassette_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def playback(self, request: dict, test_name: str = "") -> Optional[dict]:
        """回放已录制的响应

        Args:
            request: 请求内容（用于匹配录制）
            test_name: 测试名称

        Returns:
            录制的响应 dict，若无录制则返回 None
        """
        cassette_file = self._cassette_path(request, test_name)
        if cassette_file.exists():
            with open(cassette_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data["response"]
        return None

    def has_recording(self, request: dict, test_name: str = "") -> bool:
        """检查是否有录制"""
        return self._cassette_path(request, test_name).exists()

    async def record_or_playback(
        self,
        request: dict,
        real_call_fn: Callable,
        test_name: str = "",
    ) -> dict:
        """自动录制或回放

        根据 record_mode 决定行为：
        - "once": 有录制则回放，无则调用 real_call_fn 并录制
        - "always": 始终调用 real_call_fn 并录制
        - "none": 仅回放，无录制时抛出 RuntimeError

        Args:
            request: 请求内容
            real_call_fn: 真实调用函数（async）
            test_name: 测试名称

        Returns:
            响应 dict
        """
        if self.record_mode == "none":
            response = self.playback(request, test_name)
            if response is None:
                raise RuntimeError(
                    f"Cassette not found for test '{test_name}' and "
                    f"record_mode is 'none'. Run with record_mode='once' first."
                )
            return response

        if self.record_mode == "always":
            response = await real_call_fn(request)
            self.record(request, response, test_name)
            return response

        # record_mode == "once"
        existing = self.playback(request, test_name)
        if existing is not None:
            return existing

        response = await real_call_fn(request)
        self.record(request, response, test_name)
        return response

    def list_recordings(self) -> list[dict]:
        """列出所有录制文件的信息"""
        recordings = []
        for f in self.cassette_dir.glob("*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                recordings.append({
                    "file": f.name,
                    "test_name": data.get("test_name", ""),
                    "recorded_at": data.get("recorded_at", ""),
                })
            except (json.JSONDecodeError, OSError):
                recordings.append({
                    "file": f.name,
                    "test_name": "",
                    "recorded_at": "",
                    "error": "corrupted",
                })
        return recordings

    def clear_recordings(self, test_name: Optional[str] = None) -> int:
        """清除录制文件

        Args:
            test_name: 若指定，只清除该测试名的录制；否则清除全部

        Returns:
            删除的文件数
        """
        count = 0
        for f in self.cassette_dir.glob("*.json"):
            if test_name is None or test_name in f.name:
                f.unlink()
                count += 1
        return count

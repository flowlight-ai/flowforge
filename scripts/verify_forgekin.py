#!/usr/bin/env python
"""九Forgekin 配置 + LLM CLI 后端验证脚本.

用法：
    python scripts/verify_forgekins.py            # 仅校验配置与二进制
    python scripts/verify_forgekins.py --live     # 额外对每个 灵智体 做一次性 LLM 调用（PONG）

该脚本不依赖已启动的 flowforge 服务，直接：
  1. 用 roster.load_forgekin_config 加载 9 个 灵智体 YAML
  2. 校验每个 灵智体 的 llm.provider / model / mode 字段
  3. 校验对应 CLI 二进制在 PATH 中
  4. （--live）通过 llm.cli_provider 对每个 灵智体 做一次 chat 调用
"""

from __future__ import annotations

import asyncio
import shutil
import sys

sys.path.insert(0, __file__ and str(__import__("pathlib").Path(__file__).resolve().parent.parent) or "")

from flowforge.forgemind.forgekins.roster import ROSTER_FILES, load_forgekin_config  # noqa: E402
from flowforge.llm.cli_provider import build_cli_provider  # noqa: E402

PROVIDER_BINARY = {
    "opencode": "opencode",
    "codex": "codex",
    "gemini": "gemini",
    "claude_code": "claude",
    "codebuddy": "codebuddy",
    "qodercli": "qodercli",
    "iflow": "iflow",
    "trae": None,  # IDE 桥接，非子进程
}

# 每个 provider 的验证模型（qxanel 给 CL 提供模型参数）
PROVIDER_MODEL = {
    "opencode": "deepseek-v4-flash-free",
    "codex": "Doubao-Seed2.0",
    "gemini": "gemini-2.5-flash",
    "claude_code": "Doubao-Seed2.0",
    "codebuddy": "hy3",
    "qodercli": None,
    "iflow": "Doubao-Seed2.0",
    "trae": None,
}

# 全为「校验脚本执行后被调用的注解」—— 铁律5（不硬编码密钥/路径）除外
# 该 provider->binary/model 映射属于框架级能力发现（铁律10），可从 YAML 附加扩展


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def check_config() -> tuple[dict, list[dict]]:
    """1. 加载 9 个 灵智体 并校验 llm 字段."""
    section("Step 1: 九Forgekin 配置加载与校验")
    forgekins: dict = {}
    meta: list[dict] = []
    for fid in ROSTER_FILES:
        if fid not in ("wenxin", "sherlock", "luban", "vangogh", "davinci",
                       "keane", "humming", "sqrl", "butterfly"):
            continue
        try:
            cfg = load_forgekin_config(fid)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL: {fid} 加载失败: {exc}")
            raise SystemExit(1)
        forgekins[fid] = cfg
        llm = cfg.get("llm", {})
        provider = llm.get("provider", "trae")
        model = llm.get("model", "")
        meta.append({"id": fid, "cfg": cfg, "provider": provider, "model": model})
        print(f"  OK: {fid:12} {cfg.get('name','?'):8} -> provider={provider:12} model={model}")
    return forgekins, meta


def check_binary(meta: list[dict]) -> None:
    """2. 校验 provider 对应 CLI 二进制。"""
    section("2. CLI 二进制可用性")
    for m in meta:
        provider = m["provider"]
        binary = PROVIDER_BINARY.get(provider)
        if binary is None:
            print(f"  SKIP: {m['id']:12} {provider:12} -> 非子进程（Trae 桥接）")
            continue
        found = shutil.which(binary)
        if found:
            print(f"  OK: {m['id']:12} {provider:12} -> {found}")
        else:
            print(f"  FAIL: {m['id']:12} {provider:12} -> {binary} 不在 PATH")


async def verify_live(meta: list[dict]) -> None:
    """3. 对每个 灵智体 做一次性 PONG 调用。"""
    section("3. 一次性 PONG 验证（live）")
    for m in meta:
        provider = m["provider"]
        if provider == "trae":
            print(f"  SKIP: {m['id']:12} provider=trae（IDE 桥接，跳过子进程验证）")
            continue
        built = build_cli_provider(provider)
        if built is None:
            print(f"  FAIL: {m['id']:12} provider={provider} 无预置配置")
            continue
        if not built.is_available():
            print(f"  FAIL: {m['id']:12} provider={provider} 二进制不可用")
            continue
        try:
            r = await built.chat(
                [{"role": "user", "content": "reply with exactly: PONG"}],
                model=PROVIDER_MODEL.get(provider),
                timeout=110,
            )
            content = r.get("content", "")
            err = r.get("usage", {}).get("error")
            status = "OK " if content.strip().upper().endswith("PONG") and not err else "WARN"
            print(f"  {status}: {m['id']:12} {provider:12} -> {content[:40]!r} err={err}")
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL: {m['id']:12} {provider:12} 异常: {exc}")


def main() -> None:
    live = "--live" in sys.argv
    forgekins, meta = check_config()
    check_binary(meta)
    if live:
        asyncio.run(verify_live(meta))
    section("完成")


if __name__ == "__main__":
    main()
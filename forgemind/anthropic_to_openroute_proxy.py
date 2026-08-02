"""Anthropic Messages → OpenRoute (OpenAI Chat Completions) 协议转换代理.

背景
----
Claude Code CLI 原生只讲 Anthropic Messages 协议 (``/v1/messages``)，
而本地 OpenRoute 网关 (``http://localhost:13001/v1``) 只讲 OpenAI Chat Completions。
ccr 3.0.7 配置复杂且 SQLite 存储，本代理提供一个轻量替代方案，直接给 claude CLI 用。

启动
----
    python -m flowforge.forgemind.anthropic_to_openroute_proxy
    # 或直接运行
    python anthropic_to_openroute_proxy.py

Claude CLI 配置 (~/.claude/settings.json):
    {
      "env": {
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:8083",
        "ANTHROPIC_AUTH_TOKEN": "openroute-proxy"
      }
    }

端口选择: 8083 — 与 gemini-proxy (8082) 错开。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
import uvicorn

# ── 配置 ────────────────────────────────────────────────────────────────────

OPENROUTE_BASE_URL = os.environ.get("OPENROUTE_BASE_URL", "http://localhost:13001/v1")
OPENROUTE_API_KEY = os.environ.get(
    "OPENROUTE_API_KEY",
    "",  # 铁律5: 禁止硬编码密钥 — 必须通过 OPENROUTE_API_KEY 环境变量注入
)
DEFAULT_PORT = int(os.environ.get("ANTHROPIC_PROXY_PORT", "8083"))
DEFAULT_HOST = os.environ.get("ANTHROPIC_PROXY_HOST", "127.0.0.1")
# 默认模型切换为 Doubao-Seed2.0 —— OpenRoute 2026-07-25 实测：
#   - Doubao-Seed2.0:  14.6s 返回 PONG ✓ (稳定)
#   - Qwen3.6-Plus:    33.9s 返回 PONG ✓ (慢但可用)
#   - DeepSeek-V4-Pro: 返回 "无法回答"（被识别为拒绝）
#   - MiniMax-M3:      返回 HTML 主页内容（不可用）
#   - Kimi-K2.6:       返回 "无法回答"
#   - GLM-5.1:         返回部分英文片段
#   - HunYuan3:        返回 "点击全选以下消息"
DEFAULT_MODEL = os.environ.get("ANTHROPIC_PROXY_MODEL", "Doubao-Seed2.0")

# Claude 模型名 → OpenRoute 模型名映射
# Claude CLI 默认用 claude-sonnet-4 / claude-haiku 等，映射到 openroute 的国产模型。
# Claude CLI 2.1+ 在模型名后追加 `[1m]` / `[5m]` 等推理预算后缀，代理需剥离后缀再查表。
CLAUDE_TO_OPENROUTE_MODEL = {
    # Sonnet 系列 → Doubao-Seed2.0（当前最稳定的国产模型）
    "claude-sonnet-4-6": DEFAULT_MODEL,
    "claude-sonnet-4-5": DEFAULT_MODEL,
    "claude-sonnet-4": DEFAULT_MODEL,
    "claude-3-7-sonnet": DEFAULT_MODEL,
    "claude-3-5-sonnet": DEFAULT_MODEL,
    # Opus 系列 → Qwen3.6-Plus（推理能力较强，作为 Opus 替代）
    "claude-opus-4-7": "Qwen3.6-Plus",
    "claude-opus-4-5": "Qwen3.6-Plus",
    "claude-opus-4": "Qwen3.6-Plus",
    # Haiku 系列 → Doubao-Seed2.0（响应快）
    "claude-haiku-4-5": DEFAULT_MODEL,
    "claude-3-5-haiku": DEFAULT_MODEL,
}


def _strip_model_suffix(model: str) -> str:
    """剥离 Claude CLI 模型名后缀（如 ``claude-opus-4-7[1m]`` → ``claude-opus-4-7``）.

    Claude CLI 2.1+ 在模型名后追加 ``[1m]`` / ``[5m]`` / ``[1h]`` 等推理预算后缀，
    用于控制 extended thinking 时长。OpenRoute 不识别这些后缀，需要在映射前剥离。
    """
    if "[" in model:
        return model.split("[", 1)[0]
    return model

# ── 日志 ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] anthropic_proxy: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("anthropic_proxy")

app = FastAPI(title="Anthropic→OpenRoute Proxy", version="1.0.0")


# ── 协议转换: Anthropic → OpenAI ────────────────────────────────────────────

def anthropic_to_openai(body: dict[str, Any]) -> dict[str, Any]:
    """把 Anthropic /v1/messages 请求转成 OpenAI /v1/chat/completions 请求.

    Anthropic 请求体示例:
        {
          "model": "claude-sonnet-4",
          "max_tokens": 1024,
          "system": "You are helpful.",
          "messages": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": [{"type": "text", "text": "How are you?"}]}
          ],
          "temperature": 0.7,
          "stream": false
        }

    OpenAI 请求体示例:
        {
          "model": "Qwen3.6-Plus",
          "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "How are you?"}
          ],
          "max_tokens": 1024,
          "temperature": 0.7
        }
    """
    messages: list[dict[str, str]] = []

    # system (可以是字符串或数组)
    system = body.get("system")
    if system:
        if isinstance(system, str):
            messages.append({"role": "system", "content": system})
        elif isinstance(system, list):
            # system 作为数组 (Claude 支持)
            parts = []
            for item in system:
                if isinstance(item, dict):
                    if "text" in item:
                        parts.append(item["text"])
                    elif "content" in item:
                        parts.append(str(item["content"]))
            if parts:
                messages.append({"role": "system", "content": "\n".join(parts)})

    # messages
    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content")

        # content 可以是字符串或数组
        if isinstance(content, str):
            messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            # 数组形式: [{"type": "text", "text": "..."}, ...]
            text_parts = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                t = item.get("type", "text")
                if t == "text":
                    text_parts.append(item.get("text", ""))
                elif t == "tool_result":
                    # tool_result → 转成文本
                    inner = item.get("content", "")
                    if isinstance(inner, list):
                        for ip in inner:
                            if isinstance(ip, dict) and ip.get("type") == "text":
                                text_parts.append(ip.get("text", ""))
                    else:
                        text_parts.append(str(inner))
                elif t == "tool_use":
                    # tool_use → 转成 JSON 表示
                    text_parts.append(json.dumps({
                        "tool_use": item.get("name", ""),
                        "input": item.get("input", {}),
                    }, ensure_ascii=False))
            messages.append({"role": role, "content": "\n".join(text_parts) if text_parts else ""})

    # 模型映射 (剥离 [1m]/[5m] 等推理预算后缀后再查表)
    model = body.get("model", "claude-sonnet-4")
    base_model = _strip_model_suffix(model)
    openai_model = CLAUDE_TO_OPENROUTE_MODEL.get(base_model, DEFAULT_MODEL)

    openai_body: dict[str, Any] = {
        "model": openai_model,
        "messages": messages,
        "stream": body.get("stream", False),
    }

    # 参数映射
    if "max_tokens" in body:
        openai_body["max_tokens"] = body["max_tokens"]
    if "temperature" in body:
        openai_body["temperature"] = body["temperature"]
    if "top_p" in body:
        openai_body["top_p"] = body["top_p"]
    if "stop_sequences" in body:
        openai_body["stop"] = body["stop_sequences"]

    # tools → OpenAI tools 格式
    tools = body.get("tools", [])
    if tools:
        oa_tools = []
        for tool in tools:
            oa_tools.append({
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
                },
            })
        if oa_tools:
            openai_body["tools"] = oa_tools

    return openai_body


def openai_to_anthropic(oa_resp: dict[str, Any], model: str) -> dict[str, Any]:
    """把 OpenAI chat/completions 响应转回 Anthropic /v1/messages 响应.

    Anthropic 响应格式:
        {
          "id": "msg_xxx",
          "type": "message",
          "role": "assistant",
          "model": "claude-sonnet-4",
          "content": [{"type": "text", "text": "Hello!"}],
          "stop_reason": "end_turn",
          "usage": {"input_tokens": 10, "output_tokens": 5}
        }
    """
    content_blocks = []
    for choice in oa_resp.get("choices", []):
        msg = choice.get("message", {})
        text = msg.get("content", "")
        if text:
            content_blocks.append({"type": "text", "text": text})
        # tool_calls → tool_use blocks
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            content_blocks.append({
                "type": "tool_use",
                "id": tc.get("id", "tool_0"),
                "name": fn.get("name", ""),
                "input": args,
            })

    if not content_blocks:
        content_blocks.append({"type": "text", "text": ""})

    # stop_reason 映射
    finish_reason = oa_resp.get("choices", [{}])[0].get("finish_reason", "stop")
    stop_reason = {
        "stop": "end_turn",
        "length": "max_tokens",
        "tool_calls": "tool_use",
        "content_filter": "end_turn",
    }.get(finish_reason, "end_turn")

    usage = oa_resp.get("usage", {})
    return {
        "id": f"msg_{oa_resp.get('id', 'unknown')}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


# ── 流式转换: OpenAI 非流式响应 → Anthropic SSE ────────────────────────────

async def stream_openai_to_anthropic(oa_resp: httpx.Response, model: str, msg_id: str) -> Any:
    """把 OpenAI 非流式响应合成为 Anthropic SSE 流.

    OpenRoute 的 stream 实现有 bug（返回非 SSE JSON），所以我们总是以
    stream=False 调用 OpenRoute，然后在这里把完整响应切分成 SSE 事件
    返回给 claude CLI。

    Anthropic 流式事件:
    1. message_start: 开始消息
    2. content_block_start: 开始一个 content block
    3. content_block_delta: content block 增量（按 chunk 切分完整文本）
    4. content_block_stop: 结束 content block
    5. message_delta: 消息级增量 (stop_reason 等)
    6. message_stop: 结束消息
    """
    # 解析 OpenRoute 非流式响应
    try:
        oa_data = oa_resp.json()
    except Exception as exc:
        log.error(f"failed to parse OpenRoute response as JSON: {exc}")
        yield (
            f"event: error\n"
            f"data: {json.dumps({'type': 'error', 'error': {'type': 'api_error', 'message': f'proxy parse error: {exc}'}})}\n\n"
        )
        return

    # 提取完整文本
    full_text = ""
    finish_reason = "stop"
    tool_calls_blocks = []
    for choice in oa_data.get("choices", []):
        msg = choice.get("message", {})
        text = msg.get("content", "") or ""
        if text:
            full_text += text
        if choice.get("finish_reason"):
            finish_reason = choice["finish_reason"]
        # tool_calls → 后续作为单独 content block 发送
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            tool_calls_blocks.append({
                "id": tc.get("id", "tool_0"),
                "name": fn.get("name", ""),
                "input": args,
            })

    usage = oa_data.get("usage", {})

    # 发送 message_start
    yield (
        f"event: message_start\n"
        f"data: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'model': model, 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': usage.get('prompt_tokens', 0), 'output_tokens': 0}}})}\n\n"
    )

    # 文本 content block (index=0)
    yield (
        f"event: content_block_start\n"
        f"data: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
    )

    # 按固定 chunk 大小切分文本，模拟流式增量
    CHUNK_SIZE = 64
    for i in range(0, len(full_text), CHUNK_SIZE):
        chunk_text = full_text[i:i + CHUNK_SIZE]
        yield (
            f"event: content_block_delta\n"
            f"data: {json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': chunk_text}})}\n\n"
        )

    yield (
        f"event: content_block_stop\n"
        f"data: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
    )

    # tool_use content blocks (index=1, 2, ...)
    for idx, tc in enumerate(tool_calls_blocks, start=1):
        yield (
            f"event: content_block_start\n"
            f"data: {json.dumps({'type': 'content_block_start', 'index': idx, 'content_block': {'type': 'tool_use', 'id': tc['id'], 'name': tc['name'], 'input': {}}})}\n\n"
        )
        yield (
            f"event: content_block_delta\n"
            f"data: {json.dumps({'type': 'content_block_delta', 'index': idx, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(tc['input'], ensure_ascii=False)}})}\n\n"
        )
        yield (
            f"event: content_block_stop\n"
            f"data: {json.dumps({'type': 'content_block_stop', 'index': idx})}\n\n"
        )

    # 发送 message_delta (stop_reason)
    stop_reason = {
        "stop": "end_turn",
        "length": "max_tokens",
        "tool_calls": "tool_use",
    }.get(finish_reason, "end_turn")
    yield (
        f"event: message_delta\n"
        f"data: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': stop_reason, 'stop_sequence': None}, 'usage': {'output_tokens': len(full_text)}})}\n\n"
    )

    # 发送 message_stop
    yield "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"


# ── HTTP 客户端 ─────────────────────────────────────────────────────────────

async def call_openroute(openai_body: dict[str, Any], stream: bool = False) -> httpx.Response:
    """Call OpenRoute. We ALWAYS use non-stream mode because OpenRoute's stream
    implementation has a bug — it returns non-SSE JSON (object=chat.completion
    with message instead of delta) even when stream=true is requested.

    The caller (messages endpoint) handles stream=true by synthesizing SSE
    events from the non-stream response, so claude CLI's stream expectation
    is still satisfied.
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTE_API_KEY}",
        "Content-Type": "application/json",
    }
    # Force stream=False to OpenRoute regardless of what the caller requested.
    # We synthesize SSE ourselves in stream_openai_to_anthropic().
    openai_body = {**openai_body, "stream": False}
    async with httpx.AsyncClient(timeout=120.0) as client:
        return await client.post(
            f"{OPENROUTE_BASE_URL}/chat/completions",
            json=openai_body,
            headers=headers,
        )


# ── 路由 ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root() -> dict:
    return {"service": "anthropic-to-openroute-proxy", "status": "ok"}


@app.get("/health")
async def health() -> dict:
    return {"status": "healthy", "openroute_base": OPENROUTE_BASE_URL, "default_model": DEFAULT_MODEL}


@app.api_route("/v1/messages", methods=["POST"])
async def messages(request: Request) -> Any:
    """Anthropic /v1/messages 端点."""
    body = await request.json()
    model = body.get("model", "claude-sonnet-4")
    stream = body.get("stream", False)
    log.info(f"messages: model={model} stream={stream}")

    try:
        openai_body = anthropic_to_openai(body)
        t0 = time.perf_counter()
        oa_resp = await call_openroute(openai_body, stream=stream)
        elapsed = (time.perf_counter() - t0) * 1000
        log.info(f"openroute responded: {oa_resp.status_code} ({elapsed:.0f}ms)")

        if oa_resp.status_code != 200:
            err_text = oa_resp.text[:500]
            return JSONResponse(
                status_code=oa_resp.status_code,
                content={"type": "error", "error": {"type": "api_error", "message": err_text}},
            )

        if stream:
            msg_id = f"msg_{int(time.time()*1000)}"
            return StreamingResponse(
                stream_openai_to_anthropic(oa_resp, model, msg_id),
                media_type="text/event-stream",
            )

        oa_data = oa_resp.json()
        anthropic_resp = openai_to_anthropic(oa_data, model)
        return JSONResponse(content=anthropic_resp)
    except Exception as exc:
        log.exception("messages failed")
        return JSONResponse(
            status_code=500,
            content={"type": "error", "error": {"type": "api_error", "message": str(exc)}},
        )


@app.get("/v1/models")
async def list_models() -> dict:
    """列出可用模型 (Anthropic 格式)."""
    models = []
    for claude_name, openroute_name in CLAUDE_TO_OPENROUTE_MODEL.items():
        models.append({
            "id": claude_name,
            "display_name": claude_name,
            "type": "model",
            "proxied_to": openroute_name,
        })
    return {"data": models}


# ── 入口 ────────────────────────────────────────────────────────────────────

def main() -> None:
    global OPENROUTE_BASE_URL, OPENROUTE_API_KEY, DEFAULT_MODEL
    parser = argparse.ArgumentParser(description="Anthropic→OpenRoute protocol proxy")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--openroute-base", default=OPENROUTE_BASE_URL,
                        help="OpenRoute base URL")
    parser.add_argument("--openroute-key", default=OPENROUTE_API_KEY,
                        help="OpenRoute API key")
    parser.add_argument("--default-model", default=DEFAULT_MODEL,
                        help="Default OpenRoute model")
    args = parser.parse_args()

    OPENROUTE_BASE_URL = args.openroute_base.rstrip("/")
    OPENROUTE_API_KEY = args.openroute_key
    DEFAULT_MODEL = args.default_model

    log.info(f"Starting Anthropic→OpenRoute proxy on {args.host}:{args.port}")
    log.info(f"OpenRoute backend: {OPENROUTE_BASE_URL}")
    log.info(f"Default model: {DEFAULT_MODEL}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

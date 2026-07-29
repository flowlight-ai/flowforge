"""OpenAI Responses API → OpenRoute (Chat Completions) 协议转换代理.

背景
----
OpenAI Codex CLI 强制使用 Responses API (``/v1/responses``)，不再支持 chat completions。
而本地 OpenRoute 网关只讲 OpenAI Chat Completions 协议。
本代理监听 ``127.0.0.1:8084``，把 Responses API 请求翻译成 Chat Completions 转发给 OpenRoute。

启动
----
    python -m flowforge.forgemind.responses_to_openroute_proxy

Codex CLI 配置 (~/.codex/config.toml):
    model = "Qwen3.6-Plus"
    model_provider = "openroute_responses"
    [model_providers.openroute_responses]
    base_url = "http://127.0.0.1:8084/v1"
    env_key = "OPENROUTE_API_KEY"
    wire_api = "responses"
"""

from __future__ import annotations

import argparse
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
DEFAULT_PORT = int(os.environ.get("RESPONSES_PROXY_PORT", "8084"))
DEFAULT_HOST = os.environ.get("RESPONSES_PROXY_HOST", "127.0.0.1")
# 默认模型 Doubao-Seed2.0 —— OpenRoute 2026-07-25 实测：
#   - Doubao-Seed2.0:  14.6s 返回 PONG ✓ (稳定)
#   - Qwen3.6-Plus:    33.9s 返回 PONG ✓ (慢但可用)
#   - DeepSeek-V4-Pro: 返回 "无法回答"
DEFAULT_MODEL = os.environ.get("RESPONSES_PROXY_MODEL", "Doubao-Seed2.0")

# ── 日志 ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] responses_proxy: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("responses_proxy")

app = FastAPI(title="Responses→OpenRoute Proxy", version="1.0.0")


# ── 协议转换: Responses → Chat Completions ──────────────────────────────────

def responses_to_chat(body: dict[str, Any]) -> dict[str, Any]:
    """把 OpenAI Responses API 请求转成 Chat Completions 请求.

    Responses API 请求体示例:
        {
          "model": "gpt-5",
          "input": "What is 2+2?" or [{"role": "user", "content": "..."}],
          "instructions": "You are helpful.",
          "max_output_tokens": 1024,
          "temperature": 0.7,
          "stream": false
        }

    Chat Completions 请求体示例:
        {
          "model": "Qwen3.6-Plus",
          "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "What is 2+2?"}
          ],
          "max_tokens": 1024,
          "temperature": 0.7
        }
    """
    messages: list[dict[str, str]] = []

    # instructions → system message
    instructions = body.get("instructions")
    if instructions:
        messages.append({"role": "system", "content": instructions})

    # input → messages (可以是字符串或数组)
    inp = body.get("input")
    if isinstance(inp, str):
        messages.append({"role": "user", "content": inp})
    elif isinstance(inp, list):
        for item in inp:
            if not isinstance(item, dict):
                continue
            role = item.get("role", "user")
            content = item.get("content", "")
            # content 可以是字符串或数组
            if isinstance(content, str):
                messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                text_parts = []
                for c in content:
                    if isinstance(c, dict):
                        if c.get("type") == "text" or "text" in c:
                            text_parts.append(c.get("text", ""))
                        elif c.get("type") == "output_text":
                            text_parts.append(c.get("text", ""))
                        elif c.get("type") == "reasoning":
                            # skip reasoning content
                            pass
                if text_parts:
                    messages.append({"role": role, "content": "\n".join(text_parts)})
            elif content:
                messages.append({"role": role, "content": str(content)})

    # 模型
    model = body.get("model", DEFAULT_MODEL)

    chat_body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": body.get("stream", False),
    }

    # 参数映射
    if "max_output_tokens" in body:
        chat_body["max_tokens"] = body["max_output_tokens"]
    if "temperature" in body:
        chat_body["temperature"] = body["temperature"]
    if "top_p" in body:
        chat_body["top_p"] = body["top_p"]

    # tools (Responses API 用 tools 数组，格式类似 Chat Completions 的 functions)
    tools = body.get("tools", [])
    if tools:
        oa_tools = []
        for tool in tools:
            if tool.get("type") == "function":
                oa_tools.append(tool)
            else:
                # 转成 function 格式
                oa_tools.append({
                    "type": "function",
                    "function": {
                        "name": tool.get("name", ""),
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
                    },
                })
        if oa_tools:
            chat_body["tools"] = oa_tools

    return chat_body


def chat_to_responses(oa_resp: dict[str, Any], model: str) -> dict[str, Any]:
    """把 Chat Completions 响应转回 Responses API 格式.

    Responses API 响应示例:
        {
          "id": "resp_xxx",
          "object": "response",
          "model": "gpt-5",
          "output": [
            {"type": "message", "id": "msg_xxx", "role": "assistant", "status": "completed",
             "content": [{"type": "output_text", "text": "Hello!", "annotations": []}]}
          ],
          "status": "completed",
          "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        }
    """
    output = []
    for choice in oa_resp.get("choices", []):
        msg = choice.get("message", {})
        text = msg.get("content", "")
        content_blocks = []
        if text:
            content_blocks.append({"type": "output_text", "text": text, "annotations": []})
        # tool_calls
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            output.append({
                "type": "function_call",
                "id": tc.get("id", "call_0"),
                "call_id": tc.get("id", "call_0"),
                "name": fn.get("name", ""),
                "arguments": json.dumps(args, ensure_ascii=False),
            })

        if content_blocks:
            output.append({
                "type": "message",
                "id": f"msg_{choice.get('index', 0)}",
                "role": "assistant",
                "status": "completed",
                "content": content_blocks,
            })

    usage = oa_resp.get("usage", {})
    return {
        "id": f"resp_{oa_resp.get('id', 'unknown')}",
        "object": "response",
        "created_at": int(time.time()),
        "model": model,
        "output": output,
        "status": "completed",
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
    }


# ── 流式转换 ────────────────────────────────────────────────────────────────

async def stream_chat_to_responses(oa_resp: httpx.Response, model: str, resp_id: str) -> Any:
    """从 OpenAI 非流式响应合成为 Responses API SSE 流.

    OpenRoute 的 stream 实现有 bug（返回非 SSE JSON），所以我们总是以
    stream=False 调用 OpenRoute，然后在这里把完整响应切分成 SSE 事件
    返回给 codex CLI。

    Responses API 流式事件:
    1. response.created
    2. response.output_item.added (message)
    3. response.content_part.added (output_text)
    4. response.output_text.delta
    5. response.content_part.done
    6. response.output_item.done
    7. response.completed
    """
    # 先把非流式响应读出来
    try:
        oa_data = oa_resp.json()
    except Exception as exc:
        log.error(f"failed to parse OpenRoute response as JSON: {exc}")
        err = {"type": "response.failed", "response": {"id": resp_id, "status": "failed", "error": {"message": str(exc)}}}
        yield f"event: response.failed\ndata: {json.dumps(err)}\n\n"
        return

    # 提取完整文本和 tool_calls
    full_text = ""
    tool_calls_list = []
    for choice in oa_data.get("choices", []):
        msg = choice.get("message", {})
        text = msg.get("content", "") or ""
        if text:
            full_text += text
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            tool_calls_list.append({
                "id": tc.get("id", "call_0"),
                "call_id": tc.get("id", "call_0"),
                "name": fn.get("name", ""),
                "arguments": json.dumps(args, ensure_ascii=False),
            })
    usage = oa_data.get("usage", {})

    # response.created
    yield (
        f"event: response.created\n"
        f"data: {json.dumps({'type': 'response.created', 'response': {'id': resp_id, 'object': 'response', 'status': 'in_progress', 'model': model, 'output': []}})}\n\n"
    )

    # response.output_item.added (message)
    msg_id = f"msg_{int(time.time()*1000)}"
    yield (
        f"event: response.output_item.added\n"
        f"data: {json.dumps({'type': 'response.output_item.added', 'output_index': 0, 'item': {'type': 'message', 'id': msg_id, 'role': 'assistant', 'status': 'in_progress', 'content': []}})}\n\n"
    )

    # response.content_part.added
    yield (
        f"event: response.content_part.added\n"
        f"data: {json.dumps({'type': 'response.content_part.added', 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': '', 'annotations': []}})}\n\n"
    )

    # 把完整文本按固定 chunk 切分，模拟流式增量
    CHUNK_SIZE = 64
    for i in range(0, len(full_text), CHUNK_SIZE):
        chunk_text = full_text[i:i + CHUNK_SIZE]
        yield (
            f"event: response.output_text.delta\n"
            f"data: {json.dumps({'type': 'response.output_text.delta', 'output_index': 0, 'content_index': 0, 'delta': chunk_text})}\n\n"
        )

    # response.content_part.done
    yield (
        f"event: response.content_part.done\n"
        f"data: {json.dumps({'type': 'response.content_part.done', 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': full_text, 'annotations': []}})}\n\n"
    )

    # response.output_item.done
    yield (
        f"event: response.output_item.done\n"
        f"data: {json.dumps({'type': 'response.output_item.done', 'output_index': 0, 'item': {'type': 'message', 'id': msg_id, 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': full_text, 'annotations': []}]}})}\n\n"
    )

    # response.completed
    yield (
        f"event: response.completed\n"
        f"data: {json.dumps({'type': 'response.completed', 'response': {'id': resp_id, 'object': 'response', 'status': 'completed', 'model': model, 'output': [{'type': 'message', 'id': msg_id, 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': full_text, 'annotations': []}]}], 'usage': {'input_tokens': usage.get('prompt_tokens', 0), 'output_tokens': usage.get('completion_tokens', 0), 'total_tokens': usage.get('total_tokens', 0)}}})}\n\n"
    )


# ── HTTP 客户端 ─────────────────────────────────────────────────────────────

async def call_openroute(chat_body: dict[str, Any], stream: bool = False) -> httpx.Response:
    """转发请求到 OpenRoute. 总是用 stream=False（OpenRoute stream 有 bug）.

    stream=true 的请求由 stream_chat_to_responses 端点从非流式响应合成 SSE。
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTE_API_KEY}",
        "Content-Type": "application/json",
    }
    # 总是用 stream=False，OpenRoute 的 stream 实现有 bug
    chat_body = {**chat_body, "stream": False}
    async with httpx.AsyncClient(timeout=120.0) as client:
        return await client.post(
            f"{OPENROUTE_BASE_URL}/chat/completions",
            json=chat_body,
            headers=headers,
        )


# ── 路由 ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root() -> dict:
    return {"service": "responses-to-openroute-proxy", "status": "ok"}


@app.get("/health")
async def health() -> dict:
    return {"status": "healthy", "openroute_base": OPENROUTE_BASE_URL, "default_model": DEFAULT_MODEL}


@app.api_route("/v1/responses", methods=["POST"])
async def responses(request: Request) -> Any:
    """OpenAI Responses API 端点."""
    body = await request.json()
    model = body.get("model", DEFAULT_MODEL)
    stream = body.get("stream", False)
    log.info(f"responses: model={model} stream={stream}")

    try:
        chat_body = responses_to_chat(body)
        t0 = time.perf_counter()
        oa_resp = await call_openroute(chat_body, stream=stream)
        elapsed = (time.perf_counter() - t0) * 1000
        log.info(f"openroute responded: {oa_resp.status_code} ({elapsed:.0f}ms)")

        if oa_resp.status_code != 200:
            err_text = oa_resp.text[:500]
            return JSONResponse(
                status_code=oa_resp.status_code,
                content={"error": {"message": err_text, "type": "api_error"}},
            )

        if stream:
            resp_id = f"resp_{int(time.time()*1000)}"
            return StreamingResponse(
                stream_chat_to_responses(oa_resp, model, resp_id),
                media_type="text/event-stream",
            )

        oa_data = oa_resp.json()
        responses_resp = chat_to_responses(oa_data, model)
        return JSONResponse(content=responses_resp)
    except Exception as exc:
        log.exception("responses failed")
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(exc), "type": "api_error"}},
        )


@app.get("/v1/models")
async def list_models() -> dict:
    """列出可用模型."""
    return {
        "data": [
            {"id": DEFAULT_MODEL, "object": "model"},
            {"id": "Kimi-K2.6", "object": "model"},
            {"id": "GLM-5.1", "object": "model"},
            {"id": "Doubao-Seed2.0", "object": "model"},
            {"id": "DeepSeek-V4-Pro", "object": "model"},
        ]
    }


# ── 入口 ────────────────────────────────────────────────────────────────────

def main() -> None:
    global OPENROUTE_BASE_URL, OPENROUTE_API_KEY, DEFAULT_MODEL
    parser = argparse.ArgumentParser(description="Responses→OpenRoute protocol proxy")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--openroute-base", default=OPENROUTE_BASE_URL)
    parser.add_argument("--openroute-key", default=OPENROUTE_API_KEY)
    parser.add_argument("--default-model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    OPENROUTE_BASE_URL = args.openroute_base.rstrip("/")
    OPENROUTE_API_KEY = args.openroute_key
    DEFAULT_MODEL = args.default_model

    log.info(f"Starting Responses→OpenRoute proxy on {args.host}:{args.port}")
    log.info(f"OpenRoute backend: {OPENROUTE_BASE_URL}")
    log.info(f"Default model: {DEFAULT_MODEL}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

"""Gemini → OpenRoute 协议转换代理.

背景
----
Google Gemini CLI 使用 Google Gemini API 协议（``/v1beta/models/{model}:generateContent``），
而本地 OpenRoute 网关（``http://localhost:13001/v1``）只讲 OpenAI Chat Completions 协议。
两者不兼容，Gemini CLI 直接指向 OpenRoute 会 404 / 格式错误。

本代理监听 ``127.0.0.1:8082``，把 Gemini 协议的请求实时翻译成 OpenAI 协议转发给
OpenRoute，再把响应翻译回 Gemini 格式。Gemini CLI 通过环境变量
``GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8082`` 指向本代理。

端口选择
--------
* 8082 — 与 claude-code-router (8788) / codex-proxy (8789) 错开，参考
  puhuaqiang/CodeCLIUseOpenRouter 的 8081 约定。

参考
----
* puhuaqiang/CodeCLIUseOpenRouter README_GEMINI.md — Gemini↔OpenAI 双向转换
* google-gemini/gemini-cli PR #21561 — GOOGLE_GEMINI_BASE_URL 环境变量支持

启动
----
    python gemini_to_openroute_proxy.py
    # 或指定端口
    python gemini_to_openroute_proxy.py --port 8083

    # 后台运行（推荐，配合 flowforge 服务启动）
    Start-Process python -ArgumentList "gemini_to_openroute_proxy.py" -WindowStyle Hidden
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
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

# ── 配置 ────────────────────────────────────────────────────────────────────

OPENROUTE_BASE_URL = os.environ.get("OPENROUTE_BASE_URL", "http://localhost:13001/v1")
OPENROUTE_API_KEY = os.environ.get(
    "OPENROUTE_API_KEY",
    "",  # 铁律5: 禁止硬编码密钥 — 必须通过 OPENROUTE_API_KEY 环境变量注入
)
DEFAULT_PORT = int(os.environ.get("GEMINI_PROXY_PORT", "8082"))
DEFAULT_HOST = os.environ.get("GEMINI_PROXY_HOST", "127.0.0.1")

# 默认 fallback 模型（未知 gemini-* 模型名统一走这里）
DEFAULT_MODEL = os.environ.get("GEMINI_PROXY_MODEL", "Doubao-Seed2.0")

# Gemini 模型名 → OpenRoute 模型名映射
# Gemini CLI 默认用 gemini-2.5-pro / gemini-2.5-flash 等，映射到 openroute 的国产模型。
# OpenRoute 2026-07-25 实测：
#   - Doubao-Seed2.0:  14.6s 返回 PONG ✓ (稳定)
#   - Qwen3.6-Plus:    33.9s 返回 PONG ✓ (慢但可用)
#   - DeepSeek-V4-Pro: 返回 "无法回答"（被识别为拒绝）
#   - MiniMax-M3:      返回 HTML 主页内容（不可用）
# Pro 档 → Qwen3.6-Plus（推理强），Flash 档 → Doubao-Seed2.0（响应快）。
GEMINI_TO_OPENROUTE_MODEL = {
    "gemini-2.5-pro": "Qwen3.6-Plus",
    "gemini-2.5-flash": "Doubao-Seed2.0",
    "gemini-2.0-flash": "Doubao-Seed2.0",
    "gemini-2.0-pro": "Qwen3.6-Plus",
    "gemini-1.5-pro": "Qwen3.6-Plus",
    "gemini-1.5-flash": "Doubao-Seed2.0",
    # 新版 gemini-cli 0.51+ 默认模型名
    "gemini-3.1-flash-lite": "Doubao-Seed2.0",
    "gemini-3.1-pro": "Qwen3.6-Plus",
    "gemini-3.1-flash": "Doubao-Seed2.0",
    "gemini-3.0-pro": "Qwen3.6-Plus",
    "gemini-3.0-flash": "Doubao-Seed2.0",
    # gemini-cli 0.60+ 内部 router 用的模型名
    "gemini-3.5-flash": "Doubao-Seed2.0",
    "gemini-3.5-flash-thinking": "Qwen3.6-Plus",
    "gemini-3.5-flash-thinking-lite": "Doubao-Seed2.0",
    "gemini-3.5-pro": "Qwen3.6-Plus",
    "gemini-auto": "Doubao-Seed2.0",
    "gemini-flash-lite": "Doubao-Seed2.0",
    # 允许直接用 openroute 模型名（如 "GLM-5.1"）原样透传
}

# ── 日志 ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] gemini_proxy: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("gemini_proxy")

app = FastAPI(title="Gemini→OpenRoute Proxy", version="1.0.0")


# ── 协议转换: Gemini → OpenAI ───────────────────────────────────────────────

def gemini_request_to_openai(model: str, body: dict[str, Any]) -> dict[str, Any]:
    """把 Gemini generateContent 请求转成 OpenAI chat/completions 请求.

    Gemini 请求体示例:
        {
          "contents": [
            {"role": "user", "parts": [{"text": "Hello"}]},
            {"role": "model", "parts": [{"text": "Hi there"}]}
          ],
          "systemInstruction": {"parts": [{"text": "You are helpful."}]},
          "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.7}
        }

    OpenAI 请求体示例:
        {
          "model": "GLM-5.1",
          "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"}
          ],
          "max_tokens": 1024,
          "temperature": 0.7
        }
    """
    messages: list[dict[str, str]] = []

    # systemInstruction → system message
    sys_inst = body.get("systemInstruction") or body.get("system_instruction")
    if sys_inst and isinstance(sys_inst, dict):
        parts = sys_inst.get("parts", [])
        sys_text = " ".join(p.get("text", "") for p in parts if isinstance(p, dict))
        if sys_text.strip():
            messages.append({"role": "system", "content": sys_text})

    # contents → user/assistant messages
    for entry in body.get("contents", []):
        role = entry.get("role", "user")
        # Gemini 用 "model" 表示 assistant，OpenAI 用 "assistant"
        oa_role = "assistant" if role == "model" else role
        parts = entry.get("parts", [])
        # 把所有 text part 合并成单个 content 字符串
        text_parts = [p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p]
        content = "\n".join(text_parts) if text_parts else ""
        if content:
            messages.append({"role": oa_role, "content": content})

    # generationConfig → OpenAI 参数
    gen_cfg = body.get("generationConfig") or body.get("generation_config") or {}
    # 未知模型名不透传（OpenRoute 会 403），统一 fallback 到 Doubao-Seed2.0
    resolved_model = GEMINI_TO_OPENROUTE_MODEL.get(model)
    if not resolved_model:
        # 处理 gemini-3.5-flash / gemini-3.5-flash-thinking 等 CLI 内部 router 模型
        # 任何以 "gemini-" 开头的未知型号都映射到默认模型
        if model.startswith("gemini-"):
            resolved_model = DEFAULT_MODEL if DEFAULT_MODEL else "Doubao-Seed2.0"
        else:
            # 非 gemini 前缀的可能是用户直接指定的 openroute 模型名，原样透传
            resolved_model = model
        log.info(f"model '{model}' not in map, using fallback: {resolved_model}")
    openai_body: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "stream": False,  # 默认非流式，streamGenerateContent 端点单独处理
    }
    if "maxOutputTokens" in gen_cfg:
        openai_body["max_tokens"] = gen_cfg["maxOutputTokens"]
    if "temperature" in gen_cfg:
        openai_body["temperature"] = gen_cfg["temperature"]
    if "topP" in gen_cfg:
        openai_body["top_p"] = gen_cfg["topP"]
    if "stopSequences" in gen_cfg:
        openai_body["stop"] = gen_cfg["stopSequences"]

    # 工具配置 (functionDeclarations → tools)
    tools = body.get("tools", [])
    if tools:
        oa_tools = []
        for tool in tools:
            decls = tool.get("functionDeclarations", [])
            for decl in decls:
                oa_tools.append({
                    "type": "function",
                    "function": {
                        "name": decl.get("name", ""),
                        "description": decl.get("description", ""),
                        "parameters": decl.get("parameters", {"type": "object", "properties": {}}),
                    },
                })
        if oa_tools:
            openai_body["tools"] = oa_tools

    return openai_body


def openai_response_to_gemini(oa_resp: dict[str, Any], model: str) -> dict[str, Any]:
    """把 OpenAI chat/completions 响应转回 Gemini generateContent 响应."""
    candidates = []
    for choice in oa_resp.get("choices", []):
        msg = choice.get("message", {})
        content = msg.get("content", "") or ""
        finish_reason = choice.get("finish_reason", "stop")
        # 映射 finish_reason
        gemini_finish = {
            "stop": "STOP",
            "length": "MAX_TOKENS",
            "tool_calls": "STOP",
        }.get(finish_reason, "STOP")

        parts = []
        if content:
            parts.append({"text": content})
        # tool_calls → functionCall parts
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            parts.append({"functionCall": {"name": fn.get("name", ""), "args": args}})

        candidate = {
            "content": {"role": "model", "parts": parts or [{"text": ""}]},
            "finishReason": gemini_finish,
            "index": choice.get("index", 0),
        }
        candidates.append(candidate)

    usage = oa_resp.get("usage", {})
    return {
        "candidates": candidates,
        "usageMetadata": {
            "promptTokenCount": usage.get("prompt_tokens", 0),
            "candidatesTokenCount": usage.get("completion_tokens", 0),
            "totalTokenCount": usage.get("total_tokens", 0),
        },
        "modelVersion": oa_resp.get("model", model),
    }


# ── 协议转换: 非流式 OpenAI 响应 → Gemini SSE ──────────────────────────────

async def stream_openai_to_gemini(oa_resp: httpx.Response, model: str) -> Any:
    """把 OpenAI 非流式响应合成为 Gemini SSE 流.

    OpenRoute 的 stream 实现有 bug（返回非 SSE JSON），所以我们总是以
    stream=False 调用 OpenRoute，然后在这里把完整响应切分成 SSE 事件
    返回给 gemini CLI。

    Gemini streamGenerateContent 用 SSE，每行 ``data: {json}``，json 是完整的
    generateContent 响应片段。
    """
    try:
        oa_data = oa_resp.json()
    except Exception as exc:
        log.error(f"failed to parse OpenRoute response as JSON: {exc}")
        err = {"error": {"code": 500, "message": f"proxy parse error: {exc}"}}
        yield f"data: {json.dumps(err)}\n\n"
        # Gemini SSE 协议不使用 [DONE] 哨兵（那是 OpenAI 的）— 直接关闭流即可
        return

    # 提取完整文本和 tool_calls
    full_text = ""
    finish_reason = None
    tool_calls_list = []
    for choice in oa_data.get("choices", []):
        msg = choice.get("message", {})
        text = msg.get("content", "") or ""
        if text:
            full_text += text
        if choice.get("finish_reason"):
            finish_reason = choice["finish_reason"]
        for tc in msg.get("tool_calls", []):
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}
            tool_calls_list.append({"name": fn.get("name", ""), "args": args})

    # 按固定 chunk 大小切分文本，模拟流式增量
    CHUNK_SIZE = 64
    for i in range(0, len(full_text), CHUNK_SIZE):
        chunk_text = full_text[i:i + CHUNK_SIZE]
        gemini_chunk = {
            "candidates": [{
                "content": {"role": "model", "parts": [{"text": chunk_text}]},
                "finishReason": None,
                "index": 0,
            }],
            "modelVersion": oa_data.get("model", model),
        }
        yield f"data: {json.dumps(gemini_chunk, ensure_ascii=False)}\n\n"

    # 发送 tool_calls 和结束 chunk
    parts = []
    if tool_calls_list:
        for tc in tool_calls_list:
            parts.append({"functionCall": tc})
    if finish_reason:
        final_chunk = {
            "candidates": [{
                "content": {"role": "model", "parts": parts} if parts else {"role": "model"},
                "finishReason": "STOP" if finish_reason == "stop" else "MAX_TOKENS",
                "index": 0,
            }],
            "modelVersion": oa_data.get("model", model),
        }
        yield f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n"

    # Gemini SSE 协议不使用 [DONE] 哨兵 — 直接关闭流即可
    # (OpenAI 用 data: [DONE]，但 Gemini CLI 会尝试解析为 JSON 导致 SyntaxError)


# ── HTTP 客户端 ─────────────────────────────────────────────────────────────

async def call_openroute(openai_body: dict[str, Any], stream: bool = False) -> httpx.Response:
    """转发请求到 OpenRoute. 总是用 stream=False（OpenRoute stream 有 bug）.

    stream=true 的请求由 stream_generate_content 端点从非流式响应合成 SSE。
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTE_API_KEY}",
        "Content-Type": "application/json",
    }
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
    return {"service": "gemini-to-openroute-proxy", "status": "ok"}


@app.get("/health")
async def health() -> dict:
    return {"status": "healthy", "openroute_base": OPENROUTE_BASE_URL}


@app.api_route("/v1beta/models/{model}:generateContent", methods=["POST"])
async def generate_content(model: str, request: Request) -> JSONResponse:
    """非流式 generateContent."""
    body = await request.json()
    log.info(f"generateContent: model={model}")
    try:
        openai_body = gemini_request_to_openai(model, body)
        t0 = time.perf_counter()
        oa_resp = await call_openroute(openai_body, stream=False)
        elapsed = (time.perf_counter() - t0) * 1000
        log.info(f"openroute responded: {oa_resp.status_code} ({elapsed:.0f}ms)")
        if oa_resp.status_code != 200:
            return JSONResponse(
                status_code=oa_resp.status_code,
                content={"error": {"code": oa_resp.status_code, "message": oa_resp.text[:500]}},
            )
        gemini_resp = openai_response_to_gemini(oa_resp.json(), model)
        return JSONResponse(content=gemini_resp)
    except Exception as exc:
        log.exception("generateContent failed")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": 500, "message": str(exc)}},
        )


@app.api_route("/v1beta/models/{model}:streamGenerateContent", methods=["POST"])
async def stream_generate_content(model: str, request: Request) -> StreamingResponse:
    """流式 streamGenerateContent (SSE)."""
    body = await request.json()
    log.info(f"streamGenerateContent: model={model}")
    try:
        openai_body = gemini_request_to_openai(model, body)
        oa_resp = await call_openroute(openai_body, stream=True)
        if oa_resp.status_code != 200:
            err_body = {"error": {"code": oa_resp.status_code, "message": oa_resp.text[:500]}}
            return StreamingResponse(
                iter([f"data: {json.dumps(err_body)}\n\n"]),
                media_type="text/event-stream",
            )
        return StreamingResponse(
            stream_openai_to_gemini(oa_resp, model),
            media_type="text/event-stream",
        )
    except Exception as exc:
        log.exception("streamGenerateContent failed")
        err_body = {"error": {"code": 500, "message": str(exc)}}
        return StreamingResponse(
            iter([f"data: {json.dumps(err_body)}\n\n"]),
            media_type="text/event-stream",
        )


@app.get("/v1beta/models")
async def list_models() -> dict:
    """列出可用模型 (Gemini 格式)."""
    models = []
    for gemini_name, openroute_name in GEMINI_TO_OPENROUTE_MODEL.items():
        models.append({
            "name": f"models/{gemini_name}",
            "displayName": gemini_name,
            "description": f"Proxied to OpenRoute {openroute_name}",
        })
    # 也加上 openroute 原生模型名（gemini CLI 可能直接用）
    for openroute_name in set(GEMINI_TO_OPENROUTE_MODEL.values()):
        models.append({
            "name": f"models/{openroute_name}",
            "displayName": openroute_name,
            "description": "OpenRoute native model",
        })
    return {"models": models}


# ── 入口 ────────────────────────────────────────────────────────────────────

def main() -> None:
    global OPENROUTE_BASE_URL, OPENROUTE_API_KEY
    parser = argparse.ArgumentParser(description="Gemini→OpenRoute protocol proxy")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--openroute-base", default=OPENROUTE_BASE_URL,
                        help="OpenRoute base URL (default: http://localhost:13001/v1)")
    parser.add_argument("--openroute-key", default=OPENROUTE_API_KEY,
                        help="OpenRoute API key")
    args = parser.parse_args()

    OPENROUTE_BASE_URL = args.openroute_base.rstrip("/")
    OPENROUTE_API_KEY = args.openroute_key

    log.info(f"Starting Gemini→OpenRoute proxy on {args.host}:{args.port}")
    log.info(f"OpenRoute backend: {OPENROUTE_BASE_URL}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

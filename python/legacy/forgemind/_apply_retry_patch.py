"""Patch script: add retry logic to 3 proxy call_openroute functions."""
import sys
from pathlib import Path

SHARED = '''# Invalid response patterns that indicate silent failure
INVALID_RESPONSE_PATTERNS = [
    "\\u65e0\\u6cd5\\u56de\\u7b54",
    "\\u5f53\\u524d\\u4e0d\\u53ef\\u7528\\uff0c\\u8bf7\\u7a0d\\u540e\\u91cd\\u8bd5",
    "\\u5f53\\u524d\\u4e0d\\u53ef\\u7528,\\u8bf7\\u7a0d\\u540e\\u91cd\\u8bd5",
    "\\u6211\\u65e0\\u6cd5\\u56de\\u7b54",
    "\\u6211\\u4e0d\\u80fd\\u56de\\u7b54",
    "\\u6211\\u65e0\\u6cd5\\u63d0\\u4f9b",
    "\\u6211\\u65e0\\u6cd5\\u5b8c\\u6210",
]

# Fallback models to try when primary model fails
FALLBACK_MODELS = ["Qwen3.6-Plus", "Kimi-K2.6", "DeepSeek-V4-Pro", "auto"]


def _is_invalid_response(content: str) -> bool:
    """Check if the LLM response is invalid (silent failure)."""
    if not content or len(content.strip()) < 2:
        return True
    content_stripped = content.strip()
    for pattern in INVALID_RESPONSE_PATTERNS:
        if pattern in content_stripped:
            return True
    return False


'''


def new_func(p):
    return (
        'async def call_openroute(' + p + ': dict[str, Any], stream: bool = False) -> httpx.Response:\n'
        '    """Call OpenRoute with retry logic and invalid response detection.\n'
        '\n'
        '    On invalid response or error, retries with fallback models.\n'
        '    Max 3 attempts. Always uses stream=False (OpenRoute stream has a bug);\n'
        '    callers synthesize SSE from the non-stream response.\n'
        '    """\n'
        '    headers = {\n'
        '        "Authorization": f"Bearer {OPENROUTE_API_KEY}",\n'
        '        "Content-Type": "application/json",\n'
        '    }\n'
        '\n'
        '    original_model = ' + p + '.get("model", DEFAULT_MODEL)\n'
        '    last_response: httpx.Response | None = None\n'
        '\n'
        '    for attempt in range(1, 4):\n'
        '        # Select model: original on attempt 1, fallback on later attempts\n'
        '        if attempt == 1:\n'
        '            model = original_model\n'
        '        else:\n'
        '            fallback_idx = min(attempt - 2, len(FALLBACK_MODELS) - 1)\n'
        '            model = FALLBACK_MODELS[fallback_idx]\n'
        '            log.info(f"Retry {attempt}/3 with fallback model: {model}")\n'
        '\n'
        '        request_body = {**' + p + ', "model": model, "stream": False}\n'
        '\n'
        '        def _call() -> httpx.Response:\n'
        '            with httpx.Client(timeout=180.0) as client:\n'
        '                return client.post(\n'
        '                    f"{OPENROUTE_BASE_URL}/chat/completions",\n'
        '                    json=request_body,\n'
        '                    headers=headers,\n'
        '                )\n'
        '\n'
        '        try:\n'
        '            resp = await asyncio.to_thread(_call)\n'
        '            if resp.status_code != 200:\n'
        '                log.warning(f"OpenRoute returned {resp.status_code} (attempt {attempt})")\n'
        '                last_response = resp\n'
        '                if attempt < 3:\n'
        '                    continue\n'
        '                return resp\n'
        '\n'
        '            # Check for invalid response\n'
        '            try:\n'
        '                data = resp.json()\n'
        '                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")\n'
        '                if _is_invalid_response(content):\n'
        '                    log.warning(f"Invalid response from {model} (attempt {attempt}): {content[:50]}")\n'
        '                    last_response = resp\n'
        '                    if attempt < 3:\n'
        '                        continue\n'
        '                    return resp\n'
        '            except Exception:\n'
        '                pass\n'
        '\n'
        '            # Valid response\n'
        '            return resp\n'
        '\n'
        '        except Exception as e:\n'
        '            log.warning(f"OpenRoute call failed (attempt {attempt}): {e}")\n'
        '            if attempt < 3:\n'
        '                continue\n'
        '            raise\n'
        '\n'
        '    # All retries exhausted, return last response (may be None)\n'
        '    if last_response is not None:\n'
        '        return last_response\n'
        '    # Create a synthetic error response\n'
        '    return httpx.Response(\n'
        '        status_code=503,\n'
        '        json={"error": {"message": "All retry attempts failed", "type": "api_error"}},\n'
        '    )\n'
    )


def patch(path, p):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    marker = "async def call_openroute("
    idx = src.find(marker)
    if idx == -1:
        print("ERROR: not found in " + path, file=sys.stderr)
        sys.exit(1)
    lines = src[idx:].splitlines(keepends=True)
    end = 0
    for i, line in enumerate(lines):
        if i == 0:
            continue
        if line and not line[0].isspace() and line.strip():
            end = sum(len(x) for x in lines[:i])
            break
    else:
        end = sum(len(x) for x in lines)
    old = src[idx:idx + end]
    print("  old first: " + repr(old.splitlines()[0]))
    print("  old last : " + repr(old.rstrip().splitlines()[-1]))
    new = SHARED + new_func(p)
    out = src[:idx] + new + src[idx + end:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print("  patched " + path)


def main():
    b = str(Path(__file__).resolve().parent)
    patch(b + r"\anthropic_to_openroute_proxy.py", "openai_body")
    patch(b + r"\gemini_to_openroute_proxy.py", "openai_body")
    patch(b + r"\responses_to_openroute_proxy.py", "chat_body")
    print("Done.")


if __name__ == "__main__":
    main()

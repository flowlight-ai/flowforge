import os
import hashlib
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("image_download")

# PIL is optional — if unavailable we skip dimension checks
try:
    from PIL import Image
    import io

    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


def _url_to_filename(url: str) -> str:
    """Derive a safe filename from URL, preserving extension when possible."""
    parsed = urlparse(url)
    path = parsed.path or ""
    ext = Path(path).suffix or ".jpg"
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    return f"{h}{ext}"


class ImageDownloadTool(BaseTool):
    name = "image_download"
    description = "Download images from URLs to local filesystem with size filtering"
    safety_level = "normal"
    is_concurrency_safe = True
    parameters_schema = {
        "type": "object",
        "required": ["urls", "output_dir"],
        "properties": {
            "urls": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of image URLs to download",
            },
            "output_dir": {
                "type": "string",
                "description": "Local directory to save images",
            },
            "min_width": {
                "type": "integer",
                "default": 400,
                "description": "Minimum image width in pixels",
            },
            "min_height": {
                "type": "integer",
                "default": 300,
                "description": "Minimum image height in pixels",
            },
            "timeout": {
                "type": "integer",
                "default": 30,
                "description": "Per-request timeout in seconds",
            },
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        urls: List[str] = input.params["urls"]
        output_dir: str = input.params["output_dir"]
        min_width: int = input.params.get("min_width", 400)
        min_height: int = input.params.get("min_height", 300)
        timeout: int = input.params.get("timeout", 30)

        if not urls:
            return ToolOutput(
                result={"downloaded": [], "failed": []},
                error="No URLs provided",
            )

        # Ensure output directory exists
        try:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return ToolOutput(
                result={"downloaded": [], "failed": list(urls)},
                error=f"Cannot create output directory: {e}",
            )

        downloaded: List[Dict[str, Any]] = []
        failed: List[str] = []

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            for url in urls:
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    content = resp.content

                    # Check dimensions if PIL is available
                    width: int = 0
                    height: int = 0
                    if _PIL_AVAILABLE:
                        try:
                            img = Image.open(io.BytesIO(content))
                            width, height = img.size
                            if width < min_width or height < min_height:
                                logger.info(
                                    f"Skipping {url}: {width}x{height} below "
                                    f"minimum {min_width}x{min_height}"
                                )
                                failed.append(url)
                                continue
                        except Exception:
                            # Cannot read image dimensions — save anyway
                            pass

                    filename = _url_to_filename(url)
                    filepath = os.path.join(output_dir, filename)
                    with open(filepath, "wb") as f:
                        f.write(content)

                    downloaded.append({
                        "url": url,
                        "path": filepath,
                        "width": width,
                        "height": height,
                        "size_bytes": len(content),
                    })
                    logger.info(f"Downloaded {url} -> {filepath}")

                except httpx.TimeoutException:
                    logger.warning(f"Timeout downloading {url}")
                    failed.append(url)
                except httpx.HTTPStatusError as e:
                    logger.warning(f"HTTP error downloading {url}: {e.response.status_code}")
                    failed.append(url)
                except Exception as e:
                    logger.warning(f"Failed to download {url}: {e}")
                    failed.append(url)

        return ToolOutput(result={"downloaded": downloaded, "failed": failed})

from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("publish")

# Platform name -> (module_path, class_name) for real publisher tools
_PLATFORM_TOOL_MAP: Dict[str, tuple[str, str]] = {
    "wechat": ("flowforge.tools.wechat_publisher", "WeChatPublisherTool"),
    "toutiao": ("flowforge.tools.toutiao_publisher", "ToutiaoPublisherTool"),
}


class PublishTool(BaseTool):
    name = "publish"
    description = "Publish content to platforms via platform-specific publisher tools"
    safety_level = "dangerous"
    is_concurrency_safe = False
    parameters_schema = {
        "type": "object",
        "required": ["platform", "title", "content"],
        "properties": {
            "platform": {
                "type": "string",
                "description": "Target platform (e.g. wechat, toutiao, zhihu)",
            },
            "title": {
                "type": "string",
                "description": "Article title",
            },
            "content": {
                "type": "string",
                "description": "Article content in HTML or Markdown",
            },
            "publish_mode": {
                "type": "string",
                "default": "draft",
                "enum": ["draft", "publish"],
                "description": "Publish as draft or directly",
            },
            "images": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
                "description": "List of local image paths to attach",
            },
        },
    }

    def __init__(self, tool_registry: Optional[Any] = None) -> None:
        self._tool_registry = tool_registry
        self._publisher_cache: Dict[str, BaseTool] = {}

    def set_tool_registry(self, tool_registry: Any) -> None:
        self._tool_registry = tool_registry

    def _get_platform_publisher(self, platform: str) -> Optional[BaseTool]:
        """Lazily instantiate and cache a platform-specific publisher."""
        if platform in self._publisher_cache:
            return self._publisher_cache[platform]

        # Try ToolRegistry first (publish_wechat, publish_toutiao, etc.)
        if self._tool_registry:
            tool_name = f"publish_{platform}"
            try:
                tool = self._tool_registry.get_tool(tool_name)
                if tool:
                    self._publisher_cache[platform] = tool
                    return tool
            except Exception:
                pass

        # Fallback: import and instantiate directly
        if platform in _PLATFORM_TOOL_MAP:
            module_path, class_name = _PLATFORM_TOOL_MAP[platform]
            try:
                import importlib
                mod = importlib.import_module(module_path)
                tool_cls = getattr(mod, class_name)
                tool = tool_cls()
                self._publisher_cache[platform] = tool
                return tool
            except (ImportError, AttributeError) as e:
                logger.warning(f"Cannot load publisher for '{platform}': {e}")

        return None

    async def execute(self, input: ToolInput) -> ToolOutput:
        platform: str = input.params["platform"]
        title: str = input.params["title"]
        content: str = input.params["content"]
        publish_mode: str = input.params.get("publish_mode", "draft")
        images: List[str] = input.params.get("images", [])

        # Validate required params
        if not platform.strip():
            return ToolOutput(result={}, error="Platform cannot be empty")
        if not title.strip():
            return ToolOutput(result={}, error="Title cannot be empty")
        if not content.strip():
            return ToolOutput(result={}, error="Content cannot be empty")

        # Delegate to platform-specific publisher
        publisher = self._get_platform_publisher(platform)
        if publisher is not None:
            logger.info(
                f"Delegating publish to {publisher.name}: "
                f"platform={platform}, title={title[:30]}..., "
                f"mode={publish_mode}, images={len(images)}"
            )
            try:
                publisher_params: Dict[str, Any] = {
                    "title": title,
                    "content": content,
                }
                # Pass platform-specific extra params
                if platform == "wechat" and images:
                    publisher_params["thumb_media_id"] = images[0] if images else ""
                    publisher_params["digest"] = content[:54]
                if platform == "toutiao" and images:
                    publisher_params["cover_image"] = images[0]

                result = await publisher.execute(
                    ToolInput(params=publisher_params)
                )
                # Enrich result with original request metadata
                enriched = dict(result.result)
                enriched["platform"] = platform
                enriched["publish_mode"] = publish_mode
                if result.error:
                    enriched["success"] = False
                    return ToolOutput(result=enriched, error=result.error)
                enriched["success"] = True
                return ToolOutput(result=enriched)
            except Exception as e:
                logger.error(f"Platform publisher '{publisher.name}' failed: {e}")
                return ToolOutput(
                    result={"success": False, "platform": platform, "publish_mode": publish_mode},
                    error=f"Publish to '{platform}' failed: {e}",
                )

        # No real publisher available for this platform
        logger.warning(
            f"No publisher available for platform '{platform}'. "
            f"Supported platforms: {list(_PLATFORM_TOOL_MAP.keys())}"
        )
        return ToolOutput(
            result={
                "success": False,
                "platform": platform,
                "publish_mode": publish_mode,
                "available_platforms": list(_PLATFORM_TOOL_MAP.keys()),
            },
            error=(
                f"No publisher implementation for platform '{platform}'. "
                f"Available platforms: {list(_PLATFORM_TOOL_MAP.keys())}. "
                f"Please register a 'publish_{platform}' tool or add it to _PLATFORM_TOOL_MAP."
            ),
        )

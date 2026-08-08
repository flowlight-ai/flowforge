"""Declarative Platform Adapter — YAML-driven platform publishing configuration.

Implements:
- PlatformSpec: Pydantic model for declarative platform specifications
- PlatformAdapterRegistry: Registry for loading/managing platform specs from YAML
- PlatformAdapter: Content adaptation engine driven by PlatformSpec configs

This module does NOT replace publish_engine.py. It provides a declarative
layer that can be integrated alongside the existing engine. The existing
PLATFORM_SPECS dict in publish_engine.py can eventually be migrated to
YAML files loaded through this framework.

Design principles:
- Configuration over code: Platform behavior defined in YAML, not Python
- Forward compatible: Existing publish_engine.py continues to work unchanged
- DI pattern: No direct imports of SDKs or hardcoded credentials
"""
import re
from pathlib import Path
from typing import Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field, field_validator

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


# ── PlatformSpec: Declarative platform specification model ──────────────

class PlatformSpec(BaseModel):
    """Declarative specification for a publishing platform.

    All platform behavior is defined through this model, loaded from YAML.
    No code changes needed to add or modify a platform — just edit the YAML.
    """

    platform_id: str = Field(
        ...,
        description="Unique platform identifier, e.g. 'toutiao', 'wechat'",
    )
    display_name: str = Field(
        ...,
        description="Human-readable platform name, e.g. '今日头条'",
    )
    auth_type: Literal["cookie", "api", "oauth"] = Field(
        ...,
        description="Authentication method required by the platform",
    )
    content_format: Literal["markdown", "rich_text", "html"] = Field(
        ...,
        description="Native content format supported by the platform",
    )
    max_title_length: int = Field(
        default=64,
        description="Maximum title length in characters",
    )
    max_content_length: int = Field(
        default=20000,
        description="Maximum content length in characters",
    )
    image_handling: Literal["embed", "upload", "url_only"] = Field(
        default="upload",
        description="How the platform handles images",
    )
    rate_limit: int = Field(
        default=10,
        description="Maximum requests per minute allowed by the platform",
    )
    fallback_platform: Optional[str] = Field(
        default=None,
        description="Alternative platform to use if this one fails",
    )
    supports_html: bool = Field(
        default=False,
        description="Whether the platform supports HTML content",
    )
    supports_images: bool = Field(
        default=True,
        description="Whether the platform supports image embedding",
    )
    paragraph_separator: str = Field(
        default="\n\n",
        description="Paragraph separator used by the platform",
    )
    extra: Dict = Field(
        default_factory=dict,
        description="Platform-specific extra configuration",
    )

    @field_validator("platform_id")
    @classmethod
    def validate_platform_id(cls, v: str) -> str:
        if not re.match(r'^[a-z][a-z0-9_]*$', v):
            raise ValueError(
                f"platform_id must be lowercase alphanumeric with underscores, "
                f"got: '{v}'"
            )
        return v

    model_config = {"extra": "allow"}


# ── PlatformAdapterRegistry: YAML-driven platform spec management ──────

class PlatformAdapterRegistry:
    """Registry for managing platform specifications loaded from YAML.

    Supports:
    - Register platform specs programmatically or from YAML files
    - List all registered platforms
    - Get a specific platform spec by ID
    - Load all YAML specs from a directory
    """

    def __init__(self) -> None:
        self._specs: Dict[str, PlatformSpec] = {}

    def register(self, spec: PlatformSpec) -> None:
        """Register a platform specification.

        Args:
            spec: PlatformSpec instance to register.

        Raises:
            ValueError: If a spec with the same platform_id already exists.
        """
        if spec.platform_id in self._specs:
            raise ValueError(
                f"Platform '{spec.platform_id}' already registered. "
                f"Use unregister() first if you want to replace it."
            )
        self._specs[spec.platform_id] = spec
        logger.info(f"PlatformAdapterRegistry: registered '{spec.platform_id}' ({spec.display_name})")

    def unregister(self, platform_id: str) -> None:
        """Remove a platform specification from the registry."""
        if platform_id in self._specs:
            del self._specs[platform_id]
            logger.info(f"PlatformAdapterRegistry: unregistered '{platform_id}'")

    def get_adapter(self, platform_id: str) -> PlatformSpec:
        """Get a platform specification by ID.

        Args:
            platform_id: The unique platform identifier.

        Returns:
            PlatformSpec for the given platform.

        Raises:
            KeyError: If the platform is not registered.
        """
        if platform_id not in self._specs:
            raise KeyError(
                f"Platform '{platform_id}' not registered. "
                f"Available: {list(self._specs.keys())}"
            )
        return self._specs[platform_id]

    def list_platforms(self) -> List[PlatformSpec]:
        """List all registered platform specifications."""
        return list(self._specs.values())

    def load_from_yaml(self, yaml_path: str) -> None:
        """Load platform specs from a YAML file.

        The YAML file can contain either a single spec or a list of specs.

        Args:
            yaml_path: Path to the YAML file.

        Raises:
            FileNotFoundError: If the YAML file doesn't exist.
            ValueError: If the YAML content is invalid.
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Platform YAML not found: {yaml_path}")

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if data is None:
            raise ValueError(f"Empty YAML file: {yaml_path}")

        # Support both single spec and list of specs
        specs_data = data if isinstance(data, list) else [data]

        for spec_data in specs_data:
            if not isinstance(spec_data, dict):
                raise ValueError(f"Invalid spec format in {yaml_path}: {spec_data}")
            spec = PlatformSpec(**spec_data)
            # Allow overwriting when loading from YAML
            self._specs[spec.platform_id] = spec
            logger.info(
                f"PlatformAdapterRegistry: loaded '{spec.platform_id}' "
                f"({spec.display_name}) from {yaml_path}"
            )

    def load_from_directory(self, dir_path: str) -> None:
        """Load all YAML platform specs from a directory.

        Args:
            dir_path: Path to directory containing YAML files.
        """
        path = Path(dir_path)
        if not path.exists():
            raise FileNotFoundError(f"Platform config directory not found: {dir_path}")

        yaml_files = sorted(path.glob("*.yaml")) + sorted(path.glob("*.yml"))
        if not yaml_files:
            logger.warning(f"No YAML files found in {dir_path}")
            return

        for yaml_file in yaml_files:
            try:
                self.load_from_yaml(str(yaml_file))
            except Exception as e:
                logger.error(f"Failed to load platform spec from {yaml_file}: {e}")

        logger.info(
            f"PlatformAdapterRegistry: loaded {len(self._specs)} platform(s) "
            f"from {dir_path}"
        )

    def has_platform(self, platform_id: str) -> bool:
        """Check if a platform is registered."""
        return platform_id in self._specs


# ── PlatformAdapter: Content adaptation driven by PlatformSpec ──────────

class PlatformAdapter:
    """Content adaptation engine driven by PlatformSpec configurations.

    Handles:
    - Format conversion (markdown ↔ rich_text ↔ html)
    - Length limits (title and content truncation)
    - Image handling strategy
    - Paragraph normalization

    This class uses PlatformSpec for all configuration — no hardcoded
    platform-specific logic. New platforms only need a YAML spec file.
    """

    def __init__(self, registry: Optional[PlatformAdapterRegistry] = None):
        self._registry = registry or PlatformAdapterRegistry()

    @property
    def registry(self) -> PlatformAdapterRegistry:
        """Access the underlying registry."""
        return self._registry

    def adapt_content(
        self,
        content: str,
        source_format: str,
        target_platform: str,
    ) -> str:
        """Adapt content from source format to target platform's format.

        Args:
            content: The original content string.
            source_format: Source content format ("markdown", "rich_text", "html").
            target_platform: Target platform ID (must be registered).

        Returns:
            Adapted content string conforming to the target platform's spec.
        """
        spec = self._registry.get_adapter(target_platform)

        # Step 1: Format conversion
        adapted = self._convert_format(content, source_format, spec.content_format)

        # Step 2: Strip HTML if platform doesn't support it
        if not spec.supports_html:
            adapted = self._strip_html(adapted)

        # Step 3: Normalize paragraph separators
        adapted = re.sub(r'\n{3,}', spec.paragraph_separator, adapted)

        # Step 4: Truncate to max content length
        if len(adapted) > spec.max_content_length:
            adapted = adapted[: spec.max_content_length - 3] + "..."
            logger.info(
                f"PlatformAdapter: content truncated to "
                f"{spec.max_content_length} chars for '{target_platform}'"
            )

        return adapted

    def adapt_title(self, title: str, target_platform: str) -> str:
        """Adapt title for target platform's length limits.

        Args:
            title: The original title string.
            target_platform: Target platform ID.

        Returns:
            Adapted title string.
        """
        spec = self._registry.get_adapter(target_platform)
        if len(title) <= spec.max_title_length:
            return title
        return title[: spec.max_title_length - 1] + "…"

    def adapt(
        self, title: str, content: str, source_format: str, target_platform: str
    ) -> tuple:
        """Adapt both title and content for a target platform.

        Args:
            title: Original title.
            content: Original content.
            source_format: Source content format.
            target_platform: Target platform ID.

        Returns:
            Tuple of (adapted_title, adapted_content).
        """
        adapted_title = self.adapt_title(title, target_platform)
        adapted_content = self.adapt_content(
            content, source_format, target_platform
        )
        return adapted_title, adapted_content

    def _convert_format(
        self, content: str, source_format: str, target_format: str
    ) -> str:
        """Convert content between formats.

        Supported conversions:
        - markdown → html: Basic markdown to HTML
        - html → markdown: Strip HTML tags (simplified)
        - markdown → rich_text: Keep as-is (rich_text accepts markdown)
        - html → rich_text: Strip HTML tags
        - Any → markdown: Strip HTML if present
        """
        if source_format == target_format:
            return content

        # markdown → html
        if source_format == "markdown" and target_format == "html":
            return self._markdown_to_html(content)

        # html → markdown (simplified)
        if source_format == "html" and target_format == "markdown":
            return self._strip_html(content)

        # html → rich_text
        if source_format == "html" and target_format == "rich_text":
            return self._strip_html(content)

        # markdown → rich_text (rich_text accepts markdown)
        if source_format == "markdown" and target_format == "rich_text":
            return content

        # rich_text → html
        if source_format == "rich_text" and target_format == "html":
            return self._markdown_to_html(content)

        # rich_text → markdown
        if source_format == "rich_text" and target_format == "markdown":
            return content

        # Fallback: just return as-is
        return content

    @staticmethod
    def _markdown_to_html(text: str) -> str:
        """Basic markdown to HTML conversion.

        Handles: headers, bold, italic, links, images, paragraphs.
        This is intentionally simple — not a full markdown parser.
        """
        lines = text.split("\n")
        html_lines: List[str] = []

        for line in lines:
            stripped = line.strip()

            # Headers
            if stripped.startswith("### "):
                html_lines.append(f"<h3>{stripped[4:]}</h3>")
            elif stripped.startswith("## "):
                html_lines.append(f"<h2>{stripped[3:]}</h2>")
            elif stripped.startswith("# "):
                html_lines.append(f"<h1>{stripped[2:]}</h1>")
            # Images
            elif stripped.startswith("![") and "](" in stripped:
                match = re.match(r'!\[(.*?)\]\((.*?)\)', stripped)
                if match:
                    html_lines.append(
                        f'<img src="{match.group(2)}" alt="{match.group(1)}">'
                    )
                else:
                    html_lines.append(f"<p>{stripped}</p>")
            # Links
            elif "[" in stripped and "](" in stripped:
                html_lines.append(
                    re.sub(
                        r'\[(.*?)\]\((.*?)\)',
                        r'<a href="\2">\1</a>',
                        stripped,
                    )
                )
                html_lines[-1] = f"<p>{html_lines[-1]}</p>"
            # Bold
            elif stripped:
                line_html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', stripped)
                line_html = re.sub(r'\*(.*?)\*', r'<em>\1</em>', line_html)
                html_lines.append(f"<p>{line_html}</p>")
            else:
                html_lines.append("")

        return "\n".join(html_lines)

    @staticmethod
    def _strip_html(text: str) -> str:
        """Remove HTML tags from text."""
        clean = re.sub(r'<[^>]+>', '', text)
        clean = clean.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        clean = clean.replace('&quot;', '"').replace('&#39;', "'")
        clean = clean.replace('&nbsp;', ' ')
        return clean


# ── Convenience: Default registry with built-in specs ───────────────────

def create_default_registry() -> PlatformAdapterRegistry:
    """Create a registry pre-loaded with default platform specs.

    These defaults match the existing PLATFORM_SPECS in publish_engine.py,
    ensuring backward compatibility. They can be overridden by loading
    YAML specs from the config/platforms/ directory.
    """
    registry = PlatformAdapterRegistry()

    default_specs = [
        PlatformSpec(
            platform_id="toutiao",
            display_name="今日头条",
            auth_type="cookie",
            content_format="rich_text",
            max_title_length=30,
            max_content_length=20000,
            image_handling="upload",
            rate_limit=6,
            fallback_platform="baijiahao",
            supports_html=False,
            supports_images=True,
        ),
        PlatformSpec(
            platform_id="wechat",
            display_name="微信公众号",
            auth_type="api",
            content_format="html",
            max_title_length=64,
            max_content_length=20000,
            image_handling="upload",
            rate_limit=5,
            fallback_platform=None,
            supports_html=True,
            supports_images=True,
        ),
        PlatformSpec(
            platform_id="baijiahao",
            display_name="百家号",
            auth_type="cookie",
            content_format="rich_text",
            max_title_length=30,
            max_content_length=20000,
            image_handling="upload",
            rate_limit=6,
            fallback_platform="toutiao",
            supports_html=False,
            supports_images=True,
        ),
        PlatformSpec(
            platform_id="zhihu",
            display_name="知乎",
            auth_type="cookie",
            content_format="markdown",
            max_title_length=100,
            max_content_length=50000,
            image_handling="upload",
            rate_limit=10,
            fallback_platform=None,
            supports_html=True,
            supports_images=True,
        ),
    ]

    for spec in default_specs:
        registry.register(spec)

    return registry

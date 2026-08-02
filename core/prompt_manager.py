import os
import yaml
from flowforge.core.tracing import get_logger

logger = get_logger("prompt_manager")

# Default config directory relative to this module
_DEFAULT_CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")


class PromptManager:
    _instance = None
    _prompts: dict = {}

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, prompts_dir: str = None):
        if self._prompts:
            return
        self._prompts = {}
        # 动态注册的项目列表：{prefix: project_name}
        # 例如 {"contentforge.": "contentforge"} 表示以 "contentforge." 开头的 key
        # 会从对应项目的 config 目录加载
        self._registered_projects: dict[str, str] = {}
        # Load from default config dir first
        if os.path.isdir(_DEFAULT_CONFIG_DIR):
            self._load_from_dir(_DEFAULT_CONFIG_DIR)
        # Auto-discover and load prompts from registered projects
        self._auto_discover_project_prompts()
        # Load from custom dir if specified
        if prompts_dir and os.path.isdir(prompts_dir) and prompts_dir != _DEFAULT_CONFIG_DIR:
            self._load_from_dir(prompts_dir)

    def register_project(self, prefix: str, project_name: str) -> None:
        """注册一个上层项目，使其 prompts 可被自动发现和按前缀加载。

        Args:
            prefix: prompt key 的前缀，如 "contentforge."
            project_name: 项目名称，如 "contentforge"，用于定位 config 目录
        """
        self._registered_projects[prefix] = project_name
        # 立即尝试加载该项目的 prompts
        workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        project_config_dir = os.path.join(workspace_root, project_name, "config")
        if os.path.isdir(project_config_dir):
            self._load_from_dir(project_config_dir)

    def _auto_discover_project_prompts(self):
        """Auto-discover and load prompts.yaml from registered projects.

        扫描策略：
        1. 先加载已通过 register_project 注册的项目
        2. 再自动扫描工作目录下所有 *forge/ 项目的 config/prompts.yaml
           （使测试环境无需加载 plugins.py 也能发现项目级 prompts）
        """
        workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

        # 1. 加载已注册项目
        for prefix, project_name in self._registered_projects.items():
            project_config_dir = os.path.join(workspace_root, project_name, "config")
            if os.path.isdir(project_config_dir):
                self._load_from_dir(project_config_dir)

        # 2. 自动扫描工作目录下所有 *forge/ 项目
        if not os.path.isdir(workspace_root):
            return
        for entry in sorted(os.listdir(workspace_root)):
            project_dir = os.path.join(workspace_root, entry)
            if not os.path.isdir(project_dir):
                continue
            # 匹配 *forge 项目（contentforge/devforge/novelforge/mallforge/stockforge/demoforge）
            if not entry.endswith("forge") or entry == "flowforge":
                continue
            prefix = entry + "."
            # 跳过已注册的项目（避免重复加载）
            if prefix in self._registered_projects:
                continue
            project_config_dir = os.path.join(project_dir, "config")
            if os.path.isdir(project_config_dir):
                # 自动注册前缀并加载
                self._registered_projects[prefix] = entry
                self._load_from_dir(project_config_dir)

    def _load_from_dir(self, prompts_dir: str):
        for filename in sorted(os.listdir(prompts_dir)):
            if filename.startswith("prompts") and filename.endswith((".yaml", ".yml")):
                filepath = os.path.join(prompts_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                    if isinstance(data, dict):
                        self._prompts.update(self._flatten_prompts(data))
                        logger.info(f"Loaded prompts from {filepath}: {len(self._prompts)} keys")
                except Exception as e:
                    logger.warning(f"Failed to load prompts from {filepath}: {e}")

    @staticmethod
    def _flatten_prompts(data: dict) -> dict:
        """Flatten nested prompts YAML into a flat dict of key→template_string.

        Supports two YAML structures:
        1. Flat: ``key: "template string"`` (legacy, used by old flowforge)
        2. Nested: ``prompts: {key: {template: "..."}}`` (new format with metadata)

        For nested format, extracts the ``template`` field from each prompt entry.
        Metadata keys (version, magic_words) are excluded — only prompt templates
        are stored so that list_keys() returns only actual prompts.
        """
        result: dict = {}
        prompts_section = data.get("prompts")
        if isinstance(prompts_section, dict):
            # Nested format: prompts: {key: {template: "..."}, ...}
            for key, value in prompts_section.items():
                if isinstance(value, dict) and "template" in value:
                    result[key] = value["template"]
                elif isinstance(value, str):
                    result[key] = value
            # Metadata keys (version, magic_words) are intentionally excluded
        else:
            # Flat format: key: "template string"
            result.update(data)
        return result

    def get(self, key: str, fallback: str = "", **kwargs) -> str:
        template = self._prompts.get(key, "")
        if not template:
            # Try to load from project-specific prompts on miss
            template = self._try_load_project_prompt(key)
        if not template:
            # YAML 未命中时使用 fallback 模板（支持 {var} 占位符渲染）
            if fallback:
                try:
                    return fallback.format(**kwargs)
                except (KeyError, ValueError, IndexError) as e:
                    logger.warning(f"Prompt '{key}' fallback format error: {e}")
                    for k, v in kwargs.items():
                        fallback = fallback.replace(f"{{{k}}}", str(v))
                    return fallback
            logger.warning(f"Prompt key '{key}' not found")
            return ""
        # Ensure template is a string (metadata values like magic_words may be lists)
        if not isinstance(template, str):
            logger.warning(f"Prompt key '{key}' is not a string: {type(template).__name__}")
            return ""
        if kwargs:
            try:
                return template.format(**kwargs)
            except (KeyError, ValueError, IndexError) as e:
                logger.warning(f"Prompt '{key}' format error: {e}")
                for k, v in kwargs.items():
                    template = template.replace(f"{{{k}}}", str(v))
                return template
        return template

    def _try_load_project_prompt(self, key: str) -> str:
        """Try to load a prompt from a project-specific prompts.yaml based on key prefix."""
        for prefix, project_name in self._registered_projects.items():
            if key.startswith(prefix):
                # flowforge/core/prompt_manager.py -> flowforge/ -> openclaw/
                workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                project_config_dir = os.path.join(workspace_root, project_name, "config")
                if os.path.isdir(project_config_dir):
                    self._load_from_dir(project_config_dir)
                    template = self._prompts.get(key, "")
                    if template:
                        return template
                break
        return ""

    def set(self, key: str, template: str):
        self._prompts[key] = template

    def list_keys(self) -> list:
        """Return list of prompt keys (excludes non-string metadata like version/magic_words)."""
        return [k for k, v in self._prompts.items() if isinstance(v, str)]

    def reload(self, prompts_dir: str = None):
        self._prompts = {}
        # 保留已注册的项目列表（reload 不清除项目注册）
        registered = dict(self._registered_projects)
        if os.path.isdir(_DEFAULT_CONFIG_DIR):
            self._load_from_dir(_DEFAULT_CONFIG_DIR)
        # 重新触发自动发现（包括已注册项目和自动扫描）
        self._auto_discover_project_prompts()
        if prompts_dir and os.path.isdir(prompts_dir) and prompts_dir != _DEFAULT_CONFIG_DIR:
            self._load_from_dir(prompts_dir)


def get_prompt(key: str, fallback: str = "", **kwargs) -> str:
    """加载提示词模板并渲染.

    Args:
        key: 提示词键名（对应 prompts.yaml 中的键）
        fallback: YAML 未命中时的兜底模板（支持 {var} 占位符渲染）。
                  兼容 rewoo/plan_execute 等模式的 `get_prompt(key, "fallback...", **vars)` 调用。
        **kwargs: 模板变量
    """
    return PromptManager().get(key, fallback=fallback, **kwargs)

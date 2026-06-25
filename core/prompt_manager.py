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
        """Auto-discover and load prompts.yaml from registered projects."""
        workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        for prefix, project_name in self._registered_projects.items():
            project_config_dir = os.path.join(workspace_root, project_name, "config")
            if os.path.isdir(project_config_dir):
                self._load_from_dir(project_config_dir)

    def _load_from_dir(self, prompts_dir: str):
        for filename in sorted(os.listdir(prompts_dir)):
            if filename.startswith("prompts") and filename.endswith((".yaml", ".yml")):
                filepath = os.path.join(prompts_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                    if isinstance(data, dict):
                        self._prompts.update(data)
                        logger.info(f"Loaded prompts from {filepath}: {list(data.keys())}")
                except Exception as e:
                    logger.warning(f"Failed to load prompts from {filepath}: {e}")

    def get(self, key: str, **kwargs) -> str:
        template = self._prompts.get(key, "")
        if not template:
            # Try to load from project-specific prompts on miss
            template = self._try_load_project_prompt(key)
        if not template:
            logger.warning(f"Prompt key '{key}' not found")
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
        return list(self._prompts.keys())

    def reload(self, prompts_dir: str = None):
        self._prompts = {}
        if os.path.isdir(_DEFAULT_CONFIG_DIR):
            self._load_from_dir(_DEFAULT_CONFIG_DIR)
        if prompts_dir and os.path.isdir(prompts_dir) and prompts_dir != _DEFAULT_CONFIG_DIR:
            self._load_from_dir(prompts_dir)


def get_prompt(key: str, **kwargs) -> str:
    return PromptManager().get(key, **kwargs)

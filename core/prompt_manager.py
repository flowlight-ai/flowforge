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
        # Load from default config dir first
        if os.path.isdir(_DEFAULT_CONFIG_DIR):
            self._load_from_dir(_DEFAULT_CONFIG_DIR)
        # Auto-discover and load prompts from upper-layer projects
        self._auto_discover_project_prompts()
        # Load from custom dir if specified
        if prompts_dir and os.path.isdir(prompts_dir) and prompts_dir != _DEFAULT_CONFIG_DIR:
            self._load_from_dir(prompts_dir)

    def _auto_discover_project_prompts(self):
        """Auto-discover and load prompts.yaml from upper-layer projects (contentforge, novelforge, etc.)."""
        # flowforge/core/prompt_manager.py -> flowforge/ -> openclaw/
        workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        project_names = ["contentforge", "novelforge", "devforge", "mallforge"]
        for project in project_names:
            project_config_dir = os.path.join(workspace_root, project, "config")
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
        project_map = {
            "contentforge.": "contentforge",
            "novelforge.": "novelforge",
            "devforge.": "devforge",
            "mallforge.": "mallforge",
        }
        for prefix, project_name in project_map.items():
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

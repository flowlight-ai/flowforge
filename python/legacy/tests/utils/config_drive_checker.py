"""配置驱动率自动验证工具

检查项目的配置驱动率，确保 Agent、提示词、工具等核心组件
通过 YAML 配置驱动而非硬编码，符合项目铁律要求。
"""
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class ConfigDriveResult:
    """配置驱动率检查结果"""
    total_items: int
    config_driven: int
    hardcoded: int
    rate: float
    details: List[str] = field(default_factory=list)


class ConfigDriveChecker:
    """检查项目的配置驱动率

    扫描项目目录，统计 Agent / 提示词 / 工具 / 工作流等组件
    中有多少是配置驱动的（YAML），有多少是硬编码的（Python），
    并计算配置驱动率。
    """

    # 长字符串阈值：超过此长度的三引号/引号字符串视为潜在硬编码提示词
    PROMPT_LENGTH_THRESHOLD = 50

    def __init__(self, project_dir: str | Path):
        self.project_dir = Path(project_dir)

    # ── Agent 配置驱动率 ─────────────────────────────────────────

    def check_agent_config_rate(self) -> ConfigDriveResult:
        """检查 Agent 配置驱动率

        统计 agents/ 目录下的 Python Agent 文件数，
        以及 config/agents/ 目录下的 YAML 配置文件数。
        配置驱动的 Agent 应有对应的 YAML 配置。
        """
        agents_dir = self.project_dir / "agents"
        config_agents_dir = self.project_dir / "config" / "agents"

        agent_files = self._find_py_files(agents_dir)
        yaml_files = self._find_yaml_files(config_agents_dir)

        total = len(agent_files)
        config_driven = len(yaml_files)

        return ConfigDriveResult(
            total_items=total,
            config_driven=config_driven,
            hardcoded=total - config_driven,
            rate=config_driven / total if total > 0 else 0.0,
            details=[f"Agent YAML configs: {config_driven}/{total}"],
        )

    # ── 提示词配置驱动率 ─────────────────────────────────────────

    def check_prompt_config_rate(self) -> ConfigDriveResult:
        """检查提示词配置驱动率

        扫描代码中的长字符串（可能是硬编码提示词），
        对比 prompts.yaml 中定义的提示词数量。
        """
        prompts_yaml = self.project_dir / "config" / "prompts.yaml"
        hardcoded_count = 0
        hardcoded_details: List[str] = []

        # 扫描代码中的硬编码提示词
        for py_file in self._find_py_files(self.project_dir):
            try:
                content = py_file.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue

            # 三引号长字符串
            triple_quote_matches = re.findall(
                r'"""[\s\S]{%d,}"""' % self.PROMPT_LENGTH_THRESHOLD, content
            )
            # 单引号长字符串
            single_quote_matches = re.findall(
                r"'[\s\S]{%d,}'" % self.PROMPT_LENGTH_THRESHOLD, content
            )
            count = len(triple_quote_matches) + len(single_quote_matches)
            if count > 0:
                hardcoded_count += count
                rel_path = py_file.relative_to(self.project_dir)
                hardcoded_details.append(f"{rel_path}: {count} hardcoded prompts")

        # 检查 prompts.yaml 中有多少 key
        yaml_keys = 0
        if prompts_yaml.exists():
            yaml_keys = self._count_yaml_keys(prompts_yaml)

        total = hardcoded_count + yaml_keys

        return ConfigDriveResult(
            total_items=total,
            config_driven=yaml_keys,
            hardcoded=hardcoded_count,
            rate=yaml_keys / total if total > 0 else 0.0,
            details=[
                f"Prompts YAML keys: {yaml_keys}",
                f"Hardcoded prompts: {hardcoded_count}",
            ] + hardcoded_details[:5],  # 最多显示5个详情
        )

    # ── 工作流配置驱动率 ─────────────────────────────────────────

    def check_workflow_config_rate(self) -> ConfigDriveResult:
        """检查工作流配置驱动率

        统计 config/workflows/ 下的 YAML 工作流配置数量。
        """
        workflows_dir = self.project_dir / "config" / "workflows"
        yaml_files = self._find_yaml_files(workflows_dir)

        return ConfigDriveResult(
            total_items=len(yaml_files),
            config_driven=len(yaml_files),
            hardcoded=0,
            rate=1.0 if yaml_files else 0.0,
            details=[f"Workflow YAML configs: {len(yaml_files)}"],
        )

    # ── 综合报告 ─────────────────────────────────────────────────

    def full_report(self) -> Dict[str, ConfigDriveResult]:
        """生成完整的配置驱动率报告"""
        return {
            "agent": self.check_agent_config_rate(),
            "prompt": self.check_prompt_config_rate(),
            "workflow": self.check_workflow_config_rate(),
        }

    # ── 内部工具方法 ─────────────────────────────────────────────

    def _find_py_files(self, directory: Path) -> List[Path]:
        if not directory.exists():
            return []
        return [
            p for p in directory.rglob("*.py")
            if not p.name.startswith("__")
            and "__pycache__" not in p.parts
            and "tests" not in p.parts
        ]

    def _find_yaml_files(self, directory: Path) -> List[Path]:
        if not directory.exists():
            return []
        return [
            p for p in directory.rglob("*")
            if p.suffix in (".yaml", ".yml")
        ]

    def _count_yaml_keys(self, yaml_path: Path) -> int:
        """计算 YAML 文件中的顶层 key 数量"""
        import yaml

        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if isinstance(data, dict):
                return len(data)
        except Exception:
            pass
        return 0

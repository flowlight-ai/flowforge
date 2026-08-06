"""Persona Auto-Inject — 将persona的SOUL/MEMORY/CREATION自动注入到prompt/参数中。

FWK-05: 消除Agent中硬编码的persona加载逻辑，通过声明式注入
自动将persona的SOUL/MEMORY/CREATION/约束条件注入到prompt和参数中。

Usage:
    from flowforge.core.persona_injector import PersonaInjector, PersonaContext

    injector = PersonaInjector()

    # 注入到prompt中
    prompt = "请根据以下信息创作文章\\n{{auto.persona}}"
    result = await injector.inject(prompt, persona_id="education")

    # 获取完整persona上下文
    context = await injector.get_persona_context("education")
    print(context.soul)

    # 注入到参数字典中
    params = {"topic": "AI趋势"}
    params = await injector.inject_params(params, persona_id="education")
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("persona_injector")

# 占位符模式
PERSONA_PLACEHOLDER = "{{auto.persona}}"


class PersonaContext(BaseModel):
    """Persona完整上下文。

    Attributes:
        persona_id: Persona标识符
        soul: SOUL风格描述
        memory: 历史记忆摘要
        creation: 创作偏好（序列化为YAML字符串）
        constraints: 约束条件
        style_profile: 风格画像
    """

    model_config = {"extra": "allow"}

    persona_id: str = Field(default="", description="Persona标识符")
    soul: str = Field(default="", description="SOUL风格描述")
    memory: str = Field(default="", description="历史记忆摘要")
    creation: str = Field(default="", description="创作偏好")
    constraints: str = Field(default="", description="约束条件")
    style_profile: dict = Field(default_factory=dict, description="风格画像")


class PersonaInjector:
    """Persona自动注入器 - 将persona的SOUL/MEMORY/CREATION自动注入到prompt/参数中。

    从persona YAML配置文件中加载persona信息，支持：
    1. 注入到prompt中的 {{auto.persona}} 占位符
    2. 获取完整的PersonaContext对象
    3. 将persona信息注入到参数字典中
    """

    # 类变量：通过Plugin协议注册的persona目录和直接注册的persona数据
    # 所有PersonaInjector实例共享，避免每次实例化时丢失注册信息
    _persona_dirs: list[str] = []
    _registered_personas: dict[str, dict] = {}

    def __init__(self, persona_repo: Any = None, prompt_manager: Any = None) -> None:
        self._persona_repo = persona_repo
        self._prompt_manager = prompt_manager
        self._cache: dict[str, PersonaContext] = {}
        self._workspace_root: Path | None = None

    def _get_workspace_root(self) -> Path:
        """获取workspace根目录。"""
        if self._workspace_root is not None:
            return self._workspace_root
        # flowforge/core/persona_injector.py -> flowforge/ -> openclaw/
        self._workspace_root = Path(__file__).parent.parent.parent
        return self._workspace_root

    async def inject(
        self,
        prompt: str,
        persona_id: str,
        sections: list[str] | None = None,
    ) -> str:
        """将persona信息注入到prompt中。

        支持三种占位符格式：
        1. {{auto.persona}} — 整体注入格式化persona上下文
        2. {soul} {memory} {creation} {constraints} — 单字段占位符(单花括号)
        3. {soul_intro} — soul首句摘要(取soul按句号分割的第一段)

        未命中任何占位符时，在prompt末尾追加格式化persona上下文。

        Args:
            prompt: 原始提示词
            persona_id: persona标识
            sections: 要注入的部分，默认全部 ["soul", "memory", "creation", "constraints"]

        Returns:
            注入后的提示词
        """
        if not persona_id:
            return prompt

        context = await self.get_persona_context(persona_id)
        if not context.soul and not context.memory and not context.creation and not context.constraints:
            logger.debug(f"PersonaInjector: persona '{persona_id}' has no content to inject")
            return prompt

        sections = sections or ["soul", "memory", "creation", "constraints"]

        # 1. 替换 {{auto.persona}} 整体占位符
        injected_text = self._format_persona_context(context, sections)
        if PERSONA_PLACEHOLDER in prompt:
            prompt = prompt.replace(PERSONA_PLACEHOLDER, injected_text)

        # 2. 替换单字段占位符 {soul} {memory} {creation} {constraints} {soul_intro}
        # 这些占位符在 prompts.yaml 模板中广泛使用，必须在此处替换，
        # 否则 DeclarativeAgent._render_template_vars 会跳过它们（_PERSONA_VARS保留列表）
        single_vars = {
            "soul": context.soul,
            "memory": context.memory,
            "creation": context.creation if isinstance(context.creation, str) else "",
            "constraints": context.constraints,
        }
        # soul_intro: soul首句摘要(取soul按句号分割的第一段)
        if context.soul:
            single_vars["soul_intro"] = context.soul.split('。')[0] if '。' in context.soul else context.soul
        else:
            single_vars["soul_intro"] = "专业作者"

        replaced_any = False
        for var_name, value in single_vars.items():
            placeholder = "{" + var_name + "}"
            if placeholder in prompt:
                prompt = prompt.replace(placeholder, str(value) if value else "")
                replaced_any = True

        # 3. 如果没有任何占位符被替换，也没有 {{auto.persona}}，则在末尾追加
        if not replaced_any and PERSONA_PLACEHOLDER not in prompt:
            # 检查是否已经有注入的persona内容(避免重复追加)
            if "你的创作身份（SOUL）" not in prompt and "你的创作身份(SOUL)" not in prompt:
                prompt = prompt + "\n\n" + injected_text

        return prompt

    async def get_persona_context(self, persona_id: str) -> PersonaContext:
        """获取完整的persona上下文。

        优先从缓存获取，然后从直接注册的persona数据，再从persona_repo，
        最后从YAML文件加载。

        Args:
            persona_id: persona标识

        Returns:
            PersonaContext对象
        """
        if persona_id in self._cache:
            return self._cache[persona_id]

        # 优先使用直接注册的persona数据
        if persona_id in self._registered_personas:
            context = self._build_context_from_data(persona_id, self._registered_personas[persona_id])
            self._cache[persona_id] = context
            return context

        # 使用persona_repo（如果提供了的话）
        if self._persona_repo is not None:
            try:
                context = await self._load_from_repo(persona_id)
                if context is not None:
                    self._cache[persona_id] = context
                    return context
            except Exception as e:
                logger.warning(f"PersonaInjector: failed to load from repo: {e}")

        # 从YAML文件加载
        context = self._load_from_yaml(persona_id)
        self._cache[persona_id] = context
        return context

    async def inject_params(self, params: dict, persona_id: str) -> dict:
        """将persona信息注入到参数字典中。

        在params中添加 persona_context 字段，包含完整的PersonaContext。

        Args:
            params: 原始参数字典
            persona_id: persona标识

        Returns:
            注入后的参数字典
        """
        if not persona_id:
            return params

        context = await self.get_persona_context(persona_id)
        result = dict(params)
        result["persona_id"] = persona_id
        result["persona_context"] = context.model_dump()
        if context.soul:
            result["style_profile"] = {
                "soul": context.soul,
                "memory": context.memory,
                "creation": context.creation,
            }
        return result

    def clear_cache(self, persona_id: str | None = None) -> None:
        """清除缓存。

        Args:
            persona_id: 指定清除某个persona的缓存，None则清除全部
        """
        if persona_id:
            self._cache.pop(persona_id, None)
        else:
            self._cache.clear()

    def register_persona_dir(self, dir_path: str) -> None:
        """注册一个persona配置目录，允许通过Plugin协议注入。

        注册的目录将在加载persona时被搜索。路径可以是绝对路径
        或相对于workspace根目录的相对路径。

        Args:
            dir_path: persona配置目录路径
        """
        if dir_path not in self._persona_dirs:
            self._persona_dirs.append(dir_path)
            logger.info(f"PersonaInjector: registered persona dir '{dir_path}'")

    def register_persona(self, persona_id: str, persona_data: dict) -> None:
        """直接注册一个persona，无需YAML文件。

        允许通过Plugin协议直接注入persona数据，优先级高于YAML文件。

        Args:
            persona_id: persona标识
            persona_data: persona数据字典，包含soul/memory/creation等字段
        """
        self._registered_personas[persona_id] = persona_data
        # 清除该persona的缓存，确保下次获取时使用新数据
        self._cache.pop(persona_id, None)
        logger.info(f"PersonaInjector: registered persona '{persona_id}' directly")

    async def _load_from_repo(self, persona_id: str) -> PersonaContext | None:
        """从persona_repo加载persona信息。"""
        if not hasattr(self._persona_repo, "get_persona"):
            return None
        data = await self._persona_repo.get_persona(persona_id)
        if data is None:
            return None
        return self._build_context_from_data(persona_id, data)

    def _load_from_yaml(self, persona_id: str) -> PersonaContext:
        """从YAML配置文件加载persona信息。

        搜索通过Plugin协议注册的persona目录，查找匹配的YAML文件。
        如果没有注册任何目录，返回空的PersonaContext并记录警告。
        """
        workspace_root = self._get_workspace_root()

        # 仅使用通过Plugin协议注册的目录
        search_dirs = list(self._persona_dirs)

        if not search_dirs:
            logger.warning(
                f"PersonaInjector: no persona dirs registered via register_persona_dir(), "
                f"persona '{persona_id}' cannot be loaded from YAML. "
                f"Please call register_persona_dir() during plugin initialization."
            )

        for persona_dir in search_dirs:
            dir_path = Path(persona_dir)
            if not dir_path.is_absolute():
                dir_path = workspace_root / persona_dir
            if not dir_path.is_dir():
                continue

            # 尝试多种文件名格式
            candidates = [
                dir_path / f"{persona_id}.yaml",
                dir_path / f"{persona_id}.yml",
            ]

            for yaml_path in candidates:
                if yaml_path.is_file():
                    try:
                        with open(yaml_path, encoding="utf-8") as f:
                            data = yaml.safe_load(f) or {}
                        context = self._build_context_from_data(persona_id, data)
                        logger.debug(f"PersonaInjector: loaded persona '{persona_id}' from {yaml_path}")
                        return context
                    except Exception as e:
                        logger.warning(f"PersonaInjector: failed to load {yaml_path}: {e}")

        logger.debug(f"PersonaInjector: persona '{persona_id}' not found in any config dir")
        return PersonaContext(persona_id=persona_id)

    def _build_context_from_data(self, persona_id: str, data: dict) -> PersonaContext:
        """从原始数据构建PersonaContext。

        支持两种YAML格式：
        1. 扁平格式（contentforge风格）：soul, memory, creation 直接在顶层
        2. 嵌套格式（novelforge风格）：persona.style 等嵌套结构
        """
        # 处理嵌套格式（如 novelforge 的 persona: 前缀）
        if "persona" in data and isinstance(data["persona"], dict):
            inner = data["persona"]
            data = {**data, **inner}

        soul = data.get("soul", "")
        memory = data.get("memory", "")
        creation = data.get("creation", "")

        # creation 可能是字典（如 education.yaml 中的 writing_methods 等）
        if isinstance(creation, dict):
            creation = yaml.dump(creation, allow_unicode=True, default_flow_style=False)
        elif not isinstance(creation, str):
            creation = str(creation) if creation else ""

        # 提取约束条件
        constraints = self._extract_constraints(data)

        # 构建风格画像
        style_profile: dict[str, Any] = {}
        if "style" in data and isinstance(data["style"], dict):
            style_profile = data["style"]
        if soul or memory or creation:
            style_profile.setdefault("soul", soul)
            style_profile.setdefault("memory", memory)
            style_profile.setdefault("creation", creation)

        return PersonaContext(
            persona_id=persona_id,
            soul=soul,
            memory=memory,
            creation=creation,
            constraints=constraints,
            style_profile=style_profile,
        )

    @staticmethod
    def _extract_constraints(data: dict) -> str:
        """从persona数据中提取约束条件。

        从 creation.compliance_rules、creation.required_elements 等字段提取。
        """
        parts: list[str] = []

        creation = data.get("creation", {})
        if isinstance(creation, dict):
            compliance_rules = creation.get("compliance_rules", [])
            if compliance_rules:
                parts.append("合规规则：\n" + "\n".join(f"- {r}" for r in compliance_rules))

            required_elements = creation.get("required_elements", [])
            if required_elements:
                parts.append("必要元素：\n" + "\n".join(f"- {r}" for r in required_elements))

            regional_rules = creation.get("regional_rules", [])
            if regional_rules:
                parts.append("地域规则：\n" + "\n".join(f"- {r}" for r in regional_rules))

        # 顶层 constraints 字段
        top_constraints = data.get("constraints", [])
        if isinstance(top_constraints, list) and top_constraints:
            parts.append("约束条件：\n" + "\n".join(f"- {c}" for c in top_constraints))
        elif isinstance(top_constraints, str) and top_constraints:
            parts.append(top_constraints)

        return "\n\n".join(parts)

    @staticmethod
    def _format_persona_context(context: PersonaContext, sections: list[str]) -> str:
        """将PersonaContext格式化为可注入的文本。

        Args:
            context: Persona上下文
            sections: 要包含的部分

        Returns:
            格式化后的文本
        """
        parts: list[str] = []

        section_map: dict[str, tuple[str, str]] = {
            "soul": ("你的创作身份（SOUL）", context.soul),
            "memory": ("创作记忆", context.memory),
            "creation": ("创作偏好", context.creation),
            "constraints": ("约束条件", context.constraints),
        }

        for section_key in sections:
            if section_key in section_map:
                title, content = section_map[section_key]
                if content and content.strip():
                    parts.append(f"## {title}\n{content}")

        return "\n\n".join(parts) if parts else ""

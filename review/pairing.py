"""Reviewer 配对规则 — 从 clowder-ai 移植的跨模型评审配对机制。

核心规则：
1. 跨 family 优先（如 DeepSeek 写的代码用 GLM 审查）
2. 必须有 peer-reviewer 角色
3. 必须 available
4. 优先 lead
5. 优先活跃 agent

降级策略：
- 无跨 family reviewer → 同 family 不同个体 → 用户

铁律：同一个体不能 review 自己的代码。
"""
from __future__ import annotations

from flowforge.core.tracing import get_logger
from flowforge.review.models import ReviewerInfo

logger = get_logger("review.pairing")

# 模型名 → family 关键词映射（按优先级排序，先匹配先返回）
# 覆盖 flowforge 已有 provider：DoubaoProvider, QwenProvider, DeepSeekProvider
# 以及 OpenRoute 可能路由到的所有模型
_FAMILY_KEYWORDS: list[tuple[str, str]] = [
    ("deepseek", "deepseek"),
    ("doubao", "doubao"),
    ("ark", "doubao"),  # 豆包走 ark 平台
    ("豆包", "doubao"),
    ("qwen", "qwen"),
    ("tongyi", "qwen"),
    ("通义", "qwen"),
    ("glm", "glm"),
    ("chatglm", "glm"),
    ("zhipu", "glm"),
    ("智谱", "glm"),
    ("kimi", "kimi"),
    ("moonshot", "kimi"),
    ("trae", "trae"),
    ("gpt", "openai"),
    ("openai", "openai"),
    ("o1-", "openai"),
    ("o3-", "openai"),
    ("o4-", "openai"),
    ("claude", "anthropic"),
    ("anthropic", "anthropic"),
    ("gemini", "google"),
    ("gemma", "google"),
    ("llama", "meta"),
    ("hermes", "nous"),
    ("nemotron", "nvidia"),
    ("mistral", "mistral"),
    ("yi-", "yi"),
    ("baichuan", "baichuan"),
    ("ernie", "baidu"),
    ("wenxin", "baidu"),
    ("hunyuan", "tencent"),
    ("spark", "iflytek"),
    ("gemini", "google"),
]

# 默认 family（无法识别时）
_DEFAULT_FAMILY = "unknown"


class ReviewerPairing:
    """Reviewer 配对规则（从 clowder-ai 移植）。

    动态匹配规则：
    1. 跨 family 优先（如 DeepSeek 写的代码用 GLM 审查）
    2. 必须有 peer-reviewer 角色
    3. 必须 available
    4. 优先 lead
    5. 优先活跃 agent

    降级：无跨 family reviewer → 同 family 不同个体 → 用户

    铁律：同一个体不能 review 自己的代码。
    """

    def __init__(self) -> None:
        self._reviewers: list[ReviewerInfo] = []

    def register_reviewer(self, reviewer: ReviewerInfo) -> None:
        """注册 reviewer。如果 agent_name 已存在则更新。"""
        for i, existing in enumerate(self._reviewers):
            if existing.agent_name == reviewer.agent_name:
                self._reviewers[i] = reviewer
                logger.info(
                    f"register_reviewer: updated existing reviewer "
                    f"agent={reviewer.agent_name!r} model={reviewer.model_name!r} "
                    f"family={reviewer.model_family!r}"
                )
                return
        self._reviewers.append(reviewer)
        logger.info(
            f"register_reviewer: registered reviewer "
            f"agent={reviewer.agent_name!r} model={reviewer.model_name!r} "
            f"family={reviewer.model_family!r} role={reviewer.role!r}"
        )

    def find_reviewer(
        self, author_model: str, author_agent: str
    ) -> ReviewerInfo | None:
        """为指定的作者找到合适的 reviewer。

        铁律：同一个体不能 review 自己的代码。
        匹配优先级：
        1. 跨 family + peer_reviewer + available + lead + active
        2. 跨 family + peer_reviewer + available + active
        3. 同 family 不同个体 + peer_reviewer + available
        4. 任何 available 的 reviewer（不同个体）

        Args:
            author_model: 作者使用的模型名
            author_agent: 作者 agent 名

        Returns:
            匹配的 ReviewerInfo，无匹配则返回 None
        """
        author_family = self.get_model_family(author_model)
        logger.debug(
            f"find_reviewer: enter author_model={author_model!r} "
            f"author_agent={author_agent!r} author_family={author_family!r} "
            f"pool_size={len(self._reviewers)}"
        )

        # 过滤掉不可用的和同一个体
        candidates = [
            r
            for r in self._reviewers
            if r.available
            and r.model_name != author_model  # 铁律：不同模型
            and r.agent_name != author_agent  # 铁律：不同 agent
        ]

        if not candidates:
            logger.warning(
                f"find_reviewer: no available reviewers "
                f"(author={author_agent!r} model={author_model!r})"
            )
            return None

        # 按优先级分层匹配
        # 层 1：跨 family + peer_reviewer + lead + active
        layer1 = [
            r
            for r in candidates
            if r.model_family != author_family
            and r.role == "peer_reviewer"
            and r.role == "lead"
            and r.active
        ]
        if layer1:
            chosen = layer1[0]
            logger.info(
                f"find_reviewer: matched layer1(cross_family+peer+lead+active) "
                f"reviewer={chosen.agent_name!r} model={chosen.model_name!r}"
            )
            return chosen

        # 层 2：跨 family + peer_reviewer + active
        layer2 = [
            r
            for r in candidates
            if r.model_family != author_family
            and r.role == "peer_reviewer"
            and r.active
        ]
        if layer2:
            chosen = layer2[0]
            logger.info(
                f"find_reviewer: matched layer2(cross_family+peer+active) "
                f"reviewer={chosen.agent_name!r} model={chosen.model_name!r}"
            )
            return chosen

        # 层 3：同 family 不同个体 + peer_reviewer + available
        layer3 = [
            r
            for r in candidates
            if r.model_family == author_family
            and r.role == "peer_reviewer"
        ]
        if layer3:
            chosen = layer3[0]
            logger.info(
                f"find_reviewer: matched layer3(same_family_diff_individual+peer) "
                f"reviewer={chosen.agent_name!r} model={chosen.model_name!r}"
            )
            return chosen

        # 层 4：任何 available 的 reviewer（不同个体）— 降级
        chosen = candidates[0]
        logger.info(
            f"find_reviewer: matched layer4(fallback_any_available) "
            f"reviewer={chosen.agent_name!r} model={chosen.model_name!r}"
        )
        return chosen

    def get_model_family(self, model_name: str) -> str:
        """根据模型名推断 family。

        使用大小写不敏感的关键词匹配。覆盖 flowforge 已有 provider
        和 OpenRoute 可能路由到的所有主流模型。

        Args:
            model_name: 模型名（如 'DeepSeek-V4-Pro', 'glm-4-plus'）

        Returns:
            family 字符串（如 'deepseek', 'glm'）
        """
        if not model_name:
            return _DEFAULT_FAMILY

        lower = model_name.lower()
        for keyword, family in _FAMILY_KEYWORDS:
            if keyword in lower:
                return family

        logger.debug(
            f"get_model_family: unknown model={model_name!r} -> {_DEFAULT_FAMILY!r}"
        )
        return _DEFAULT_FAMILY

    def is_cross_family(
        self, author_model: str, reviewer_model: str
    ) -> bool:
        """检查是否跨 family。

        Args:
            author_model: 作者模型名
            reviewer_model: 评审者模型名

        Returns:
            True 表示跨 family（不同家族），False 表示同 family
        """
        author_family = self.get_model_family(author_model)
        reviewer_family = self.get_model_family(reviewer_model)
        cross = author_family != reviewer_family
        logger.debug(
            f"is_cross_family: author={author_model!r}({author_family!r}) "
            f"reviewer={reviewer_model!r}({reviewer_family!r}) -> {cross}"
        )
        return cross

    @property
    def reviewers(self) -> list[ReviewerInfo]:
        """已注册的 reviewer 列表（只读副本）。"""
        return list(self._reviewers)

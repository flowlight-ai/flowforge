"""Feature doc truth 核对.

FlowForge merge-gate SKILL Step 7.5 的 Feature Doc Truth 核对方法论：
- Pre-merge: 核对 doc 没撒谎（声称完成的有代码支撑，严防"糖衣包装未做"）
- Post-merge: 记录已合入状态（Phase ✅ + AC 打勾 + Timeline）

为什么在 merge-gate 而不是 feat-lifecycle close：
一个 Feature 拆 N 个 Phase/PR，如果等 close 才核对/更新文档，
中间所有 session 冷启动读到的都是过时甚至说谎的状态。
每次 merge 都是一次"代码现实 ↔ feature doc"对账。

设计原则（遵守铁律）：
- 不硬编码路径（铁律5）：feature_doc_path 通过参数传入
- 不直接操作数据库（铁律4）：通过文件读写
- 仅依赖 flowforge.core.tracing，单向依赖
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.vcs.feature_truth")


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class TruthResult(BaseModel):
    """Pre-merge Feature Doc Truth 核对结果.

    Attributes:
        is_truthful: doc 是否说真话（声称完成的有代码支撑）
        feature_id: 提取到的 F{NNN} feature ID（无则空）
        claimed_phases: doc 中标 ✅ 的 Phase 列表
        claimed_acs: doc 中打勾 [x] 的 AC 列表
        discrepancies: 声称 vs 代码现实的差异列表
        warnings: 警告列表
    """

    is_truthful: bool = Field(description="doc 是否说真话")
    feature_id: str = Field(default="", description="F{NNN} feature ID")
    claimed_phases: list[str] = Field(
        default_factory=list, description="doc 中标 ✅ 的 Phase"
    )
    claimed_acs: list[str] = Field(
        default_factory=list, description="doc 中打勾的 AC"
    )
    discrepancies: list[str] = Field(
        default_factory=list, description="声称 vs 代码现实差异"
    )
    warnings: list[str] = Field(default_factory=list, description="警告列表")


# ---------------------------------------------------------------------------
# FeatureTruthChecker
# ---------------------------------------------------------------------------


class FeatureTruthChecker:
    """Feature doc truth 核对.

    FlowForge Feature Doc Truth 核对方法论：
    - Pre-merge: 核对 doc 没撒谎（声称完成的有代码支撑）
    - Post-merge: 记录已合入状态（Phase ✅ + AC 打勾 + Timeline）

    机械兜底（check-feature-truth.mjs 等价物）：
    硬拦明显矛盾 — Status 仍是 pre-development（spec/design/idea/draft/spike）
    但 Timeline 已有 merged PR 且无 reopen 标记。
    机器只抓这一类零歧义 drift，不替你判 AC/Phase 语义。

    Usage:
        checker = FeatureTruthChecker()
        # Pre-merge
        result = checker.check_pre_merge("docs/features/F123-xxx.md", ["src/a.py"])
        if not result.is_truthful:
            print("doc 撒谎:", result.discrepancies)
        # Post-merge
        checker.update_post_merge("docs/features/F123-xxx.md", pr_number=456, phase="Phase 1")
    """

    # F{NNN} feature ID 正则
    _FEATURE_ID_PATTERN = re.compile(r"\bF(\d{3,})\b")

    # Phase 标记为完成的模式（✅）
    _PHASE_DONE_PATTERN = re.compile(r"([-*]\s*.*Phase\s+\d+.*?)✅")

    # AC 打勾模式（[x]）
    _AC_CHECKED_PATTERN = re.compile(r"[-*]\s*\[x\]\s*(.+)", re.IGNORECASE)

    # Status 行模式
    _STATUS_PATTERN = re.compile(r"^\s*[Ss]tatus\s*[:：]\s*(.+)$", re.MULTILINE)

    # Timeline merged 记录模式
    _TIMELINE_MERGED_PATTERN = re.compile(
        r"merged.*PR\s*#?(\d+)", re.IGNORECASE
    )

    # pre-development 状态值（表示尚未开始实现）
    _PRE_DEV_STATUSES = {
        "spec", "design", "idea", "draft", "spike",
        "pre-development", "not-started",
    }

    def __init__(self) -> None:
        """初始化 FeatureTruthChecker."""
        pass

    def extract_feature_id(
        self, pr_title: str = "", branch: str = ""
    ) -> Optional[str]:
        """从 PR title/branch 提取 F{NNN} feature ID.

        对应 SKILL Step 7.5a Step 1：识别 Feature。
        无 Feature ID → 跳过（纯 TD/hotfix 不需要）。

        Args:
            pr_title: PR 标题
            branch: 分支名

        Returns:
            F{NNN} 格式的 feature ID（如 "F123"），无则 None
        """
        # 先从 PR title 查找
        if pr_title:
            match = self._FEATURE_ID_PATTERN.search(pr_title)
            if match:
                fid = f"F{match.group(1)}"
                logger.debug(f"extract_feature_id: found {fid} in PR title")
                return fid

        # 再从 branch 查找
        if branch:
            match = self._FEATURE_ID_PATTERN.search(branch)
            if match:
                fid = f"F{match.group(1)}"
                logger.debug(f"extract_feature_id: found {fid} in branch")
                return fid

        logger.debug("extract_feature_id: no F{NNN} found")
        return None

    def check_pre_merge(
        self,
        feature_doc_path: str,
        pr_changes: Optional[list[str]] = None,
    ) -> TruthResult:
        """Pre-merge 核对：doc 声称 vs 代码现实.

        对应 SKILL Step 7.5a：
        1. 识别 Feature（从 doc 文件名提取 F{NNN}）
        2. 声称 vs 代码现实（人工语义层机器判不了，但机械兜底可抓 drift）
        3. 机械兜底：硬拦明显矛盾（Status 仍是 pre-development 但 Timeline 有 merged）
        4. 核对不过 → 先修 doc 再 merge

        注意：AC/Phase 语义核对是人工检查（SKILL 明确说"语义层机器判不了"），
        此方法只做机械兜底 + 收集 doc 声称的 Phase/AC 供人工核对。

        Args:
            feature_doc_path: feature doc 文件路径
            pr_changes: 本 PR 变更的文件列表（用于辅助判断，机器不做语义比对）

        Returns:
            TruthResult 核对结果
        """
        path = Path(feature_doc_path)
        logger.info(f"check_pre_merge: doc={path}")

        if not path.exists():
            return TruthResult(
                is_truthful=False,
                feature_id="",
                discrepancies=[f"feature doc 不存在: {path}"],
                warnings=["无法核对不存在的 doc"],
            )

        content = path.read_text(encoding="utf-8", errors="replace")

        # 从文件名提取 feature ID
        feature_id = self.extract_feature_id(pr_title=path.name) or ""

        # 收集 doc 声称已完成的 Phase（✅ 标记）
        claimed_phases = [
            m.group(1).strip()
            for m in self._PHASE_DONE_PATTERN.finditer(content)
        ]

        # 收集 doc 打勾的 AC（[x] 标记）
        claimed_acs = [
            m.group(1).strip()
            for m in self._AC_CHECKED_PATTERN.finditer(content)
        ]

        # 机械兜底：Status 仍是 pre-development 但 Timeline 有 merged 记录
        discrepancies: list[str] = []
        warnings: list[str] = []

        status_match = self._STATUS_PATTERN.search(content)
        status_value = status_match.group(1).strip().lower() if status_match else ""

        has_merged_timeline = bool(self._TIMELINE_MERGED_PATTERN.search(content))

        if status_value in self._PRE_DEV_STATUSES and has_merged_timeline:
            discrepancies.append(
                f"机械兜底拦截：Status='{status_value}'（pre-development）"
                f"但 Timeline 已有 merged PR 记录 — status↔timeline drift"
            )

        # 提示人工核对项（语义层机器判不了）
        if claimed_phases:
            warnings.append(
                f"人工核对：doc 标 ✅ 的 Phase {claimed_phases} "
                f"需要有代码支撑（严防'糖衣包装未做'）"
            )
        if claimed_acs:
            warnings.append(
                f"人工核对：doc 打勾的 AC {claimed_acs} "
                f"需要有代码支撑"
            )

        is_truthful = len(discrepancies) == 0
        result = TruthResult(
            is_truthful=is_truthful,
            feature_id=feature_id,
            claimed_phases=claimed_phases,
            claimed_acs=claimed_acs,
            discrepancies=discrepancies,
            warnings=warnings,
        )
        logger.info(
            f"check_pre_merge: is_truthful={is_truthful} "
            f"feature_id={feature_id} "
            f"phases={len(claimed_phases)} acs={len(claimed_acs)} "
            f"discrepancies={len(discrepancies)}"
        )
        return result

    def update_post_merge(
        self,
        feature_doc_path: str,
        pr_number: int,
        phase: str,
    ) -> None:
        """Post-merge 更新：Phase ✅ + AC 打勾 + Timeline.

        对应 SKILL Step 7.5b：在 main 上把这个 PR 带来的增量写进 feature doc：
        1. Phase 状态：本 PR 对应的 Phase 标记从 📋/🚧 → ✅
        2. Timeline：加一行 merged 记录
        3. Status 行：第一个 Phase 完成 spec → in-progress

        ⚠️ 此方法修改 feature doc 文件。调用方应确保在持有 main 的 worktree
        中执行（SKILL 7.5b 落点说明）。

        Args:
            feature_doc_path: feature doc 文件路径
            pr_number: PR 编号
            phase: 本 PR 对应的 Phase 名称（如 "Phase 1"）

        Raises:
            FileNotFoundError: feature doc 不存在
        """
        path = Path(feature_doc_path)
        logger.info(
            f"update_post_merge: doc={path} pr={pr_number} phase={phase}"
        )

        if not path.exists():
            raise FileNotFoundError(
                f"feature doc 不存在: {path}. "
                f"确保在持有 main 的 worktree 中执行（SKILL 7.5b 落点说明）。"
            )

        content = path.read_text(encoding="utf-8", errors="replace")
        today = datetime.utcnow().strftime("%Y-%m-%d")

        # 1. Phase 标记从 📋/🚧 → ✅
        # 匹配包含 phase 名称且带 📋 或 🚧 的行
        phase_pattern = re.compile(
            rf"([-*]\s*.*{re.escape(phase)}.*?)(📋|🚧)"
        )
        content = phase_pattern.sub(r"\1✅", content)

        # 2. Timeline 加一行 merged 记录
        timeline_entry = f"| {today} | {phase} merged (PR #{pr_number}) |"
        timeline_section_pattern = re.compile(
            r"(##\s*Timeline\s*\n)",
            re.IGNORECASE,
        )
        timeline_match = timeline_section_pattern.search(content)
        if timeline_match:
            # 在 Timeline 标题后插入
            insert_pos = timeline_match.end()
            content = (
                content[:insert_pos]
                + timeline_entry
                + "\n"
                + content[insert_pos:]
            )
        else:
            # 无 Timeline section，追加到文件末尾
            content += f"\n## Timeline\n{timeline_entry}\n"

        # 3. Status 行：第一个 Phase 完成 spec → in-progress
        status_match = self._STATUS_PATTERN.search(content)
        if status_match:
            status_value = status_match.group(1).strip().lower()
            if status_value in self._PRE_DEV_STATUSES:
                content = self._STATUS_PATTERN.sub(
                    f"Status: in-progress", content
                )

        path.write_text(content, encoding="utf-8")
        logger.info(
            f"update_post_merge: updated {path.name} — "
            f"Phase {phase} → ✅, Timeline +merged PR #{pr_number}"
        )

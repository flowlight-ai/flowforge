"""FlowForge SOP 执行引擎 — 多智能体自开发方法论的阶段门禁系统。

SOP（Standard Operating Procedure）执行引擎是 FlowForge 的核心组件之一，
用于管控多智能体自开发方法论的阶段流转。从 clowder-ai 移植并适配 Python/flowforge 框架。

核心概念：
- SOPDefinition: 一个完整的标准作业流程（如 7 阶段开发 SOP）
- SOPStage: SOP 中的单个阶段（kickoff / impl / review / merge 等）
- HardRule: 阶段的硬规则（blocker 未通过则阻断）
- Pitfall: 阶段的陷阱警告（常见错误提醒）
- PredicateConfig: 谓词配置（描述如何检查一条规则）
- PredicateResult: 谓词检查结果
- SOPExecutor: SOP 执行器（门禁检查与阶段推进）
- PredicateChecker: 谓词检查器（按 type 路由到对应检查函数）

与 LoopExecutor 的协作：
- SOPExecutor 管控阶段门禁（hard_rules / pitfalls）
- LoopExecutor 管控阶段内的实际任务执行
- SOPExecutor 在每个阶段开始前检查 hard_rules，通过后才允许 LoopExecutor 执行
- 阶段完成后 SOPExecutor 推进到下一阶段

设计原则（遵守铁律）：
- SOPExecutor 只做门禁检查和阶段推进，不直接执行任务（铁律3：组合优于继承）
- 不直接操作数据库（铁律4），状态由 CheckpointManager 持久化
- 不硬编码路径/密钥（铁律5），所有配置从 YAML 加载
- 所有 I/O 操作使用 async/await
"""

from flowforge.sop.models import (
    HardRule,
    Pitfall,
    PredicateConfig,
    PredicateResult,
    PredicateType,
    Severity,
    SOPDefinition,
    SOPExecutionResult,
    SOPExecutionState,
    SOPStage,
    SOPStageResult,
)
from flowforge.sop.predicate import (
    PredicateChecker,
    check_command_pattern,
    check_command_sequence,
    check_env,
    check_feature_doc_readiness,
    check_git_state,
    check_handle,
    check_manual_only,
    check_sha_dedup,
)
from flowforge.sop.engine import (
    SOPExecutor,
    load_sop_from_yaml,
    load_sops_from_dir,
)

__all__ = [
    # models
    "HardRule",
    "Pitfall",
    "PredicateConfig",
    "PredicateResult",
    "PredicateType",
    "Severity",
    "SOPDefinition",
    "SOPExecutionResult",
    "SOPExecutionState",
    "SOPStage",
    "SOPStageResult",
    # predicate
    "PredicateChecker",
    "check_command_pattern",
    "check_command_sequence",
    "check_env",
    "check_feature_doc_readiness",
    "check_git_state",
    "check_handle",
    "check_manual_only",
    "check_sha_dedup",
    # engine
    "SOPExecutor",
    "load_sop_from_yaml",
    "load_sops_from_dir",
]

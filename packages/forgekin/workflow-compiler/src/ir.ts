/**
 * @flowforge/forgekin-workflow-compiler — 工作流 IR（中间表示）数据结构
 *
 * IR 是 YAML 和执行图之间的中间层，解耦解析与代码生成（对齐 Python `compiler/ir.py`）。
 * MVP1 支持 SEQUENCE 顺序执行；MVP2 支持 CONDITIONAL 条件分支；
 * MVP3 支持 PARALLEL / FALLBACK / LOOP。
 */

/** 步骤类型（对齐 Python StepType(str, Enum)） */
export type StepType =
  | 'agent'
  | 'tool'
  | 'gate'
  | 'parallel'
  | 'conditional'
  | 'fallback'
  | 'loop'
  | 'error_handler'
  | 'sub_workflow';

export const STEP_TYPES: readonly StepType[] = [
  'agent', 'tool', 'gate', 'parallel', 'conditional', 'fallback',
  'loop', 'error_handler', 'sub_workflow',
];

/** 是否为合法步骤类型 */
export function isStepType(value: unknown): value is StepType {
  return typeof value === 'string' && (STEP_TYPES as readonly string[]).includes(value);
}

/** IR 步骤节点（对齐 Python IRStep，pydantic extra=allow 语义 → 保留未知键） */
export interface IRStep {
  readonly id: string;
  readonly name: string;
  readonly type: StepType;
  readonly agent: string | undefined;
  readonly tool: string | undefined;
  readonly inputMapping: Record<string, string>;
  readonly outputKey: string | undefined;
  readonly executionPolicy: Record<string, unknown>;
  readonly checkpoint: Record<string, unknown>;
  /** MVP2 条件分支字段 */
  readonly condition: string | undefined;
  readonly onTrue: string | undefined;
  readonly onFalse: string | undefined;
  /** PARALLEL: 并行子步骤 */
  readonly parallelSteps: IRStep[];
  /** FALLBACK: 主步骤与回退步骤 */
  readonly primary: IRStep[];
  readonly fallback: IRStep[];
  /** LOOP: 循环子步骤 */
  readonly loopSteps: IRStep[];
  readonly maxIterations: number;
  readonly exitCondition: string | undefined;
  readonly loopVariable: string | undefined;
  /** ERROR_HANDLER / LOOP: 子步骤 */
  readonly body: IRStep[] | undefined;
  /** SUB_WORKFLOW: 引用的 workflow 名称 */
  readonly workflowRef: string | undefined;
  /** ERROR_HANDLER: 错误处理步骤 */
  readonly onError: IRStep[] | undefined;
  /** pydantic extra=allow：未知字段透传 */
  readonly extra: Record<string, unknown>;
}

/** IR 工作流（对齐 Python IRWorkflow） */
export interface IRWorkflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly steps: IRStep[];
  readonly stateSchema: Record<string, unknown>;
  readonly executionPolicy: Record<string, unknown>;
  readonly checkpoint: Record<string, unknown>;
  readonly extra: Record<string, unknown>;
}

export interface MakeIRStepInit {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly type?: StepType | undefined;
  readonly agent?: string | undefined;
  readonly tool?: string | undefined;
  readonly inputMapping?: Record<string, string> | undefined;
  readonly outputKey?: string | undefined;
  readonly executionPolicy?: Record<string, unknown> | undefined;
  readonly checkpoint?: Record<string, unknown> | undefined;
  readonly condition?: string | undefined;
  readonly onTrue?: string | undefined;
  readonly onFalse?: string | undefined;
  readonly parallelSteps?: IRStep[] | undefined;
  readonly primary?: IRStep[] | undefined;
  readonly fallback?: IRStep[] | undefined;
  readonly loopSteps?: IRStep[] | undefined;
  readonly maxIterations?: number | undefined;
  readonly exitCondition?: string | undefined;
  readonly loopVariable?: string | undefined;
  readonly body?: IRStep[] | undefined;
  readonly workflowRef?: string | undefined;
  readonly onError?: IRStep[] | undefined;
  readonly extra?: Record<string, unknown> | undefined;
}

export function makeIRStep(init: MakeIRStepInit & { index?: number }): IRStep {
  const index = init.index ?? 0;
  return {
    id: init.id ?? `step_${index}`,
    name: init.name ?? `Step ${index}`,
    type: init.type ?? 'agent',
    agent: init.agent,
    tool: init.tool,
    inputMapping: init.inputMapping ?? {},
    outputKey: init.outputKey,
    executionPolicy: init.executionPolicy ?? {},
    checkpoint: init.checkpoint ?? {},
    condition: init.condition,
    onTrue: init.onTrue,
    onFalse: init.onFalse,
    parallelSteps: init.parallelSteps ?? [],
    primary: init.primary ?? [],
    fallback: init.fallback ?? [],
    loopSteps: init.loopSteps ?? [],
    maxIterations: init.maxIterations ?? 1,
    exitCondition: init.exitCondition,
    loopVariable: init.loopVariable,
    body: init.body,
    workflowRef: init.workflowRef,
    onError: init.onError,
    extra: init.extra ?? {},
  };
}

export interface MakeIRWorkflowInit {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly version?: string | undefined;
  readonly steps?: IRStep[] | undefined;
  readonly stateSchema?: Record<string, unknown> | undefined;
  readonly executionPolicy?: Record<string, unknown> | undefined;
  readonly checkpoint?: Record<string, unknown> | undefined;
  readonly extra?: Record<string, unknown> | undefined;
}

export function makeIRWorkflow(init: MakeIRWorkflowInit = {}): IRWorkflow {
  return {
    id: init.id ?? 'unnamed',
    name: init.name ?? 'Unnamed Workflow',
    description: init.description ?? '',
    version: init.version ?? '1.0',
    steps: init.steps ?? [],
    stateSchema: init.stateSchema ?? {},
    executionPolicy: init.executionPolicy ?? {},
    checkpoint: init.checkpoint ?? {},
    extra: init.extra ?? {},
  };
}

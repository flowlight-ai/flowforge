/**
 * @flowforge/forgekin-workflow-compiler — 工作流 YAML 解析器
 *
 * YAML → IRWorkflow 中间表示（对齐 Python `compiler/parser.py`）：
 * - MVP1 SEQUENCE 顺序执行
 * - MVP2 CONDITIONAL 条件分支（condition/on_true/on_false）
 * - MVP3 PARALLEL / FALLBACK / LOOP 递归子步骤
 * 非法 YAML / 非 mapping / 非法 step type → WorkflowCompileError(PARSE_ERROR)。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { WorkflowCompileError } from './errors.js';
import { IRStep, IRWorkflow, StepType, isStepType, makeIRStep, makeIRWorkflow } from './ir.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class WorkflowParser {
  /** 解析 YAML 字符串为 IRWorkflow */
  parse(yamlContent: string): IRWorkflow {
    let data: unknown;
    try {
      data = parseYaml(yamlContent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new WorkflowCompileError(`Invalid YAML: ${msg}`, 'PARSE_ERROR', [msg]);
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      const got = data === null ? 'null' : Array.isArray(data) ? 'list' : typeof data;
      throw new WorkflowCompileError(
        `Invalid YAML: expected mapping, got ${got}`,
        'PARSE_ERROR',
      );
    }
    return this.parseWorkflow(asRecord(data));
  }

  /** 解析 YAML 文件为 IRWorkflow */
  async parseFile(filePath: string): Promise<IRWorkflow> {
    const absPath = path.resolve(filePath);
    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Workflow YAML file not found: ${filePath}`);
      }
      throw e;
    }
    return this.parse(content);
  }

  /** 将原始字典解析为 IRWorkflow */
  parseWorkflow(data: Record<string, unknown>): IRWorkflow {
    const rawSteps = Array.isArray(data.steps) ? data.steps : [];
    const steps = rawSteps.map((s, i) => this.parseStep(asRecord(s), i));
    return makeIRWorkflow({
      id: typeof data.id === 'string' ? data.id : 'unnamed',
      name: typeof data.name === 'string' ? data.name : 'Unnamed Workflow',
      description: typeof data.description === 'string' ? data.description : '',
      version: String(data.version ?? '1.0'),
      steps,
      stateSchema: asRecord(data.state_schema),
      executionPolicy: asRecord(data.execution_policy),
      checkpoint: asRecord(data.checkpoint),
    });
  }

  /** 将原始字典解析为 IRStep */
  parseStep(stepData: Record<string, unknown>, index: number): IRStep {
    const rawType = stepData.type ?? 'agent';
    if (!isStepType(rawType)) {
      throw new WorkflowCompileError(
        `Step ${index}: invalid type ${JSON.stringify(rawType)}`,
        'PARSE_ERROR',
        [`Step ${index}: invalid type ${JSON.stringify(rawType)}`],
      );
    }
    let stepType: StepType = rawType;

    // MVP2: 有 condition 字段但未显式指定 type → 自动设为 CONDITIONAL
    const condition = typeof stepData.condition === 'string' ? stepData.condition : undefined;
    const onTrue = typeof stepData.on_true === 'string' ? stepData.on_true : undefined;
    const onFalse = typeof stepData.on_false === 'string' ? stepData.on_false : undefined;
    if (condition !== undefined && stepType !== 'conditional') {
      stepType = 'conditional';
    }

    // MVP3: 递归子步骤解析
    let parallelSteps: IRStep[] = [];
    if (stepType === 'parallel') {
      parallelSteps = (Array.isArray(stepData.parallel_steps) ? stepData.parallel_steps : [])
        .map((s, i) => this.parseStep(asRecord(s), i));
    }
    let primary: IRStep[] = [];
    let fallback: IRStep[] = [];
    if (stepType === 'fallback') {
      primary = (Array.isArray(stepData.primary) ? stepData.primary : [])
        .map((s, i) => this.parseStep(asRecord(s), i));
      fallback = (Array.isArray(stepData.fallback) ? stepData.fallback : [])
        .map((s, i) => this.parseStep(asRecord(s), i));
    }
    let loopSteps: IRStep[] = [];
    if (stepType === 'loop') {
      loopSteps = (Array.isArray(stepData.loop_steps) ? stepData.loop_steps : [])
        .map((s, i) => this.parseStep(asRecord(s), i));
    }

    return makeIRStep({
      id: typeof stepData.id === 'string' ? stepData.id : `step_${index}`,
      name: typeof stepData.name === 'string' ? stepData.name : `Step ${index}`,
      type: stepType,
      agent: typeof stepData.agent === 'string' ? stepData.agent : undefined,
      tool: typeof stepData.tool === 'string' ? stepData.tool : undefined,
      inputMapping: Object.fromEntries(Object.entries(asRecord(stepData.input_mapping)).map(([k, v]) => [k, String(v)])),
      outputKey: typeof stepData.output_key === 'string' ? stepData.output_key : undefined,
      executionPolicy: asRecord(stepData.execution_policy),
      checkpoint: asRecord(stepData.checkpoint),
      condition,
      onTrue,
      onFalse,
      parallelSteps,
      primary,
      fallback,
      loopSteps,
      maxIterations: typeof stepData.max_iterations === 'number' ? stepData.max_iterations : 1,
      exitCondition: typeof stepData.exit_condition === 'string' ? stepData.exit_condition : undefined,
      loopVariable: typeof stepData.loop_variable === 'string' ? stepData.loop_variable : undefined,
      body: Array.isArray(stepData.body) ? (stepData.body as unknown[]).map((s, i) => this.parseStep(asRecord(s), i)) : undefined,
      workflowRef: typeof stepData.workflow_ref === 'string' ? stepData.workflow_ref : undefined,
      onError: stepData.on_error === undefined ? undefined : Array.isArray(stepData.on_error)
        ? (stepData.on_error as unknown[]).map((s, i) => this.parseStep(asRecord(s), i))
        : undefined,
    });
  }
}

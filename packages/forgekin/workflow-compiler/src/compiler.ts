/**
 * @flowforge/forgekin-workflow-compiler — 工作流编译器主入口
 *
 * 三阶段编译器：YAML → Parser → IR → Validator → CodeGen → sop_steps
 * （对齐 Python `compiler/compiler.py` + `core/workflow_compiler.py` 向后兼容
 * CompiledWorkflow 对象）。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { SopStep, WorkflowCodeGen } from './codegen.js';
import { WorkflowCompileError } from './errors.js';
import { IRStep, IRWorkflow } from './ir.js';
import { WorkflowParser } from './parser.js';
import { WorkflowValidator } from './validator.js';

/** 编译产物：sop_steps（供 WorkflowExecutor 消费）+ ir（调试/二次处理） */
export interface WorkflowCompileResult {
  readonly sopSteps: SopStep[];
  readonly ir: IRWorkflow;
}

/** 向后兼容 CompiledWorkflow（对齐 Python core/workflow_compiler.py 同名类） */
export class CompiledWorkflow {
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly nodes: Record<string, unknown>;
  readonly edges: Array<Record<string, unknown>>;
  readonly entryPoint: string;
  readonly interruptBefore: string[];
  readonly stateConfig: unknown;
  readonly config: unknown;
  readonly sopSteps: SopStep[];
  readonly adjacency: Record<string, unknown>;

  constructor(init: {
    name: string;
    description?: string;
    version?: number;
    nodes?: Record<string, unknown>;
    edges?: Array<Record<string, unknown>>;
    entryPoint?: string;
    interruptBefore?: string[];
    stateConfig?: unknown;
    config?: unknown;
    sopSteps?: SopStep[];
    adjacency?: Record<string, unknown>;
  }) {
    this.name = init.name;
    this.description = init.description ?? '';
    this.version = init.version ?? 1.0;
    this.nodes = init.nodes ?? {};
    this.edges = init.edges ?? [];
    this.entryPoint = init.entryPoint ?? '';
    this.interruptBefore = init.interruptBefore ?? [];
    this.stateConfig = init.stateConfig;
    this.config = init.config;
    this.sopSteps = init.sopSteps ?? [];
    this.adjacency = init.adjacency ?? {};
  }
}

export class WorkflowCompiler {
  readonly parser: WorkflowParser;
  readonly validator: WorkflowValidator;
  readonly codegen: WorkflowCodeGen;

  constructor() {
    this.parser = new WorkflowParser();
    this.validator = new WorkflowValidator();
    this.codegen = new WorkflowCodeGen();
  }

  /** 编译 YAML 字符串为执行图 */
  compile(yamlContent: string): WorkflowCompileResult {
    const ir = this.parser.parse(yamlContent);
    const errors = this.validator.validate(ir);
    if (errors.length > 0) {
      throw new WorkflowCompileError(
        `Workflow validation failed: ${JSON.stringify(errors)}`,
        'VALIDATION_ERROR',
        errors,
      );
    }
    const sopSteps = this.codegen.generate(ir);
    return { sopSteps, ir };
  }

  /** 编译 YAML 文件为执行图 */
  async compileFile(filePath: string): Promise<WorkflowCompileResult> {
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
    return this.compile(content);
  }

  /** 编译为向后兼容的 CompiledWorkflow 对象（Python core 版本语义） */
  compileLegacy(yamlContent: string): CompiledWorkflow {
    const { sopSteps, ir } = this.compile(yamlContent);
    const entry = ir.steps[0]?.id ?? '';
    return new CompiledWorkflow({
      name: ir.name,
      description: ir.description,
      version: Number(ir.version) || 1.0,
      nodes: Object.fromEntries(ir.steps.map((s) => [s.id, this.stepToNode(s)])),
      edges: this.buildEdges(ir.steps),
      entryPoint: entry,
      interruptBefore: [],
      stateConfig: ir.stateSchema,
      config: ir.executionPolicy,
      sopSteps,
      adjacency: this.buildAdjacency(ir.steps),
    });
  }

  private stepToNode(step: IRStep): Record<string, unknown> {
    return {
      id: step.id,
      name: step.name,
      type: step.type,
      ...(step.agent !== undefined ? { agent: step.agent } : {}),
      ...(step.tool !== undefined ? { tool: step.tool } : {}),
      ...(step.outputKey !== undefined ? { output_key: step.outputKey } : {}),
      ...(step.condition !== undefined
        ? { condition: step.condition, on_true: step.onTrue, on_false: step.onFalse }
        : {}),
    };
  }

  private buildEdges(steps: IRStep[]): Array<Record<string, unknown>> {
    const edges: Array<Record<string, unknown>> = [];
    for (const step of steps) {
      if (step.onTrue !== undefined) {
        edges.push({ from: step.id, to: step.onTrue, label: 'true' });
      }
      if (step.onFalse !== undefined) {
        edges.push({ from: step.id, to: step.onFalse, label: 'false' });
      }
    }
    for (let i = 0; i + 1 < steps.length; i += 1) {
      const cur = steps[i];
      const next = steps[i + 1];
      if (cur !== undefined && next !== undefined && cur.onTrue === undefined && cur.onFalse === undefined) {
        edges.push({ from: cur.id, to: next.id, label: 'next' });
      }
    }
    return edges;
  }

  private buildAdjacency(steps: IRStep[]): Record<string, unknown> {
    const adjacency: Record<string, unknown> = {};
    for (const step of steps) {
      const outs: string[] = [];
      if (step.onTrue !== undefined) {
        outs.push(step.onTrue);
      }
      if (step.onFalse !== undefined) {
        outs.push(step.onFalse);
      }
      adjacency[step.id] = outs;
    }
    return adjacency;
  }
}

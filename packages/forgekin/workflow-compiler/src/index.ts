/**
 * @flowforge/forgekin-workflow-compiler — 阶段7 T7.8 工作流编译器域 Cordis 插件
 *
 * 挂载 `ctx.forgeWorkflowCompiler`：YAML 工作流 → 执行图三阶段编译
 * （Parser→Validator→CodeGen），含条件路由/字段门控。
 * 对齐 Python `compiler/*.py` + `core/workflow_compiler.py`。
 */
import { Context, Service } from '@flowforge/cordis';
import { WorkflowCodeGen } from './codegen.js';
import { WorkflowCompiler, WorkflowCompileResult } from './compiler.js';
import { WorkflowParser } from './parser.js';
import { WorkflowValidator } from './validator.js';

export * from './ir.js';
export * from './errors.js';
export * from './parser.js';
export * from './validator.js';
export * from './codegen.js';
export * from './compiler.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** 工作流编译器域：YAML → 执行图三阶段编译 */
    forgeWorkflowCompiler: WorkflowCompilerService;
  }
}

export class WorkflowCompilerService extends Service {
  readonly parser: WorkflowParser;
  readonly validator: WorkflowValidator;
  readonly codegen: WorkflowCodeGen;

  constructor(ctx: Context) {
    super(ctx, 'forgeWorkflowCompiler');
    this.parser = new WorkflowParser();
    this.validator = new WorkflowValidator();
    this.codegen = new WorkflowCodeGen();
  }

  /** 编译 YAML 字符串为执行图（sopSteps + ir） */
  compile(yamlContent: string): WorkflowCompileResult {
    return new WorkflowCompiler().compile(yamlContent);
  }

  /** 编译 YAML 文件为执行图 */
  compileFile(filePath: string): Promise<WorkflowCompileResult> {
    return new WorkflowCompiler().compileFile(filePath);
  }

  /** 编译为向后兼容的 CompiledWorkflow */
  compileLegacy(yamlContent: string): import('./compiler.js').CompiledWorkflow {
    return new WorkflowCompiler().compileLegacy(yamlContent);
  }

  /** 编译器快照（trace 日志） */
  snapshot(): { stages: string[]; stepTypes: string[] } {
    return {
      stages: ['parser', 'validator', 'codegen'],
      stepTypes: ['agent', 'tool', 'gate', 'parallel', 'conditional', 'fallback', 'loop', 'error_handler', 'sub_workflow'],
    };
  }
}

export default function Plugin(ctx: Context) {
  return ctx.plugin(WorkflowCompilerService);
}

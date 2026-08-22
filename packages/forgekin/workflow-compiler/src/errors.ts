/**
 * @flowforge/forgekin-workflow-compiler — 工作流编译器结构化异常
 *
 * 统一编译/解析/验证阶段的错误为 `WorkflowCompileError`，并通过
 * errorCode / errors / toDict() 暴露结构化错误信息（对齐 Python
 * `compiler/errors.py` P-97 结构化，errorCode ∈ PARSE_ERROR /
 * VALIDATION_ERROR / GENERATION_ERROR / COMPILE_ERROR）。
 */

export type WorkflowCompileErrorCode =
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'GENERATION_ERROR'
  | 'COMPILE_ERROR';

export class WorkflowCompileError extends Error {
  readonly errorCode: WorkflowCompileErrorCode;
  readonly errors: string[];

  constructor(message: string, errorCode: WorkflowCompileErrorCode = 'COMPILE_ERROR', errors: string[] = []) {
    super(message);
    this.name = 'WorkflowCompileError';
    this.errorCode = errorCode;
    this.errors = errors;
  }

  /** 转为结构化字典，供 API 错误响应直接使用（对齐 Python to_dict） */
  toDict(): { error: string; message: string; details: string[] } {
    return {
      error: this.errorCode,
      message: this.message,
      details: this.errors,
    };
  }
}

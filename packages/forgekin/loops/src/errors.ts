/**
 * loops 域异常定义（对齐 Python `evolution/self_dev_base.py` §2）。
 */

/** SelfDev 闭环基础异常 */
export class SelfDevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfDevError';
  }
}

/** 觉醒阶门控阻止（I1）— 当前可进化智能体觉醒阶低于闭环要求 */
export class AwakeningStageBlockedError extends SelfDevError {
  readonly loopType: string;
  readonly currentStage: string;
  readonly requiredStage: string;

  constructor(loopType: string, currentStage: string, requiredStage: string) {
    super(`觉醒阶门控阻止：${loopType} 闭环要求 ${requiredStage}，当前可进化智能体为 ${currentStage}`);
    this.name = 'AwakeningStageBlockedError';
    this.loopType = loopType;
    this.currentStage = currentStage;
    this.requiredStage = requiredStage;
  }
}

/** Scope Guard 前置检查阻止（I2）— 目标路径在受保护白名单中 */
export class ScopeGuardBlockedError extends SelfDevError {
  readonly targetPath: string;
  readonly reason: string;

  constructor(targetPath: string, reason = '') {
    super(`Scope Guard 阻止修改受保护路径：${targetPath}（${reason}）`);
    this.name = 'ScopeGuardBlockedError';
    this.targetPath = targetPath;
    this.reason = reason;
  }
}

/** 需要 operator 显式批准（I8）— Framework 闭环的 Act 操作必须 approval */
export class ApprovalRequiredError extends SelfDevError {
  readonly planId: string;
  readonly targetPath: string;

  constructor(planId: string, targetPath: string) {
    super(`Plan ${planId} 修改 ${targetPath} 需要 operator 显式批准`);
    this.name = 'ApprovalRequiredError';
    this.planId = planId;
    this.targetPath = targetPath;
  }
}

/** LLM 审核未通过（I4 / T7 铁律） */
export class LLMReviewFailedError extends SelfDevError {
  readonly contentType: string;
  readonly reason: string;

  constructor(contentType: string, reason: string) {
    super(`LLM 审核未通过（${contentType}）：${reason}`);
    this.name = 'LLMReviewFailedError';
    this.contentType = contentType;
    this.reason = reason;
  }
}

/** Reflect 重试次数耗尽（I3）— 超过上限仍未通过 Verify */
export class ReflectRetryExhaustedError extends SelfDevError {
  readonly taskId: string;
  readonly attempts: number;

  constructor(taskId: string, attempts: number) {
    super(`Task ${taskId} Reflect 重试 ${attempts} 次仍未通过 Verify`);
    this.name = 'ReflectRetryExhaustedError';
    this.taskId = taskId;
    this.attempts = attempts;
  }
}

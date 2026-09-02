/**
 * F255 模板边界 — Present Loop 归属 cat-life settings（F255），
 * 不可作为 pack delegate 安装为原始调度任务。
 *
 * 移植自 clowder-ai `infrastructure/scheduler/f255-template-boundary.ts`。
 */

export const F255_PRESENT_LOOP_TEMPLATE_ID = 'present-loop';

/** Present Loop builtin 引用判定。 */
export function isF255PresentLoopBuiltinRef(builtinTemplateRef: string): boolean {
  return builtinTemplateRef === F255_PRESENT_LOOP_TEMPLATE_ID;
}

interface PackTemplateLookup {
  get(templateId: string): { builtinTemplateRef: string } | null;
}

/** 模板是否为 F255 config-only（Present Loop 本体或其 pack delegate）。 */
export function isF255ConfigOnlyTemplate(templateId: string, packTemplateStore?: PackTemplateLookup): boolean {
  if (templateId === F255_PRESENT_LOOP_TEMPLATE_ID) return true;
  const packTemplate = packTemplateStore?.get(templateId);
  return !!packTemplate && isF255PresentLoopBuiltinRef(packTemplate.builtinTemplateRef);
}

/** F255 config-required 错误载荷。 */
export function f255ConfigRequired() {
  return {
    error: 'Present Loop is configured from the cat home in /starry, not as a raw schedule task',
    code: 'F255_CONFIG_REQUIRED',
  } as const;
}

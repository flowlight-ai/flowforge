/**
 * cron 槽位计算（TS 移植自 clowder-ai `infrastructure/scheduler/cron-utils.ts`）。
 *
 * 依赖 cron-parser（R19 对齐 clowder 依赖清单）。
 *
 * 边界竞态背景（computeNextCronSlot 存在的原因）：TaskRunnerV2 用 setTimeout 链
 * 调度 cron tick，`.finally` 重排下一 tick。setTimeout 内部用单调钟，但
 * getNextCronMs 从墙钟 Date.now() 计算延迟。墙钟在等待窗口内被回调（NTP 步退、
 * VM 暂停恢复、容器时钟漂移）时，回调会在墙钟时间**早于**目标 cron 槽位触发，
 * 普通 `parsed.next()` 会把**同一**槽位再返回一次——同一 cron 窗口内重复触发。
 * 传入 lastFiredSlotMs 可确定性地跳过已触发槽位。
 */

import { CronExpressionParser } from 'cron-parser';

/** 计算距离 cron 表达式下次触发的毫秒数（对齐 getNextCronMs） */
export function getNextCronMs(expression: string, timezone?: string): number {
  const options: Record<string, unknown> = { currentDate: new Date() };
  if (timezone) options.tz = timezone;
  const parsed = CronExpressionParser.parse(expression, options);
  const next = parsed.next().toDate();
  return Math.max(1, next.getTime() - Date.now());
}

/**
 * 计算严格晚于 lastFiredSlotMs（如提供）的下一次 cron 触发的绝对 epoch-ms。
 *
 * @throws 表达式非法或推进迭代超限时抛出
 */
export function computeNextCronSlot(
  expression: string,
  timezone: string | undefined,
  now: number,
  lastFiredSlotMs: number | undefined,
): number {
  const options: Record<string, unknown> = { currentDate: new Date(now) };
  if (timezone) options.tz = timezone;
  const parsed = CronExpressionParser.parse(expression, options);
  let nextMs = parsed.next().toDate().getTime();
  // 边界竞态守卫：推进越过已触发槽位。
  // 迭代上限防失控（lastFiredSlotMs 为脏的远期值时）。分钟级 cron 1440 次 = 1 天槽位。
  const MAX_ADVANCE_ITERATIONS = 1440;
  let iterations = 0;
  while (lastFiredSlotMs !== undefined && nextMs <= lastFiredSlotMs) {
    if (++iterations >= MAX_ADVANCE_ITERATIONS) {
      throw new Error(
        `computeNextCronSlot: exceeded ${MAX_ADVANCE_ITERATIONS} iterations advancing past lastFiredSlotMs=${lastFiredSlotMs} (now=${now}, expression=${expression}). Possible dirty future timestamp.`,
      );
    }
    nextMs = parsed.next().toDate().getTime();
  }
  return nextMs;
}

/**
 * 统计已选定槽位之后、实际触发时刻之前到期的额外 cron 槽位数。
 * 这是 `merge_late_one` 的记账数字：调度器为 scheduledSlotMs 触发一次补偿运行，
 * 该计数记录被合并进同一次运行的后续槽位数（而非逐个重放）。
 */
export function countAdditionalDueCronSlots(
  expression: string,
  timezone: string | undefined,
  scheduledSlotMs: number,
  firedMs: number,
): number {
  if (firedMs <= scheduledSlotMs) return 0;
  const options: Record<string, unknown> = { currentDate: new Date(scheduledSlotMs) };
  if (timezone) options.tz = timezone;
  const parsed = CronExpressionParser.parse(expression, options);
  const MAX_MISSED_SLOTS = 1440;
  let count = 0;
  for (let i = 0; i < MAX_MISSED_SLOTS; i++) {
    const nextMs = parsed.next().toDate().getTime();
    if (nextMs > firedMs) return count;
    count++;
  }
  return count;
}

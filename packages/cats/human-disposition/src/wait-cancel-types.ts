/**
 * @flowforge/cats-human-disposition — F280 wait termination 事件（F281 adapter 消费）。
 *
 * TS 移植自 clowder-ai `packages/shared/src/types/wait-termination.ts`：
 * canonical wait termination event + user-cancel 子类型（actor 必须匹配 owner）。
 *
 * @module @flowforge/cats-human-disposition/wait-cancel-types
 */

import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const referenceSchema = z.string().trim().min(1).max(500);
const ownerIdentitySchema = z.string().trim().min(1).max(120);

export const waitTerminationReasonSchema = z.enum([
  'matched',
  'subject_terminal',
  'expired',
  'owner_changed',
  'superseded',
  'user_cancel',
]);

export const waitTerminationActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('system') }).strict(),
  z.object({ kind: z.literal('cat'), catId: ownerIdentitySchema, invocationId: identifierSchema }).strict(),
  z.object({ kind: z.literal('user'), userId: ownerIdentitySchema }).strict(),
]);

const waitTerminationEventShape = {
  v: z.literal(1),
  eventId: referenceSchema,
  kind: z.literal('wait.terminated'),
  waitId: identifierSchema,
  waitKind: z.enum(['hold_ball', 'github_pr', 'github_issue', 'managed_command', 'timer']),
  generation: z.number().int().positive(),
  subjectRef: referenceSchema,
  threadId: identifierSchema,
  ownerUserId: ownerIdentitySchema,
  ownerCatId: ownerIdentitySchema,
  reason: waitTerminationReasonSchema,
  actor: waitTerminationActorSchema,
  at: z.number().finite().nonnegative(),
};

export const waitTerminationEventSchema = z.object(waitTerminationEventShape).strict();

export const userCancelWaitTerminationEventSchema = z
  .object({
    ...waitTerminationEventShape,
    waitKind: z.literal('hold_ball'),
    reason: z.literal('user_cancel'),
    actor: z.object({ kind: z.literal('user'), userId: ownerIdentitySchema }).strict(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.actor.userId !== event.ownerUserId) {
      context.addIssue({
        code: 'custom',
        message: 'user cancel actor must match the authenticated wait owner',
        path: ['actor', 'userId'],
      });
    }
  });

export type WaitTerminationReason = z.infer<typeof waitTerminationReasonSchema>;
export type WaitTerminationActor = z.infer<typeof waitTerminationActorSchema>;
export type WaitTerminationEventV1 = z.infer<typeof waitTerminationEventSchema>;
export type UserCancelWaitTerminationEventV1 = z.infer<typeof userCancelWaitTerminationEventSchema>;

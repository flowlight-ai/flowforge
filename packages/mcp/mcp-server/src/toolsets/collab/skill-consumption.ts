/**
 * collab/skill-consumption toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/skill-consumption-tools.ts`. Three handlers all
 * converge on callback routes:
 *   - prepare: POST `/api/callbacks/skill-consumption/prepare`
 *   - open:    POST `/api/workspace/navigate` (skillConsumptionHandle + path + open)
 *   - dismiss: POST `/api/callbacks/skill-consumption/dismiss`
 * Resource family `skill-consumption-receipt`, private callback-owner auth.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const preparedHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .describe('Opaque revision- and invocation-bound handle returned by cat_cafe_prepare_skill_consumption.');

const prepareSkillConsumptionInputSchema = {
  skillId: z
    .literal('workspace-navigator')
    .describe('Pilot skill package whose current revision will be bound to the Workspace navigation consumer.'),
};

const dismissSkillConsumptionInputSchema = {
  handle: preparedHandleSchema,
  reason: z
    .enum(['alternate_native_shortcut', 'outside_skill_scope'])
    .describe('Bounded Workspace consumer decision explaining why the prepared skill was not applied.'),
};

const openWithWorkspaceNavigatorInputSchema = {
  handle: preparedHandleSchema,
  path: z
    .string()
    .min(1)
    .describe('Codex-native absolute file path, or a repo-relative file path when worktreeId is provided.'),
  worktreeId: z
    .string()
    .min(1)
    .optional()
    .describe('Target worktree id for repo-relative paths; omit when path is absolute.'),
  line: z.number().int().min(1).optional().describe('Optional 1-based line number to focus after opening the file.'),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe('Current Clowder AI thread id; omit to use the thread bound to invocation auth.'),
};

export const SKILL_CONSUMPTION_SERVER_FAMILY = 'collab' as const;
const ADMISSION = 'file:docs/architecture/skill-consumption-receipt-contract.md' as const;

export function buildSkillConsumptionToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SKILL_CONSUMPTION_SERVER_FAMILY, [
    {
      name: 'cat_cafe_prepare_skill_consumption',
      description:
        'Prepare an opaque handle binding the current workspace-navigator package revision to this exact invocation and its declared Workspace consumer. ' +
        'Use after fully reading that skill and before either opening a file through cat_cafe_open_with_workspace_navigator or dismissing it. ' +
        'NOT for recording applied/dismissed, selecting skills, proving task success, or preparing any unlisted skill family. ' +
        'Output: a short-lived prepared handle and revision coordinate; preparation is not a consumption receipt. ' +
        'GOTCHA: the handle or later receipt does not prove the package was read; agent-key and readonly/desktop carriers are unsupported because they cannot prove the same invocation.',
      action: 'derive',
      risk: { level: 'read', openWorld: false },
      inputSchema: prepareSkillConsumptionInputSchema,
      resourceFamily: 'skill-consumption-receipt',
      runtimeProfiles: ['full'],
      admissionRef: ADMISSION,
      sourceExport: 'handlePrepareSkillConsumption',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/skill-consumption/prepare',
        bodyKeys: ['skillId'],
      },
    },
    {
      name: 'cat_cafe_open_with_workspace_navigator',
      description:
        'Open one file through the existing Workspace navigation consumer while consuming a prepared workspace-navigator revision in the same invocation. ' +
        'Use only after cat_cafe_prepare_skill_consumption returned the handle and the resolved target is a file that should be opened. ' +
        'NOT for directories/reveal, preparing or dismissing consumption, scoring the skill, or claiming task success. ' +
        'Output: the Workspace deliveryStatus plus one revision-bound applied receipt whose outcome is limited to that delivery decision. ' +
        'GOTCHA: queued, blocked, and unconfirmed remain applied-to-consumer outcomes but do not prove the user saw the file; agent-key/readonly/desktop carriers are unsupported.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: openWithWorkspaceNavigatorInputSchema,
      resourceFamily: 'skill-consumption-receipt',
      runtimeProfiles: ['full'],
      admissionRef: ADMISSION,
      sourceExport: 'handleOpenWithWorkspaceNavigator',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/workspace/navigate',
        bodyKeys: ['handle', 'path', 'worktreeId', 'line', 'threadId'],
      },
    },
    {
      name: 'cat_cafe_dismiss_skill_consumption',
      description:
        'Record a revision-bound dismissed receipt for a prepared workspace-navigator skill in the same authenticated invocation and Workspace consumer. ' +
        'Use when the prepared skill is not applicable or the consumer chooses its native shortcut instead. ' +
        'NOT for recording applied (only cat_cafe_open_with_workspace_navigator may do that), scoring skill quality, or claiming task success. ' +
        'Output: one content-free dismissed receipt with a bounded not_applicable consumer decision. ' +
        'GOTCHA: agent-key and readonly/desktop carriers are unsupported; stale package revisions and replayed handles fail closed.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: dismissSkillConsumptionInputSchema,
      resourceFamily: 'skill-consumption-receipt',
      runtimeProfiles: ['full'],
      admissionRef: ADMISSION,
      sourceExport: 'handleDismissSkillConsumption',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/skill-consumption/dismiss',
        bodyKeys: ['handle', 'reason'],
      },
    },
  ]);
}
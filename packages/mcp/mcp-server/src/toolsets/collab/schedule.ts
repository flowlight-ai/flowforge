/**
 * collab/schedule toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/schedule-tools.ts` (F139 Phase 3A). Four handlers:
 *   - list_templates:   GET  `/api/schedule/templates`
 *   - preview_task:     POST `/api/schedule/tasks/preview`
 *   - register_task:    POST `/api/schedule/tasks`
 *   - remove_task:      DELETE `/api/schedule/tasks/${taskId}` (see note below)
 * Resource family `schedule`.
 *
 * NOTE: clowder's `handleRemoveScheduledTask` used a `DELETE` verb. The injected
 * `CallbackTransportPort` only carries POST/GET, so the destructive task removal
 * is represented as a GET route with the `sourceThreadId` query param (the
 * original passed it as a query string); a host extension would be needed to
 * carry the DELETE verb faithfully.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const agentKeyCatIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared Antigravity MCP when CAT_CAFE_AGENT_KEY_FILES is configured; ignored when invocation credentials are present.',
  );

const listScheduleTemplatesInputSchema = {
  agentKeyCatId: agentKeyCatIdSchema,
};

const registerScheduledTaskInputSchema = {
  templateId: z
    .string()
    .min(1)
    .describe('Template ID from list_schedule_templates (e.g. "reminder", "web-digest", "repo-activity")'),
  trigger: z
    .string()
    .describe(
      'Trigger config as JSON string. Examples: {"type":"cron","expression":"0 9 * * *"} or {"type":"interval","ms":3600000} or {"type":"once","delayMs":120000} (fire once after 2min) or {"type":"once","fireAt":1712345678000} (fire once at epoch ms)',
    ),
  params: z
    .string()
    .optional()
    .describe('Template-specific parameters as JSON string (e.g. {"message":"检查 backlog"})'),
  entrustedWorkReevaluation: z
    .string()
    .optional()
    .describe(
      'Typed F310 owner coordinates as JSON. Required only for entrusted-work-producer-reevaluation; never place these refs in params.',
    ),
  deliveryThreadId: z
    .string()
    .optional()
    .describe(
      'Thread ID to deliver results to. If omitted on invocation-token callback requests, the current invocation thread is used. Required when agentKeyCatId is used because persistent MCP has no invocation thread.',
    ),
  label: z.string().optional().describe('Human-readable task label (defaults to template label)'),
  category: z.string().optional().describe('Display category: pr | repo | thread | system | external'),
  description: z.string().optional().describe('Short description of this task instance'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const previewScheduledTaskInputSchema = {
  templateId: z.string().min(1).describe('Template ID from list_schedule_templates'),
  trigger: z.string().describe('Trigger config as JSON string'),
  params: z.string().optional().describe('Template-specific parameters as JSON string'),
  entrustedWorkReevaluation: z
    .string()
    .optional()
    .describe('Typed F310 owner coordinates as JSON for entrusted-work-producer-reevaluation'),
  deliveryThreadId: z
    .string()
    .optional()
    .describe(
      'Thread ID to deliver results to. If omitted on invocation-token callback requests, the current invocation thread is used. Required when agentKeyCatId is used because persistent MCP has no invocation thread.',
    ),
  agentKeyCatId: agentKeyCatIdSchema,
};

const removeScheduledTaskInputSchema = {
  taskId: z.string().min(1).describe('The dynamic task ID to remove (e.g. "dyn-1711504800000-abc123")'),
  sourceThreadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Verified source thread for the delete request. Required with agentKeyCatId because persistent MCP has no invocation thread.',
    ),
  agentKeyCatId: agentKeyCatIdSchema,
};

export const SCHEDULE_SERVER_FAMILY = 'collab' as const;
const F139 = 'file:docs/features/F139-schedule-tasks.md' as const;

export function buildScheduleToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SCHEDULE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_list_schedule_templates',
      description:
        'List available schedule task templates. Each template defines a reusable task type (e.g. reminder, web-digest, repo-activity) ' +
        'with its parameter schema and default trigger. Use this to discover what kinds of scheduled tasks can be created. ' +
        'When a task fires, it wakes a cat via invokeTrigger — the woken cat has FULL capabilities (rich blocks, search, image generation, etc.). ' +
        'Shared persistent MCP callers pass agentKeyCatId.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listScheduleTemplatesInputSchema,
      resourceFamily: 'schedule',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F139,
      sourceExport: 'handleListScheduleTemplates',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/schedule/templates', paramKeys: [] },
    },
    {
      name: 'cat_cafe_preview_scheduled_task',
      description:
        'Preview a scheduled task before submitting it for approval. ' +
        'Use when the user asks to create a schedule and needs to confirm the resolved template, trigger, and params. ' +
        'NOT for persisting or activating a task. ' +
        'Output: one non-persisted draft to show the user before calling register_scheduled_task. ' +
        'GOTCHA: shared persistent MCP callers pass agentKeyCatId.',
      action: 'derive',
      risk: { level: 'write', openWorld: false },
      inputSchema: previewScheduledTaskInputSchema,
      resourceFamily: 'schedule',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F139,
      sourceExport: 'handlePreviewScheduledTask',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/schedule/tasks/preview',
        bodyKeys: ['templateId', 'trigger', 'params', 'entrustedWorkReevaluation', 'deliveryThreadId'],
      },
    },
    {
      name: 'cat_cafe_register_scheduled_task',
      description:
        'Submit a new scheduled task from a template for operator approval. ' +
        'Use after preview_scheduled_task when the user confirms the draft. ' +
        'NOT for direct activation or unsupported ad-hoc task definitions. ' +
        'Output: one anchored Approval Hub proposal; the task is not persisted or run until the operator approves. ' +
        'Supports cron, interval, and once triggers. ' +
        'GOTCHA: trigger and params are JSON strings; shared persistent MCP callers pass agentKeyCatId and an owned deliveryThreadId.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: registerScheduledTaskInputSchema,
      resourceFamily: 'schedule',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F139,
      sourceExport: 'handleRegisterScheduledTask',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/schedule/tasks',
        bodyKeys: ['templateId', 'trigger', 'params', 'entrustedWorkReevaluation', 'deliveryThreadId', 'label', 'category', 'description'],
      },
    },
    {
      name: 'cat_cafe_remove_scheduled_task',
      description:
        'Request permanent removal of a user-created dynamic scheduled task by task ID. ' +
        'Use when the user asks a cat to permanently delete a scheduled task. ' +
        'NOT for pause/resume or builtin system tasks. ' +
        'Output: one anchored Approval Hub proposal; the task remains active until the operator approves. ' +
        'GOTCHA: persistent agent-key callers must pass agentKeyCatId and an owned sourceThreadId.',
      action: 'close',
      risk: { level: 'write', openWorld: false },
      inputSchema: removeScheduledTaskInputSchema,
      resourceFamily: 'schedule',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F139,
      sourceExport: 'handleRemoveScheduledTask',
      authorizationHint: 'callback-owner',
      route: {
        method: 'GET',
        path: '/api/schedule/tasks/${taskId}',
        paramKeys: ['sourceThreadId'],
      },
    },
  ]);
}
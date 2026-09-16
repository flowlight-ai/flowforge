/**
 * memory/library-lifecycle toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/library-lifecycle-tools.ts` (F188 Phase I AC-I4).
 * Six tools: library_list / library_dry_run / library_create / library_rebuild /
 * library_archive / library_verify. Resource family `library`.
 *
 * NOTE(E2b memory): the source handlers issue direct `fetch` calls (list is a GET
 * against the catalog; the mutation endpoints are POST). All are represented via
 * the injected transport as synthesized POST/GET routes. `library_create` also
 * triggers an internal rebuild — a host-layer side effect not carried by the ported
 * route. `library_list`'s `status` filter is applied client-side in the source and
 * is therefore not forwarded as a query param.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const libraryListInputSchema = {
  status: z
    .enum(['registered', 'indexing', 'active', 'stale', 'blocked', 'archived'])
    .optional()
    .describe('Filter by collection status. Omit = all statuses.'),
};

const libraryDryRunInputSchema = {
  root: z.string().describe('Absolute path to the directory to scan.'),
  exclude: z.array(z.string()).optional().describe('Glob patterns to exclude from scan.'),
};

const libraryCreateInputSchema = {
  kind: z.enum(['project', 'world', 'domain', 'research', 'global']).describe('Collection kind.'),
  name: z.string().describe('Short lowercase name (e.g. "finance"). Used in collection ID as <kind>:<name>.'),
  displayName: z.string().describe('Human-readable name shown in UI.'),
  root: z
    .string()
    .optional()
    .describe('Absolute path to bind. Omit for managed vault (auto-created under ~/.cat-cafe/library/sources/).'),
  sensitivity: z
    .enum(['public', 'internal', 'private', 'restricted'])
    .optional()
    .describe('Access level (default: private).'),
  exclude: z.array(z.string()).optional().describe('Glob patterns to exclude from indexing.'),
};

const libraryRebuildInputSchema = {
  collectionId: z.string().describe('Collection ID (e.g. "domain:finance").'),
  force: z.boolean().optional().describe('Force full rebuild even if no changes detected.'),
};

const libraryArchiveInputSchema = {
  collectionId: z.string().describe('Collection ID to archive (e.g. "domain:finance").'),
};

const libraryVerifyInputSchema = {
  anchor: z.string().min(1).describe('The document anchor to act on (e.g. F188, LL-029).'),
  action: z
    .enum(['confirm', 'mark_stale', 'escalate', 'dismiss_review'])
    .describe(
      'confirm: mark as reviewed (needs_review→reviewed). mark_stale: reset to needs_review. escalate: flag for human attention. dismiss_review: clear review_status.',
    ),
  actor: z.string().min(1).describe('Who is performing this action (cat ID or human identifier).'),
};

export const LIBRARY_LIFECYCLE_SERVER_FAMILY = 'memory' as const;
const F188 = 'file:docs/features/F188-library-stewardship.md' as const;

export function buildLibraryLifecycleToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, LIBRARY_LIFECYCLE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_library_list',
      description: [
        'List all registered collections with status, document count, sensitivity.',
        'Use when: discovering available knowledge collections, checking health/status.',
        'Optional status filter: registered/indexing/active/stale/blocked/archived.',
        '',
        'v1 limitation (KD-8): no collection scoping. Sees all localhost-owned collections.',
      ].join('\n'),
      action: 'command',
      risk: { level: 'read', openWorld: false },
      inputSchema: libraryListInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryList',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/library/catalog', paramKeys: [] },
    },
    {
      name: 'cat_cafe_library_dry_run',
      description: [
        'Scan a directory and report what would be indexed (file count, size, secrets, scanner level).',
        'Use BEFORE cat_cafe_library_create to preview what a collection bind would include.',
        'Does NOT persist anything — safe to run multiple times.',
      ].join('\n'),
      action: 'command',
      risk: { level: 'read', openWorld: false },
      inputSchema: libraryDryRunInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryDryRun',
      authorizationHint: 'read-only',
      route: {
        method: 'POST',
        path: '/api/library/bind-dry-run',
        bodyKeys: ['root', 'exclude'],
      },
    },
    {
      name: 'cat_cafe_library_create',
      description: [
        'Create a new collection. Two modes:',
        '  1. Bind existing dir: provide root path (e.g. ~/docs/finance)',
        '  2. Managed vault: omit root — auto-creates under ~/.cat-cafe/library/sources/',
        'Collection ID auto-derived as <kind>:<name>.',
        'After creation, run cat_cafe_library_rebuild to populate the index.',
      ].join('\n'),
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: libraryCreateInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryCreate',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/library/register',
        bodyKeys: ['kind', 'name', 'displayName', 'root', 'sensitivity', 'exclude'],
      },
    },
    {
      name: 'cat_cafe_library_rebuild',
      description: [
        'Rebuild the index for a collection — scans root directory for new/changed/deleted files.',
        'Use after: creating a collection, adding files to a bound directory.',
        'Incremental by default; use force=true for full rebuild.',
      ].join('\n'),
      action: 'command',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: libraryRebuildInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryRebuild',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/library/${collectionId}/rebuild',
        bodyKeys: ['force'],
      },
    },
    {
      name: 'cat_cafe_library_archive',
      description: [
        'Archive a collection — removes it from search/routing but preserves data.',
        'Archived collections are excluded from getRoutable and search results.',
        'Can be unarchived later via the REST API (POST /api/library/:id/unarchive).',
      ].join('\n'),
      action: 'command',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: libraryArchiveInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryArchive',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/library/${collectionId}/archive',
        bodyKeys: [],
      },
    },
    {
      name: 'cat_cafe_library_verify',
      description: [
        'Execute a verification action on a document: confirm, mark_stale, escalate, or dismiss_review.',
        'Use when: reviewing documents flagged by the verification migration or health report.',
        'Preconditions enforced: e.g. confirm only works on needs_review docs.',
      ].join('\n'),
      action: 'command',
      risk: { level: 'read', openWorld: false },
      inputSchema: libraryVerifyInputSchema,
      resourceFamily: 'library',
      runtimeProfiles: ['full'],
      admissionRef: F188,
      sourceExport: 'handleLibraryVerify',
      authorizationHint: 'read-only',
      route: {
        method: 'POST',
        path: '/api/f163/verification/action',
        bodyKeys: ['anchor', 'action', 'actor'],
      },
    },
  ]);
}
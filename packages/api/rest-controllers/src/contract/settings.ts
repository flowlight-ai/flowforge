/**
 * Settings family contracts/types + schema (self-built CRUD feline).
 *
 * clowder api has no standalone settings controller; this is a self-contained
 * read/write/validate contract that the host binds to a real settings/credential
 * store in EP2. Values are JSON-safe scalars/objects; every write is validated
 * against an injected validator before commit.
 */

import { z } from 'zod';

export type SettingsScope = 'user' | 'global' | 'workspace';

export interface SettingsRecord {
  key: string;
  scope: SettingsScope;
  value: unknown;
  updatedBy: string;
  updatedAt: number;
  version: number;
}

/** Read model returned by the settings controller. */
export interface SettingsReadResult {
  key: string;
  scope: SettingsScope;
  value: unknown;
  source: 'stored' | 'default';
}

/** Cursor-shaped envelope returned by the controller (testable, host-agnostic). */
export interface SettingsEnvelope {
  settings: SettingsReadResult[];
  totalMatches: number;
  truncated: boolean;
}

export const settingsWriteBodySchema = z.object({
  key: z.string().min(1).max(200),
  scope: z.enum(['user', 'global', 'workspace']).default('user'),
  value: z.unknown(),
});

export const VALID_SETTINGS_SCOPES: SettingsScope[] = ['user', 'global', 'workspace'];
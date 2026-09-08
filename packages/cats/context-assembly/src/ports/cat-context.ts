/**
 * Cat context port (self-contained).
 *
 * Injectable seam over the host's cat registry / config loader / dossier /
 * prompt-pipeline. Consumed by SystemPromptBuilder, ContextAssembler.getSenderName
 * and StagingContent. EP2 wires the real host implementations; tests supply a
 * `MemoryCatContext` satisfying the contract.
 */

import type { CatConfig, ReviewPolicy, Roster } from '@flowforge/cats-shared';

export interface CatRosterPort {
  getRoster(): Roster;
  isCatLead(catId: string): boolean;
  catHasRole(catId: string, role: string): boolean;
}

export interface CatDossierPort {
  getL0Pronouns(catId: string, rootDir: string): string | null;
  getRosterSummary(catId: string, rootDir: string): string | null;
  hasEntry(catId: string, rootDir: string): boolean;
}

export interface CatPromptPipelinePort {
  buildStaticIdentity(
    catId: string,
    options?: { mcpAvailable?: boolean | undefined },
  ): string;
  buildInvocationContext(ctx: Record<string, unknown>): string;
}

export interface CatContextPort {
  getConfig(catId: string): CatConfig | undefined;
  getAllConfigs(): Record<string, CatConfig>;
  isCatAvailable(catId: string): boolean;
  roster: CatRosterPort;
  reviewPolicy: ReviewPolicy;
  /** env → registry → default resolution for a cat's runtime model (F167). */
  resolvedModel(catId: string): string;
  dossier: CatDossierPort;
  rootDir: string;
  promptPipeline: CatPromptPipelinePort;
}

/**
 * In-memory contract implementation used by vitest (real store, no mocks).
 */
export class MemoryCatContext implements CatContextPort {
  private configs: Record<string, CatConfig> = {};
  private available = new Set<string>();
  reviewPolicy: ReviewPolicy = {
    excludeUnavailable: false,
    requireDifferentFamily: false,
    preferActiveInThread: false,
    preferLead: false,
  };
  rootDir = '.';
  roster: CatRosterPort = { getRoster: () => ({}), isCatLead: () => false, catHasRole: () => false };
  dossier: CatDossierPort = {
    getL0Pronouns: () => null,
    getRosterSummary: () => null,
    hasEntry: () => false,
  };
  promptPipeline: CatPromptPipelinePort = {
    buildStaticIdentity: (catId) => catId,
    buildInvocationContext: () => '',
  };

  constructor(
    configs: Record<string, CatConfig> = {},
    opts: Partial<{ rootDir: string; reviewPolicy: ReviewPolicy; resolvedModels: Record<string, string> }> = {},
  ) {
    this.configs = configs;
    if (opts.rootDir !== undefined) this.rootDir = opts.rootDir;
    if (opts.reviewPolicy !== undefined) this.reviewPolicy = opts.reviewPolicy;
    this.available = new Set(Object.keys(configs));
    const resolved = opts.resolvedModels ?? {};
    this.resolvedModelFn = (catId) => resolved[catId] ?? this.getConfig(catId)?.defaultModel ?? '';
  }

  private resolvedModelFn: (catId: string) => string = () => '';

  getConfig(catId: string): CatConfig | undefined {
    return this.configs[catId];
  }

  getAllConfigs(): Record<string, CatConfig> {
    return { ...this.configs };
  }

  isCatAvailable(catId: string): boolean {
    return this.available.has(catId);
  }

  resolvedModel(catId: string): string {
    return this.resolvedModelFn(catId);
  }

  withRoster(roster: CatRosterPort): this {
    this.roster = roster;
    return this;
  }

  withDossier(dossier: CatDossierPort): this {
    this.dossier = dossier;
    return this;
  }

  withPromptPipeline(pipeline: CatPromptPipelinePort): this {
    this.promptPipeline = pipeline;
    return this;
  }
}
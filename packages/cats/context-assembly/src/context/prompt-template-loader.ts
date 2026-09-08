/**
 * Prompt template loader (self-contained port of clowder
 * `prompt-template-loader.ts`, F237 Checkpoint B+C).
 *
 * Loads prompt-injection segments from external template files instead of inline
 * TypeScript constants. Supports simple `{{VAR}}` substitution and `.local`
 * overlay files. All file access goes through the injected `FileSystemSeam`
 * (EP2 wires the host's assets/prompt-templates + `.cat-cafe` overlay dirs; tests
 * inject the in-memory implementation). Workflow-trigger YAML is parsed with the
 * local lightweight `simple-yaml` subset instead of the `yaml` dependency.
 */

import type { FileSystemSeam } from '../ports/file-system.ts';
import { parseSimpleYamlMap } from '../pure/simple-yaml.ts';

export function templateDir(fileSystem: FileSystemSeam): string {
  return `${fileSystem.rootDir}/assets/prompt-templates`.replace(/\/+/g, '/');
}

export function overlayDir(fileSystem: FileSystemSeam): string {
  return `${fileSystem.rootDir}/.cat-cafe/prompt-overlays`.replace(/\/+/g, '/');
}

function templatePath(fileSystem: FileSystemSeam, filename: string): string {
  return `${templateDir(fileSystem)}/${filename}`;
}

function overlayPath(fileSystem: FileSystemSeam, filename: string): string {
  return `${overlayDir(fileSystem)}/${filename}`;
}

/** Resolve the effective file, checking .local overlay first. */
function resolveWithOverlay(
  fileSystem: FileSystemSeam,
  base: string,
  localSuffix: string,
): { path: string; isOverride: boolean } {
  const localPath = overlayPath(fileSystem, localSuffix);
  if (fileSystem.existsSync(localPath)) {
    return { path: localPath, isOverride: true };
  }
  return { path: templatePath(fileSystem, base), isOverride: false };
}

/** Replace `{{KEY}}` placeholders; unresolved placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const resolved = vars[key];
    return resolved !== undefined ? resolved : match;
  });
}

/** Strip HTML comment lines (authoring annotations, not injected). */
export function stripComments(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('<!--'))
    .join('\n')
    .trim();
}

/**
 * Load per-breed workflow triggers (allowLocalOverride: true).
 * Returns Record<string, string> keyed by breedId.
 */
export function loadWorkflowTriggers(fileSystem: FileSystemSeam): Record<string, string> {
  const { path: filePath, isOverride } = resolveWithOverlay(
    fileSystem,
    'workflow-triggers.yaml',
    'workflow-triggers.local.yaml',
  );
  const raw = fileSystem.readFileSync(filePath);
  if (raw === null) {
    if (isOverride) return {};
    return {};
  }
  const result: Record<string, string> = {};
  for (const [breed, content] of Object.entries(parseSimpleYamlMap(raw))) {
    result[breed] = content.trimEnd();
  }
  return result;
}

/**
 * Load MCP tools section markdown template.
 * Checks for mcp-tools.local.md overlay first.
 */
export function loadMcpToolsSection(fileSystem: FileSystemSeam, vars: { RICH_BLOCK_SHORT: string }): string {
  const { path: filePath } = resolveWithOverlay(fileSystem, 'mcp-tools.md', 'mcp-tools.local.md');
  const raw = fileSystem.readFileSync(filePath);
  if (raw === null) return '';
  return renderTemplate(stripComments(raw), vars);
}

/** Load A2A ball ownership check prompt (no variables, no overlay). */
export function loadA2aBallCheck(fileSystem: FileSystemSeam): string {
  const raw = fileSystem.readFileSync(templatePath(fileSystem, 'a2a-ball-check.md'));
  if (raw === null) return '';
  return stripComments(raw);
}

/** Load handoff decision tree template (no overlay). */
export function loadHandoffDecisionTree(fileSystem: FileSystemSeam, vars: { CC_MENTION: string }): string {
  const raw = fileSystem.readFileSync(templatePath(fileSystem, 'handoff-decision-tree.md'));
  if (raw === null) return '';
  return renderTemplate(stripComments(raw), vars);
}
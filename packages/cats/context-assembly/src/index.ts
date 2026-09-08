/**
 * @flowforge/cats-context-assembly — context-assembly domain (B12).
 *
 * Message Bundle selection/projection/carrier resolution, IntentParser,
 * governance L0 compile, prompt template loader, L0 staging content, chat history
 * ContextAssembler and SystemPromptBuilder. Ported from clowder-ai
 * `domains/cats/services/context`. Self-contained: store/config/file/dossier/
 * model/prompt-pipeline seams are injectable ports with in-memory contract
 * implementations. Runtime deps: only `zod` + `@flowforge/cats-shared`.
 */

// Contract + pure primitives
export * from './contract/message-bundle.ts';
export * from './pure/canonical-json.ts';
export * from './pure/sha256-digest.ts';
export * from './pure/markdown-readable.ts';
export * from './pure/cli-tool-label.ts';
export * from './pure/simple-yaml.ts';
export * from './pure/token-estimate.ts';
export * from './pure/format-prompt-time.ts';
export * from './pure/entrusted-work-signals.ts';
export * from './pure/prompt-digest.ts';

// Ports
export * from './ports/message-store.ts';
export * from './ports/thread-store.ts';
export * from './ports/visibility.ts';
export * from './ports/cat-context.ts';
export * from './ports/file-system.ts';

// Message Bundle subdomain
export * from './message-bundle/message-selection-types.ts';
export * from './message-bundle/message-selection-results.ts';
export * from './message-bundle/message-bundle-quote-matching.ts';
export * from './message-bundle/message-bundle-project-digest.ts';
export * from './message-bundle/message-bundle-source-projection.ts';
export * from './message-bundle/message-bundle-source-group.ts';
export * from './message-bundle/message-bundle-carrier-resolver.ts';
export * from './message-bundle/message-selection-resolver.ts';
export * from './message-bundle/message-bundle-prompt-resolver.ts';

// Context subdomain
export * from './context/intent-parser.ts';
export * from './context/rich-block-rules.ts';
export * from './context/governance-l0.ts';
export * from './context/prompt-template-loader.ts';
export * from './context/staging-content.ts';
export * from './context/context-assembler.ts';
export * from './context/system-prompt-builder.ts';
# Changelog

All notable changes to FlowForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Project scaffolding: LICENSE, CODEOWNERS, .gitignore, .editorconfig
- Security policy: SECURITY.md with five Iron Laws
- Contributor License Agreement: CLA.md (bilingual)
- Contributing guide: CONTRIBUTING.md (bilingual)
- Maintainers guide: MAINTAINERS.md
- Trademark policy: TRADEMARKS.md
- GitHub Actions: CI, release, CodeQL, docs, labels workflows
- Issue templates: bug report, feature request
- Pull request template
- Dependabot configuration
- Code of Conduct (Contributor Covenant 2.1)

### Changed
- Nothing yet.

### Deprecated
- Nothing yet.

### Removed
- Nothing yet.

### Fixed
- Nothing yet.

### Security
- Nothing yet.

## [0.1.0] - TBD

Initial public release of FlowForge — a configuration-driven Agent Harness framework with built-in self-evolution capabilities.

### Added
- Core: DI container, plugin protocol V3, tracing, context
- Evolution Engine: three modes (Scope Guard, Process Evolution, Knowledge Evolution)
- Loop Executor: Discover→Assign→Act→Verify→Persist
- Compiler: YAML workflow compiler (Parser→Validator→CodeGen)
- Tools: agentic RAG, publish, web search
- Seven-layer architecture: Application → Command → Execution → Tools → Memory → Evolution → Governance
- CLI: `flowforge` command-line interface

### Documentation
- README.md with quickstart and architecture overview
- docs/spec.md: specification
- docs/arch.md: architecture
- docs/design.md: detailed design
- docs/roadmap.md: development roadmap

---

## Changelog Format Guide / 更新日志格式说明

Each release entry should follow this structure:

```
## [VERSION] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements
```

### Link References

```
[Unreleased]: https://github.com/flowlight-ai/flowforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/flowlight-ai/flowforge/releases/tag/v0.1.0
```

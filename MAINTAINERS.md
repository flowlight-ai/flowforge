# FlowForge Maintainers / 维护者

This document lists the maintainers of the FlowForge project and describes the maintenance policy.

## Maintainer Roles

### Lead Maintainer / 首席维护者

- **ForgeMind** (@flowlight-ai)
  - Final decision authority on architecture and roadmap
  - Responsible for release management
  - Owns the `main` branch protection rules

### Core Maintainers / 核心维护者

Core maintainers have commit access and can approve PRs in their areas of expertise.

| Area | Maintainer | GitHub |
|------|-----------|--------|
| Evolution Engine | TBD | TBD |
| Loop Executor | TBD | TBD |
| Core / DI Container | TBD | TBD |
| Compiler / YAML | TBD | TBD |
| Tools / Memory | TBD | TBD |
| Documentation | TBD | TBD |

> Note: Core maintainer slots will be filled as the project grows. Contributions in any area may lead to maintainer role.

## Becoming a Maintainer / 成为维护者

1. **Active contributor**: Submit at least 5 merged PRs.
2. **Domain expertise**: Demonstrate deep understanding of a specific module.
3. **Code review**: Review at least 10 PRs from other contributors.
4. **Community engagement**: Help users in Issues and Discussions.
5. **Nomination**: Be nominated by an existing maintainer.
6. **Consensus**: Approved by majority of existing maintainers.

## Maintainer Responsibilities / 维护者职责

- Review and merge PRs in a timely manner.
- Ensure code quality and architectural integrity.
- Triage and label Issues.
- Participate in release planning.
- Mentor new contributors.
- Enforce the [Code of Conduct](./.github/CODE_OF_CONDUCT.md).
- Uphold the [five Iron Laws](./SECURITY.md).

## Decision Making / 决策机制

- **Small changes** (bug fixes, docs): Single maintainer approval.
- **Medium changes** (features, refactors): Two maintainer approvals.
- **Large changes** (architecture, breaking changes): Lead maintainer + consensus.
- **Emergencies** (security fixes): Lead maintainer can bypass the process.

## Release Process / 发布流程

1. Create release branch `release/vX.Y.Z`.
2. Run full test suite and benchmark.
3. Update [CHANGELOG.md](./CHANGELOG.md).
4. Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
5. Push tag: `git push origin vX.Y.Z`.
6. The release workflow will publish to PyPI and create GitHub Release automatically.
7. Announce release in Discussions.

### Versioning / 版本号

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes (e.g., API removal, architectural shifts)
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Stepping Down / 离任

Maintainers may step down at any time by notifying the team. Inactive maintainers (no commits, reviews, or issue comments for 6 months) will be moved to Emeritus status.

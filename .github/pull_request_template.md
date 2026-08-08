<!-- Thanks for contributing to OpenRoute! Please fill in the following. -->
<!-- 感谢你为 OpenRoute 贡献代码！请填写以下内容。 -->

## Description

<!-- Briefly describe what this PR does and why. Link related issues. -->
<!-- 简要描述本 PR 做了什么以及原因，并关联相关 Issue。 -->

Fixes # (issue number)

## Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactor (no functional changes)
- [ ] Test addition
- [ ] Chore (dependencies, CI, build, etc.)
- [ ] Security fix

## Checklist

<!-- Mark completed items with an "x". All items must be checked for review. -->

- [ ] My code follows the [contribution guidelines](../CONTRIBUTING.md)
- [ ] I have read the [SECURITY.md](../SECURITY.md)
- [ ] Type annotations are added (Python 3.11+)
- [ ] All I/O operations use `async/await`
- [ ] No hardcoded prompts, paths, keys, or ports (externalized to YAML config)
- [ ] Single-direction dependency rule is respected (no reverse imports)
- [ ] I have added tests for my changes
- [ ] All existing tests pass (`pytest tests/ -v`)
- [ ] Linter passes (`ruff check .`)
- [ ] Type checker passes (`mypy .`)
- [ ] My commits follow [conventional commits](https://www.conventionalcommits.org/)
- [ ] I have updated the [CHANGELOG.md](../CHANGELOG.md) if applicable
- [ ] I have signed the [CLA](../CLA.md) (if first contribution)

## Architecture Compliance

<!-- For changes that touch core modules, confirm architectural integrity -->

- [ ] No circular dependencies introduced
- [ ] DI container used for all dependency injection
- [ ] No business logic hardcoded in core modules

## Testing

<!-- Describe how you tested your changes -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated (if applicable)
- [ ] Manually tested
- [ ] Tested on Windows 11
- [ ] Tested on Linux

### Test Results

```
<!-- Paste test output summary here -->
```

## Screenshots / Recordings

<!-- If your change affects the UI or output, include screenshots or recordings -->

## Additional Notes

<!-- Any other information that reviewers should know -->

---

**For Maintainers:**

- [ ] CI checks pass
- [ ] Code review completed
- [ ] CLA signed
- [ ] Branch up to date with `main`
- [ ] Ready to merge (squash and merge recommended)

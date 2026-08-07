# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in FlowForge, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please:
1. Open a **private security advisory** on GitHub: go to the repo → Security → Advisories → "Report a vulnerability"
2. Or email: **security@flowlight-ai.dev**

We will acknowledge your report within **48 hours** and provide a timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest `main` | ✅ Yes |
| Latest release tag | ✅ Yes |
| Older releases | ⚠️ Best effort |

## Security Model

FlowForge is an AI Agent Harness with self-evolution capabilities. Its security model is built around **Iron Laws** — non-negotiable constraints enforced in code, not just prompts.

### Iron Laws

1. **Data Sanctuary** — Production data stores are isolated from development environments. Agents in development mode cannot access production data.
2. **No Self-Review** — An agent cannot approve its own code changes. Cross-agent review is preferred.
3. **Identity Immutability** — Agents cannot impersonate other agents. Identity is injected by the system, not self-declared.
4. **Config Immutability** — Runtime config is read-only to agents. Changing it requires human action.
5. **Port Boundary** — Agents never access localhost ports that don't belong to their service.

### Security Boundaries

| Boundary | Enforcement |
|----------|------------|
| Agent ↔ Production data | Port isolation + environment checks |
| Agent ↔ Agent identity | System-level injection, not prompt-level |
| Agent ↔ External services | API key management via environment variables |
| User input ↔ Agent execution | Input sanitization + capability restrictions |
| Self-evolution ↔ Critical code | Scope Guard (Mode A) + scope_guard.py |

### What We Scan For

- **API key values**: Zero tolerance in source code (test files with fake keys are allowed)
- **Personal information**: Checked in all non-test source files
- **Hardcoded paths/secrets/ports**: Detected by `tests/utils/config_drive_checker.py`
- **Denylist patterns**: `.env`, `.pem`, `.key`, `.p12`, `cookies.json`

### Responsible Disclosure

We follow a **90-day disclosure timeline**:
1. You report the vulnerability privately
2. We acknowledge within 48 hours
3. We develop and test a fix
4. We release the fix and credit the reporter (unless anonymity is requested)
5. After 90 days, the vulnerability may be publicly disclosed

## Scope

**In scope**:
- Authentication/authorization bypasses
- Data leaks (production data accessible in dev mode)
- Agent identity spoofing
- Prompt injection leading to unauthorized actions
- API key or secret exposure in source code
- Self-evolution proposing dangerous changes (bypassing Scope Guard)

**Out of scope**:
- Issues in upstream AI provider APIs (report to the provider)
- Social engineering attacks
- Denial of service via API rate limiting (handled by providers)
- Issues requiring physical access to the server

## Dependencies

We monitor dependencies for known vulnerabilities using:
- GitHub Dependabot alerts (see `.github/dependabot.yml`)
- `pip-audit` in CI pipeline
- GitHub CodeQL scanning (see `.github/workflows/codeql.yml`)

## Contact

- Security reports: **security@flowlight-ai.dev** (or private GitHub advisory)
- General questions: [GitHub Discussions](https://github.com/flowlight-ai/flowforge/discussions)

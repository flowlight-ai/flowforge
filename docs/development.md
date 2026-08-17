# Development Guide

English | [中文](development.zh.md)

> **Document ID**: development.md
> **Scope**: how to build, test, and contribute to FlowForge.
> **Companion rules**: [AGENTS.md](../AGENTS.md) (mandatory AI-tool & Git rules), [CONTRIBUTING.md](../CONTRIBUTING.md).

FlowForge is a TypeScript pnpm monorepo where **every capability is a Cordis plugin** (`packages/*`, scoped `@flowforge/*`), built on a vendored [Cordis](https://github.com/cordiverse/cordis) kernel rescooped as `@flowforge/cordis`. A Python 3.11+ monolith (`agents/`, `brain/`, `core/`, `llm/`, `loop/`, `forgemind/`, `web/`, `sdk.py`) is **legacy** and on a sunset path.

- **Active line** → TypeScript: use `pnpm`.
- **Legacy line** → Python: use `pytest` / `ruff`.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | `^22.19.0 \|\| >=24.0.0` | Enforced by `package.json` `engines`. |
| pnpm | `11.7.0` | Install via Corepack (`corepack enable && corepack prepare pnpm@11.7.0 --activate`). |
| Python | `>=3.11` | Only needed for the legacy Python monolith and its tests. |
| Git | any recent | All remote ops go through `./mgr` (see below). |

> **Platform awareness**: `flowlight/flowforge/mgr` → Gitee (base `master`); `flowlight-ai/...` → GitHub (base `main`). Develop only on the platform whose directory you are in, and open PRs only to that platform.

## Repository setup (TypeScript)

```sh
git clone https://gitee.com/flowlight/flowforge.git   # Gitee (base: master)
cd flowforge
corepack enable
pnpm install
```

`pnpm install` installs workspace deps for `vendor/*`, `packages/*/*`, and `apps/*`.

## Build & verify

```sh
pnpm build        # Build the Host aggregate: tsc -b tsconfig.host.json
pnpm typecheck    # Type-check only (same tsc pass as build)
pnpm lint         # oxlint static analysis
pnpm test         # vitest run
```

### Minimal pre-commit check set

Run **only the checks that cover your change surface**. Exhaustive coverage and the compatibility matrix are CI's job — do not run them locally in full.

| Change type | Run |
|-------------|-----|
| Pure TypeScript | `pnpm typecheck` + `pnpm lint` |
| Behavioral change | add `pnpm test` |
| Docs change | sync the corresponding document |
| Dependency / build output (`lib/`) change | `pnpm build` first |

## Running the host

> **Status**: the host CLI (`pnpm flowforge` / `pnpm start`, entry `apps/cli/src/bin.ts`) is **planned / stage 3** and `apps/cli` is not yet present. It is **not runnable** today.

Until `apps/cli` lands, exercise the system through each package's own examples and the test suite:

```sh
pnpm test                       # run the whole vitest suite
pnpm vitest <path/to/file>      # run a focused test
```

Check `packages/<group>/<pkg>/` for per-package examples and entrypoints.

## Python monolith (legacy)

The Python 3.11+ monolith is frozen for sunset. Use it only where the TS rewrite does not yet cover the capability you need.

```sh
# Create a venv and install (editable, with dev extras)
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Lint & test
ruff check .                   # static analysis (line-length 110, py311)
ruff format .                  # formatter (double quotes)
pytest                         # run the Python test suite
mypy .                         # strict type-check (optional)
```

Python config (pytest markers, ruff, mypy) is defined in [`pyproject.toml`](../pyproject.toml).

## Git workflow (highest priority)

**Never use `git push`, `curl`, or `Invoke-RestMethod` to touch Git remotes directly.** All commit / push / PR / sync operations **must** go through `./mgr`. Bypassing it skips the mandatory convention checks (commit message, PR title, PR body) and produces broken PRs.

```sh
./mgr pull                                          # pull current-platform updates
./mgr commit "type(scope): description [agentID]"  # commit (mandatory convention checks)
./mgr push --pr --title "PR title" --body "PR body"  # push + open PR (recommended)
./mgr sync "type(scope): desc [id]" --body "..."   # commit + push + PR in one step
./mgr pr "type(scope): desc [id]" --body "..."     # open a PR for the current branch
./mgr merge-cross --dry-run                         # preview cross-platform diff (one-way)
./mgr merge-cross                                   # one-way cross-platform merge: current platform → opposite (manual)
```

> **AI tools**: even "just opening a PR" must use `./mgr pr`. Calling the Gitee/GitHub API directly causes mojibake, missing descriptions, and skipped checks — a serious violation.

### Commit message format (mandatory)

```
type(scope): short description [#PR] [agentID]
```

- `type`: `feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `perf`
- Must carry an agent signature: `[sherlock]` / `[luban]` / `[wenxin]` / `[humming]` / `[keane]` / `[vangogh]` / `[davinci]` / `[sqrl]` / `[butterfly]`

Example: `feat(api): add user auth endpoint [sherlock]`

### Trunk protection

- **No direct push** to `master`/`main` — always go through a PR.
- No long-lived branches like `dev`. Delete temporary branches (`feat/xxx`, `fix/xxx`) right after merge.

## Dev red lines

1. Never commit secrets/tokens — inject via environment variables only.
2. Never hardcode prompts / paths / ports.
3. Do not commit `.venv/`, `node_modules/`, `__pycache__/`, `.autonomous/patches/`.
4. Never bypass PR to merge into the trunk.
5. Run lint and tests before committing.
6. LLM-generated content must be reviewed by an LLM (T7 iron rule).
7. Web features must be verified by driving a real browser against the DOM (T8 iron rule).
8. No single file over 1000 lines.

## Project layout

```
flowforge/
├── vendor/                 # vendored deps (rescooped as @flowforge/*): cordis, cosmokit, ...
├── packages/               # TS plugins (active rewrite) — packages/<group>/<pkg>/
├── apps/                   # (planned / stage 3) host CLI — apps/cli/src/bin.ts
├── web/                    # Web UI (Next.js frontend)
├── native/landlock-run/    # native sandbox runner (standalone subproject)
├── docs/                   # spec / architecture / development docs
├── mgr  mgr.cmd  mgr.ps1   # mandatory Git-workflow CLI (direct git remote ops forbidden)
├── scripts/                # helper scripts
└── agents/ brain/ core/ llm/ loop/ forgemind/ web/ sdk.py  # Python 3.11+ monolith (legacy, sunset)
```

## Where to go next

- Architecture & design: [docs/arch.md](../arch.md), [docs/design.md](../design.md), [docs/spec.md](../spec.md)
- Git workflow spec: [docs/git-workflow.md](git-workflow.md)
- General engineering spec: [docs/dev-spec.md](dev-spec.md)
- AI-tool rulebook: [AGENTS.md](../AGENTS.md)

# mgr — Git / PR / sync control plane

English | [中文](README.zh.md)

> `mgr` is flowforge's mandatory control plane for all git, PR, and cross-platform sync
> operations. Raw `git push` / `curl` to remotes is **forbidden** — every commit, push,
> PR, sync, and cross-platform merge must go through `./mgr`.
> Authoritative, full specification: [`docs/git-workflow.md`](../git-workflow.md).
> The script itself lives at the repo root: `mgr` (with `mgr.cmd` / `mgr.ps1` wrappers).

## Platform awareness (path decides the current platform)

`mgr` auto-detects the current platform from where the script sits on disk. Develop on
**one** platform and open PRs **only** there; cross-platform sync is a separate, manual step.

| Script location            | Current platform | Origin                 | Base branch |
|----------------------------|------------------|------------------------|-------------|
| `flowlight/<repo>/mgr`     | Gitee            | gitee.com              | `master`    |
| `flowlight-ai/<repo>/mgr`  | GitHub           | github.com             | `main`      |

- `commit` / `push` / `pr` / `sync` act **only** on the current platform — never the other side.
- Cross-platform sync uses `./mgr merge-cross` **only** (manual trigger).

## Key commands

| Command | Purpose |
|---------|---------|
| `./mgr pull` | Fetch and fast-forward / merge the current platform's remote updates. |
| `./mgr commit "type(scope): desc [agentID]"` | Stage all and commit on the current platform (enforces message format). |
| `./mgr push [--pr] [--title "T"] [--body "B"]` | Push the current branch; with `--pr` also creates/updates the PR. Refuses to push directly to `master`/`main`. |
| `./mgr pr "type(scope): desc [agentID]" [--body "B"]` | Open a PR for the current branch on the current platform. |
| `./mgr sync "type(scope): desc [agentID]" [--body "B"]` | One-shot: commit dirty + smart-push + open PR. On the base branch it auto-creates a temporary `sync/<base>-<ts>` branch. |
| `./mgr status [--cross] [--fetch]` | Show branch & sync state of the current platform (`--cross` shows both sides, `--fetch` refreshes from remote). |
| `./mgr merge-cross [--dry-run]` | **One-way** cross-platform merge: current platform → opposite platform. Creates a sync PR on the opposite side. `--dry-run` shows the file diff only. |
| `./mgr log [N]` | Show the last N commits (default 5). |
| `./mgr diff` | Show uncommitted changes. |
| `./mgr branch` | Show the current branch. |
| `./mgr list` | Show repo info and platform status. |
| `./mgr mirror-setup` | Configure bidirectional mirror remotes. |
| `./mgr protect` | Set Gitee `master` branch protection (Gitee only). |

Global scope flags (applied before the subcommand): `--all`, `--repo NAME`.

## Commit / PR message format (enforced)

`./mgr` **rejects** the operation locally if the message does not match:

```
type(scope): short description [#PR] [agentID]
```

- `type` must be one of (enforced by the script): `feat` `fix` `refactor` `chore`
  `docs` `test` `ci` `perf` `style` `build`.
- `scope` is an optional module name.
- `[agentID]` at the end is **required** and must be one of: `wenxin` `sherlock`
  `luban` `vangogh` `davinci` `keane` `humming` `sqrl` `butterfly`.
- `commit`, `pr`, and `sync` all enforce this. Examples:
  `fix(web): fix login timeout [luban]`, `docs(api): document health check [wenxin]`.

## Trunk protection

- **Never target `master` / `main` directly.** `./mgr push` refuses to push on a base
  branch and tells you to use a PR or branch first.
- All changes land via PR: `master` via Gitee PR, `main` via GitHub PR.
- No long-lived `dev` / `develop` branches. Temporary `feat/xxx` / `fix/xxx` branches are
  deleted right after merge.

See [`docs/git-workflow.md`](../git-workflow.md) for the complete, binding specification.

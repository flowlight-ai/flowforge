"use client";

import { useCallback, useEffect, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────

interface GitFileEntry {
  status: string;
  path: string;
}

interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

interface GitStatusResult {
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
}

interface CommitDetail {
  hash: string;
  files: Array<{ path: string; summary: string }>;
}

interface GitPanelProps {
  /** Optional worktree identifier forwarded to the backend. */
  worktreeId?: string;
  /** API base path; defaults to "/api/v1/git". */
  apiBase?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(isoDate).toLocaleDateString();
}

// ── Sub-components ──────────────────────────────────────────────────

function StatusBadge({
  status,
  variant,
}: {
  status: string;
  variant: "staged" | "unstaged" | "untracked";
}) {
  const colors = {
    staged: "bg-[var(--semantic-success-surface)] text-[var(--semantic-success)]",
    unstaged: "bg-[var(--semantic-warning-surface)] text-[var(--semantic-warning)]",
    untracked: "bg-[var(--bg-elevated)] text-[var(--muted)]",
  };
  return (
    <span
      className={`inline-block px-1 py-0.5 rounded text-micro font-mono font-bold ${colors[variant]}`}
    >
      {status}
    </span>
  );
}

function StatusSection({
  title,
  items,
  variant,
}: {
  title: string;
  items: GitFileEntry[];
  variant: "staged" | "unstaged" | "untracked";
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-micro font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">
        {title} ({items.length})
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <div
            key={item.path}
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--text)] py-0.5 px-1 rounded hover:bg-[var(--bg-elevated)]"
          >
            <StatusBadge status={item.status} variant={variant} />
            <span className="truncate">{item.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  isExpanded,
  onToggle,
}: {
  commit: GitCommit;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const relDate = formatRelativeDate(commit.date);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border)] ${
        isExpanded ? "bg-[var(--bg-elevated)]" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[var(--cafe-accent)] text-micro shrink-0">
          {commit.short}
        </span>
        <span className="truncate text-[var(--text)] flex-1">{commit.subject}</span>
        <span className="text-micro text-[var(--muted)] shrink-0">{relDate}</span>
      </div>
      <div className="text-micro text-[var(--muted)] mt-0.5">{commit.author}</div>
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────

/**
 * GitPanel — displays Git branch info, working-tree status (staged /
 * unstaged / untracked), and commit history. Replaces clowder-ai's
 * HealthDashboard with a compact status summary bar.
 *
 * Inline hook logic (state + effects) — no external useGitPanel dep.
 */
export function GitPanel({ worktreeId, apiBase = "/api/v1/git" }: GitPanelProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  const buildQuery = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams(extra);
      if (worktreeId) params.set("worktreeId", worktreeId);
      return params.toString();
    },
    [worktreeId],
  );

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/log?${buildQuery({ limit: "50" })}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCommits(data.commits ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch git log");
    } finally {
      setLoading(false);
    }
  }, [apiBase, buildQuery]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/status?${buildQuery()}`);
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch git status");
    }
  }, [apiBase, buildQuery]);

  const fetchCommitDetail = useCallback(
    async (hash: string) => {
      setCommitDetail(null);
      try {
        const res = await fetch(`${apiBase}/show?${buildQuery({ hash })}`);
        if (!res.ok) throw new Error(await res.text());
        setCommitDetail(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch commit detail");
      }
    },
    [apiBase, buildQuery],
  );

  const refresh = useCallback(async () => {
    await Promise.all([fetchLog(), fetchStatus()]);
  }, [fetchLog, fetchStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggleCommit = (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
    } else {
      setExpandedHash(hash);
      fetchCommitDetail(hash);
    }
  };

  const totalChanges = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — branch + refresh */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-micro font-semibold text-[var(--muted)] uppercase tracking-wider">
          {status?.branch ? `Branch: ${status.branch}` : "Git"}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-micro text-[var(--cafe-accent)] hover:opacity-80 disabled:opacity-50"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--semantic-critical)] bg-[var(--semantic-critical-surface)] border-b border-[var(--border)]">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Status summary — replaces clowder-ai HealthDashboard */}
        <div className="px-3 py-1.5 border-b border-[var(--border)] flex items-center gap-3 text-micro text-[var(--muted)]">
          <span>
            Staged{" "}
            <span className="text-[var(--semantic-success)] font-semibold">
              {status?.staged.length ?? 0}
            </span>
          </span>
          <span>
            Modified{" "}
            <span className="text-[var(--semantic-warning)] font-semibold">
              {status?.unstaged.length ?? 0}
            </span>
          </span>
          <span>
            Untracked{" "}
            <span className="text-[var(--text)] font-semibold">
              {status?.untracked.length ?? 0}
            </span>
          </span>
          <span className="ml-auto">Commits {commits.length}</span>
        </div>

        {/* Git Status Section */}
        {status && totalChanges > 0 && (
          <div className="border-b border-[var(--border)]">
            <button
              type="button"
              onClick={() => setStatusCollapsed(!statusCollapsed)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--bg-elevated)]"
            >
              <span className="text-micro font-semibold text-[var(--muted)] uppercase tracking-wider">
                Status ({totalChanges} changes)
              </span>
              <span className="text-micro text-[var(--muted)]">
                {statusCollapsed ? "▸" : "▾"}
              </span>
            </button>
            {!statusCollapsed && (
              <div className="px-3 pb-2">
                <StatusSection title="Staged" items={status.staged} variant="staged" />
                <StatusSection title="Modified" items={status.unstaged} variant="unstaged" />
                <StatusSection title="Untracked" items={status.untracked} variant="untracked" />
              </div>
            )}
          </div>
        )}

        {status && totalChanges === 0 && (
          <div className="px-3 py-2 text-xs text-[var(--semantic-success)] border-b border-[var(--border)]">
            Working tree clean
          </div>
        )}

        {/* Git Log Section */}
        <div>
          <div className="px-3 py-1.5 text-micro font-semibold text-[var(--muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-elevated)] backdrop-blur-sm border-b border-[var(--border)]">
            Commits ({commits.length})
          </div>
          {commits.map((commit) => (
            <div key={commit.hash}>
              <CommitRow
                commit={commit}
                isExpanded={expandedHash === commit.hash}
                onToggle={() => handleToggleCommit(commit.hash)}
              />
              {expandedHash === commit.hash &&
                commitDetail &&
                commitDetail.hash === commit.hash && (
                  <div className="bg-[var(--bg-elevated)] px-3 py-2 border-b border-[var(--border)]">
                    {commitDetail.files.length === 0 ? (
                      <div className="text-micro text-[var(--muted)]">No file changes</div>
                    ) : (
                      <div className="space-y-0.5">
                        {commitDetail.files.map((f) => (
                          <div
                            key={f.path}
                            className="flex items-center justify-between text-micro font-mono"
                          >
                            <span className="text-[var(--text)] truncate">{f.path}</span>
                            <span className="text-[var(--muted)] shrink-0 ml-2">{f.summary}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          ))}
          {commits.length === 0 && !loading && (
            <div className="px-3 py-4 text-xs text-[var(--muted)] text-center">
              No commits found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GitPanel;
